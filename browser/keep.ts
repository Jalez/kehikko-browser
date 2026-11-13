/**
 * Pages kept ready: each place's page stays open in the background, frozen, so going back to it is
 * instant and finds it as it was left. What is kept, for how long, and when a kept page is refreshed
 * is decided here; the browser's own work (opening, freezing, loading) is `PageOps`, so all of it is
 * tested without a browser.
 *
 * Light by default, with no setting needed ("Automatic"):
 * - a page out of sight costs memory, not processor: it is frozen (`freeze`), and thawed when shown;
 * - at most `AUTO_PAGES` pages, within min(1 GB, 10% of memory); half of each when the machine says its
 *   memory is short, only the page on screen when it is very short. Least worth keeping goes first
 *   (seen long ago, and seldom);
 * - a kept page shown again after a minute out of sight is checked: the site is asked whether it
 *   changed (a conditional request with its ETag or Last-Modified), and a changed page is loaded again;
 *   a site that does not say is loaded again after `AUTO_STALE_MS` out of sight. Either way off
 *   screen, in a page of its own, swapped in once painted, so nothing blanks. One refresh at a time, and only while
 *   the machine is not busy. A page with something typed in it is never replaced: the person is told
 *   a newer one is there, and decides;
 * - nothing is loaded speculatively: a page is kept once it was shown.
 *
 * Every number can be set in Browser's settings (`settings.ts`); each defaults to Automatic.
 */

export type Pressure = 'normal' | 'warn' | 'critical'

export interface Machine {
  totalBytes: number
  pressure: Pressure
  /** The processor is busy: the 1-minute load is at or above the number of cores. */
  busy: boolean
}

export interface KeepSettings {
  /** How many pages are kept besides the one on screen. */
  pages: 'auto' | number
  /** How much memory kept pages may use, in MB. */
  memoryMb: 'auto' | number
  /** After how many minutes out of sight a kept page is refreshed when shown again. */
  refresh: 'auto' | 'never' | number
  /** `auto` (and `cheap`) asks the site whether the page changed first; `full` always loads it again. */
  revalidate: 'auto' | 'cheap' | 'full'
}

export const AUTOMATIC: KeepSettings = { pages: 'auto', memoryMb: 'auto', refresh: 'auto', revalidate: 'auto' }

export const AUTO_PAGES = 6
export const AUTO_MEMORY_CEILING = 1024 * 1024 * 1024
export const AUTO_MEMORY_SHARE = 0.1
export const AUTO_STALE_MS = 15 * 60_000
/**
 * What a page costs beyond its script heap (its renderer process, its DOM, its pictures): measured,
 * six typical pages kept added about 88 MB each to Chromium's resident memory (bench/hidden-pages.ts).
 */
export const PAGE_OVERHEAD = 80 * 1024 * 1024

/** How many pages, and how many bytes, may be kept besides the one on screen. */
export function budgetOf(settings: KeepSettings, machine: Pick<Machine, 'totalBytes' | 'pressure'>): { pages: number; bytes: number } {
  /* Very short of memory: only what is on screen, whatever the settings say. The machine comes first. */
  if (machine.pressure === 'critical') return { pages: 0, bytes: 0 }
  const short = machine.pressure === 'warn'
  const pages = settings.pages === 'auto' ? (short ? Math.floor(AUTO_PAGES / 2) : AUTO_PAGES) : Math.max(0, Math.floor(settings.pages))
  const bytes =
    settings.memoryMb === 'auto'
      ? Math.min(AUTO_MEMORY_CEILING, machine.totalBytes * AUTO_MEMORY_SHARE) * (short ? 0.5 : 1)
      : Math.max(0, settings.memoryMb) * 1024 * 1024
  return { pages, bytes }
}

/** How long a page may be out of sight before it is checked when shown again. */
export function staleAfterMs(settings: KeepSettings): number {
  if (settings.refresh === 'never') return Infinity
  if (settings.refresh === 'auto') return AUTO_STALE_MS
  return Math.max(1, settings.refresh) * 60_000
}

export interface Kept<P> {
  key: string
  page: P
  /** The page a popup was opened from, shown again when the popup closes. */
  opener?: P
  /** When it was last shown, and how often. */
  shownAt: number
  shown: number
  /** When it was last on screen or refreshed: how stale it is is counted from here. */
  freshAt: number
  /** Its memory, measured (`heapBytes` plus `PAGE_OVERHEAD`), and when. */
  bytes: number
  measuredAt: number
  /** The person said never to refresh this page by itself. */
  asIs: boolean
}

