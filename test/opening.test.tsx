import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

import { Browser } from './hosted.tsx'
import { FAILED_WORDS, LOADING_GRACE_MS, LOADING_WORDS, SLOW_WORDS, covering, troubleOf } from '../src/lib/loading.ts'
import { addressShown, alreadyOpening, committed, openingSaid, pickedOpening, startOpening } from '../src/lib/opening.ts'
import type { Api } from '../src/wire/api.ts'
import type { PageState, Stream, StreamEvents } from '../src/wire/stream.ts'
import type { Host, Kept } from '../src/wire/use-kehikot.ts'

/**
 * A pick or a hand-over, opened as fast as the forge allows: said at once, shown
 * in the address bar at once, and asked of the engine once. The engine is the
 * fake stream below; no browser runs.
 */

afterEach(cleanup)

const MR = 'https://gitlab.example.org/group/project/-/merge_requests/4013'
const HOME = 'https://gitlab.example.org/group/project'

function fakeStream(connected = true) {
  const sent: Record<string, unknown>[] = []
  let events: StreamEvents = {}
  const make = (e: StreamEvents) => {
    events = e
    return {
      start: () => {
        if (!connected) return
        events.open?.(true)
        events.status?.({ state: 'ready', why: null, endpoint: null })
      },
      stop: () => {},
      send: (m: Record<string, unknown>) => sent.push(m),
      resize: () => {},
      shown: () => {},
    } as unknown as Stream
  }
  return { sent, make, events: () => events, gos: () => sent.filter((m) => m.t === 'go') }
}

const page = (url: string): PageState => ({ url, title: '', canBack: true, canForward: false, loading: false })
const frame = { data: '', width: 1, height: 1 }

function fakeApi(): Api {
  const none = () => Promise.resolve([])
  return {
    saved: none,
    save: () => Promise.resolve({ list: [] }),
    remove: none,
    rename: none,
    place: () => Promise.resolve(null),
    record: () => Promise.resolve(),
    followEndpoint: () => () => {},
    console: () => Promise.resolve({ entries: [], dropped: 0, last: 0 }),
    clearConsole: () => Promise.resolve(),
    openDevtools: () => Promise.resolve(''),
    runs: none,
    shotSets: none,
    shotSet: () => Promise.reject(new Error('none')),
    approveShots: () => Promise.reject(new Error('none')),
  } as unknown as Api
}

/** A host whose `tracker.get` answers when the test says so, or at once. */
function host(over: Partial<Host> = {}, answerAtOnce = true) {
  const asked: unknown[][] = []
  let answer: () => void = () => {}
  const h = {
    where: 'hosted',
    project: 'P',
    projectPath: '/work/p',
    epic: 'e',
    theme: 'light',
    selection: [],
    parts: [],
    kehikko: { id: 1, name: 'Main', key: 'main' },
    kept: null,
    trackerAt: null,
    request: (...args: unknown[]) => {
      asked.push(args)
      const reading = { rows: [{ ref: '!4013', url: MR }], missing: [] }
      if (answerAtOnce) return Promise.resolve(reading)
      return new Promise((resolve) => (answer = () => resolve(reading)))
    },
    remember: () => {},
    header: () => {},
    ...over,
  } as unknown as Host & { kept: Kept | null }
  return { h, asked, answer: () => answer() }
}

const bar = () => (screen.getByLabelText('Address') as HTMLInputElement).value

describe('what is being opened, as a value', () => {
  test('a pick is said at once and keeps an address already on its way', () => {
    const picked = pickedOpening(null, '!4013', HOME)
    expect(picked).toMatchObject({ url: null, label: '!4013', from: 'pick' })
    expect(openingSaid(picked)).toBe('Opening !4013…')
    expect(addressShown(picked, HOME)).toBe(HOME)
    const handed = startOpening(null, { url: MR, label: null, from: 'handed', before: HOME })
    expect(pickedOpening(handed, '!4013', HOME)).toMatchObject({ url: MR, label: '!4013', from: 'handed' })
  })

  test('the address bar shows the address on its way, then the engine’s, redirect included', () => {
    const on = startOpening(null, { url: MR, label: null, from: 'handed', before: HOME })
    expect(addressShown(on, HOME)).toBe(MR)
    expect(committed(on, HOME)).toBe(on) /* the old page's own news */
    const moved = committed(on, `${MR}/diffs`)
    expect(moved.committed).toBe(true)
    expect(addressShown(moved, `${MR}/diffs`)).toBe(`${MR}/diffs`)
  })

  test('one click in a ref list is one navigation; two hand-overs or a typed address always go', () => {
    const handed = startOpening(null, { url: MR, label: null, from: 'handed', before: HOME })
    expect(alreadyOpening(handed, MR, 'pick')).toBe(true)
    expect(alreadyOpening(handed, MR, 'handed')).toBe(false)
    const picked = startOpening(null, { url: MR, label: '!4013', from: 'pick', before: HOME })
    expect(alreadyOpening(picked, MR, 'handed')).toBe(true)
    expect(alreadyOpening(picked, MR, 'typed')).toBe(false)
    expect(alreadyOpening(picked, HOME, 'pick')).toBe(false)
  })
})

