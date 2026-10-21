import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { manifestSchema, skillPath, skillTextIssue } from 'kehikot-module-protocol'

import { MANIFEST, answer, servingAt, tools } from '../doors.ts'
import { OFFERED, fill, sessionPlugin, skillDeclarations, skillTemplate, skillText } from '../skills.ts'

const NAMES = ['browser-walkthrough', 'browser-before-after', 'browser-repro', 'browser-open']
const none = new URLSearchParams()

/** The front matter of a filled skill, as key → value. */
function front(text: string): Record<string, string> {
  const lines = text.split('\n')
  const end = lines.indexOf('---', 1)
  return Object.fromEntries(lines.slice(1, end).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
}

describe('the skills this module offers', () => {
  test('four, every one starting with "browser"', () => {
    expect(OFFERED.map((one): string => one.name)).toEqual(NAMES)
    for (const one of OFFERED) expect(one.summary.length).toBeLessThanOrEqual(200)
  })

  test('each text, with the origin filled in, passes skillTextIssue', () => {
    for (const name of NAMES) {
      const text = skillText(name, 'http://127.0.0.1:18020')!
      expect(skillTextIssue(text, name)).toBeNull()
      expect(text).not.toContain('{{origin}}')
      expect(text).not.toContain('{{version}}')
      expect(text).toContain('http://127.0.0.1:18020/api/skill/say')
    }
  })

  test('only a person runs them, and the tools they pre-approve never write to a forge', () => {
    for (const name of NAMES) {
      const said = front(skillText(name)!)
      expect(said.name).toBe(name)
      expect(said['disable-model-invocation']).toBe('true')
      const allowed = said['allowed-tools']!
      expect(allowed).toContain('Bash(curl:*)')
      for (const write of ['gh api', 'gh pr edit', 'gh issue comment', 'glab api', 'glab mr update', 'glab issue note', 'git push', 'Bash(gh:', 'Bash(glab:', 'Bash(git:']) {
        expect(allowed).not.toContain(write)
      }
      /* Every MCP tool it names is one this module has. */
      const known = new Set(tools().map((t) => `mcp__browser__${t.name}`))
      for (const tool of allowed.match(/mcp__browser__[a-z_]+/g) ?? []) expect(known.has(tool)).toBe(true)
    }
  })

  test('the manifest declares them, and each version follows the origin served on', () => {
    expect(manifestSchema.safeParse(MANIFEST).success).toBe(true)
    expect(MANIFEST.declares.skills?.map((s) => s.name)).toEqual(NAMES)
    const here = skillDeclarations('http://127.0.0.1:18020')
    const there = skillDeclarations('http://127.0.0.1:18030')
    expect(here[0]!.version).not.toBe(there[0]!.version)
    expect(fill(skillTemplate('browser-open')!, 'http://127.0.0.1:18020').version).toBe(here[3]!.version)
  })

  test('each is served at skillPath as markdown, with the origin the module is on', async () => {
    servingAt('http://127.0.0.1:18020')
    for (const name of NAMES) {
      const reply = await answer('GET', skillPath(name), none, null, null)
      expect(reply?.status).toBe(200)
      expect(reply?.raw?.type).toContain('text/markdown')
      expect(String(reply?.raw?.bytes)).toContain('http://127.0.0.1:18020')
    }
    expect(MANIFEST.declares.skills?.[0]?.version).toBe(skillDeclarations('http://127.0.0.1:18020')[0]!.version)
    expect((await answer('POST', skillPath('browser-open'), none, null, null))?.status).toBe(405)
    expect(() => servingAt('https://evil.example')).toThrow()
  })

  test('a session is given them as one plugin folder, filled in, outside ~/.claude', () => {
    const base = mkdtempSync(join(tmpdir(), 'kehikko-browser-plugin-'))
    try {
      const dir = sessionPlugin('http://127.0.0.1:18020', base)
      expect(dir.startsWith(base)).toBe(true)
      expect(existsSync(join(dir, '.claude-plugin', 'plugin.json'))).toBe(true)
      for (const name of NAMES) {
        const text = readFileSync(join(dir, 'skills', name, 'SKILL.md'), 'utf8')
        expect(skillTextIssue(text, name)).toBeNull()
        expect(text).toContain('http://127.0.0.1:18020')
      }
      expect(sessionPlugin('http://127.0.0.1:18020', base)).toBe(dir)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
