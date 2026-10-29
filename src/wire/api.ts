import { answered, ask, subscribe } from 'kehikot-module-protocol/client'

import type { Snippets } from '@/lib/endpoint'
import type { Visit } from '@/lib/places'
import type { Saved } from '@/lib/saved'
import type { Run, RunKind } from '@/lib/runs'
import type { Pair, ShotSet } from '@/lib/shots'
import type { ConsoleEntry } from '@/wire/stream'

/**
 * This module's own `/api`, as the page calls it. `ask` carries the ticket on
 * a write and turns every failure into one sentence.
 */
export interface Endpoint {
  endpoint: { http: string; ws: string | null; port: number } | null
  snippets: Snippets | null
}

export interface Api {
  saved(projectPath: string): Promise<Saved[]>
  save(projectPath: string, entry: { url: string; title?: string | null; name?: string | null }): Promise<{ list: Saved[]; saved?: Saved }>
  remove(projectPath: string, id: string): Promise<Saved[]>
  rename(projectPath: string, id: string, name: string): Promise<Saved[]>
  place(projectPath: string, keys: string[]): Promise<(Visit & { key: string }) | null>
  record(projectPath: string, keys: string[], url: string, title: string): Promise<void>
  /**
   * Hear the Playwright endpoint: as it stands when the stream opens (and each time it reopens, after
   * a drop or when the page is shown again), then each time the browser starts or stops. Never on a
   * clock. Returns the function that stops it.
   */
  followEndpoint(onEndpoint: (endpoint: Endpoint) => void): () => void
  console(): Promise<{ entries: ConsoleEntry[]; dropped: number; last: number }>
  clearConsole(): Promise<void>
  openDevtools(): Promise<string>
  runs(projectPath: string, kind: RunKind): Promise<Run[]>
  shotSets(projectPath: string): Promise<ShotSummary[]>
  shotSet(projectPath: string, ref: string): Promise<{ set: ShotSet; pairs: Pair[]; missing: string[] }>
  approveShots(projectPath: string, ref: string): Promise<ShotSet>
}

export interface ShotSummary {
  slug: string
  ref: string
  title: string
  createdAt: string
  captured: number
  approved: ShotSet['approved']
  posted: ShotSet['posted']
}

/** A picture a record keeps, as the page loads it (a plain GET of this module's own origin). */
export function runPng(projectPath: string, kind: RunKind, id: string, file: string): string {
  return `./api/run/png?${new URLSearchParams({ projectPath, kind, id, file })}`
}
export function shotPng(projectPath: string, ref: string, file: string): string {
  return `./api/shots/png?${new URLSearchParams({ projectPath, ref, file })}`
}

export const api: Api = {
  async saved(projectPath) {
    return answered(await ask<{ list?: Saved[] }>('./api/saved', { query: { projectPath } })).list ?? []
  },
  async save(projectPath, entry) {
    const got = answered(await ask<{ list?: Saved[]; saved?: Saved }>('./api/saved', { body: { projectPath, op: 'add', ...entry } }))
    return { list: got.list ?? [], ...(got.saved ? { saved: got.saved } : {}) }
  },
  async remove(projectPath, id) {
    return answered(await ask<{ list?: Saved[] }>('./api/saved', { body: { projectPath, op: 'remove', id } })).list ?? []
  },
  async rename(projectPath, id, name) {
    return answered(await ask<{ list?: Saved[] }>('./api/saved', { body: { projectPath, op: 'rename', id, name } })).list ?? []
  },
  async place(projectPath, keys) {
    return (
      answered(await ask<{ visit?: (Visit & { key: string }) | null }>('./api/place', { query: { projectPath, keys: JSON.stringify(keys) } })).visit
      ?? null
    )
  },
  async record(projectPath, keys, url, title) {
    answered(await ask('./api/place', { body: { projectPath, keys, url, title } }))
  },
  followEndpoint: (onEndpoint) =>
    subscribe<Partial<Endpoint>>('./api/endpoint/events', (got) => onEndpoint({ endpoint: got.endpoint ?? null, snippets: got.snippets ?? null }), { probe: true }),
  async console() {
    const got = answered(await ask<{ entries?: ConsoleEntry[]; dropped?: number; last?: number }>('./api/console'))
    return { entries: got.entries ?? [], dropped: got.dropped ?? 0, last: got.last ?? 0 }
  },
  async clearConsole() {
    answered(await ask('./api/console/clear', { body: {} }))
  },
  async openDevtools() {
    return answered(await ask<{ url?: string }>('./api/devtools', { body: {} })).url ?? ''
  },
  async runs(projectPath, kind) {
    return answered(await ask<{ runs?: Run[] }>('./api/runs', { query: { projectPath, kind } })).runs ?? []
  },
  async shotSets(projectPath) {
    return answered(await ask<{ sets?: ShotSummary[] }>('./api/shots', { query: { projectPath } })).sets ?? []
  },
  async shotSet(projectPath, ref) {
    const got = answered(await ask<{ set: ShotSet; pairs?: Pair[]; missing?: string[] }>('./api/shots/set', { query: { projectPath, ref } }))
    return { set: got.set, pairs: got.pairs ?? [], missing: got.missing ?? [] }
  },
  async approveShots(projectPath, ref) {
    return answered(await ask<{ set: ShotSet }>('./api/shots/approve', { body: { projectPath, ref } })).set
  },
}
