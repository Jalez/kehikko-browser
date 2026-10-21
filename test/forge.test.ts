import { describe, expect, test } from 'bun:test'

import { forgeUrl, remotesFrom, repoOf } from '../src/lib/forge.ts'

const github = [{ name: 'origin', url: 'git@github.com:Jalez/kehikko.git' }]
const gitlab = [{ name: 'origin', url: 'https://gitlab.example.org/team/app.git' }]

describe('/browser-open picks the forge page for a ref', () => {
  test('a short ref means the project’s own repository, read from its remotes', () => {
    expect(forgeUrl('gh#12', github)).toMatchObject({ ok: true, url: 'https://github.com/Jalez/kehikko/issues/12' })
    expect(forgeUrl('#12', gitlab)).toMatchObject({ ok: true, url: 'https://gitlab.example.org/team/app/-/issues/12' })
    expect(forgeUrl('!7', gitlab)).toMatchObject({ ok: true, url: 'https://gitlab.example.org/team/app/-/merge_requests/7', kind: 'change' })
  })

  test('words people use', () => {
    expect(forgeUrl('PR 41', github)).toMatchObject({ ok: true, url: 'https://github.com/Jalez/kehikko/pull/41' })
    expect(forgeUrl('issue #3', github)).toMatchObject({ ok: true, url: 'https://github.com/Jalez/kehikko/issues/3' })
    expect(forgeUrl('MR !7', gitlab)).toMatchObject({ ok: true, url: 'https://gitlab.example.org/team/app/-/merge_requests/7' })
  })

  test('a qualified ref names its own repository', () => {
    expect(forgeUrl('gh:octo/cat#5', gitlab)).toMatchObject({ ok: true, url: 'https://github.com/octo/cat/issues/5' })
    expect(forgeUrl('octo/cat#5', github)).toMatchObject({ ok: true, url: 'https://github.com/octo/cat/issues/5' })
    expect(forgeUrl('group/sub/proj!9', gitlab)).toMatchObject({ ok: true, url: 'https://gitlab.example.org/group/sub/proj/-/merge_requests/9' })
  })

  test('an address already on a forge is kept', () => {
    expect(forgeUrl('https://github.com/Jalez/kehikko/pull/93', [])).toMatchObject({ ok: true, url: 'https://github.com/Jalez/kehikko/pull/93', kind: 'change', number: 93 })
    expect(forgeUrl('https://example.org/x', []).ok).toBe(false)
  })

  test('says why when there is no repository to mean', () => {
    const none = forgeUrl('#12', [{ name: 'origin', url: '/srv/git/app.git' }])
    expect(none.ok).toBe(false)
    expect(forgeUrl('gh#12', gitlab).ok).toBe(false)
    expect(forgeUrl('nonsense here', github).ok).toBe(false)
  })

  test('remotes are read from git config, origin first', () => {
    const remotes = remotesFrom('remote.upstream.url https://github.com/up/stream.git\nremote.origin.url git@github.com:me/fork.git\n')
    expect(remotes).toEqual([
      { name: 'upstream', url: 'https://github.com/up/stream.git' },
      { name: 'origin', url: 'git@github.com:me/fork.git' },
    ])
    expect(forgeUrl('gh#1', remotes)).toMatchObject({ url: 'https://github.com/me/fork/issues/1' })
    expect(repoOf('ssh://git@gitlab.com/a/b.git')).toEqual({ forge: 'gitlab', host: 'gitlab.com', path: 'a/b' })
    expect(repoOf('https://bitbucket.org/a/b.git')).toBeNull()
  })
})
