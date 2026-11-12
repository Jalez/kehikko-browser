import { readTrackerRef } from 'kehikot-module-protocol'

import { allowedUrl } from './address.ts'
import { pageFor } from './forge.ts'

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
  | { kind: 'open'; ref: string; url: string; title?: string }
  | { kind: 'pending'; refs: string[] }
  | { kind: 'none'; why: string }

interface Row {
  ref?: unknown
  url?: unknown
  title?: unknown
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

interface Source {
  tracker?: unknown
  host?: unknown
  repo?: unknown
  default?: unknown
}

/**
 * A page for a ref, needing no row. GitHub, naming its repository: `gh:owner/repo#12` →
 * https://github.com/owner/repo/issues/12 (GitHub sends an issue number that is a pull request on to
 * the pull request). GitLab: `!7` → `https://<host>/<group>/<project>/-/merge_requests/7`, `#7` →
 * `/-/issues/7`, the host and project taken from the host's `sources` (the reading's list of
 * repositories): the one named by a qualified ref (`gl:group/project!7`), else the tracker's default
 * one, so a self-hosted instance works. No source to say where → null. A short GitHub spelling
 * (`gh#12`) means the project's default repository, which only the host knows.
 */
export function directUrl(ref: string, sources: readonly unknown[] = []): string | null {
  const name = readTrackerRef(ref)
  if (!name) return null
  if (name.tracker === 'github') {
    if (!name.repo) return null
    return pageFor({ forge: 'github', host: 'github.com', path: name.repo }, 'either', name.number)
  }
  const all = sources.filter((one): one is Source => !!one && typeof one === 'object' && (one as Source).tracker === 'gitlab')
  const pick = name.repo
    ? all.find((one) => one.repo === name.repo)
    : (all.find((one) => one.default === true) ?? (all.length === 1 ? all[0] : undefined))
  if (!pick || typeof pick.host !== 'string' || typeof pick.repo !== 'string') return null
  const url = pageFor({ forge: 'gitlab', host: pick.host, path: pick.repo }, name.kind === 'change' ? 'change' : 'issue', name.number)
  return allowedUrl(url) ? url : null
}

/** What to open for a selection, given the host's answer to `tracker.get { refs }` (or null when it had none). */
export function urlForSelection(selection: readonly string[], reading: { rows?: unknown; missing?: unknown; sources?: unknown } | null): Followed {
  const refs = refsToAsk(selection)
  if (refs.length === 0) {
    return { kind: 'none', why: selection.length ? 'Nothing picked is an issue or a pull request.' : 'Nothing is picked.' }
  }
  const rows = Array.isArray(reading?.rows) ? (reading.rows as Row[]) : []
  const missing = Array.isArray(reading?.missing) ? (reading.missing as Missing[]) : []
  const sources = Array.isArray(reading?.sources) ? (reading.sources as unknown[]) : []
  const pending: string[] = []
  for (const ref of refs) {
    const row = rows.find((one) => one && one.ref === ref)
    const title = row && typeof row.title === 'string' && row.title.trim() ? { title: row.title.trim() } : {}
    if (row && typeof row.url === 'string' && allowedUrl(row.url) && row.url !== 'about:blank') return { kind: 'open', ref, url: row.url, ...title }
    const direct = directUrl(ref, sources)
    if (direct) return { kind: 'open', ref, url: direct, ...title }
    if (missing.some((one) => one && one.ref === ref && one.reason === 'pending')) pending.push(ref)
  }
  if (pending.length) return { kind: 'pending', refs: pending }
  return { kind: 'none', why: `The host has no page for ${refs.join(', ')}.` }
}
