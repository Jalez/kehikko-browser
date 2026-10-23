import { existsSync, lstatSync, mkdtempSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium, type BrowserContext } from 'playwright-core'

import { NO_SIGNAL_HANDLERS } from './signals.ts'

/**
 * Chromium's own DevTools for the page the person sees, in a window of its own.
 *
 * ## Where it opens, and why there
 *
 * The frontend is the one the DevTools endpoint serves itself, on 127.0.0.1
 * (`/devtools/inspector.html?ws=…`), not `devtoolsFrontendUrl` from `/json/list`: that one is
 * `chrome-devtools-frontend.appspot.com`, a page from the internet driving this browser.
 *
 * It opens in a small Chromium app window this module starts (`--app=<frontend>`), with a
 * throwaway profile in the temporary folder, because that is the one place it reliably works:
 *
 * - Inside the container it would be an iframe in the module's page, and in the desktop app that
 *   page is rendered by the system WebView (WebKit on macOS), which cannot run the DevTools
 *   frontend: it is a Chromium-only application.
 * - `window.open` from the page hands the address to the person's default browser (the desktop
 *   app opens new windows there), and Safari or Firefox cannot run it either.
 * - The browser this module drives is headless, so it has no window to dock DevTools into.
 *
 * The window is the same Chrome or Chromium the module already runs (`channel: 'chrome'` first),
 * shows the frontend and nothing else, and is closed with this module. Its profile holds nothing
 * of the person's and is removed when the window closes.
 *
 * The endpoint refuses its own frontend unless Chrome was started with
 * `--remote-allow-origins=<the endpoint's own origin>` (measured on Chrome 155: a 403 on the
 * socket). The engine passes exactly that origin and no other.
 */

type Env = Record<string, string | undefined>

/** What every DevTools window's throwaway profile is called, in the temporary folder: this module's, and nothing else's. */
export const DEVTOOLS_PREFIX = 'kehikot-browser-devtools-'

/** A leftover younger than this may be a window another copy of this module is opening right now. */
const YOUNG_MS = 60_000

/** The temporary folder the DevTools profiles are made in. */
export function devtoolsTemp(env: Env = process.env): string {
  return env.TMPDIR || tmpdir()
}

/** Whether a Chrome still holds a profile: its `SingletonLock` names `<host>-<pid>`, and that pid is alive. */
function held(dir: string, alive: (pid: number) => boolean): boolean {
  let lock: string
  try {
    lock = readlinkSync(join(dir, 'SingletonLock'))
  } catch {
    return false
  }
  const pid = Number(/-(\d+)$/.exec(lock)?.[1])
  return Number.isInteger(pid) && pid > 0 && alive(pid)
}

/**
 * Wait until Chrome has let go of a profile, for at most `within` ms. Chrome removes `SingletonLock`
 * last as it quits, after Playwright's close has already resolved, and writes `Local State` before
 * that: a folder removed sooner is written again, and left behind.
 */
