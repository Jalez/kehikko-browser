import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

import { Browser, headerItems } from '../src/app.tsx'
import type { Saved } from '../src/lib/saved.ts'
import type { Api, Endpoint } from '../src/wire/api.ts'
import type { Stream, StreamEvents } from '../src/wire/stream.ts'
import type { Host, Kept } from '../src/wire/use-kehikot.ts'

afterEach(cleanup)

const saved: Saved[] = [{ id: 'sabc', name: 'Issues', url: 'https://github.com/Jalez/kehikko/issues', at: '' }]

function fakeStream() {
  const sent: Record<string, unknown>[] = []
  let events: StreamEvents = {}
  const make = (e: StreamEvents) => {
    events = e
    return {
      start: () => events.open?.(true),
      stop: () => {},
      send: (m: Record<string, unknown>) => sent.push(m),
      resize: () => {},
    } as unknown as Stream
  }
  return { sent, make, events: () => events }
}

function fakeApi(over: Partial<Api> = {}): Api & { recorded: unknown[] } {
  const recorded: unknown[] = []
  return {
    recorded,
    saved: () => Promise.resolve(saved),
    save: () => Promise.resolve({ list: saved }),
    remove: () => Promise.resolve([]),
    rename: () => Promise.resolve(saved),
    place: () => Promise.resolve(null),
    record: (...args) => {
      recorded.push(args)
      return Promise.resolve()
    },
    followEndpoint: (on) => (on({ endpoint: { http: 'http://127.0.0.1:8025', ws: null, port: 8025 }, snippets: null }), () => {}),
    console: () => Promise.resolve({ entries: [], dropped: 0, last: 0 }),
    clearConsole: () => {
      recorded.push('clear')
      return Promise.resolve()
    },
    openDevtools: () => {
      recorded.push('devtools')
      return Promise.resolve('http://127.0.0.1:8025/devtools/inspector.html?ws=127.0.0.1:8025/devtools/page/ABC')
    },
    runs: () => Promise.resolve([]),
    shotSets: () => Promise.resolve([]),
    shotSet: () => Promise.reject(new Error('none')),
    approveShots: () => Promise.reject(new Error('none')),
    ...over,
  }
}

function host(over: Partial<Host> = {}): Host & { said: unknown[][]; kept: Kept | null } {
  const said: unknown[][] = []
  return {
    where: 'hosted',
    project: 'Kehikko',
    projectPath: '/work/kehikko',
    epic: 'browser',
    theme: 'light',
    selection: [],
    parts: [],
    kehikko: { id: 1, name: 'Main', key: 'main' },
    kept: null,
    trackerAt: null,
    request: (...args: unknown[]) => {
      said.push(args)
      return Promise.resolve({ rows: [{ ref: 'gh#41', url: 'https://github.com/Jalez/kehikko/pull/41' }], missing: [] })
    },
    remember: () => {},
    header: () => {},
    said,
    ...over,
  } as Host & { said: unknown[][]; kept: Kept | null }
}

describe('the header it declares', () => {
  test('saved addresses are a Go item agents may press; follow is a toggle and a pinned button', () => {
    const items = headerItems({ saved, follow: true, canSave: true })
    const go = items.find((i) => i.id === 'saved')
    expect(go).toMatchObject({ kind: 'go', agents: true, options: [{ id: 'sabc', label: 'Issues' }] })
    expect(items.find((i) => i.id === 'follow')).toMatchObject({ kind: 'toggle', checked: true, agents: true })
    expect(items.find((i) => i.id === 'pin')).toMatchObject({ kind: 'run', pinned: true, label: 'Stop following picks' })
    expect(items.find((i) => i.id === 'save')).toMatchObject({ kind: 'run', agents: true, disabled: null })
    expect(items.find((i) => i.id === 'endpoint')).toMatchObject({ tool: 'cdp_endpoint', agents: false })
  })

  test('nothing saved, no Go item; nothing to save, the save is disabled with a reason', () => {
    const items = headerItems({ saved: [], follow: false, canSave: false })
    expect(items.some((i) => i.id === 'saved')).toBe(false)
    expect(items.find((i) => i.id === 'pin')).toMatchObject({ label: 'Follow picks again' })
    expect((items.find((i) => i.id === 'save') as { disabled: string | null }).disabled).toBeTruthy()
  })
})

