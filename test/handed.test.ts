import { describe, expect, test } from 'bun:test'
import type { SharedAddress } from 'kehikot-module-protocol'

import { ID, DECLARED } from '../manifest.ts'
import { addressToOpen, handedSaid } from '../src/lib/handed.ts'

const address = (over: Partial<SharedAddress> = {}): SharedAddress => ({
  url: 'https://example.com/design',
  title: 'Design',
  intent: 'show',
  by: 'kehikot.flows',
  at: '2026-10-23T10:00:00.000Z',
  ...over,
})

describe('the manifest', () => {
  test('says it shows pages: reacts to address', () => {
    expect(DECLARED.reacts).toContain('address')
  })
})

describe('addressToOpen', () => {
  test('a new address is opened, with its title and who handed it over', () => {
    expect(addressToOpen(address(), null)).toEqual({
      url: 'https://example.com/design',
      title: 'Design',
      by: 'kehikot.flows',
      at: '2026-10-23T10:00:00.000Z',
    })
  })

  test('one already acted on is not opened again; the same address with a new at is', () => {
    expect(addressToOpen(address(), '2026-10-23T10:00:00.000Z')).toBeNull()
    expect(addressToOpen(address({ at: '2026-10-23T10:00:00.001Z' }), '2026-10-23T10:00:00.000Z')?.url).toBe('https://example.com/design')
  })

  test('nothing, one this module sent, and one the protocol would not take are not opened', () => {
    expect(addressToOpen(null, null)).toBeNull()
    expect(addressToOpen(undefined, null)).toBeNull()
    expect(addressToOpen(address({ by: ID }), null)).toBeNull()
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://example.com', 'https://u:p@example.com']) {
      expect(addressToOpen(address({ url }), null)).toBeNull()
    }
  })

  test('an agent’s address says so', () => {
    const { by: _by, ...rest } = address()
    expect(addressToOpen({ ...rest, agent: true }, null)?.by).toBe('an agent')
  })

  test('the line it says', () => {
    expect(handedSaid({ url: 'https://example.com/design', title: 'Design', by: 'kehikot.flows', at: null })).toBe(
      'Opened “Design”, handed over by kehikot.flows.',
    )
    expect(handedSaid({ url: 'https://example.com/design', title: null, by: null, at: null })).toBe('Opened “example.com/design”.')
  })
})
