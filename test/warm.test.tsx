import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { FooterItem, HeaderItem } from 'kehikot-module-protocol'

import { Browser } from './hosted.tsx'
import { FOOT, NEWER_LABEL } from '../src/lib/footer.ts'
import type { Api } from '../src/wire/api.ts'
import type { Stream, StreamEvents } from '../src/wire/stream.ts'
import type { Host } from '../src/wire/use-kehikot.ts'

/* Pages kept ready, from the page's side: the engine shows a kept place's page at once, and the page
   then asks nothing, opens nothing and blanks nothing. */

afterEach(cleanup)

const PAGE = 'https://example.org/dashboard'
const page = (url: string) => ({ url, title: '', canBack: false, canForward: false, loading: false })

/** An engine that keeps the places in `kept`, as the real one does once each was shown. */
function engine(kept: Set<string>) {
  const sent: Record<string, unknown>[] = []
  let events: StreamEvents = {}
  const make = (e: StreamEvents) => {
    events = e
    return {
      start: () => {
        events.open?.(true)
        events.status?.({ state: 'ready', why: null, endpoint: null })
      },
      stop: () => {},
      send: (m: Record<string, unknown>) => {
        sent.push(m)
        if (m.t === 'place') {
          const key = String(m.key)
          const was = kept.has(key)
          kept.add(key)
          queueMicrotask(() => events.placed?.({ key, kept: was, asIs: false }))
        }
        return true
      },
      resize: () => {},
      shown: () => {},
    } as unknown as Stream
  }
  return { sent, make, events: () => events }
}

function fakeApi(read: string[]): Api {
  return {
    saved: () => Promise.resolve([]),
    save: () => Promise.resolve({ list: [] }),
    remove: () => Promise.resolve([]),
    rename: () => Promise.resolve([]),
    place: (_p, key) => {
      read.push(key)
      return Promise.resolve(key.includes('method') ? { url: PAGE, title: '', at: '', key } : null)
    },
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
  }
}

function host(over: Partial<Host> = {}) {
  const footers: FooterItem[][] = []
  const headers: HeaderItem[][] = []
  const h = {
    where: 'hosted',
    project: 'P',
    projectPath: '/work/p',
    epic: 'thesis',
    theme: 'light',
    selection: [],
    parts: [],
    kehikko: { id: 1, name: 'Main', key: 'main' },
    kept: null,
    trackerAt: null,
    drawsFooter: true,
    footerKinds: ['run', 'text', 'input'],
    request: () => Promise.resolve({ rows: [], missing: [] }),
    remember: () => {},
    header: (items: HeaderItem[]) => void headers.push(items),
    footer: (items: FooterItem[]) => void footers.push(items),
    ...over,
  } as unknown as Host
  return { h, footers, headers }
}

const at = (id: string) => ({ space: { path: [{ id: 'thesis', name: 'Thesis' }, { id, name: id }], picked: [] } })

describe('a place kept ready', () => {
  test('going back shows the kept page at once: no memory read, no navigation, no blank, no empty space', async () => {
    const kept = new Set<string>()
    const e = engine(kept)
    const read: string[] = []
    const api = fakeApi(read)
    const { h } = host(at('method'))
    const view = render(<Browser host={h} api={api} makeStream={e.make} />)
    await waitFor(() => expect(e.sent).toContainEqual({ t: 'go', url: PAGE }))
    act(() => e.events().page?.(page(PAGE)))
    act(() => e.events().frame?.({ data: '', width: 1, height: 1 }))

    const other = host(at('results')).h
    await act(async () => view.rerender(<Browser host={other} api={api} makeStream={e.make} />))
    await waitFor(() => expect(screen.getByTestId('empty-space')).toBeTruthy())
    act(() => e.events().page?.(page('about:blank')))

    const before = { sent: e.sent.length, read: read.length }
    await act(async () => view.rerender(<Browser host={h} api={api} makeStream={e.make} />))
    /* The engine put the kept page back; it says so with its own state. */
    act(() => e.events().page?.(page(PAGE)))
    await waitFor(() => expect(screen.queryByTestId('empty-space')).toBeNull())
    expect(screen.queryByTestId('reading-place')).toBeNull()
    expect(read.length).toBe(before.read)
    expect(e.sent.slice(before.sent)).toEqual([{ t: 'place', key: '/work/p::epic:thesis/parts:method/kehikko:main', projectPath: '/work/p' }])
  })

  test('a page the host keeps hidden does not claim the browser; shown again, it does', async () => {
    const e = engine(new Set())
    const { h } = host({ ...at('method'), visible: false })
    const view = render(<Browser host={h} api={fakeApi([])} makeStream={e.make} />)
    await act(async () => new Promise((r) => setTimeout(r, 10)))
    expect(e.sent.some((m) => m.t === 'place')).toBe(false)
    await act(async () => view.rerender(<Browser host={{ ...h, visible: true }} api={fakeApi([])} makeStream={e.make} />))
    await waitFor(() => expect(e.sent.some((m) => m.t === 'place')).toBe(true))
  })
})