describe('a hand-over', () => {
  test('is in the address bar within one tick, corrected by the engine, and over at the first frame', async () => {
    const s = fakeStream()
    const { h } = host()
    const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => s.events().page?.(page(HOME)))
    const handed = { url: MR, title: 'Fix the thing', intent: 'show' as const, by: 'kehikot.example', at: 't1' }
    act(() => rerender(<Browser host={{ ...h, address: handed }} api={fakeApi()} makeStream={s.make} />))
    /* No page event yet: the engine has not heard from the forge. */
    expect(bar()).toBe(MR)
    expect(screen.getByTestId('opening').textContent).toContain('Opening gitlab.example.org/group/project/-/merge_requests/4013…')
    expect(s.gos()).toEqual([{ t: 'go', url: MR }])

    /* A frame of the old page while the forge thinks does not end it. */
    act(() => s.events().frame?.(frame))
    expect(screen.getByTestId('opening')).toBeDefined()

    /* The forge redirected; the bar says where the page really is. */
    act(() => s.events().page?.(page(`${MR}/diffs`)))
    expect(bar()).toBe(`${MR}/diffs`)
    act(() => s.events().frame?.(frame))
    expect(screen.queryByTestId('opening')).toBeNull()
  })

  test('plus the pick of the same item is one navigation, whichever is heard first', async () => {
    for (const order of ['handed first', 'pick first'] as const) {
      const s = fakeStream()
      const { h, answer } = host({}, false)
      const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
      act(() => s.events().page?.(page(HOME)))
      const handed = { url: MR, intent: 'show' as const, by: 'kehikot.example', at: 't1' }
      if (order === 'handed first') {
        act(() => rerender(<Browser host={{ ...h, address: handed, selection: ['!4013'] }} api={fakeApi()} makeStream={s.make} />))
        await act(async () => answer())
      } else {
        act(() => rerender(<Browser host={{ ...h, selection: ['!4013'] }} api={fakeApi()} makeStream={s.make} />))
        await act(async () => answer())
        act(() => rerender(<Browser host={{ ...h, address: handed, selection: ['!4013'] }} api={fakeApi()} makeStream={s.make} />))
      }
      expect(s.gos()).toEqual([{ t: 'go', url: MR }])
      expect(bar()).toBe(MR)
      cleanup()
    }
  })
})

describe('a pick', () => {
  test('covers the browser with “Loading content…, Opening !4013…” before the host has answered, then opens the page', async () => {
    const s = fakeStream()
    const { h, answer } = host({}, false)
    const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => rerender(<Browser host={{ ...h, selection: ['!4013'] }} api={fakeApi()} makeStream={s.make} />))
    expect(screen.getByTestId('opening').textContent).toBe('Loading content…Opening !4013…')
    expect(s.gos()).toEqual([])
    await act(async () => answer())
    expect(s.gos()).toEqual([{ t: 'go', url: MR }])
    expect(bar()).toBe(MR)
    expect(screen.getByTestId('opening').textContent).toBe('Loading content…Opening !4013…')
  })

  test('made while the stream is down is opened when it comes up, if it is still the selection', async () => {
    const s = fakeStream(false)
    const { h, asked } = host()
    const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => rerender(<Browser host={{ ...h, selection: ['!4013'] }} api={fakeApi()} makeStream={s.make} />))
    expect(asked).toEqual([])
    await act(async () => s.events().open?.(true))
    await waitFor(() => expect(s.gos()).toEqual([{ t: 'go', url: MR }]))
  })

  test('made while the stream is down and then unpicked opens nothing when it comes up', async () => {
    const s = fakeStream(false)
    const { h, asked } = host()
    const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => rerender(<Browser host={{ ...h, selection: ['!4013'] }} api={fakeApi()} makeStream={s.make} />))
    act(() => rerender(<Browser host={{ ...h, selection: [] }} api={fakeApi()} makeStream={s.make} />))
    await act(async () => s.events().open?.(true))
    await new Promise((r) => setTimeout(r, 10))
    expect(asked).toEqual([])
    expect(s.gos()).toEqual([])
  })

  test('a failed navigation turns the cover into the failure, with the server’s sentence and Try again', async () => {
    const s = fakeStream()
    const { h } = host()
    const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    await act(async () => rerender(<Browser host={{ ...h, selection: ['!4013'] }} api={fakeApi()} makeStream={s.make} />))
    expect(screen.getByTestId('opening')).toBeDefined()
    act(() => s.events().said?.(`Could not open ${MR}: net::ERR_NAME_NOT_RESOLVED`))
    expect(screen.queryByTestId('opening')).toBeNull()
    const trouble = screen.getByTestId('trouble')
    expect(trouble.textContent).toContain('The page could not be loaded.')
    expect(trouble.textContent).toContain('ERR_NAME_NOT_RESOLVED')
    /* Try again asks for the same address again, and the cover says Loading once more. */
    act(() => screen.getByText('Try again').click())
    expect(s.gos()).toEqual([
      { t: 'go', url: MR },
      { t: 'go', url: MR },
    ])
    expect(screen.getByTestId('opening')).toBeDefined()
  })

  test('Chrome’s own error page ends the load as a failure, and the person can put the cover away', async () => {
    const s = fakeStream()
    const { h } = host()
    const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => s.events().page?.(page(HOME)))
    await act(async () => rerender(<Browser host={{ ...h, selection: ['!4013'] }} api={fakeApi()} makeStream={s.make} />))
    act(() => s.events().page?.(page('chrome-error://chromewebdata/')))
    expect(screen.getByTestId('trouble').textContent).toContain('The page could not be loaded.')
    /* The engine's sentence, heard after the page, fills in why. */
    act(() => s.events().said?.(`Could not open ${MR}: net::ERR_CONNECTION_REFUSED`))
    expect(screen.getByTestId('trouble').textContent).toContain('ERR_CONNECTION_REFUSED')
    expect(screen.queryByTestId('said')).toBeNull()
    act(() => screen.getByText('Show the page').click())
    expect(screen.queryByTestId('trouble')).toBeNull()
    expect(screen.queryByTestId('opening')).toBeNull()
  })
})

