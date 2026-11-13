import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

import { Browser } from './hosted.tsx'
import type { Api } from '../src/wire/api.ts'
import type { Stream, StreamEvents } from '../src/wire/stream.ts'
import type { Host, Kept } from '../src/wire/use-kehikot.ts'

/* The person's report: switching to a space with nothing shown kept the previous space's page up. Each
   place holds its own page; one that holds none shows the empty space, and coming back restores the page. */

afterEach(cleanup)

function fakeStream() {
  const sent: Record<string, unknown>[] = []
  let events: StreamEvents = {}
  const make = (e: StreamEvents) => {
    events = e
    return {
      start: () => events.open?.(true),
      stop: () => {},
      send: (m: Record<string, unknown>) => {
        sent.push(m)
        /* The engine answers a place with a new blank page of its own: nothing kept (keep.ts). */
        if (m.t === 'place') queueMicrotask(() => events.placed?.({ key: String(m.key), kept: false, asIs: false }))
        return true
      },
      resize: () => {},
      shown: () => {},
    } as unknown as Stream
  }
  return { sent, make, events: () => events }
}

const PAGE = 'https://github.com/Jalez/kehikko/pull/41'

/** Memory with one page kept, at `at`; every other place holds nothing. */
function fakeApi(at: string, over: Partial<Api> = {}): Api {
  return {
    saved: () => Promise.resolve([]),
    save: () => Promise.resolve({ list: [] }),
    remove: () => Promise.resolve([]),
    rename: () => Promise.resolve([]),
    place: (_p, key) => Promise.resolve(key === at ? { url: PAGE, title: 'PR 41', at: '', key } : null),
    suggest: () => Promise.resolve({ nearby: [], recent: [], servers: [] }),
    record: () => Promise.resolve(),
    followEndpoint: () => () => {},
    console: () => Promise.resolve({ entries: [], dropped: 0, last: 0 }),
    clearConsole: () => Promise.resolve(),
    openDevtools: () => Promise.resolve(''),
    runs: () => Promise.resolve([]),
    shotSets: () => Promise.resolve([]),
    shotSet: () => Promise.reject(new Error('none')),
    approveShots: () => Promise.reject(new Error('none')),
    ...over,
  }
}

function host(over: Partial<Host> = {}): Host {
  return {
    where: 'hosted',
    project: 'Kehikko',
    projectPath: '/work/kehikko',
    epic: 'thesis',
    theme: 'light',
    selection: [],
    parts: [],
    kehikko: { id: 1, name: 'Main', key: 'main' },
    kept: null,
    trackerAt: null,
    request: () => Promise.resolve({ rows: [], missing: [] }),
    remember: () => {},
    header: () => {},
    ...over,
  } as unknown as Host & { kept: Kept | null }
}

const space = (...ids: string[]) => ({ path: ids.map((id) => ({ id, name: id })), picked: [] })
const page = (url: string) => ({ url, title: '', canBack: false, canForward: false, loading: false })

async function journey(atA: Host, atB: Host, keyA: string) {
  const s = fakeStream()
  const api = fakeApi(keyA)
  const { rerender } = render(<Browser host={atA} api={api} makeStream={s.make} />)
  act(() => s.events().status?.({ state: 'ready', why: null, endpoint: null }))
  /* A's page is restored and comes up. */
  await waitFor(() => expect(s.sent).toContainEqual({ t: 'go', url: PAGE }))
  act(() => s.events().page?.(page(PAGE)))
  act(() => s.events().frame?.({ data: '', width: 1, height: 1 }))
  expect(screen.queryByTestId('empty-space')).toBeNull()

  /* To B, where nothing was shown: A's page is covered at once, then let go, and the empty space says so. */
  await act(async () => rerender(<Browser host={atB} api={api} makeStream={s.make} />))
  await waitFor(() => expect(screen.getByTestId('empty-space')).toBeTruthy())
  expect(s.sent.at(-1)).toEqual({ t: 'go', url: 'about:blank' })
  expect(screen.getByTestId('empty-space').textContent).toContain('Nothing is open in this space yet.')
  act(() => s.events().page?.(page('about:blank')))
  expect(screen.getByTestId('empty-space')).toBeTruthy()

  /* Back to A: its page again. */
  const gos = s.sent.filter((m) => m.t === 'go' && m.url === PAGE).length
  await act(async () => rerender(<Browser host={atA} api={api} makeStream={s.make} />))
  await waitFor(() => expect(s.sent.filter((m) => m.t === 'go' && m.url === PAGE).length).toBe(gos + 1))
  act(() => s.events().page?.(page(PAGE)))
  act(() => s.events().frame?.({ data: '', width: 1, height: 1 }))
  await waitFor(() => expect(screen.queryByTestId('empty-space')).toBeNull())
}