describe('what the footer says about a kept page, only when it matters', () => {
  test('nothing by default; a newer version over typed input offers Reload, and pressing it reloads', async () => {
    const e = engine(new Set())
    const { h, footers } = host(at('method'))
    const pressRef = { current: (_: { item: string }) => undefined as string | void }
    render(<Browser host={h} api={fakeApi([])} makeStream={e.make} pressRef={pressRef as never} />)
    await waitFor(() => expect(e.sent.some((m) => m.t === 'place')).toBe(true))
    act(() => e.events().page?.(page(PAGE)))
    await waitFor(() => expect(footers.length).toBeGreaterThan(0))
    expect(footers.at(-1)!.some((one) => one.id === FOOT.NEWER || one.id === FOOT.NOTICE)).toBe(false)

    const key = String(e.sent.find((m) => m.t === 'place')!.key)
    act(() => e.events().notice?.(key, { kind: 'newer' }))
    await waitFor(() => expect(footers.at(-1)!.find((one) => one.id === FOOT.NEWER)).toMatchObject({ kind: 'run', label: NEWER_LABEL }))
    act(() => void pressRef.current({ item: FOOT.NEWER }))
    expect(e.sent.at(-1)).toEqual({ t: 'reload' })
    await waitFor(() => expect(footers.at(-1)!.some((one) => one.id === FOOT.NEWER)).toBe(false))

    act(() => e.events().notice?.(key, { kind: 'failed', why: 'Couldn’t refresh: offline.' }))
    await waitFor(() => expect(footers.at(-1)!.find((one) => one.id === FOOT.NOTICE)).toMatchObject({ kind: 'text', text: 'Couldn’t refresh: offline.' }))
    /* Another place's news is not this page's. */
    act(() => e.events().notice?.('/work/p::elsewhere', { kind: 'newer' }))
    expect(footers.at(-1)!.some((one) => one.id === FOOT.NEWER)).toBe(false)
  })

  test('a page can be kept as it is: the header toggle tells the engine never to refresh it by itself', async () => {
    const e = engine(new Set())
    const { h, headers } = host(at('method'))
    const pressRef = { current: (_: { item: string; value?: unknown }) => undefined as string | void }
    render(<Browser host={h} api={fakeApi([])} makeStream={e.make} pressRef={pressRef as never} />)
    await waitFor(() => expect(e.sent.some((m) => m.t === 'place')).toBe(true))
    act(() => e.events().page?.(page(PAGE)))
    await waitFor(() => expect(headers.at(-1)!.find((one) => one.id === 'as-is')).toMatchObject({ kind: 'toggle', checked: false }))
    act(() => void pressRef.current({ item: 'as-is', value: true }))
    expect(e.sent.at(-1)).toMatchObject({ t: 'as-is', on: true })
    await waitFor(() => expect(headers.at(-1)!.find((one) => one.id === 'as-is')).toMatchObject({ checked: true }))
  })
})
