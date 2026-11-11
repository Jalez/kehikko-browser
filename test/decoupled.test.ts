import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import * as manifest from '../manifest.ts'

/* Modules do not name each other: text an agent or a person reads says what the other thing does.
   "Inbox" is a host term and may stay. */
const OTHERS = ['Journeys', 'References', 'Checklist', 'Paper', 'Slides', 'Citations', 'Notes', 'Learning', 'Source', 'Diff', 'Review', 'Explorer', 'Terminal', 'History', 'Orchestrator', 'Browser', 'Editor', 'Factory', 'Kanban', 'Monitor', 'Queue', 'Worktrees', 'Flows', 'Screenplay', 'Codex', 'Antigravity', 'OpenCode', 'Vibe'].filter((n) => n !== 'Browser')
const ROOT = join(import.meta.dir, '..')
const names = new RegExp(`\\b(${OTHERS.join('|')})\\b|(kehikot|roadmap)\\.(${OTHERS.map((n) => n.toLowerCase()).join('|')})\\b|mcp__(${OTHERS.map((n) => n.toLowerCase()).join('|')})__|\\.kehikot/(${OTHERS.map((n) => n.toLowerCase()).join('|')})\\b`)
const lower = OTHERS.map((n) => n.toLowerCase()).join('|')
/* Another module's id (either spelling), its MCP tools' prefix or its folder under `.kehikot/`. */
const ids = new RegExp(`(kehikot|roadmap)\\.(${lower})\\b|mcp__(${lower})__|\\.kehikot/(${lower})\\b`)

/* Lines where a capitalised everyday word is only a word, not a module. */
const PLAIN: string[] = []
const found = (text: string): string[] => text.split('\n').filter((line) => names.test(line) && !PLAIN.some((one) => line.includes(one)))
const read = (path: string): string => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : '')

describe('no module names another', () => {
  test('the manifest, its help and what agents are told', () => {
    /* Everything the manifest module exports: the manifest itself, its help, what agents are told. */
    expect(found(JSON.stringify({ ...manifest }, null, 1))).toEqual([])
  })

  test('the skills', () => {
    const dir = join(ROOT, 'plugin', 'skills')
    const skills = existsSync(dir) ? readdirSync(dir).map((one) => read(`plugin/skills/${one}/SKILL.md`)) : []
    /* allowed-tools names tools, which is functional; the prose is what is read. */
    for (const text of skills) expect(found(text.split('\n').filter((line) => !line.startsWith('allowed-tools')).join('\n'))).toEqual([])
  })

  test('the descriptions an agent reads in the code', () => {
    for (const file of ["doors.ts","skills.ts","work.ts"]) {
      let inBlock = false
      const lines = read(file).split('\n').filter((line) => {
        const was = inBlock
        if (!inBlock && /^\s*\/\*/.test(line)) inBlock = true
        if (inBlock && line.includes('*/')) inBlock = false
        return !was && !/^\s*(\/\*|\*|\/\/)/.test(line) && !/^\s*import /.test(line)
      })
      expect(lines.filter((line) => ids.test(line))).toEqual([])
    }
  })

  test('the README', () => {
    expect(found(read('README.md'))).toEqual([])
  })

  test('no code names another module by id, tool prefix or folder', () => {
    const files = Array.from(new Bun.Glob('**/*.{ts,tsx,json}').scanSync({ cwd: ROOT })).filter((path) => !/^(node_modules|test|dist)\//.test(path) && !path.endsWith('bun.lock'))
    const hits = files.flatMap((path) => read(path).split('\n').filter((line) => ids.test(line)).map((line) => `${path}: ${line.trim()}`))
    expect(hits).toEqual([])
  })
})
