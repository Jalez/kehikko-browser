import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DOOR_ARGUMENTS, WELL_KNOWN } from 'kehikot-module-protocol'

import { profileDir, preferredCdpPort } from '../browser/engine.ts'
import { fenced } from '../browser/stream.ts'
import { MANIFEST, TICKET, answer } from '../doors.ts'
import { ID } from '../manifest.ts'

const project = mkdtempSync(join(tmpdir(), 'kehikko-browser-doors-'))
afterAll(() => rmSync(project, { recursive: true, force: true }))

const none = new URLSearchParams()

type Result = { tools?: { name: string; description: string; annotations?: { readOnlyHint?: boolean }; inputSchema: { properties: Record<string, unknown> } }[]; content?: { type: string; text?: string }[]; isError?: boolean }

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<Result> {
  const reply = await answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method, params }, null)
  return (reply?.body as { result: Result }).result
}

async function tool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const got = await rpc('tools/call', { name, arguments: args })
  return { text: got.content?.map((c) => c.text ?? '').join('\n') ?? '', isError: got.isError === true }
}

describe('the doors', () => {
  test('the health check says which module this is', async () => {
    const reply = await answer('GET', '/healthz', none, null, null)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { id: string }).id).toBe(ID)
  })

  test('the manifest is this module’s', () => {
    expect(WELL_KNOWN.startsWith('/')).toBe(true)
    expect(MANIFEST.id).toBe(ID)
  })

  test('a path that is not ours is left to Vite', async () => {
    expect(await answer('GET', '/src/main.tsx', none, null, null)).toBeNull()
  })

  test('a saved-address write without this page’s ticket is refused, and one with it is kept', async () => {
    const body = { projectPath: project, op: 'add', url: 'https://github.com/Jalez/kehikko/issues', name: 'Issues' }
    expect((await answer('POST', '/api/saved', none, body, null))?.status).toBe(403)
    expect((await answer('POST', '/api/saved', none, body, 'not-the-ticket'))?.status).toBe(403)
    expect((await answer('POST', '/api/saved', none, body, TICKET))?.status).toBe(200)
    const read = await answer('GET', '/api/saved', new URLSearchParams({ projectPath: project }), null, null)
    expect((read?.body as { list: { name: string }[] }).list.map((s) => s.name)).toEqual(['Issues'])
    expect(existsSync(join(project, '.kehikot', 'browser', 'saved.json'))).toBe(true)
  })

  test('a place is recorded with the ticket, and restored from the most specific level', async () => {
    const keys = ['epic:e/parts:a', 'epic:e', 'project']
    const body = { projectPath: project, keys, url: 'https://example.org/a', title: 'A' }
    expect((await answer('POST', '/api/place', none, body, null))?.status).toBe(403)
    expect((await answer('POST', '/api/place', none, body, TICKET))?.status).toBe(200)
    const elsewhere = new URLSearchParams({ projectPath: project, keys: JSON.stringify(['epic:e/parts:b', 'epic:e', 'project']) })
    const got = await answer('GET', '/api/place', elsewhere, null, null)
    expect((got?.body as { visit: { url: string; key: string } }).visit).toMatchObject({ url: 'https://example.org/a', key: 'epic:e' })
    expect(existsSync(join(project, '.kehikot', 'browser', 'places.json'))).toBe(true)
  })

  test('a place is not written for keys it did not make, nor for an address it does not open', async () => {
    expect((await answer('POST', '/api/place', none, { projectPath: project, keys: ['../x'], url: 'https://x.org/' }, TICKET))?.status).toBe(400)
    expect((await answer('POST', '/api/place', none, { projectPath: project, keys: ['project'], url: 'file:///etc/hosts' }, TICKET))?.status).toBe(400)
  })
})