export async function released(dir: string, within = 1000): Promise<void> {
  const until = Date.now() + within
  while (Date.now() < until) {
    try {
      lstatSync(join(dir, 'SingletonLock'))
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    /* EPERM: it exists, and is somebody else's. */
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Remove the DevTools profiles an earlier run left behind (a process that was killed before it could
 * remove its own), once, when this module starts serving.
 *
 * Only folders this module makes (`DEVTOOLS_PREFIX`, real directories, never a link), and never one a
 * live Chrome still holds or one made in the last minute: another copy of Browser on this machine
 * (the person's own, on its own port) may have a DevTools window open, or be opening one. Says what it
 * removed. Returns the folders removed.
 */
export function sweepDevtoolsProfiles(
  log: (line: string) => void = () => {},
  env: Env = process.env,
  { now = Date.now(), alive = isAlive }: { now?: number; alive?: (pid: number) => boolean } = {},
): string[] {
  const temp = devtoolsTemp(env)
  let names: string[]
  try {
    names = readdirSync(temp)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names) {
    if (!name.startsWith(DEVTOOLS_PREFIX)) continue
    const dir = join(temp, name)
    try {
      const stat = lstatSync(dir)
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue
      if (now - stat.mtimeMs < YOUNG_MS) continue
      if (held(dir, alive)) continue
      rmSync(dir, { recursive: true, force: true })
      removed.push(dir)
    } catch {
      /* Gone already, or not ours to read: leave it. */
    }
  }
  if (removed.length) log(`browser: removed ${removed.length} DevTools profile(s) an earlier run left in ${temp}`)
  return removed
}

/** The one origin the endpoint lets drive it from a page: its own. */
export function allowOriginsArg(port: number): string {
  return `--remote-allow-origins=http://127.0.0.1:${port}`
}

const TARGET = /^[A-Za-z0-9_-]{1,128}$/

/** The DevTools frontend the endpoint serves, pointed at one target. */
export function devtoolsFrontend(port: number, targetId: string): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`not a port: ${port}`)
  if (!TARGET.test(targetId)) throw new Error('not a DevTools target id')
  return `http://127.0.0.1:${port}/devtools/inspector.html?ws=127.0.0.1:${port}/devtools/page/${targetId}`
}

/** Whether an address is a DevTools frontend on loopback, the only thing the window is pointed at. */
export function isDevtoolsFrontend(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1:\d{1,5}\/devtools\/inspector\.html\?ws=127\.0\.0\.1:\d{1,5}\/devtools\/page\/[A-Za-z0-9_-]{1,128}$/.test(url)
}

export class DevtoolsWindow {
  private context: BrowserContext | null = null
  private dir: string | null = null

  constructor(
    private readonly log: (line: string) => void = () => {},
    private readonly env: Env = process.env,
  ) {}

  async open(url: string): Promise<void> {
    if (!isDevtoolsFrontend(url)) throw new Error('That is not a DevTools frontend on this machine.')
    const page = this.context?.pages()[0]
    if (page && !page.isClosed()) {
      await page.goto(url).catch(() => {})
      await page.bringToFront().catch(() => {})
      return
    }
    await this.close()
    /* A throwaway profile in the temporary folder: never the person's, never the module's. */
    const dir = mkdtempSync(join(devtoolsTemp(this.env), DEVTOOLS_PREFIX))
    this.dir = dir
    const common = { headless: false, viewport: null, ...NO_SIGNAL_HANDLERS, args: [`--app=${url}`, '--window-size=1100,760', '--no-first-run', '--no-default-browser-check'] }
    let context: BrowserContext | null = null
    for (const channel of ['chrome', null] as const) {
      try {
        context = await chromium.launchPersistentContext(dir, channel ? { ...common, channel } : common)
        break
      } catch (error) {
        this.log(`browser: DevTools window with ${channel ?? 'Playwright Chromium'}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
      }
    }
    if (!context) {
      this.forget()
      throw new Error('Could not open a DevTools window: no Chrome or Chromium to open it in.')
    }
    this.context = context
    context.on('close', () => {
      if (this.context === context) this.context = null
      /* Closed by the person, or by `close`: the profile goes once Chrome has let go of it. */
      void released(dir).then(() => this.forgetDir(dir))
    })
    /* The window is the frontend and nothing else: closing its page closes it. */
    context.pages()[0]?.on('close', () => void context.close().catch(() => {}))
  }

  async close(): Promise<void> {
    const context = this.context
    const dir = this.dir
    this.context = null
    if (context) await context.close().catch(() => {})
    if (dir) {
      await released(dir)
      this.forgetDir(dir)
    }
  }

  /** Remove the window's profile now. Synchronous, so it can run on `exit` too, when nothing is awaited. */
  forget(): void {
    if (this.dir) this.forgetDir(this.dir)
  }

  /** Remove one profile this window made; a later window's is not touched. */
  private forgetDir(dir: string): void {
    if (this.dir === dir) this.dir = null
    /* Never a throw: this runs from an event handler and on `exit`. A Chrome still writing its last
       files makes a removal see a folder that is not empty (measured); it is tried again, and
       whatever is left, the next start sweeps. */
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    } catch (error) {
      this.log(`browser: could not remove the DevTools profile ${dir} yet (${error instanceof Error ? error.message : String(error)}); the next start will.`)
    }
  }
}
