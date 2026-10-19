/**
 * The address this browser showed at each place, and which one to show on arrival.
 *
 * A place is project › epic › part › kehikko. Each is a level of a key, and a
 * place's keys run from the most specific (everything said) to the broadest
 * (the project alone). The project is not in the key: the record is kept inside
 * the project (`<project>/.kehikot/browser/places.json`).
 *
 * Recording writes the address at EVERY level of the place, so a broader level
 * holds the last address shown anywhere under it. Arriving somewhere new then
 * restores the most specific level that holds anything: a part never visited
 * shows what this epic last showed, an epic never visited what the project last
 * showed.
 */

export interface Place {
  epic: string | null
  /** The ids of the parts a person picked out. Empty is the whole epic. */
  parts: readonly string[]
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

/**
 * Every key of a place, most specific first, ending with the project's own.
 * Parts are sorted, so the same pick in another order is the same place.
 */
export function placeKeys(place: Place): string[] {
  const segments: string[] = []
  if (place.epic) {
    segments.push(`epic:${place.epic}`)
    if (place.parts.length) segments.push(`parts:${[...new Set(place.parts)].sort().join(',')}`)
  }
  if (place.kehikko) segments.push(`kehikko:${place.kehikko}`)
  const keys: string[] = []
  for (let n = segments.length; n > 0; n -= 1) keys.push(segments.slice(0, n).join('/'))
  keys.push(PROJECT)
  return keys
}

/** The visit to restore at a place: the most specific level that holds one, or null. */
export function restoreFrom(places: Places, keys: readonly string[]): (Visit & { key: string }) | null {
  for (const key of keys) {
    const visit = Object.prototype.hasOwnProperty.call(places, key) ? places[key] : undefined
    if (visit && typeof visit.url === 'string') return { ...visit, key }
  }
  return null
}

/** The record with this visit written at every level of the place. Pure: the old record is untouched. */
export function recordAt(places: Places, keys: readonly string[], visit: Visit, max = MAX_PLACES): Places {
  const next: Places = { ...places }
  for (const key of keys) next[key] = visit
  const all = Object.entries(next)
  if (all.length <= max) return next
  all.sort((a, b) => (a[1].at < b[1].at ? 1 : a[1].at > b[1].at ? -1 : 0))
  return Object.fromEntries(all.slice(0, max))
}

/** Whether a key looks like one `placeKeys` makes, so a request cannot write arbitrary names. */
export function isPlaceKey(key: string): boolean {
  if (key === PROJECT) return true
  if (key.length > 400) return false
  return key.split('/').every((segment) => /^(epic|parts|kehikko):[A-Za-z0-9_.,:-]{1,200}$/.test(segment))
}
