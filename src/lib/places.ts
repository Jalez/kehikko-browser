/**
 * The address this browser showed at each place, and what to show on arrival.
 *
 * A place is project › space › kehikko. The project is not in the key: the record is kept inside the
 * project (`<project>/.kehikot/browser/places.json`). A space is what the host says in
 * `context.space` (protocol 2.89.0): its path of ids from the top-level space, and the children
 * picked out together. An older host says only the epic and its picked parts, which is the same
 * place spelled by the compatibility mapping (`epicPartsOf`): the epic is the top-level space, one
 * part is that child, several parts are the epic with those children picked. So both spell the
 * same key for every place an older host can name.
 *
 * Each place holds its OWN address and nothing else. A place nothing was shown at has nothing to
 * restore: Browser shows that nothing is shown there, never what another space, a broader one or the
 * project last showed (a fallback once did, and switching to an empty space kept the previous page up).
 */

export interface Place {
  epic: string | null
  /** The ids of the parts a person picked out. Empty is the whole epic. */
  parts: readonly string[]
  /**
   * 2.89.0. The space's path of ids, top-level first, and its picked children, from `context.space`;
   * null or absent from a host that does not say spaces, and on "All spaces". When said, it wins over
   * `epic` and `parts`, which a host fills from it.
   */
  space?: { ids: readonly string[]; picked: readonly string[] } | null
  /** The kehikko's `key` (never its row id). */
  kehikko: string | null
}

export interface Visit {
  url: string
  title: string
  /** ISO time it was recorded, which is also how the oldest is found when the record is full. */
  at: string
}

export type Places = Record<string, Visit>

/** The record holds at most this many keys; the oldest go first. */
export const MAX_PLACES = 400

const PROJECT = 'project'

const sorted = (ids: readonly string[]) => [...new Set(ids)].sort().join(',')

/**
 * The one key of a place. Parts (and picked children) are sorted, so the same pick in another order
 * is the same place. A top-level space, and a depth-2 space with nothing picked, are spelled as an
 * older host's epic and parts, so the record reads the same from either host; anything deeper
 * names its whole path.
 */
export function placeKey(place: Place): string {
  const segments: string[] = []
  const ids = place.space?.ids ?? []
  const picked = place.space?.picked ?? []
  if (ids.length) {
    segments.push(`epic:${ids[0]}`)
    if (ids.length === 1) {
      if (picked.length) segments.push(`parts:${sorted(picked)}`)
    } else if (ids.length === 2 && !picked.length) segments.push(`parts:${ids[1]}`)
    else {
      segments.push(`space:${ids.join('.')}`)
      if (picked.length) segments.push(`picked:${sorted(picked)}`)
    }
  } else if (place.epic) {
    segments.push(`epic:${place.epic}`)
    if (place.parts.length) segments.push(`parts:${sorted(place.parts)}`)
  }
  if (place.kehikko) segments.push(`kehikko:${place.kehikko}`)
  return segments.length ? segments.join('/') : PROJECT
}

/** The visit kept at exactly this place, or null when nothing was shown here. */
export function restoreFrom(places: Places, key: string): (Visit & { key: string }) | null {
  const visit = Object.prototype.hasOwnProperty.call(places, key) ? places[key] : undefined
  return visit && typeof visit.url === 'string' ? { ...visit, key } : null
}

/** The record with this visit kept at this place, and nowhere else. Pure: the old record is untouched. */
export function recordAt(places: Places, key: string, visit: Visit, max = MAX_PLACES): Places {
  const next: Places = { ...places, [key]: visit }
  const all = Object.entries(next)
  if (all.length <= max) return next
  all.sort((a, b) => (a[1].at < b[1].at ? 1 : a[1].at > b[1].at ? -1 : 0))
  return Object.fromEntries(all.slice(0, max))
}

/** Whether a key looks like one `placeKey` makes, so a request cannot write arbitrary names. */
export function isPlaceKey(key: unknown): key is string {
  if (typeof key !== 'string') return false
  if (key === PROJECT) return true
  if (key.length > 1200) return false
  return key.split('/').every((segment) => /^(epic|parts|space|picked|kehikko):[A-Za-z0-9_.,:-]{1,1000}$/.test(segment))
}

/** The space a key stands in, as a path of ids (and picked children), without its kehikko. Pure. */
export function spaceOfKey(key: string): { ids: string[]; picked: string[] } {
  let ids: string[] = []
  let picked: string[] = []
  for (const segment of key.split('/')) {
    const [kind, value = ''] = segment.split(/:(.*)/s)
    if (kind === 'epic') ids = [value]
    else if (kind === 'parts') {
      const parts = value.split(',')
      if (parts.length === 1) ids = [...ids, parts[0]!]
      else picked = parts
    } else if (kind === 'space') ids = value.split('.')
    else if (kind === 'picked') picked = value.split(',')
  }
  return { ids, picked }
}

export interface Suggestions {
  /** Pages shown in the spaces around this one: the spaces above it, its siblings, the children it picked. Most recent first. */
  nearby: (Visit & { key: string })[]
  /** The project's other recent pages. Most recent first. */
  recent: (Visit & { key: string })[]
}

/**
 * What a place with nothing shown offers to open (the empty space): the pages used near it, then
 * the project's recent ones, each address once, nothing from this very place (it has none). Pure.
 */
export function suggestionsFor(places: Places, key: string, most = 6): Suggestions {
  const here = spaceOfKey(key)
  const near = (other: { ids: string[]; picked: string[] }): boolean => {
    if (!here.ids.length || !other.ids.length || other.ids[0] !== here.ids[0]) return false
    const prefix = (a: string[], b: string[]) => a.length <= b.length && a.every((id, at) => b[at] === id)
    if (prefix(other.ids, here.ids)) return true // a space above this one, or this space on another kehikko
    if (other.ids.length === here.ids.length && prefix(other.ids.slice(0, -1), here.ids)) return true // a sibling
    if (other.ids.length === here.ids.length + 1 && prefix(here.ids, other.ids)) return true // a child of this space
    return false
  }
  const all = Object.entries(places)
    .filter(([one, visit]) => one !== key && typeof visit?.url === 'string' && visit.url !== 'about:blank')
    .map(([one, visit]) => ({ ...visit, key: one }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const seen = new Set<string>()
  const take = (list: (Visit & { key: string })[]) => {
    const out: (Visit & { key: string })[] = []
    for (const one of list) {
      if (out.length >= most || seen.has(one.url)) continue
      seen.add(one.url)
      out.push(one)
    }
    return out
  }
  const nearby = take(all.filter((one) => near(spaceOfKey(one.key))))
  const recent = take(all)
  return { nearby, recent }
}
