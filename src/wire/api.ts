import { answered, ask } from 'kehikot-module-protocol/client'

import type { Snippets } from '@/lib/endpoint'
import type { Visit } from '@/lib/places'
import type { Saved } from '@/lib/saved'

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
  endpoint(): Promise<Endpoint>
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
  async endpoint() {
    const got = answered(await ask<Endpoint>('./api/endpoint'))
    return { endpoint: got.endpoint ?? null, snippets: got.snippets ?? null }
  },
}
