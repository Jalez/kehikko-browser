import { describe, expect, test } from 'bun:test'

import { isPlaceKey, placeKey, recordAt, restoreFrom, spaceOfKey, suggestionsFor, type Places } from '../src/lib/places.ts'

const visit = (url: string, at = '2026-10-19T10:00:00.000Z') => ({ url, title: '', at })
const sp = (ids: string[], picked: string[] = []) => ({ ids, picked })

describe('the key of a place', () => {
  test('says the epic, the parts and the kehikko, parts sorted', () => {
    expect(placeKey({ epic: 'browser', parts: ['b', 'a'], kehikko: 'review' })).toBe('epic:browser/parts:a,b/kehikko:review')
    expect(placeKey({ epic: 'browser', parts: [], kehikko: 'main' })).toBe('epic:browser/kehikko:main')
    expect(placeKey({ epic: null, parts: ['ignored-without-an-epic'], kehikko: 'main' })).toBe('kehikko:main')
    expect(placeKey({ epic: null, parts: [], kehikko: null })).toBe('project')
  })

  test('a space an older host can name is the same key from either host', () => {
    const old = (epic: string, parts: string[]) => placeKey({ epic, parts, kehikko: 'k' })
    const now = (ids: string[], picked: string[] = []) => placeKey({ epic: 'ignored', parts: [], space: sp(ids, picked), kehikko: 'k' })
    expect(now(['thesis'])).toBe(old('thesis', []))
    expect(now(['thesis', 'method'])).toBe(old('thesis', ['method']))
    expect(now(['thesis'], ['b', 'a'])).toBe(old('thesis', ['a', 'b']))
  })

  test('deeper spaces are told apart, though an older host folds them into their depth-2 ancestor', () => {
    const deep = (ids: string[], picked: string[] = []) => placeKey({ epic: null, parts: [], space: sp(ids, picked), kehikko: null })
    expect(deep(['t', 'r', 'figures'])).toBe('epic:t/space:t.r.figures')
    expect(deep(['t', 'r', 'tables'])).not.toBe(deep(['t', 'r', 'figures']))
    expect(deep(['t', 'r'], ['y', 'x'])).toBe('epic:t/space:t.r/picked:x,y')
  })

  test('every key it makes is one the server accepts, and nothing else is', () => {
    for (const key of [
      placeKey({ epic: 'browser-module', parts: ['p-1', 'p-2'], kehikko: 'k1' }),
      placeKey({ epic: null, parts: [], space: sp(['a', 'b', 'c'], ['d', 'e']), kehikko: 'k1' }),
    ])
      expect(isPlaceKey(key)).toBe(true)
    expect(isPlaceKey('__proto__')).toBe(false)
    expect(isPlaceKey('epic:x/../../etc')).toBe(false)
    expect(isPlaceKey('elsewhere:x')).toBe(false)
    expect(isPlaceKey(['epic:x'])).toBe(false)
  })

  test('reads back as the space it stands in', () => {
    expect(spaceOfKey('epic:t/parts:m/kehikko:k')).toEqual({ ids: ['t', 'm'], picked: [] })
    expect(spaceOfKey('epic:t/parts:a,b')).toEqual({ ids: ['t'], picked: ['a', 'b'] })
    expect(spaceOfKey('epic:t/space:t.r.f/picked:x')).toEqual({ ids: ['t', 'r', 'f'], picked: ['x'] })
    expect(spaceOfKey('project')).toEqual({ ids: [], picked: [] })
  })
})

describe('restoring and recording', () => {
  test('a place restores only what was shown there: never a broader place, another space or the project', () => {
    const key = placeKey({ epic: 'e', parts: ['a'], kehikko: 'k' })
    const places: Places = { 'epic:e': visit('https://epic.example/'), 'epic:e/kehikko:k': visit('https://e.example/'), project: visit('https://project.example/') }
    expect(restoreFrom(places, key)).toBeNull()
    expect(restoreFrom({ ...places, [key]: visit('https://a.example/') }, key)).toMatchObject({ url: 'https://a.example/', key })
  })

  test('recording keeps the address at that place and nowhere else', () => {
    const here = placeKey({ epic: 'e', parts: ['a'], kehikko: 'k' })
    const there = placeKey({ epic: 'e', parts: ['b'], kehikko: 'k' })
    const after = recordAt({}, here, visit('https://a.example/'))
    expect(Object.keys(after)).toEqual([here])
    expect(restoreFrom(after, there)).toBeNull()
  })

  test('recording is pure, and the record keeps only the newest when full', () => {
    const before: Places = { project: visit('https://old/') }
    recordAt(before, 'project', visit('https://new/'))
    expect(before.project?.url).toBe('https://old/')
    let places: Places = {}
    for (let i = 0; i < 10; i += 1) places = recordAt(places, `epic:e${i}`, visit(`https://${i}/`, `2026-10-19T10:00:0${i}.000Z`), 5)
    expect(Object.keys(places).sort()).toEqual(['epic:e5', 'epic:e6', 'epic:e7', 'epic:e8', 'epic:e9'])
  })

  test('a key named like an object’s own property is not found through the prototype', () => {
    expect(restoreFrom({}, 'constructor')).toBeNull()
  })
})

describe('what the empty space offers', () => {
  const at = (n: number) => `2026-10-19T10:00:0${n}.000Z`
  const places: Places = {
    'epic:t/kehikko:k': visit('https://parent.example/', at(1)),
    'epic:t/parts:method/kehikko:k': visit('https://sibling.example/', at(3)),
    'epic:t/space:t.results.figures': visit('https://child.example/', at(2)),
    'epic:t/parts:method/kehikko:other': visit('https://sibling.example/', at(4)),
    'epic:talk': visit('https://elsewhere.example/', at(5)),
    'epic:t/space:t.method.deep': visit('https://cousin.example/', at(6)),
  }
  test('pages from the spaces above, beside and below this one first, each address once, newest first', () => {
    const got = suggestionsFor(places, 'epic:t/parts:results/kehikko:k')
    expect(got.nearby.map((one) => one.url)).toEqual(['https://sibling.example/', 'https://child.example/', 'https://parent.example/'])
    expect(got.recent.map((one) => one.url)).toEqual(['https://cousin.example/', 'https://elsewhere.example/'])
  })

  test('a place on "All spaces" has nothing nearby, and the project’s recent pages', () => {
    const got = suggestionsFor(places, 'kehikko:k', 3)
    expect(got.nearby).toEqual([])
    expect(got.recent).toHaveLength(3)
  })
})