describe('switching to a place with nothing shown', () => {
  test('a host that says spaces: the empty space, and the page again on the way back', async () => {
    await journey(
      host({ space: space('thesis', 'method') }),
      host({ space: space('thesis', 'results', 'figures') }),
      'epic:thesis/parts:method/kehikko:main',
    )
  })

  test('an older host saying only the epic and its parts: the same', async () => {
    await journey(
      host({ parts: [{ id: 'method', heading: 'Method', refs: [], picked: true }] }),
      host({ parts: [{ id: 'results', heading: 'Results', refs: [], picked: true }] }),
      'epic:thesis/parts:method/kehikko:main',
    )
  })

  test('another epic with nothing shown is empty too, not what the project showed last', async () => {
    await journey(host({ epic: 'thesis' }), host({ epic: 'talk', space: space('talk') }), 'epic:thesis/kehikko:main')
  })

  test('while the new place is read, the last page is covered, never shown', async () => {
    const s = fakeStream()
    let answer: (v: null) => void = () => {}
    let first = true
    const api = fakeApi('epic:thesis/kehikko:main', {
      place: (_p, key) => {
        if (first) {
          first = false
          return Promise.resolve({ url: PAGE, title: '', at: '', key })
        }
        return new Promise((r) => (answer = r))
      },
    })
    const { rerender } = render(<Browser host={host()} api={api} makeStream={s.make} />)
    act(() => s.events().status?.({ state: 'ready', why: null, endpoint: null }))
    await waitFor(() => expect(s.sent).toContainEqual({ t: 'go', url: PAGE }))
    act(() => s.events().page?.(page(PAGE)))
    act(() => s.events().frame?.({ data: '', width: 1, height: 1 }))
    await act(async () => rerender(<Browser host={host({ epic: 'talk' })} api={api} makeStream={s.make} />))
    expect(screen.getByTestId('reading-place')).toBeTruthy()
    await act(async () => answer(null))
    await waitFor(() => expect(screen.getByTestId('empty-space')).toBeTruthy())
    expect(screen.queryByTestId('reading-place')).toBeNull()
  })

  test('the empty space offers what was used nearby, the running dev servers and recent pages, each one press', async () => {
    const s = fakeStream()
    const api = fakeApi('none', {
      suggest: () =>
        Promise.resolve({
          nearby: [{ url: 'https://example.org/method', title: 'Method notes', at: '', key: 'epic:thesis/parts:method' }],
          recent: [{ url: 'https://example.org/old', title: 'Old', at: '', key: 'epic:talk' }],
          servers: [{ url: 'http://localhost:5173/', from: 'the dev script' }],
        }),
    })
    render(<Browser host={host({ space: space('thesis', 'results') })} api={api} makeStream={s.make} />)
    act(() => s.events().status?.({ state: 'ready', why: null, endpoint: null }))
    await waitFor(() => expect(screen.getByTestId('offer-nearby').textContent).toContain('Method notes'))
    expect(screen.getByTestId('offer-servers').textContent).toContain('localhost:5173')
    expect(screen.getByTestId('offer-servers').textContent).toContain('from the dev script')
    expect(screen.getByTestId('offer-recent').textContent).toContain('Old')
    await act(async () => screen.getByText('Method notes').click())
    expect(s.sent).toContainEqual({ t: 'go', url: 'https://example.org/method' })
  })
})
