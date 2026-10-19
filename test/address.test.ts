import { describe, expect, test } from 'bun:test'

import { allowedUrl, labelFor, normaliseAddress } from '../src/lib/address.ts'

describe('what may be opened', () => {
  test('a bare host becomes https, a dev server on loopback http', () => {
    expect(normaliseAddress('github.com/Jalez/kehikko/issues')).toEqual({ ok: true, url: 'https://github.com/Jalez/kehikko/issues' })
    expect(normaliseAddress('localhost:5173')).toEqual({ ok: true, url: 'http://localhost:5173/' })
    expect(normaliseAddress('127.0.0.1:8020/app')).toEqual({ ok: true, url: 'http://127.0.0.1:8020/app' })
    expect(normaliseAddress('myapp.test:3000')).toEqual({ ok: true, url: 'http://myapp.test:3000/' })
    expect(normaliseAddress('  https://example.org  ')).toEqual({ ok: true, url: 'https://example.org/' })
    expect(normaliseAddress('about:blank')).toEqual({ ok: true, url: 'about:blank' })
  })

  test('every other scheme is refused, by name', () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'data:text/html,hi', 'ftp://x.org', 'view-source:https://x.org']) {
      const got = normaliseAddress(bad)
      expect(got.ok).toBe(false)
    }
    expect(normaliseAddress('file:///etc/passwd')).toEqual({ ok: false, why: 'This browser opens http and https addresses only, not file.' })
  })

  test('nothing, words and spaces are not addresses', () => {
    expect(normaliseAddress('').ok).toBe(false)
    expect(normaliseAddress('issues').ok).toBe(false)
    expect(normaliseAddress('two words').ok).toBe(false)
  })

  test('allowedUrl is the server’s check on an address that already parsed', () => {
    expect(allowedUrl('https://github.com')).toBe(true)
    expect(allowedUrl('about:blank')).toBe(true)
    expect(allowedUrl('about:config')).toBe(false)
    expect(allowedUrl('file:///x')).toBe(false)
    expect(allowedUrl('not a url')).toBe(false)
  })

  test('a label is the title, else host and path, cut to fit a menu', () => {
    expect(labelFor('https://github.com/a/b', 'Issue 12 · a/b')).toBe('Issue 12 · a/b')
    expect(labelFor('https://github.com/a/b', '')).toBe('github.com/a/b')
    expect(labelFor('https://x.org/', null)).toBe('x.org')
    expect(labelFor('https://x.org/', 'x'.repeat(100)).length).toBe(48)
  })
})