/** How much a kept page is worth keeping: seen recently, and seen often. */
export function worth(entry: Pick<Kept<unknown>, 'shownAt' | 'shown'>): number {
  return entry.shownAt + Math.min(entry.shown, 10) * 3 * 60_000
}

/** The keys to let go so what is kept fits the budget. The page on screen is never one. Pure. */
export function evictions(entries: readonly Pick<Kept<unknown>, 'key' | 'shownAt' | 'shown' | 'bytes'>[], onScreen: string | null, budget: { pages: number; bytes: number }): string[] {
  const rest = entries.filter((one) => one.key !== onScreen).sort((a, b) => worth(b) - worth(a))
  const out: string[] = []
  let pages = 0
  let bytes = 0
  for (const one of rest) {
    if (pages + 1 <= budget.pages && bytes + one.bytes <= budget.bytes) {
      pages += 1
      bytes += one.bytes
    } else out.push(one.key)
  }
  return out
}

/** What the site says about a kept page's address, asked with its validators. */
export type Revalidated = 'same' | 'changed' | 'unknown' | 'offline'

/** What the person is told about the page on screen, in the footer, only when it matters. */
export type Notice = { kind: 'newer' } | { kind: 'failed'; why: string } | null

export interface PageOps<P> {
  /** A new blank page, not shown. */
  open(): Promise<P>
  close(page: P): Promise<void>
  /** Put it on screen (cast it to the viewers). */
  show(page: P): Promise<void>
  /** Out of sight: stop its scripts, animations and media. Thawed before it is shown. */
  freeze(page: P): Promise<void>
  thaw(page: P): Promise<void>
  alive(page: P): boolean
  url(page: P): string
  /** Its script heap in bytes, or 0 when it cannot say. */
  heapBytes(page: P): Promise<number>
  /** Something typed into it would be lost by loading it again. */
  dirty(page: P): Promise<boolean>
  /** Ask the site whether the page at `page`'s address changed since it was loaded. */
  revalidate(page: P): Promise<Revalidated>
  /** A fresh copy of `page`'s address, loaded and painted out of sight, scrolled as `page` was. Rejects with a sentence. */
  loadFresh(page: P): Promise<P>
  machine(): Machine
  settings(): KeepSettings
  now(): number
  /** The page on screen got news for the footer. */
  notice(key: string, notice: Notice): void
}

const REMEASURE_MS = 60_000
/** A page out of sight for less than this is shown as it is, without asking the site. */
export const ASK_AFTER_MS = 60_000

export class Keeper<P> {
  readonly kept = new Map<string, Kept<P>>()
  onScreen: string | null = null
  private refreshing: Promise<void> | null = null

  constructor(private readonly ops: PageOps<P>) {}

  /** The place's own page, kept or new, on screen. `kept` says whether it was already there. */
  async show(key: string): Promise<{ kept: boolean; page: P }> {
    const now = this.ops.now()
    const leaving = this.onScreen !== null && this.onScreen !== key ? this.kept.get(this.onScreen) : undefined
    let entry = this.kept.get(key)
    if (entry && !this.ops.alive(entry.page)) {
      this.kept.delete(key)
      entry = undefined
    }
    const kept = entry !== undefined
    if (!entry) {
      const page = await this.ops.open()
      entry = { key, page, shownAt: now, shown: 0, freshAt: now, bytes: PAGE_OVERHEAD, measuredAt: 0, asIs: false }
      this.kept.set(key, entry)
    }
    entry.shownAt = now
    entry.shown += 1
    this.onScreen = key
    this.ops.notice(key, null)
    if (kept) await this.ops.thaw(entry.page)
    await this.ops.show(entry.page)
    if (leaving && this.ops.alive(leaving.page)) {
      leaving.freshAt = now
      await this.ops.freeze(leaving.page)
    }
    await this.trim()
    if (kept) this.refreshLater(entry)
    return { kept, page: entry.page }
  }

  /** The page shown now, for the place on screen, or null. */
  page(): P | null {
    return this.onScreen ? (this.kept.get(this.onScreen)?.page ?? null) : null
  }

  /** The place on screen opened a popup: it is that place's page until it closes. */
  popup(page: P): void {
    const entry = this.onScreen ? this.kept.get(this.onScreen) : undefined
    if (!entry) return
    entry.opener = entry.page
    entry.page = page
  }

  /** Whether any place holds this page (as its page or a popup's opener). */
  holds(page: P): boolean {
    for (const one of this.kept.values()) if (one.page === page || one.opener === page) return true
    return false
  }

