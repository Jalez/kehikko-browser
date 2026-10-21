import { afterEach, describe, expect, test } from 'bun:test'

import { clearHighlight, showHighlight } from '../browser/highlight.ts'

const SLOT = '__testRefs'
const ID = '__test_highlight'

afterEach(() => {
  document.body.innerHTML = ''
  delete (window as unknown as Record<string, unknown>)[SLOT]
})

function withRef(): Element {
  const button = document.createElement('button')
  button.textContent = 'Sign in'
  document.body.append(button)
  ;(window as unknown as Record<string, unknown>)[SLOT] = new Map([['e3', { el: new WeakRef(button) }]])
  return button
}

describe('the highlight overlay', () => {
  test('is injected round a ref, with its label as text, and lets clicks through', () => {
    withRef()
    const got = showHighlight({ slot: SLOT, id: ID, ref: 'e3', label: 'Sign in', ms: 5000 })
    expect('why' in got).toBe(false)
    const host = document.getElementById(ID)!
    expect(host).not.toBeNull()
    expect(host.style.pointerEvents).toBe('none')
    expect(host.style.position).toBe('fixed')
    expect(host.shadowRoot?.textContent).toBe('Sign in')
  })

  test('a label is never markup', () => {
    withRef()
    showHighlight({ slot: SLOT, id: ID, ref: 'e3', label: '<img src=x onerror="alert(1)">', ms: 5000 })
    const root = document.getElementById(ID)!.shadowRoot!
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain('<img')
  })

  test('is removed by clearHighlight, and a second one replaces the first', () => {
    withRef()
    showHighlight({ slot: SLOT, id: ID, ref: 'e3', label: 'one', ms: 5000 })
    showHighlight({ slot: SLOT, id: ID, ref: 'e3', label: 'two', ms: 5000 })
    expect(document.querySelectorAll('[data-kehikot-highlight]')).toHaveLength(1)
    expect(document.getElementById(ID)!.shadowRoot!.textContent).toBe('two')
    expect(clearHighlight({ id: ID })).toBe(true)
    expect(document.getElementById(ID)).toBeNull()
    expect(clearHighlight({ id: ID })).toBe(false)
  })

  test('removes itself after ms', async () => {
    withRef()
    showHighlight({ slot: SLOT, id: ID, ref: 'e3', label: 'brief', ms: 300 })
    expect(document.getElementById(ID)).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(document.getElementById(ID)).toBeNull()
  })

  test('says why when there is nothing to outline', () => {
    expect(showHighlight({ slot: SLOT, id: ID, ref: 'e9', label: '', ms: 500 })).toMatchObject({ why: expect.stringContaining('e9') })
    expect(showHighlight({ slot: SLOT, id: ID, selector: '#nope', label: '', ms: 500 })).toMatchObject({ why: expect.stringContaining('#nope') })
    expect(showHighlight({ slot: SLOT, id: ID, label: '', ms: 500 })).toMatchObject({ why: expect.any(String) })
    expect(document.getElementById(ID)).toBeNull()
  })

  test('outlines a point when given one', () => {
    const got = showHighlight({ slot: SLOT, id: ID, x: 100, y: 50, label: 'here', ms: 5000 })
    expect(got).toMatchObject({ width: 32, height: 32 })
  })
})
