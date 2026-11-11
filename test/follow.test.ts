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

  test('a GitLab ref with no usable row gets its address from the host’s sources', () => {
    const com = { tracker: 'gitlab', host: 'gitlab.com', repo: 'group/sub/project', default: true }
    const self = { tracker: 'gitlab', host: 'git.example.org', repo: 'team/app', default: true }
    const gh = { tracker: 'github', host: 'github.com', repo: 'Jalez/kehikko', default: true }
    const at = (ref: string, sources: unknown[], rows: unknown[] = []) => urlForSelection([ref], { rows, missing: [], sources })
    expect(at('!4360', [gh, com])).toMatchObject({ kind: 'open', url: 'https://gitlab.com/group/sub/project/-/merge_requests/4360' })
    expect(at('#12', [gh, com])).toMatchObject({ kind: 'open', url: 'https://gitlab.com/group/sub/project/-/issues/12' })
    expect(at('!7', [self])).toMatchObject({ url: 'https://git.example.org/team/app/-/merge_requests/7' })
    expect(at('gl#7', [self])).toMatchObject({ url: 'https://git.example.org/team/app/-/issues/7' })
    expect(at('gl:team/app!9', [com, { ...self, default: false }])).toMatchObject({ url: 'https://git.example.org/team/app/-/merge_requests/9' })
    expect(at('gl:team/app#9', [com, { ...self, default: false }])).toMatchObject({ url: 'https://git.example.org/team/app/-/issues/9' })
    /* A row with a page still wins; no source to say where means no page. */
    expect(at('!7', [self], [{ ref: '!7', url: 'https://git.example.org/other/-/merge_requests/7' }])).toMatchObject({ url: 'https://git.example.org/other/-/merge_requests/7' })
    expect(at('!7', [gh]).kind).toBe('none')
    expect(at('gl:other/repo!7', [self]).kind).toBe('none')
  })

  test('GitHub addresses are unchanged beside GitLab sources', () => {
    expect(directUrl('gh:Jalez/kehikko#12', [{ tracker: 'gitlab', host: 'gitlab.com', repo: 'a/b', default: true }])).toBe('https://github.com/Jalez/kehikko/issues/12')
    expect(directUrl('gh#12', [{ tracker: 'github', host: 'github.com', repo: 'Jalez/kehikko', default: true }])).toBeNull()
  })

  test('nothing picked, or nothing that is a ref, opens nothing and says why', () => {
    expect(urlForSelection([], null)).toEqual({ kind: 'none', why: 'Nothing is picked.' })
    expect(urlForSelection(['hello'], null)).toEqual({ kind: 'none', why: 'Nothing picked is an issue or a pull request.' })
  })
})
