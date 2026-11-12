import { labelFor } from './address.ts'

/**
 * What the page is opening, from the moment it is asked until the new page's
 * first frame: said at once ("Opening !4013…"), and shown in the address bar
 * before the engine has heard back from the forge.
 *
 * A forge page takes from a few hundred milliseconds to seconds before its
 * server answers (measured on bee: GitHub 0.1–1.6 s, GitLab 0.8–4 s to the
 * first byte), and the engine reports an address only once the navigation
 * commits. Without this the bar keeps the old address for that whole time.
 *
 * Its life:
 * - `url: null`: a pick, before the host's reading has named the page.
 * - `url`, not `committed`: asked of the engine; the bar shows `url`.
 * - `committed`: the engine reported the new document (or a redirect of it);
 *   the bar shows the engine's address, and the next frame ends it.
 */
export interface Opening {
  /** The address asked for, or null while a pick is still being looked up. */
  url: string | null
  /** What a person reads: the picked ref, or null for the address itself. */
  label: string | null
  /** The page's title when the host's reading named one (a pick), for the host's own loading cover. */
  title?: string | null
  from: 'pick' | 'handed' | 'typed'
  /** The page's address when this was asked, to tell its commit from an old page's news. */
  before: string
  committed: boolean
}

/** A pick, said at once. An address already on its way stays (the hand-over of the same click). */
export function pickedOpening(now: Opening | null, ref: string, before: string): Opening {
  if (now?.url && !now.committed) return { ...now, label: ref }
  return { url: null, label: ref, from: 'pick', before, committed: false }
}

/** An address asked of the engine. A pick's label is kept while it names the same page. */
export function startOpening(now: Opening | null, next: { url: string; label: string | null; title?: string | null; from: Opening['from']; before: string }): Opening {
  const label = next.label ?? (now && !now.url ? now.label : null)
  return { url: next.url, label, ...(next.title ? { title: next.title } : {}), from: next.from, before: next.before, committed: false }
}

/** What the host's cover says while a pick opens: the page's title once the reading named it, else the ref. */
export function hostLoadingWords(now: Opening | null): string | null {
  if (!now || now.from !== 'pick' || now.committed) return null
  const what = now.title ?? now.label
  return what ? `Loading ${what}…` : null
}

/**
 * Whether a resolved pick is already on screen, so nothing needs opening: the page shows that
 * address, its last load did not fail, and no other address is on its way (a newer navigation to
 * something else would otherwise land over it). A same-address check alone is not enough.
 */
export function alreadyShown(url: string, pageUrl: string, now: Opening | null, failed: boolean): boolean {
  if (failed || url !== pageUrl) return false
  return !now?.url || now.url === url
}

/** The address an engine failure names (`Could not open <url>: …`), to tell an older navigation's failure from the one on its way. */
export function failureFor(text: string): string | null {
  return /^Could not open (\S+): /.exec(text)?.[1] ?? null
}

/**
 * Whether a navigation to `url` is already on its way, so asking again would
 * only restart it: a pick resolving to the address a hand-over is opening, or
 * a hand-over of the address a pick is opening. One click in a module listing refs
 * can do both. Two hand-overs, or a typed address, always go.
 */
export function alreadyOpening(now: Opening | null, url: string, from: Opening['from']): boolean {
  if (!now || now.url !== url) return false
  if (from === 'pick') return true
  if (from === 'handed') return now.from === 'pick'
  return false
}

/** The engine reported the page at `url`: the opening has committed once it is the new page (or where it redirected). */
export function committed(now: Opening, url: string): Opening {
  if (now.committed || !now.url) return now
  if (url === now.url || url !== now.before) return { ...now, committed: true }
  return now
}

/** A frame arrived: it shows the new page once the navigation committed. */
export function painted(now: Opening): boolean {
  return now.committed
}

/** The address bar, when nobody is typing in it: the address on its way, then the engine's. */
export function addressShown(now: Opening | null, pageUrl: string): string {
  return now?.url && !now.committed ? now.url : pageUrl
}

export function openingSaid(now: Opening): string {
  const what = now.label ?? (now.url ? labelFor(now.url, null, 64) : '')
  return what ? `Opening ${what}…` : 'Opening…'
}
