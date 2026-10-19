import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { editSaved, savedList } from '../data.ts'
import { readData, writeData } from '../store.ts'

const home = mkdtempSync(join(tmpdir(), 'kehikko-browser-store-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

function project(name: string): string {
  const dir = join(home, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('the store', () => {
  test('what is written is what is read, kept inside the project', () => {
    const dir = project('round-trip')
    expect(readData(dir, 'saved')).toEqual({ ok: true, value: null })
    expect(writeData(dir, 'saved', [{ n: 1 }]).ok).toBe(true)
    expect(readData(dir, 'saved')).toEqual({ ok: true, value: [{ n: 1 }] })
    expect(existsSync(join(dir, '.kehikot', 'browser', 'saved.json'))).toBe(true)
  })

  test('with no project there is nowhere to read or write', () => {
    expect(readData(null, 'saved').ok).toBe(false)
    expect(writeData(null, 'saved', 'x').ok).toBe(false)
    expect(writeData('relative/path', 'saved', 'x').ok).toBe(false)
    expect(editSaved(null, { op: 'add', url: 'https://x.org/' }).ok).toBe(false)
  })

  test('a .kehikot that points out of the project is refused', () => {
    const dir = project('escaping')
    const elsewhere = project('elsewhere')
    symlinkSync(elsewhere, join(dir, '.kehikot'))
    expect(writeData(dir, 'places', {}).ok).toBe(false)
    expect(existsSync(join(elsewhere, 'browser'))).toBe(false)
  })

  test('saved addresses are per project', () => {
    const a = project('a')
    const b = project('b')
    expect(editSaved(a, { op: 'add', url: 'https://a.example/', name: 'A' }).ok).toBe(true)
    expect(savedList(a)).toMatchObject({ ok: true, value: [{ name: 'A' }] })
    expect(savedList(b)).toEqual({ ok: true, value: [] })
  })
})
