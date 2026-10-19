import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

import { chromium, type BrowserContext, type CDPSession, type Dialog, type Page } from 'playwright-core'

import { allowedUrl, BLANK, normaliseAddress } from '../src/lib/address.ts'
import { keyEventParams, viewportFor, type KeyIn, type Size } from '../src/lib/input.ts'
import { collect, describe, locate, type CollectArgs, type Snapshot } from './snapshot.ts'

/**
 * One real Chromium, driven over CDP, shared by every container of this module
 * and every agent that calls its MCP door.
 *
 * - Launched with playwright-core: the person's installed Google Chrome (the
 *   `chrome` channel) when there is one, else Playwright's own Chromium, else a
 *   sentence saying how to install one.
 * - Headless: nothing opens on the desktop. What it shows reaches the module's
 *   page as `Page.startScreencast` frames, and the person's pointer and keys go
 *   back as `Input.dispatch*`, so it is the same inside the desktop app and in a
 *   plain browser, and the host's own overlays stack over it as over any page.
 * - A persistent profile, so a login survives a restart. It is machine-level
 *   (it is the person's browser, not a project's data) and lives in the Kehikot
 *   machine directory, never in the person's own Chrome profile.
 * - Its DevTools endpoint is opened on 127.0.0.1 only, so Playwright tests
 *   (`chromium.connectOverCDP`) and Playwright MCP (`--cdp-endpoint`) can attach
 *   to the very browser the person is watching.
 *
 * Nothing here sends the profile, cookies or page content anywhere: frames go to
 * this module's own page over its own fenced socket, and text to whoever called
 * the MCP door on this machine.
 */

type Env = Record<string, string | undefined>

/** `~/Library/Application Support/Kehikot/browser-profile` (macOS), the XDG data dir elsewhere. `KEHIKOT_BROWSER_PROFILE` overrides it. */
export function profileDir(env: Env = process.env, platform: string = process.platform): string {
  if (env.KEHIKOT_BROWSER_PROFILE) return env.KEHIKOT_BROWSER_PROFILE
  const home = env.HOME || homedir()
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Kehikot', 'browser-profile')
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'kehikot', 'browser-profile')
}

/** Where the DevTools endpoint would like to be: five above this module's own port, unless `KEHIKOT_BROWSER_CDP_PORT` says. */
export function preferredCdpPort(modulePort: number, env: Env = process.env): number {
  const said = Number(env.KEHIKOT_BROWSER_CDP_PORT)
  return Number.isInteger(said) && said > 1024 && said < 65536 ? said : modulePort + 5
}

