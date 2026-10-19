import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { answer, call } from '../doors.ts'
import { ASK } from '../project.ts'
import { DEFAULT_ASK } from './setup.ts'

const home = mkdtempSync(join(tmpdir(), 'kehikko-browser-moved-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))
afterEach(() => {
  ASK.options = DEFAULT_ASK
})

const ID = 'proj-1234abcd'
const env = { KEHIKOT_ORIGINS: 'http://127.0.0.1:4170' }
const none = new URLSearchParams()
const text = (got: { type: string; text?: string }[]) => got.map((c) => c.text ?? '').join('\n')

/** A host that knows one project, now at `now`, formerly at `old`. Anything else is a bare no. */
function host(table: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const path = new URL(url).searchParams.get('path') ?? ''
    return new Response(JSON.stringify(table[path] ?? { ok: true, project: false }), { status: 200 })
  }) as never
}

describe('a project that moved', () => {
  test('a former path is followed, and the answer says so', async () => {
    const now = join(home, 'new')
    mkdirSync(now)
    const old = join(home, 'old')
    ASK.options = { env, fetch: host({ [old]: { ok: true, project: false, movedTo: now, id: ID }, [now]: { ok: true, project: true, id: ID } }) }
    const saved = text(await call('save_address', { project: old, name: 'A', url: 'https://a.example.org/' }))
    expect(saved).toContain('Saved "A"')
    expect(saved).toContain(`has moved to ${now}`)
    expect(existsSync(join(now, '.kehikot', 'browser', 'saved.json'))).toBe(true)
    expect(existsSync(old)).toBe(false)
    expect(text(await call('list_addresses', { project: old }))).toContain('A')
  })

  test('an unrelated folder at the old path is refused and nothing is written', async () => {
    const stranger = join(home, 'stranger')
    mkdirSync(stranger)
    ASK.options = { env, fetch: host({}) }
    await expect(call('save_address', { project: stranger, url: 'https://a.example.org/' })).rejects.toThrow('is not a project open in Kehikot')
    const via = await answer('POST', '/api/saved', none, { projectPath: stranger, op: 'add', url: 'https://a.example.org/' }, null)
    expect(via?.status).not.toBe(200)
    expect(existsSync(join(stranger, '.kehikot'))).toBe(false)
  })

  test('with no host answering, it is a refusal, not a write', async () => {
    const dir = join(home, 'nohost')
    mkdirSync(dir)
    ASK.options = {
      env,
      fetch: (async () => {
        throw new Error('ECONNREFUSED')
      }) as never,
    }
    await expect(call('list_addresses', { project: dir })).rejects.toThrow('is not a project open in Kehikot')
    await expect(call('save_address', { project: dir, url: 'https://a.example.org/' })).rejects.toThrow()
    expect(existsSync(join(dir, '.kehikot'))).toBe(false)
  })
})
