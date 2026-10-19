import { addSaved, readList, removeSaved, renameSaved, type Edit, type Saved } from './src/lib/saved.ts'
import { isPlaceKey, recordAt, restoreFrom, type Places, type Visit } from './src/lib/places.ts'
import { allowedUrl, BLANK } from './src/lib/address.ts'
import { readData, writeData, type Result } from './store.ts'

/**
 * The saved addresses and the per-place record, read and written through the
 * store. Every edit is pure (`src/lib/`) and this file only reads, applies and
 * writes, synchronously, so two requests in this one process cannot interleave.
 */

export function savedList(projectPath: string | null | undefined): Result<Saved[]> {
  const read = readData(projectPath, 'saved')
  return read.ok ? { ok: true, value: readList(read.value) } : read
}

export type SavedOp =
  | { op: 'add'; name?: string | null; url: string; title?: string | null }
  | { op: 'remove'; id: string }
  | { op: 'rename'; id: string; name: string }

export function editSaved(projectPath: string | null | undefined, change: SavedOp): Result<{ list: Saved[]; saved?: Saved }> {
  const read = savedList(projectPath)
  if (!read.ok) return read
  let edit: Edit
  if (change.op === 'add') edit = addSaved(read.value, change)
  else if (change.op === 'remove') edit = removeSaved(read.value, change.id)
  else edit = renameSaved(read.value, change.id, change.name)
  if (!edit.ok) return { ok: false, error: edit.why }
  const written = writeData(projectPath, 'saved', edit.list)
  if (!written.ok) return written
  return { ok: true, value: { list: edit.list, ...(edit.saved ? { saved: edit.saved } : {}) } }
}

function readPlaces(projectPath: string | null | undefined): Result<Places> {
  const read = readData(projectPath, 'places')
  if (!read.ok) return read
  const value = read.value
  const places: Places = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!isPlaceKey(key) || !raw || typeof raw !== 'object') continue
      const visit = raw as Record<string, unknown>
      if (typeof visit.url !== 'string' || !allowedUrl(visit.url)) continue
      places[key] = { url: visit.url, title: typeof visit.title === 'string' ? visit.title : '', at: typeof visit.at === 'string' ? visit.at : '' }
    }
  }
  return { ok: true, value: places }
}

function goodKeys(keys: unknown): string[] | null {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 8) return null
  return keys.every((key) => typeof key === 'string' && isPlaceKey(key)) ? (keys as string[]) : null
}

/** The address to show on arriving at a place, most specific level first. */
export function placeFor(projectPath: string | null | undefined, keys: unknown): Result<(Visit & { key: string }) | null> {
  const wanted = goodKeys(keys)
  if (!wanted) return { ok: false, error: 'Those are not the keys of a place.' }
  const read = readPlaces(projectPath)
  return read.ok ? { ok: true, value: restoreFrom(read.value, wanted) } : read
}

/** Record the address shown at a place, at every level of it. `about:blank` is not worth remembering. */
export function recordPlace(projectPath: string | null | undefined, keys: unknown, url: unknown, title: unknown): Result<null> {
  const wanted = goodKeys(keys)
  if (!wanted) return { ok: false, error: 'Those are not the keys of a place.' }
  if (typeof url !== 'string' || !allowedUrl(url)) return { ok: false, error: 'Only an http or https address is remembered.' }
  if (url === BLANK) return { ok: true, value: null }
  const read = readPlaces(projectPath)
  if (!read.ok) return read
  const visit: Visit = { url, title: typeof title === 'string' ? title.slice(0, 200) : '', at: new Date().toISOString() }
  const same = wanted.every((key) => read.value[key]?.url === url)
  if (same) return { ok: true, value: null }
  return writeData(projectPath, 'places', recordAt(read.value, wanted, visit))
}
