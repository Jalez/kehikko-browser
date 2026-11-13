import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { MAX_PORTS, namedPorts, runningDevServers } from '../devservers.ts'

const files = (map: Record<string, string>) => (file: string) => map[file.replace(/^\/p\//, '')] ?? null

describe('the project’s dev servers, for the empty space', () => {
  test('only the ports the project names: its scripts, its config, the framework’s usual one', () => {
    const read = files({
      'package.json': JSON.stringify({ scripts: { dev: 'vite --port 5180', api: 'PORT=4000 bun run server.ts' }, devDependencies: { vite: '^7' } }),
      'vite.config.ts': 'export default { server: { port: 5180 }, preview: { port: 4173 } }',
    })
    expect(namedPorts('/p', read)).toEqual([
      { port: 5180, from: 'the dev script' },
      { port: 4000, from: 'the api script' },
      { port: 4173, from: 'vite.config.ts' },
      { port: 5173, from: "vite's usual port" },
    ])
  })

  test('a project that names nothing is asked about nothing, and never more than a few ports', () => {
    expect(namedPorts('/p', files({}))).toEqual([])
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`s${i}`, `x --port ${3001 + i}`]))
    expect(namedPorts('/p', files({ 'package.json': JSON.stringify({ scripts: many }) }))).toHaveLength(MAX_PORTS)
  })

  test('offers the ones that answer, and leaves out this module’s own', async () => {
    const asked: string[] = []
    const dir = join(import.meta.dir, '..')
    const got = await runningDevServers(dir, [5173], async (port, host) => {
      asked.push(`${host}:${port}`)
      return port !== 5173
    })
    expect(asked.some((one) => one.endsWith(':5173'))).toBe(false)
    expect(got.every((one) => one.url.startsWith('http://localhost:'))).toBe(true)
  })
})