describe('the page', () => {
  test('draws an address bar and its own menus only when nobody frames it', () => {
    const s = fakeStream()
    render(<Browser host={host({ where: 'unhosted' })} api={fakeApi()} makeStream={s.make} />)
    expect(screen.getByLabelText('Address')).toBeDefined()
    expect(screen.getByRole('button', { name: /View/ })).toBeDefined()
    cleanup()
    render(<Browser host={host()} api={fakeApi()} makeStream={s.make} />)
    expect(screen.queryByRole('button', { name: /View/ })).toBeNull()
  })

  test('a Go press opens the saved address', async () => {
    const s = fakeStream()
    const pressRef = { current: (_: { item: string; value?: string | boolean }) => undefined as string | void }
    render(<Browser host={host()} api={fakeApi()} makeStream={s.make} pressRef={pressRef} />)
    await waitFor(() => expect(pressRef.current({ item: 'saved', value: 'sabc' })).toBeUndefined())
    expect(s.sent).toContainEqual({ t: 'go', url: 'https://github.com/Jalez/kehikko/issues' })
  })

  test('picking an issue on the canvas opens its page, from the host’s tracker reading', async () => {
    const s = fakeStream()
    const h = host()
    const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    await act(async () => rerender(<Browser host={{ ...h, selection: ['gh#41'] }} api={fakeApi()} makeStream={s.make} />))
    await waitFor(() => expect(s.sent).toContainEqual({ t: 'go', url: 'https://github.com/Jalez/kehikko/pull/41' }))
    expect(h.said[0]).toEqual(['tracker.get', { refs: ['gh#41'] }])
  })

  test('with following stopped, a pick opens nothing', async () => {
    const s = fakeStream()
    const h = host({ kept: { follow: false } })
    const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    await act(async () => rerender(<Browser host={{ ...h, selection: ['gh#41'] }} api={fakeApi()} makeStream={s.make} />))
    await new Promise((r) => setTimeout(r, 20))
    expect(s.sent.some((m) => m.t === 'go')).toBe(false)
  })

  test('arriving at a place restores the address remembered there', async () => {
    const s = fakeStream()
    const asked: string[][] = []
    const api = fakeApi({
      place: (_p, keys) => {
        asked.push(keys)
        return Promise.resolve({ url: 'https://example.org/remembered', title: '', at: '', key: keys[1]! })
      },
    })
    render(<Browser host={host({ parts: [{ id: 'p1', heading: 'One', refs: [], picked: true }] })} api={api} makeStream={s.make} />)
    await waitFor(() => expect(s.sent).toContainEqual({ t: 'go', url: 'https://example.org/remembered' }))
    expect(asked[0]).toEqual(['epic:browser/parts:p1/kehikko:main', 'epic:browser/parts:p1', 'epic:browser', 'project'])
  })

  test('a page shown after arrival is recorded at the place', async () => {
    const s = fakeStream()
    const api = fakeApi()
    render(<Browser host={host()} api={api} makeStream={s.make} />)
    await new Promise((r) => setTimeout(r, 10))
    act(() => s.events().page?.({ url: 'https://github.com/x', title: 'X', canBack: false, canForward: false, loading: false }))
    await waitFor(() => expect(api.recorded.length).toBe(1), { timeout: 3000 })
    expect(api.recorded[0]).toEqual(['/work/kehikko', ['epic:browser/kehikko:main', 'epic:browser', 'project'], 'https://github.com/x', 'X'])
  })

  test('an address handed to the canvas opens once, says who asked, and can be saved', async () => {
    const s = fakeStream()
    const saves: unknown[] = []
    const api = fakeApi({
      save: (...args) => {
        saves.push(args)
        return Promise.resolve({ list: saved, saved: { id: 'sdes', name: 'Design', url: 'https://example.com/design', at: '' } })
      },
    })
    const remembered: unknown[] = []
    const handed = { url: 'https://example.com/design', title: 'Design', intent: 'show' as const, by: 'kehikot.flows', at: 't1' }
    const h = host({ remember: (kept: Kept) => void remembered.push(kept) })
    const { rerender } = render(<Browser host={h} api={api} makeStream={s.make} />)
    await act(async () => rerender(<Browser host={{ ...h, address: handed }} api={api} makeStream={s.make} />))
    await waitFor(() => expect(s.sent).toContainEqual({ t: 'go', url: 'https://example.com/design' }))
    expect(screen.getByTestId('said').textContent).toContain('Opened “Design”, handed over by kehikot.flows.')
    expect(remembered).toContainEqual({ addressAt: 't1' })

    /* The same context again is not a second request; a new at is. */
    await act(async () => rerender(<Browser host={{ ...h, address: { ...handed } }} api={api} makeStream={s.make} />))
    expect(s.sent.filter((m) => m.t === 'go')).toHaveLength(1)
    await act(async () => rerender(<Browser host={{ ...h, address: { ...handed, at: 't2' } }} api={api} makeStream={s.make} />))
    expect(s.sent.filter((m) => m.t === 'go')).toHaveLength(2)

    await act(async () => screen.getByTestId('save-handed').click())
    await waitFor(() => expect(saves).toEqual([['/work/kehikko', { url: 'https://example.com/design', title: 'Design' }]]))
    expect(screen.getByTestId('said').textContent).toContain('Saved as “Design”.')
  })

  test('an address already acted on before a reload is not opened again', async () => {
    const s = fakeStream()
    const handed = { url: 'https://example.com/design', intent: 'show' as const, by: 'kehikot.flows', at: 't1' }
    render(<Browser host={host({ kept: { addressAt: 't1' }, address: handed })} api={fakeApi()} makeStream={s.make} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(s.sent.some((m) => m.t === 'go')).toBe(false)
  })

  test('a handed-over address wins over the place’s remembered one arriving later', async () => {
    const s = fakeStream()
    let answer: (visit: { url: string; title: string; at: string; key: string }) => void = () => {}
    const api = fakeApi({ place: () => new Promise((resolve) => (answer = resolve)) })
    const handed = { url: 'https://example.com/design', intent: 'show' as const, by: 'kehikot.flows', at: 't1' }
    render(<Browser host={host({ address: handed })} api={api} makeStream={s.make} />)
    await waitFor(() => expect(s.sent).toContainEqual({ t: 'go', url: 'https://example.com/design' }))
    await act(async () => answer({ url: 'https://example.org/remembered', title: '', at: '', key: 'project' }))
    await new Promise((r) => setTimeout(r, 10))
    expect(s.sent).not.toContainEqual({ t: 'go', url: 'https://example.org/remembered' })
  })

  test('a failed start says why and offers to try again', () => {
    const s = fakeStream()
    render(<Browser host={host()} api={fakeApi()} makeStream={s.make} />)
    act(() => s.events().status?.({ state: 'failed', why: 'No Chromium to run.', endpoint: null }))
    expect(screen.getByTestId('starting').textContent).toContain('No Chromium to run.')
  })
})

describe('the Playwright endpoint panel: told, never asks on a clock', () => {
  test('open, it follows one stream, sets no timer, and shows the endpoint once the browser has started', async () => {
    const followers: ((endpoint: Endpoint) => void)[] = []
    let stopped = 0
    const api = fakeApi({
      /* As the stream does: the endpoint as it stands at once, then each start or stop the test sends. */
      followEndpoint: (on) => {
        followers.push(on)
        on({ endpoint: null, snippets: null })
        return () => void stopped++
      },
    })
    const realInterval = globalThis.setInterval
    let intervals = 0
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => (intervals++, realInterval(...args))) as typeof setInterval
    try {
      const s = fakeStream()
      const pressRef = { current: (_: { item: string; value?: string | boolean }) => undefined as string | void }
      render(<Browser host={host()} api={api} makeStream={s.make} pressRef={pressRef} />)
      await act(async () => void pressRef.current({ item: 'endpoint' }))
      /* Counted before `waitFor`, which keeps an interval of its own. */
      expect(intervals).toBe(0)
      expect(followers.length).toBe(1)
      expect(screen.getByText(/The endpoint opens once the browser has started/)).toBeDefined()
      /* The browser starts (an agent's cdp_endpoint, say): the server publishes the endpoint. */
      await act(async () => followers[0]!({ endpoint: { http: 'http://127.0.0.1:8031', ws: null, port: 8031 }, snippets: null }))
      expect(screen.getByTestId('endpoint').textContent).toContain('http://127.0.0.1:8031')
      expect(intervals).toBe(0)
      expect(followers.length).toBe(1)
      cleanup()
      expect(stopped).toBe(1)
    } finally {
      globalThis.setInterval = realInterval
    }
  })
})