describe('the time a pick takes in this page', () => {
  /*
   * Measured: pick → `tracker.get` asked → answered (a hit, as for every ref
   * a ref list shows) → `go` sent. With the host answering at once, everything
   * before the engine is this page's own work; the rest is the forge's.
   */
  test('a hit is opened in the same turn it is answered; nothing waits in between', async () => {
    const s = fakeStream()
    const marks: Record<string, number> = {}
    const t0 = performance.now()
    const { h } = host({
      request: (() => {
        marks.asked = performance.now() - t0
        return Promise.resolve({ rows: [{ ref: '!4013', url: MR }], missing: [] }).finally(() => (marks.answered = performance.now() - t0))
      }) as Host['request'],
    })
    const { rerender } = render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    const picked = performance.now()
    await act(async () => rerender(<Browser host={{ ...h, selection: ['!4013'] }} api={fakeApi()} makeStream={s.make} />))
    marks.go = performance.now() - t0
    expect(s.gos()).toEqual([{ t: 'go', url: MR }])
    /* The one asynchronous step is the host's answer; a fake host answers at once, so this is React's work only. */
    expect(marks.go! - (picked - t0)).toBeLessThan(250)
    expect(marks.asked! - (picked - t0)).toBeLessThan(250)
  })
})

describe('the engine’s own loading', () => {
  const loading = (url: string): PageState => ({ ...page(url), loading: true })

  test('a link clicked in the page is covered after the grace, and the cover ends on the load', async () => {
    const s = fakeStream()
    const { h } = host()
    render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => s.events().page?.(page(HOME)))
    act(() => s.events().page?.(loading(HOME)))
    /* A quick hop is not covered. */
    expect(screen.queryByTestId('opening')).toBeNull()
    await act(async () => new Promise((r) => setTimeout(r, LOADING_GRACE_MS + 30)))
    expect(screen.getByTestId('opening').textContent).toContain('Loading content…')
    act(() => s.events().page?.(page(MR)))
    expect(screen.queryByTestId('opening')).toBeNull()
  })

  test('a load quicker than the grace is never covered', async () => {
    const s = fakeStream()
    const { h } = host()
    render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => s.events().page?.(loading(HOME)))
    act(() => s.events().page?.(page(MR)))
    await act(async () => new Promise((r) => setTimeout(r, LOADING_GRACE_MS + 30)))
    expect(screen.queryByTestId('opening')).toBeNull()
  })
})

describe('the cover, as a value', () => {
  const on = startOpening(null, { url: MR, label: '!4013', from: 'pick', before: HOME })

  test('loading says what is being opened; nothing is covered when nothing loads', () => {
    expect(covering({ opening: on, loadingShown: false, trouble: null, pageUrl: HOME })).toEqual({ state: 'loading', words: LOADING_WORDS, detail: 'Opening !4013…' })
    expect(covering({ opening: null, loadingShown: true, trouble: null, pageUrl: MR })).toMatchObject({ state: 'loading', words: LOADING_WORDS })
    expect(covering({ opening: null, loadingShown: false, trouble: null, pageUrl: MR })).toBeNull()
  })

  test('a failure or a slow load wins over loading, and Try again asks for the same address', () => {
    const failed = troubleOf('failed', on, HOME, 'net::ERR_NAME_NOT_RESOLVED')
    expect(covering({ opening: on, loadingShown: true, trouble: failed, pageUrl: HOME })).toEqual({
      state: 'refused',
      words: FAILED_WORDS,
      detail: 'net::ERR_NAME_NOT_RESOLVED',
      retry: MR,
    })
    const slow = troubleOf('slow', on, HOME)
    expect(covering({ opening: on, loadingShown: true, trouble: slow, pageUrl: HOME })).toEqual({ state: 'refused', words: SLOW_WORDS, detail: 'Opening !4013…', retry: MR })
    /* A load nobody asked for by address (a link in the page) retries the page it was on, or nothing. */
    expect(troubleOf('failed', null, 'chrome-error://chromewebdata/').url).toBeNull()
  })
})