  /** A page closed by itself. Its place goes back to the page it came from, or a new one if it is on screen. */
  async closed(page: P): Promise<void> {
    for (const entry of [...this.kept.values()]) {
      if (entry.opener === page) entry.opener = undefined
      if (entry.page !== page) continue
      const back = entry.opener && this.ops.alive(entry.opener) ? entry.opener : null
      entry.opener = undefined
      if (back) entry.page = back
      else this.kept.delete(entry.key)
      if (entry.key === this.onScreen) {
        if (back) {
          await this.ops.thaw(back)
          await this.ops.show(back)
        } else {
          this.onScreen = null
          await this.show(entry.key)
        }
      }
    }
  }

  setAsIs(key: string, on: boolean): void {
    const entry = this.kept.get(key)
    if (entry) entry.asIs = on
  }

  asIs(key: string): boolean {
    return this.kept.get(key)?.asIs ?? false
  }

  /** Let go what no longer fits, least worth keeping first. Measured first where the measure is old. */
  async trim(): Promise<string[]> {
    const now = this.ops.now()
    for (const entry of this.kept.values()) {
      if (entry.key === this.onScreen || now - entry.measuredAt < REMEASURE_MS) continue
      entry.bytes = (await this.ops.heapBytes(entry.page).catch(() => 0)) + PAGE_OVERHEAD
      entry.measuredAt = now
    }
    const gone = evictions([...this.kept.values()], this.onScreen, budgetOf(this.ops.settings(), this.ops.machine()))
    for (const key of gone) {
      const entry = this.kept.get(key)
      this.kept.delete(key)
      if (!entry) continue
      await this.ops.close(entry.page).catch(() => {})
      if (entry.opener) await this.ops.close(entry.opener).catch(() => {})
    }
    return gone
  }

  /** Waits for the refresh that is running, if any. For tests and for a stop. */
  async settled(): Promise<void> {
    while (this.refreshing) await this.refreshing
  }

  private refreshLater(entry: Kept<P>): void {
    const settings = this.ops.settings()
    const away = this.ops.now() - entry.freshAt
    if (entry.asIs || settings.refresh === 'never' || away < ASK_AFTER_MS) return
    /* One at a time, and not while the machine is busy: the next showing asks again. */
    if (this.refreshing || this.ops.machine().busy) return
    this.refreshing = this.refresh(entry, settings, away > staleAfterMs(settings)).finally(() => {
      this.refreshing = null
    })
  }

  /**
   * The page judges first: the site is asked whether it changed (its ETag or Last-Modified moved), and
   * a changed page is loaded again whenever it is shown. A site that does not say is loaded again only
   * once the page has been out of sight longer than the setting (`stale`), and so is every page when
   * the setting says always reload.
   */
  private async refresh(entry: Kept<P>, settings: KeepSettings, stale: boolean): Promise<void> {
    const page = entry.page
    if (!/^https?:/.test(this.ops.url(page))) return
    if (settings.revalidate !== 'full') {
      const said = await this.ops.revalidate(page).catch((): Revalidated => 'unknown')
      if (said === 'same') {
        entry.freshAt = this.ops.now()
        return
      }
      if (said === 'offline') return stale ? this.tell(entry, { kind: 'failed', why: 'Couldn’t refresh: offline.' }) : undefined
      if (said === 'unknown' && !stale) return
    } else if (!stale) return
    if (await this.ops.dirty(page).catch(() => true)) return this.tell(entry, { kind: 'newer' })
    let fresh: P
    try {
      fresh = await this.ops.loadFresh(page)
    } catch (error) {
      return this.tell(entry, { kind: 'failed', why: `Couldn’t refresh: ${error instanceof Error ? error.message : String(error)}` })
    }
    /* Moved on, closed or navigated meanwhile: the fresh copy is not what is wanted any more. */
    if (this.kept.get(entry.key) !== entry || entry.page !== page || !this.ops.alive(page) || this.ops.url(fresh) !== this.ops.url(page)) {
      await this.ops.close(fresh).catch(() => {})
      return
    }
    entry.page = fresh
    entry.freshAt = this.ops.now()
    entry.measuredAt = 0
    if (entry.key === this.onScreen) await this.ops.show(fresh)
    else await this.ops.freeze(fresh)
    await this.ops.close(page).catch(() => {})
  }

  private tell(entry: Kept<P>, notice: Notice): void {
    if (entry.key === this.onScreen) this.ops.notice(entry.key, notice)
  }
}