function free(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

async function freePortFrom(port: number): Promise<number> {
  for (let p = port; p < port + 50; p += 1) if (await free(p)) return p
  throw new Error(`No free port for the DevTools endpoint between ${port} and ${port + 49}.`)
}

export type Status = { state: 'idle' | 'starting' | 'ready'; why: null } | { state: 'failed'; why: string }

export interface PageState {
  url: string
  title: string
  canBack: boolean
  canForward: boolean
  loading: boolean
}

export interface Frame {
  /** base64 JPEG */
  data: string
  width: number
  height: number
}

export interface Listener {
  frame?(frame: Frame): void
  page?(state: PageState): void
  status?(status: Status): void
  dialog?(dialog: { type: string; message: string; defaultValue: string } | null): void
}

export interface Endpoint {
  http: string
  ws: string | null
  port: number
}

const SLOT = `__kehikotRefs_${Math.random().toString(36).slice(2, 10)}`
const MAX_PAGES = 8

/** A function to run in the page, with a no-op `__name` in case a transpiler kept names. */
function inPage<A>(fn: (args: A) => unknown, args: A): string {
  return `(() => { const __name = (f) => f; return (${fn.toString()})(${JSON.stringify(args)}) })()`
}

export class Engine {
  private context: BrowserContext | null = null
  private starting: Promise<BrowserContext> | null = null
  private current: Page | null = null
  private session: CDPSession | null = null
  private sessionPage: Page | null = null
  private listeners = new Set<Listener>()
  private size: Size & { scale: number } = { width: 1280, height: 800, scale: 1 }
  private status: Status = { state: 'idle', why: null }
  private cdpPort: number | null = null
  private cdpWs: string | null = null
  private dialog: Dialog | null = null
  private dialogTimer: ReturnType<typeof setTimeout> | null = null
  private casting = false
  private lastState: PageState = { url: BLANK, title: '', canBack: false, canForward: false, loading: false }
  private pushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly modulePort: () => number,
    private readonly log: (line: string) => void = () => {},
    private readonly env: Env = process.env,
  ) {}

  /* ------------------------------------------------------------------ *
   * Starting, and what it says while it does.
   * ------------------------------------------------------------------ */

  getStatus(): Status {
    return this.status
  }

  private setStatus(status: Status): void {
    this.status = status
    for (const one of this.listeners) one.status?.(status)
  }

  /** The running browser, started on first use. Rejects with a sentence a person can act on. */
  async ready(): Promise<BrowserContext> {
    if (this.context) return this.context
    if (!this.starting) {
      this.starting = this.launch().then(
        (context) => {
          this.context = context
          this.setStatus({ state: 'ready', why: null })
          return context
        },
        (error: unknown) => {
          this.starting = null
          const why = error instanceof Error ? error.message : String(error)
          this.setStatus({ state: 'failed', why })
          throw new Error(why)
        },
      )
      this.setStatus({ state: 'starting', why: null })
    }
    return this.starting
  }

  private async launch(): Promise<BrowserContext> {
    const dir = profileDir(this.env)
    mkdirSync(dir, { recursive: true })
    const port = await freePortFrom(preferredCdpPort(this.modulePort(), this.env))
    const headless = this.env.KEHIKOT_BROWSER_HEADLESS !== '0'
    const common = {
      headless,
      /* Playwright turns Chromium's sandbox off by default; this browser opens the open web, so it stays on. */
      chromiumSandbox: true,
      viewport: null,
      acceptDownloads: false,
      args: [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--window-size=${this.size.width},${this.size.height}`],
    }
    const tried: string[] = []
    let context: BrowserContext | null = null
    for (const channel of ['chrome', null] as const) {
      try {
        context = await chromium.launchPersistentContext(dir, channel ? { ...common, channel } : common)
        this.log(`browser: started ${channel ? 'Google Chrome' : 'Playwright Chromium'} with profile ${dir}`)
        break
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0]! : String(error)
        tried.push(`${channel ?? 'Playwright Chromium'}: ${message}`)
        if (/ProcessSingleton|SingletonLock|profile.*in use|already in use/i.test(message)) {
          throw new Error(
            `The browser profile at ${dir} is in use by another browser. Another copy of this module is probably running; stop it, or set KEHIKOT_BROWSER_PROFILE to a different folder.`,
          )
        }
      }
    }
    if (!context) {
      throw new Error(
        'No Chromium to run. Install Google Chrome (https://www.google.com/chrome/), or Playwright’s Chromium with '
          + '`bunx playwright-core install chromium` in this module’s folder, then press Try again. '
          + `(Tried — ${tried.join(' · ')})`,
      )
    }
    this.context = context
    this.cdpPort = port
    this.cdpWs = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then((r) => r.json() as Promise<{ webSocketDebuggerUrl?: string }>)
      .then((v) => v.webSocketDebuggerUrl ?? null)
      .catch(() => null)

    context.on('page', (page) => this.adopt(page, true))
    context.on('close', () => {
      this.context = null
      this.starting = null
      this.current = null
      this.session = null
      this.sessionPage = null
      this.setStatus({ state: 'failed', why: 'The browser closed. Press Try again to start it again.' })
    })
    const pages = context.pages()
    for (const page of pages) this.adopt(page, false)
    const first = pages[pages.length - 1] ?? (await context.newPage())
    await this.focus(first)
    return context
  }

  /** Stop the browser. Called when this process stops; the profile stays on disk. */
  async close(): Promise<void> {
    const context = this.context
    this.context = null
    this.starting = null
    if (context) await context.close().catch(() => {})
  }

  endpoint(): Endpoint | null {
    if (!this.cdpPort) return null
    return { http: `http://127.0.0.1:${this.cdpPort}`, ws: this.cdpWs, port: this.cdpPort }
  }

  /* ------------------------------------------------------------------ *
   * Pages: the one in front, popups, and keeping the page's address true.
   * ------------------------------------------------------------------ */

  private adopt(page: Page, front: boolean): void {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      const url = frame.url()
      /* A page can still send its main frame somewhere this module does not show. */
      if (!allowedUrl(url) && !url.startsWith('blob:') && !url.startsWith('chrome-error:')) {
        this.log(`browser: refused to stay on ${url.slice(0, 80)}`)
        void page.goto(BLANK).catch(() => {})
      }
      if (page === this.current) this.pushState()
    })
    page.on('load', () => page === this.current && this.pushState())
    page.on('domcontentloaded', () => page === this.current && this.pushState())
    page.on('dialog', (dialog) => this.onDialog(page, dialog))
    page.on('close', () => {
      if (page !== this.current) return
      const rest = this.context?.pages().filter((p) => p !== page) ?? []
      const next = rest[rest.length - 1]
      if (next) void this.focus(next)
      else if (this.context) void this.context.newPage().catch(() => {})
    })
    if (front) {
      void this.focus(page)
      /* Popups pile up; the oldest go once there are too many. */
      const pages = this.context?.pages() ?? []
      for (const old of pages.slice(0, Math.max(0, pages.length - MAX_PAGES))) if (old !== page) void old.close().catch(() => {})
    }
  }

  private async focus(page: Page): Promise<void> {
    this.current = page
    await this.attach(page)
    this.pushState()
  }

  private async attach(page: Page): Promise<void> {
    if (this.sessionPage === page && this.session) return
    const old = this.session
    this.session = null
    this.sessionPage = page
    if (old) await old.detach().catch(() => {})
    const context = this.context
    if (!context) return
    const session = await context.newCDPSession(page)
    this.session = session
    session.on('Page.screencastFrame', (event: { data: string; sessionId: number; metadata: { deviceWidth?: number; deviceHeight?: number } }) => {
      void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
      if (session !== this.session) return
      const frame: Frame = {
        data: event.data,
        width: Math.round(event.metadata.deviceWidth ?? this.size.width),
        height: Math.round(event.metadata.deviceHeight ?? this.size.height),
      }
      for (const one of this.listeners) one.frame?.(frame)
    })
    await this.applySize(session)
    this.casting = false
    if (this.listeners.size) await this.cast(true)
  }

  private async applySize(session: CDPSession | null = this.session): Promise<void> {
    if (!session) return
    await session
      .send('Emulation.setDeviceMetricsOverride', {
        width: this.size.width,
        height: this.size.height,
        deviceScaleFactor: this.size.scale,
        mobile: false,
      })
      .catch(() => {})
  }

  private async cast(on: boolean): Promise<void> {
    const session = this.session
    if (!session) return
    if (on) {
      if (this.casting) await session.send('Page.stopScreencast').catch(() => {})
      this.casting = true
      await session
        .send('Page.startScreencast', {
          format: 'jpeg',
          quality: 75,
          maxWidth: Math.round(this.size.width * this.size.scale),
          maxHeight: Math.round(this.size.height * this.size.scale),
          everyNthFrame: 1,
        })
        .catch(() => {})
    } else if (this.casting) {
      this.casting = false
      await session.send('Page.stopScreencast').catch(() => {})
    }
  }

  /** What the page in front says about itself, sent to every viewer when it changes. Coalesced. */
  private pushState(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.readState().then((state) => {
        this.lastState = state
        for (const one of this.listeners) one.page?.(state)
      })
    }, 60)
  }

  private async readState(): Promise<PageState> {
    const page = this.current
    if (!page || page.isClosed()) return { url: BLANK, title: '', canBack: false, canForward: false, loading: false }
    let canBack = false
    let canForward = false
    const session = this.session
    if (session && this.sessionPage === page) {
      const history = (await session.send('Page.getNavigationHistory').catch(() => null)) as { currentIndex: number; entries: unknown[] } | null
      if (history) {
        canBack = history.currentIndex > 0
        canForward = history.currentIndex < history.entries.length - 1
      }
    }
    const title = await page.title().catch(() => '')
    return { url: page.url(), title, canBack, canForward, loading: false }
  }

  state(): PageState {
    return this.lastState
  }

  async page(): Promise<Page> {
    await this.ready()
    const page = this.current
    if (!page || page.isClosed()) throw new Error('The browser has no page open. Press Try again.')
    return page
  }

  /* ------------------------------------------------------------------ *
   * Viewers: the module's page, over its socket.
   * ------------------------------------------------------------------ */

  watch(listener: Listener): () => void {
    this.listeners.add(listener)
    listener.status?.(this.status)
    listener.page?.(this.lastState)
    void this.ready()
      .then(() => this.cast(true))
      .then(() => this.pushState())
      .catch(() => {})
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) void this.cast(false)
    }
  }

  /** The viewport a viewer asks for: its canvas in CSS pixels and its device pixel ratio. */
  async resize(box: Size, scale: number): Promise<void> {
    const size = viewportFor(box)
    const s = Number.isFinite(scale) ? Math.min(3, Math.max(1, scale)) : 1
    if (size.width === this.size.width && size.height === this.size.height && s === this.size.scale) return
    this.size = { ...size, scale: s }
    await this.applySize()
    if (this.casting) await this.cast(true)
  }

  viewport(): Size {
    return { width: this.size.width, height: this.size.height }
  }

  async mouse(event: { type: string; x: number; y: number; button: string; buttons: number; clickCount: number; modifiers: number }): Promise<void> {
    const type = { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved' }[event.type]
    if (!type || !this.session) return
    await this.session
      .send('Input.dispatchMouseEvent', {
        type,
        x: event.x,
        y: event.y,
        button: ['left', 'middle', 'right', 'none'].includes(event.button) ? event.button : 'none',
        buttons: event.buttons & 7,
        clickCount: Math.min(3, Math.max(0, event.clickCount | 0)),
        modifiers: event.modifiers & 15,
      } as never)
      .catch(() => {})
  }

  async wheel(event: { x: number; y: number; dx: number; dy: number; modifiers: number }): Promise<void> {
    if (!this.session) return
    const clamp = (n: number) => Math.max(-5000, Math.min(5000, Number(n) || 0))
    await this.session
      .send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: event.x,
        y: event.y,
        deltaX: clamp(event.dx),
        deltaY: clamp(event.dy),
        modifiers: event.modifiers & 15,
      } as never)
      .catch(() => {})
  }

  async key(event: KeyIn): Promise<void> {
    const params = keyEventParams(event)
    if (!params || !this.session) return
    await this.session.send('Input.dispatchKeyEvent', params as never).catch(() => {})
  }

  /** Text pasted on the module's page, typed into whatever has focus in the browser. */
  async insertText(text: string): Promise<void> {
    if (!this.session || typeof text !== 'string' || !text) return
    await this.session.send('Input.insertText', { text: text.slice(0, 100_000) }).catch(() => {})
  }

  /** What is selected in the page, for the person's copy: the browser's clipboard is not theirs. */
  async selectedText(): Promise<string> {
    const page = this.current
    if (!page) return ''
    return page
      .evaluate(() => {
        const active = document.activeElement as HTMLInputElement | null
        if (active && typeof active.selectionStart === 'number' && typeof active.value === 'string' && active.type !== 'password') {
          return active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0)
        }
        return String(getSelection() ?? '')
      })
      .catch(() => '')
  }

  /* ------------------------------------------------------------------ *
   * Dialogs: shown to a viewer, dismissed when nobody answers.
   * ------------------------------------------------------------------ */

  private onDialog(page: Page, dialog: Dialog): void {
    if (page !== this.current || this.listeners.size === 0) {
      void dialog.dismiss().catch(() => {})
      return
    }
    if (this.dialog) void this.dialog.dismiss().catch(() => {})
    this.dialog = dialog
    for (const one of this.listeners) one.dialog?.({ type: dialog.type(), message: dialog.message().slice(0, 2000), defaultValue: dialog.defaultValue() })
    if (this.dialogTimer) clearTimeout(this.dialogTimer)
    this.dialogTimer = setTimeout(() => void this.answerDialog(false), 60_000)
  }

  async answerDialog(accept: boolean, text?: string): Promise<void> {
    const dialog = this.dialog
    this.dialog = null
    if (this.dialogTimer) clearTimeout(this.dialogTimer)
    this.dialogTimer = null
    for (const one of this.listeners) one.dialog?.(null)
    if (!dialog) return
    await (accept ? dialog.accept(typeof text === 'string' ? text : undefined) : dialog.dismiss()).catch(() => {})
  }

  /* ------------------------------------------------------------------ *
   * What the person's bar and an agent's tools do.
   * ------------------------------------------------------------------ */

  /** Open an address, after the one check that decides: http, https or about:blank. */
  async navigate(typed: string): Promise<PageState> {
    const address = normaliseAddress(typed)
    if (!address.ok) throw new Error(address.why)
    const page = await this.page()
    try {
      await page.goto(address.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0]! : String(error)
      if (!/interrupted by another navigation|net::ERR_ABORTED/.test(message)) throw new Error(`Could not open ${address.url}: ${message}`)
    }
    return this.settled()
  }

  async back(): Promise<PageState> {
    const page = await this.page()
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null)
    return this.settled()
  }

  async forward(): Promise<PageState> {
    const page = await this.page()
    await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null)
    return this.settled()
  }

  async reload(): Promise<PageState> {
    const page = await this.page()
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null)
    return this.settled()
  }

  async stop(): Promise<void> {
    if (this.session) await this.session.send('Page.stopLoading').catch(() => {})
  }

  private async settled(): Promise<PageState> {
    const state = await this.readState()
    this.lastState = state
    for (const one of this.listeners) one.page?.(state)
    return state
  }

  async currentState(): Promise<PageState> {
    await this.page()
    return this.settled()
  }

  async snapshot(options: { query?: string | null; withText?: boolean; maxText?: number; maxElements?: number } = {}): Promise<Snapshot> {
    const page = await this.page()
    const args: CollectArgs = {
      slot: SLOT,
      maxText: Math.min(100_000, Math.max(500, options.maxText ?? 20_000)),
      maxElements: Math.min(500, Math.max(1, options.maxElements ?? 250)),
      query: options.query ?? null,
      withText: options.withText ?? true,
    }
    return (await page.evaluate(inPage(collect, args))) as Snapshot
  }

  async readPage(options: { maxText?: number; interactiveOnly?: boolean } = {}): Promise<string> {
    const snap = await this.snapshot({ withText: !options.interactiveOnly, ...(options.maxText ? { maxText: options.maxText } : {}) })
    return describe(snap)
  }

  async find(query: string): Promise<string> {
    const q = query.trim().slice(0, 200)
    if (!q) throw new Error('Say what to find.')
    const snap = await this.snapshot({ query: q, withText: false, maxElements: 25 })
    return describe(snap, { query: q })
  }

  private async pointFor(ref: string): Promise<{ x: number; y: number }> {
    const page = await this.page()
    if (!/^e\d{1,5}$/.test(ref)) throw new Error(`"${ref.slice(0, 20)}" is not a ref. Refs look like e12 and come from read_page or find.`)
    const at = (await page.evaluate(inPage(locate, { slot: SLOT, ref }))) as { x: number; y: number } | { why: string }
    if ('why' in at) throw new Error(at.why)
    return at
  }

  async click(target: { ref?: string; x?: number; y?: number; button?: 'left' | 'right' | 'middle'; double?: boolean }): Promise<PageState> {
    const page = await this.page()
    let at: { x: number; y: number }
    if (target.ref) at = await this.pointFor(target.ref)
    else if (Number.isFinite(target.x) && Number.isFinite(target.y)) at = { x: target.x!, y: target.y! }
    else throw new Error('Say what to click: a ref from read_page or find, or x and y in viewport pixels.')
    const before = page.url()
    await page.mouse.click(at.x, at.y, { button: target.button ?? 'left', clickCount: target.double ? 2 : 1 })
    /* A click that navigates: wait for the new document a little, never long. */
    await page.waitForURL((url) => url.href !== before, { timeout: 1500, waitUntil: 'commit' }).catch(() => {})
    if (page.url() !== before) await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})
    return this.settled()
  }

  async type(text: string, ref?: string): Promise<void> {
    const page = await this.page()
    if (ref) {
      const at = await this.pointFor(ref)
      await page.mouse.click(at.x, at.y)
    }
    await page.keyboard.type(text.slice(0, 10_000))
  }

  async press(key: string): Promise<PageState> {
    const page = await this.page()
    if (!key || key.length > 64) throw new Error('Say one key or chord, like Enter or Control+a.')
    await page.keyboard.press(key)
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {})
    return this.settled()
  }

  async scroll(how: { direction?: string; amount?: number; ref?: string; x?: number; y?: number }): Promise<string> {
    const page = await this.page()
    const vp = this.viewport()
    let at = { x: Math.round(vp.width / 2), y: Math.round(vp.height / 2) }
    if (how.ref) at = await this.pointFor(how.ref)
    else if (Number.isFinite(how.x) && Number.isFinite(how.y)) at = { x: how.x!, y: how.y! }
    const amount = Math.min(10_000, Math.max(1, Number(how.amount) || Math.round(vp.height * 0.8)))
    const direction = how.direction ?? (how.ref ? null : 'down')
    if (direction) {
      const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0
      const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0
      if (!dx && !dy) throw new Error('direction is up, down, left or right.')
      await page.mouse.move(at.x, at.y)
      await page.mouse.wheel(dx, dy)
      await page.waitForTimeout(250)
    }
    const y = await page.evaluate(() => [Math.round(window.scrollY), document.documentElement.scrollHeight, window.innerHeight]).catch(() => null)
    return y ? `Scrolled. Now at ${y[0]} of ${y[1]} (viewport ${y[2]} tall).` : 'Scrolled.'
  }

  async screenshot(): Promise<Buffer> {
    const page = await this.page()
    return page.screenshot({ type: 'png', timeout: 15_000 })
  }

  async waitFor(what: { text?: string; selector?: string; url?: string; gone?: boolean; timeoutMs?: number }): Promise<string> {
    const page = await this.page()
    const timeout = Math.min(30_000, Math.max(100, Number(what.timeoutMs) || 10_000))
    const state = what.gone ? 'hidden' : 'visible'
    try {
      if (what.text) await page.getByText(what.text.slice(0, 500)).first().waitFor({ state, timeout })
      else if (what.selector) await page.locator(what.selector.slice(0, 500)).first().waitFor({ state, timeout })
      else if (what.url) {
        const part = what.url.slice(0, 500)
        await page.waitForURL((url) => url.href.includes(part), { timeout })
      } else await page.waitForTimeout(Math.min(timeout, 10_000))
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0]! : String(error)
      throw new Error(`Not within ${timeout} ms: ${message}`)
    }
    return 'It happened.'
  }

  hasProfile(): boolean {
    return existsSync(profileDir(this.env))
  }
}