describe('the MCP door', () => {
  test('lists the browser’s tools, each saying whether it only reads', async () => {
    expect((await answer('GET', '/mcp', none, null, null))?.status).toBe(405)
    const tools = (await rpc('tools/list')).tools ?? []
    expect(tools.map((t) => t.name)).toEqual([
      'navigate', 'current_url', 'back', 'forward', 'reload', 'read_page', 'find', 'click', 'type', 'key', 'scroll',
      'screenshot', 'wait_for', 'cdp_endpoint', 'list_addresses', 'save_address', 'open_address',
    ])
    for (const t of tools) expect(typeof t.annotations?.readOnlyHint).toBe('boolean')
  })

  test('every tool that returns page content says it is untrusted', async () => {
    const tools = (await rpc('tools/list')).tools ?? []
    for (const name of ['navigate', 'current_url', 'read_page', 'find', 'screenshot', 'open_address']) {
      expect(tools.find((t) => t.name === name)?.description).toMatch(/untrusted/i)
    }
  })

  test('the project is spelled as every door spells it', async () => {
    const tools = (await rpc('tools/list')).tools ?? []
    for (const t of tools) {
      expect(Object.keys(t.inputSchema.properties)).not.toContain('projectPath')
      if (['list_addresses', 'save_address', 'open_address'].includes(t.name)) {
        expect(Object.keys(t.inputSchema.properties)).toContain(DOOR_ARGUMENTS.project)
      }
    }
  })

  test('navigate refuses what is not http or https before any browser starts', async () => {
    const got = await tool('navigate', { url: 'file:///etc/passwd' })
    expect(got.isError).toBe(true)
    expect(got.text).toContain('http and https')
  })

  test('addresses are saved, listed and refused through the door', async () => {
    const saved = await tool('save_address', { project, name: 'Staging', url: 'https://staging.example.org/' })
    expect(saved.isError).toBe(false)
    const listed = await tool('list_addresses', { project })
    expect(listed.text).toContain('Staging')
    expect((await tool('save_address', { project })).isError).toBe(true) /* nothing open: about:blank */
    expect((await tool('open_address', { project, name: 'nope' })).text).toContain('Staging')
    expect((await tool('list_addresses', {})).isError).toBe(true)
  })

  test('an unknown tool is a refusal the agent reads', async () => {
    expect((await tool('rm_rf', {})).isError).toBe(true)
  })
})

describe('the browser’s machine-level places', () => {
  test('the profile lives in the Kehikot machine directory, never the person’s own Chrome', () => {
    expect(profileDir({ HOME: '/Users/x' }, 'darwin')).toBe('/Users/x/Library/Application Support/Kehikot/browser-profile')
    expect(profileDir({ HOME: '/home/x' }, 'linux')).toBe('/home/x/.local/share/kehikot/browser-profile')
    expect(profileDir({ KEHIKOT_BROWSER_PROFILE: '/tmp/p' }, 'darwin')).toBe('/tmp/p')
  })

  test('the DevTools port sits five above the module, unless said', () => {
    expect(preferredCdpPort(8020, {})).toBe(8025)
    expect(preferredCdpPort(8020, { KEHIKOT_BROWSER_CDP_PORT: '9333' })).toBe(9333)
    expect(preferredCdpPort(8020, { KEHIKOT_BROWSER_CDP_PORT: '80' })).toBe(8025)
  })

  test('the stream answers only this module’s own page on loopback', () => {
    expect(fenced({ origin: 'http://127.0.0.1:8020', host: '127.0.0.1:8020' }, 8020).ok).toBe(true)
    expect(fenced({ origin: 'http://localhost:8020', host: 'localhost:8020' }, 8020).ok).toBe(true)
    expect(fenced({ origin: 'https://evil.example', host: '127.0.0.1:8020' }, 8020).ok).toBe(false)
    expect(fenced({ origin: 'http://127.0.0.1:8020', host: 'evil.example:8020' }, 8020).ok).toBe(false)
    expect(fenced({ host: '127.0.0.1:8020' }, 8020).ok).toBe(false)
  })
})
