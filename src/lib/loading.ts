import { labelFor } from './address.ts'
import { openingSaid, type Opening } from './opening.ts'

/**
 * The cover over the whole browser while a page loads, and what it says when the load went wrong
 * or is taking too long. The look is the protocol's `Cover`, the module's half of the host's own
 * loading screen (the kehikko mark, breathing, and one sentence); this decides which sentence.
 *
 * It is up while either is true:
 * - something was asked to open (`Opening`: a pick, a hand-over, a typed or saved address), from
 *   the moment it was asked until the new page's first frame;
 * - the engine says the page is loading (a link clicked in the page, back, forward, reload, an
 *   agent's navigation): from the navigation's request to its document's `domcontentloaded`. Shown
 *   only after `LOADING_GRACE_MS`, so a quick hop inside a site does not flash a cover.
 *
 * It ends on its own when both are over. A failed navigation turns it into `failed`, with the
 * engine's sentence and Try again; one still loading after `LOADING_AT_MOST` turns into `slow`,
 * which ends by itself if the page does arrive. Either can be put away to look at the page as it is.
 */

/** How long the engine's own loading goes uncovered: a hop inside a site is usually done by then. */
export const LOADING_GRACE_MS = 300

/** How long the cover says "Loading" before it says the page is taking long: the engine gives up on a navigation after 30 s. */
export const LOADING_AT_MOST = 30_000

/** What went wrong with the last load, until it is retried, put away, or a new one starts. */
export type Trouble =
  | { kind: 'failed'; url: string | null; what: string; why: string | null }
  | { kind: 'slow'; url: string | null; what: string }

export const LOADING_WORDS = 'Loading content…'
export const FAILED_WORDS = 'The page could not be loaded.'
export const SLOW_WORDS = 'The page is taking a long time to load.'
export const SHOW_ANYWAY = 'Show the page'

/** What the cover draws: the protocol cover's state, its sentence and its second line, or nothing. */
export type Covering =
  | { state: 'loading'; words: string; detail: string | null }
  | { state: 'refused'; words: string; detail: string | null; retry: string | null }
  | null

export function covering({
  opening,
  loadingShown,
  trouble,
  pageUrl,
}: {
  opening: Opening | null
  /** The engine has been loading for longer than the grace. */
  loadingShown: boolean
  trouble: Trouble | null
  pageUrl: string
}): Covering {
  if (trouble?.kind === 'failed') return { state: 'refused', words: FAILED_WORDS, detail: withAddress(trouble.why ?? trouble.what, trouble.url), retry: trouble.url }
  if (trouble?.kind === 'slow') return { state: 'refused', words: SLOW_WORDS, detail: trouble.what, retry: trouble.url }
  if (opening) return { state: 'loading', words: LOADING_WORDS, detail: openingSaid(opening) }
  if (loadingShown) return { state: 'loading', words: LOADING_WORDS, detail: /^https?:/.test(pageUrl) ? labelFor(pageUrl, null, 64) : null }
  return null
}

/** A failure's second line names the address it could not open, when its sentence does not already. */
function withAddress(said: string, url: string | null): string {
  if (!url || said.includes(url)) return said
  return said ? `${said} ${url}` : url
}

/** What a load that went wrong was trying to open, for the trouble's second line and Try again. */
export function troubleOf(kind: Trouble['kind'], opening: Opening | null, pageUrl: string, why: string | null = null): Trouble {
  const url = opening?.url ?? (/^https?:/.test(pageUrl) ? pageUrl : null)
  const what = opening ? openingSaid(opening) : url ? labelFor(url, null, 64) : ''
  return kind === 'failed' ? { kind, url, what, why } : { kind, url, what }
}

/** Chrome's own error page: where a main frame lands when its navigation failed. */
export function failedPage(url: string): boolean {
  return url.startsWith('chrome-error:')
}
