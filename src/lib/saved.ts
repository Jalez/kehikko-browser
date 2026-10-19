import { allowedUrl, labelFor } from './address.ts'

/**
 * Addresses a person (or an agent) saved under a name, per project:
 * `<project>/.kehikot/browser/saved.json`. Pure: every function returns a new
 * list or a sentence saying why not, and the store writes what comes back.
 */

export interface Saved {
  /** Stable, header-safe: what a Go press carries. */
  id: string
  name: string
  url: string
  at: string
}

/** The header's Go menu shows at most 64 options (`LIMITS.HEADER_OPTIONS`); the list is held to the same. */
export const MAX_SAVED = 64
export const MAX_NAME = 80

export type Edit = { ok: true; list: Saved[]; saved?: Saved } | { ok: false; why: string }

/** A new id: short, unique within the list, and inside the header's id rules. */
export function newId(list: readonly Saved[], now: number = Date.now(), random: () => number = Math.random): string {
  for (;;) {
    const id = `s${now.toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`
    if (!list.some((one) => one.id === id)) return id
    now += 1
  }
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

/**
 * Save an address. A name already in the list is moved to the new address
 * rather than duplicated, so "save as Staging" twice keeps one Staging.
 */
export function addSaved(
  list: readonly Saved[],
  entry: { name?: string | null; url: string; title?: string | null },
  now: Date = new Date(),
  random: () => number = Math.random,
): Edit {
  if (!allowedUrl(entry.url) || entry.url === 'about:blank') {
    return { ok: false, why: 'Only an http or https address can be saved.' }
  }
  const name = cleanName(entry.name || labelFor(entry.url, entry.title, MAX_NAME))
  if (!name) return { ok: false, why: 'A saved address needs a name.' }
  const same = list.find((one) => one.name.toLowerCase() === name.toLowerCase())
  if (same) {
    const saved = { ...same, name, url: entry.url, at: now.toISOString() }
    return { ok: true, list: list.map((one) => (one.id === same.id ? saved : one)), saved }
  }
  if (list.length >= MAX_SAVED) {
    return { ok: false, why: `This project already keeps ${MAX_SAVED} saved addresses. Remove one first.` }
  }
  const saved: Saved = { id: newId(list, now.getTime(), random), name, url: entry.url, at: now.toISOString() }
  return { ok: true, list: [...list, saved], saved }
}

export function removeSaved(list: readonly Saved[], id: string): Edit {
  if (!list.some((one) => one.id === id)) return { ok: false, why: `There is no saved address "${id.slice(0, 64)}".` }
  return { ok: true, list: list.filter((one) => one.id !== id) }
}

export function renameSaved(list: readonly Saved[], id: string, name: string): Edit {
  const clean = cleanName(name)
  if (!clean) return { ok: false, why: 'A saved address needs a name.' }
  const one = list.find((s) => s.id === id)
  if (!one) return { ok: false, why: `There is no saved address "${id.slice(0, 64)}".` }
  if (list.some((s) => s.id !== id && s.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, why: `Another saved address is already called "${clean}".` }
  }
  const saved = { ...one, name: clean }
  return { ok: true, list: list.map((s) => (s.id === id ? saved : s)), saved }
}

/** Find one by id, or by name (case does not matter): what an agent passes. */
export function findSaved(list: readonly Saved[], which: string): Saved | null {
  const wanted = which.trim().toLowerCase()
  return list.find((one) => one.id === which) ?? list.find((one) => one.name.toLowerCase() === wanted) ?? null
}

/** Whatever was read from disk, as a list this module trusts: bad entries are dropped, not repaired. */
export function readList(value: unknown): Saved[] {
  if (!Array.isArray(value)) return []
  const out: Saved[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const one = raw as Record<string, unknown>
    if (typeof one.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(one.id)) continue
    if (typeof one.name !== 'string' || typeof one.url !== 'string' || !allowedUrl(one.url)) continue
    if (out.some((s) => s.id === one.id)) continue
    out.push({ id: one.id, name: cleanName(one.name) || 'Untitled', url: one.url, at: typeof one.at === 'string' ? one.at : '' })
    if (out.length >= MAX_SAVED) break
  }
  return out
}
