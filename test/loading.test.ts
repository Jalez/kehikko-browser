import { describe, expect, test } from 'bun:test'

import { mainNavigation } from '../browser/engine.ts'

/** What the engine counts as the page loading: a navigation of the page's own main frame, and nothing else. */
describe('a load, as the engine sees it', () => {
  const main = { name: 'main' }
  const page = { mainFrame: () => main } as never

  test('a navigation request of the main frame is a load', () => {
    expect(mainNavigation(page, { isNavigationRequest: () => true, frame: () => main })).toBe(true)
  })

  test('a frame inside the page, or a subresource, is not', () => {
    expect(mainNavigation(page, { isNavigationRequest: () => true, frame: () => ({ name: 'iframe' }) })).toBe(false)
    expect(mainNavigation(page, { isNavigationRequest: () => false, frame: () => main })).toBe(false)
  })

  test('a worker’s request, whose frame cannot be asked, is not', () => {
    expect(
      mainNavigation(page, {
        isNavigationRequest: () => true,
        frame: () => {
          throw new Error('Service Worker requests do not have an associated frame.')
        },
      }),
    ).toBe(false)
  })
})
