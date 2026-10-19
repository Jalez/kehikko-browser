import { describe, expect, test } from 'bun:test'

import { MAX_SAVED, addSaved, findSaved, readList, removeSaved, renameSaved, type Saved } from '../src/lib/saved.ts'

const now = new Date('2026-10-19T10:00:00.000Z')
let n = 0
const random = () => (n++ % 1000) / 1000

function add(list: Saved[], url: string, name?: string): Saved[] {
  const edit = addSaved(list, { url, name: name ?? null, title: null }, now, random)
  if (!edit.ok) throw new Error(edit.why)
  return edit.list
}

describe('saved addresses', () => {
  test('an address is saved under a name, or under its title or host when none is given', () => {
    const one = addSaved([], { url: 'https://github.com/Jalez/kehikko/issues', title: 'Issues · Jalez/kehikko' }, now, random)
    expect(one.ok && one.saved?.name).toBe('Issues · Jalez/kehikko')
    const two = addSaved([], { url: 'https://example.org/a', name: '  Staging   app ' }, now, random)
    expect(two.ok && two.saved?.name).toBe('Staging app')
    const three = addSaved([], { url: 'https://example.org/a' }, now, random)
    expect(three.ok && three.saved?.name).toBe('example.org/a')
  })

  test('saving a name that exists moves it rather than adding a second', () => {
    let list = add([], 'https://a.example/', 'Staging')
    list = add(list, 'https://b.example/', 'staging')
    expect(list).toHaveLength(1)
    expect(list[0]!.url).toBe('https://b.example/')
  })

  test('only web addresses are saved, and the list is held to what the Go menu can show', () => {
    expect(addSaved([], { url: 'about:blank' }).ok).toBe(false)
    expect(addSaved([], { url: 'file:///etc/hosts' }).ok).toBe(false)
    let list: Saved[] = []
    for (let i = 0; i < MAX_SAVED; i += 1) list = add(list, `https://${i}.example/`, `n${i}`)
    const full = addSaved(list, { url: 'https://one-more.example/', name: 'more' }, now, random)
    expect(full.ok).toBe(false)
  })

  test('ids are unique and inside the header’s id rules', () => {
    let list: Saved[] = []
    for (let i = 0; i < 20; i += 1) list = add(list, `https://${i}.example/`, `n${i}`)
    const ids = list.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  test('rename and remove, and the sentences when they cannot', () => {
    const list = add(add([], 'https://a.example/', 'A'), 'https://b.example/', 'B')
    const a = list[0]!
    expect(renameSaved(list, a.id, 'B')).toEqual({ ok: false, why: 'Another saved address is already called "B".' })
    const renamed = renameSaved(list, a.id, 'Alpha')
    expect(renamed.ok && renamed.list[0]!.name).toBe('Alpha')
    expect(removeSaved(list, 'nope').ok).toBe(false)
    const removed = removeSaved(list, a.id)
    expect(removed.ok && removed.list.map((s) => s.name)).toEqual(['B'])
  })

  test('an agent finds one by id or by name', () => {
    const list = add([], 'https://a.example/', 'Staging')
    expect(findSaved(list, 'staging')?.url).toBe('https://a.example/')
    expect(findSaved(list, list[0]!.id)?.name).toBe('Staging')
    expect(findSaved(list, 'prod')).toBeNull()
  })

  test('what is read from disk is trusted only entry by entry', () => {
    const read = readList([
      { id: 'ok1', name: 'Fine', url: 'https://fine.example/', at: 'x' },
      { id: 'bad id!', name: 'x', url: 'https://x/' },
      { id: 'ok2', name: 'Script', url: 'javascript:alert(1)' },
      'nonsense',
      { id: 'ok1', name: 'Duplicate', url: 'https://dup.example/' },
    ])
    expect(read.map((s) => s.name)).toEqual(['Fine'])
    expect(readList({ not: 'a list' })).toEqual([])
  })
})
