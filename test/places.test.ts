import { describe, expect, test } from 'bun:test'

import { isPlaceKey, placeKeys, recordAt, restoreFrom, type Places } from '../src/lib/places.ts'

const visit = (url: string, at = '2026-10-19T10:00:00.000Z') => ({ url, title: '', at })

describe('the keys of a place', () => {
  test('run from everything said to the project alone', () => {
    expect(placeKeys({ epic: 'browser', parts: ['b', 'a'], kehikko: 'review' })).toEqual([
      'epic:browser/parts:a,b/kehikko:review',
      'epic:browser/parts:a,b',
      'epic:browser',
      'project',
    ])
  })

  test('skip what is not said', () => {
    expect(placeKeys({ epic: 'browser', parts: [], kehikko: 'main' })).toEqual(['epic:browser/kehikko:main', 'epic:browser', 'project'])
    expect(placeKeys({ epic: null, parts: ['ignored-without-an-epic'], kehikko: 'main' })).toEqual(['kehikko:main', 'project'])
    expect(placeKeys({ epic: null, parts: [], kehikko: null })).toEqual(['project'])
  })

  test('the same pick in another order is the same place', () => {
    expect(placeKeys({ epic: 'e', parts: ['x', 'y'], kehikko: null })[0]).toBe(placeKeys({ epic: 'e', parts: ['y', 'x', 'y'], kehikko: null })[0])
  })

  test('every key it makes is one the server accepts, and nothing else is', () => {
    for (const key of placeKeys({ epic: 'browser-module', parts: ['p-1', 'p-2'], kehikko: 'k1' })) expect(isPlaceKey(key)).toBe(true)
    expect(isPlaceKey('__proto__')).toBe(false)
    expect(isPlaceKey('epic:x/../../etc')).toBe(false)
    expect(isPlaceKey('elsewhere:x')).toBe(false)
  })
})

describe('restoring and recording', () => {
  test('arrival restores the most specific level that holds an address', () => {
    const keys = placeKeys({ epic: 'e', parts: ['a'], kehikko: 'k' })
    const places: Places = { 'epic:e': visit('https://epic.example/'), project: visit('https://project.example/') }
    expect(restoreFrom(places, keys)).toMatchObject({ url: 'https://epic.example/', key: 'epic:e' })
    expect(restoreFrom({ project: visit('https://p/') }, keys)?.key).toBe('project')
    expect(restoreFrom({}, keys)).toBeNull()
  })

  test('recording writes every level, so a new part falls back to what its epic last showed', () => {
    const here = placeKeys({ epic: 'e', parts: ['a'], kehikko: 'k' })
    const there = placeKeys({ epic: 'e', parts: ['b'], kehikko: 'k' })
    const after = recordAt({}, here, visit('https://a.example/'))
    expect(restoreFrom(after, here)?.key).toBe(here[0]!)
    expect(restoreFrom(after, there)).toMatchObject({ url: 'https://a.example/', key: 'epic:e' })
    expect(restoreFrom(after, placeKeys({ epic: 'other', parts: [], kehikko: null }))?.key).toBe('project')
  })

  test('recording is pure, and the record keeps only the newest when full', () => {
    const before: Places = { project: visit('https://old/') }
    recordAt(before, ['project'], visit('https://new/'))
    expect(before.project?.url).toBe('https://old/')
    let places: Places = {}
    for (let i = 0; i < 10; i += 1) places = recordAt(places, [`epic:e${i}`], visit(`https://${i}/`, `2026-10-19T10:00:0${i}.000Z`), 5)
    expect(Object.keys(places).sort()).toEqual(['epic:e5', 'epic:e6', 'epic:e7', 'epic:e8', 'epic:e9'])
  })

  test('a key named like an object’s own property is not found through the prototype', () => {
    expect(restoreFrom({}, ['constructor', 'toString'])).toBeNull()
  })
})
