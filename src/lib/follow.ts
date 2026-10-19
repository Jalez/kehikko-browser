import { readTrackerRef } from 'kehikot-module-protocol'

import { allowedUrl } from './address.ts'

/**
 * Which page a canvas pick names.
 *
 * The selection carries refs (`gh#41`, `!7`, `gh:owner/repo#12`) and nothing
 * else; what a ref's page is comes from the host's one tracker reading
 * (`tracker.get`, `TrackerRow.url`). A ref the host has not read yet comes back
 * `pending`, and the page asks again when `context.tracker.at` moves.
 */

/** At most this many picked refs are asked about; the first that has a page wins. */
export const ASK_AT_MOST = 16

export type Followed =
  | { kind: 'open'; ref: string; url: string }
  | { kind: 'pending'; refs: string[] }
  | { kind: 'none'; why: string }

interface Row {
  ref?: unknown
  url?: unknown
}
interface Missing {
  ref?: unknown
  reason?: unknown
}

/** The refs worth asking the host about: tracker spellings only, in the order picked, de-duplicated. */
export function refsToAsk(selection: readonly string[]): string[] {
  const out: string[] = []
  for (const ref of selection) {
    if (out.includes(ref)) continue
    if (readTrackerRef(ref) === null) continue
    out.push(ref)
    if (out.length >= ASK_AT_MOST) break
  }
  return out
}

/**
 * A page for a ref that names its own repository on GitHub, needing no reading:
 * `gh:owner/repo#12` → https://github.com/owner/repo/issues/12 (GitHub sends an
 * issue number that is a pull request on to the pull request). Short spellings
 * (`gh#12`) mean the project's default repository, which only the host knows.
 */
export function directUrl(ref: string): string | null {
  const name = readTrackerRef(ref)
  if (!name || name.tracker !== 'github' || !name.repo) return null
  return `https://github.com/${name.repo}/issues/${name.number}`
}

/** What to open for a selection, given the host's answer to `tracker.get { refs }` (or null when it had none). */
export function urlForSelection(selection: readonly string[], reading: { rows?: unknown; missing?: unknown } | null): Followed {
  const refs = refsToAsk(selection)
  if (refs.length === 0) {
    return { kind: 'none', why: selection.length ? 'Nothing picked is an issue or a pull request.' : 'Nothing is picked.' }
  }
  const rows = Array.isArray(reading?.rows) ? (reading.rows as Row[]) : []
  const missing = Array.isArray(reading?.missing) ? (reading.missing as Missing[]) : []
  const pending: string[] = []
  for (const ref of refs) {
    const row = rows.find((one) => one && one.ref === ref)
    if (row && typeof row.url === 'string' && allowedUrl(row.url) && row.url !== 'about:blank') return { kind: 'open', ref, url: row.url }
    const direct = directUrl(ref)
    if (direct) return { kind: 'open', ref, url: direct }
    if (missing.some((one) => one && one.ref === ref && one.reason === 'pending')) pending.push(ref)
  }
  if (pending.length) return { kind: 'pending', refs: pending }
  return { kind: 'none', why: `The host has no page for ${refs.join(', ')}.` }
}
