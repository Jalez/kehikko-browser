import { describe, expect, test } from 'bun:test'

import { directUrl, refsToAsk, urlForSelection } from '../src/lib/follow.ts'

describe('a pick, as a page', () => {
  test('only tracker spellings are asked about, in the order picked', () => {
    expect(refsToAsk(['gh#41', 'not a ref', '!7', 'gh#41', 'gh:Jalez/kehikko#12'])).toEqual(['gh#41', '!7', 'gh:Jalez/kehikko#12'])
  })

  test('the host’s row says where an issue or pull request lives', () => {
    const reading = { rows: [{ ref: 'gh#41', url: 'https://github.com/Jalez/kehikko/pull/41' }], missing: [] }
    expect(urlForSelection(['gh#41'], reading)).toEqual({ kind: 'open', ref: 'gh#41', url: 'https://github.com/Jalez/kehikko/pull/41' })
  })

  test('the first picked ref that has a page wins', () => {
    const reading = {
      rows: [
        { ref: '!7', url: 'https://gitlab.example/g/p/-/merge_requests/7' },
        { ref: 'gh#2', url: 'https://github.com/o/r/issues/2' },
      ],
    }
    expect(urlForSelection(['gh#2', '!7'], reading)).toMatchObject({ ref: 'gh#2' })
  })

  test('a row whose url is not a web address is not opened', () => {
    const reading = { rows: [{ ref: 'gh#1', url: 'javascript:alert(1)' }], missing: [] }
    expect(urlForSelection(['gh#1'], reading).kind).toBe('none')
  })

  test('a ref the host has not read yet is pending, and is asked again later', () => {
    expect(urlForSelection(['gh#9'], { rows: [], missing: [{ ref: 'gh#9', reason: 'pending' }] })).toEqual({ kind: 'pending', refs: ['gh#9'] })
    expect(urlForSelection(['gh#9'], { rows: [], missing: [{ ref: 'gh#9', reason: 'not-found' }] }).kind).toBe('none')
  })

  test('a ref that names its own GitHub repository opens without a reading', () => {
    expect(directUrl('gh:Jalez/kehikko#12')).toBe('https://github.com/Jalez/kehikko/issues/12')
    expect(directUrl('gh#12')).toBeNull()
    expect(directUrl('!7')).toBeNull()
    expect(urlForSelection(['gh:Jalez/kehikko#12'], null)).toMatchObject({ kind: 'open', url: 'https://github.com/Jalez/kehikko/issues/12' })
  })

  test('nothing picked, or nothing that is a ref, opens nothing and says why', () => {
    expect(urlForSelection([], null)).toEqual({ kind: 'none', why: 'Nothing is picked.' })
    expect(urlForSelection(['hello'], null)).toEqual({ kind: 'none', why: 'Nothing picked is an issue or a pull request.' })
  })
})
