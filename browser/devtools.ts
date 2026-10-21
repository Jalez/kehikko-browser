import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium, type BrowserContext } from 'playwright-core'

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
    const dir = mkdtempSync(join(this.env.TMPDIR || tmpdir(), 'kehikot-browser-devtools-'))
    this.dir = dir
    const common = { headless: false, viewport: null, args: [`--app=${url}`, '--window-size=1100,760', '--no-first-run', '--no-default-browser-check'] }
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
      this.forget()
    })
    /* The window is the frontend and nothing else: closing its page closes it. */
    context.pages()[0]?.on('close', () => void context.close().catch(() => {}))
  }

  async close(): Promise<void> {
    const context = this.context
    this.context = null
    if (context) await context.close().catch(() => {})
    this.forget()
  }

  private forget(): void {
    if (this.dir) rmSync(this.dir, { recursive: true, force: true })
    this.dir = null
  }
}
