import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { Browser } from './hosted.tsx'
import { ASK_AGAIN_MS, RETRY_AFTER_MS } from '../src/app.tsx'
import { alreadyShown, failureFor, hostLoadingWords, startOpening } from '../src/lib/opening.ts'
import type { Api } from '../src/wire/api.ts'
import type { PageState, Stream, StreamEvents } from '../src/wire/stream.ts'
import type { Host, Kept } from '../src/wire/use-kehikot.ts'

/**
 * The page pointed at is the page shown: the latest pick wins over every older one, a failed load
 * is asked once more, a lookup the host did not answer is asked again, and nothing older (a slow
 * reading, an older navigation's failure, a place's remembered address, a dropped send) lands over it.
 * The engine is a fake stream; no browser runs.
 */

afterEach(cleanup)

const A = 'https://github.com/o/r/issues/1'
const B = 'https://github.com/o/r/issues/2'
const HOME = 'https://github.com/o/r'
const ROWS: Record<string, string> = { 'gh#1': A, 'gh#2': B }

function fakeStream({ connected = true, up = () => true }: { connected?: boolean; up?: () => boolean } = {}) {
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
      send: (m: Record<string, unknown>) => {
        if (!up()) return false
        sent.push(m)
        return true
      },
      resize: () => {},
      shown: () => {},
    } as unknown as Stream
  }
  return { make, events: () => events, gos: () => sent.filter((m) => m.t === 'go').map((m) => m.url) }
}

const page = (url: string, loading = false): PageState => ({ url, title: '', canBack: true, canForward: false, loading })
const frame = { data: '', width: 1, height: 1 }
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)))

function fakeApi(over: Partial<Api> = {}): Api {
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
    ...over,
  } as unknown as Api
}

/** A host whose `tracker.get` answers by the test's rule: at once from ROWS unless `answer` says otherwise. */
function host(answer?: (refs: string[]) => Promise<unknown>, over: Partial<Host> = {}) {
  const asked: string[][] = []
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
    request: (_method: string, params: { refs: string[] }) => {
      asked.push(params.refs)
      if (answer) return answer(params.refs)
      return Promise.resolve({ rows: params.refs.filter((r) => ROWS[r]).map((ref) => ({ ref, url: ROWS[ref] })), missing: [] })
    },
    remember: () => {},
    header: () => {},
    ...over,
  } as unknown as Host & { kept: Kept | null }
  return { h, asked }
}

function mount(h: Host, s: ReturnType<typeof fakeStream>, api = fakeApi()) {
  const view = render(<Browser host={h} api={api} makeStream={s.make} />)
  const pick = (selection: string[], more: Partial<Host> = {}) =>
    act(async () => view.rerender(<Browser host={{ ...h, selection, ...more }} api={api} makeStream={s.make} />))
  return { ...view, pick }
}

describe('the latest pick wins', () => {
  test('picking back the page already shown while another is still loading opens it again (a same-address check skipped it)', async () => {
    const s = fakeStream()
    const { h } = host()
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    act(() => s.events().page?.(page(A)))
    act(() => s.events().frame?.(frame))
    await pick(['gh#2'])
    expect(s.gos()).toEqual([A, B])
    /* B has not committed: A is still the page. Picking A again must not leave B landing over it. */
    await pick(['gh#1'])
    expect(s.gos()).toEqual([A, B, A])
  })

  test('a slow reading for an older pick is dropped when it comes back after a newer pick opened', async () => {
    const s = fakeStream()
    let slow: (value: unknown) => void = () => {}
    const { h } = host((refs) =>
      refs[0] === 'gh#1' ? new Promise((r) => (slow = r)) : Promise.resolve({ rows: [{ ref: 'gh#2', url: B }], missing: [] }),
    )
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    await pick(['gh#2'])
    expect(s.gos()).toEqual([B])
    await act(async () => slow({ rows: [{ ref: 'gh#1', url: A }], missing: [] }))
    expect(s.gos()).toEqual([B])
  })

  test('A, B, A in quick succession with slow readings opens A once, never B', async () => {
    const s = fakeStream()
    const pending: Array<{ refs: string[]; done: (v: unknown) => void }> = []
    const { h } = host((refs) => new Promise((done) => pending.push({ refs, done })))
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    await pick(['gh#2'])
    await pick(['gh#1'])
    /* Answered out of order: the newest first, the oldest last. */
    for (const one of [...pending].reverse()) await act(async () => one.done({ rows: [{ ref: one.refs[0], url: ROWS[one.refs[0]!] }], missing: [] }))
    expect(s.gos()).toEqual([A])
  })

  test('an address typed while a pick is being looked up is not replaced by the pick', async () => {
    const s = fakeStream()
    let answer: (v: unknown) => void = () => {}
    const { h } = host(() => new Promise((r) => (answer = r)))
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    const field = screen.getByLabelText('Address') as HTMLInputElement
    act(() => void fireEvent.change(field, { target: { value: HOME } }))
    act(() => void fireEvent.submit(field.form!))
    expect(s.gos()).toEqual([HOME])
    await act(async () => answer({ rows: [{ ref: 'gh#1', url: A }], missing: [] }))
    expect(s.gos()).toEqual([HOME])
  })
})

describe('a load that fails', () => {
  test('an older navigation’s failure, heard after a newer one was asked, does not cover the newer one', async () => {
    const s = fakeStream()
    const { h } = host()
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    await pick(['gh#2'])
    act(() => s.events().said?.(`Could not open ${A}: Timeout 30000ms exceeded.`))
    expect(screen.queryByTestId('trouble')).toBeNull()
    expect(screen.getByTestId('opening').textContent).toContain('Opening gh#2…')
    await wait(RETRY_AFTER_MS + 30)
    expect(s.gos()).toEqual([A, B])
  })

  test('is asked once more, and a second failure is shown with its address and Try again', async () => {
    const s = fakeStream()
    const { h } = host()
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    act(() => s.events().said?.(`Could not open ${A}: net::ERR_CONNECTION_RESET`))
    expect(screen.queryByTestId('trouble')).toBeNull()
    await wait(RETRY_AFTER_MS + 30)
    expect(s.gos()).toEqual([A, A])
    act(() => s.events().said?.(`Could not open ${A}: net::ERR_CONNECTION_RESET`))
    const trouble = screen.getByTestId('trouble')
    expect(trouble.textContent).toContain('The page could not be loaded.')
    expect(trouble.textContent).toContain(A)
    expect(screen.getByText('Try again')).toBeDefined()
  })

  test('the retry that loads ends the cover as any load does', async () => {
    const s = fakeStream()
    const { h } = host()
    const { pick } = mount(h, s)
    act(() => s.events().page?.(page(HOME)))
    await pick(['gh#1'])
    act(() => s.events().page?.(page('chrome-error://chromewebdata/')))
    /* Chrome's error page, painted, does not end the wait for the retry. */
    act(() => s.events().frame?.(frame))
    expect(screen.getByTestId('opening')).toBeDefined()
    await wait(RETRY_AFTER_MS + 30)
    expect(s.gos()).toEqual([A, A])
    act(() => s.events().page?.(page(A)))
    act(() => s.events().frame?.(frame))
    expect(screen.queryByTestId('opening')).toBeNull()
    expect(screen.queryByTestId('trouble')).toBeNull()
  })

  test('picking the address the page still shows after another failed opens it, rather than leaving the failure up', async () => {
    const s = fakeStream()
    const { h } = host()
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    act(() => s.events().page?.(page(A)))
    act(() => s.events().frame?.(frame))
    await pick(['gh#2'])
    act(() => s.events().said?.(`Could not open ${B}: net::ERR_FAILED`))
    await wait(RETRY_AFTER_MS + 30)
    act(() => s.events().said?.(`Could not open ${B}: net::ERR_FAILED`))
    expect(screen.getByTestId('trouble')).toBeDefined()
    await pick(['gh#1'])
    expect(s.gos()).toEqual([A, B, B, A])
    expect(screen.queryByTestId('trouble')).toBeNull()
  })
})

describe('a lookup that did not come through', () => {
  test('a tracker.get the host did not answer is asked again, and the page opens', async () => {
    const s = fakeStream()
    let calls = 0
    const { h } = host(() => (++calls === 1 ? Promise.reject(new Error('silent')) : Promise.resolve({ rows: [{ ref: 'gh#1', url: A }], missing: [] })))
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    expect(s.gos()).toEqual([])
    expect(screen.getByTestId('said').textContent).toContain('asking again')
    await wait(ASK_AGAIN_MS + 50)
    expect(calls).toBe(2)
    expect(s.gos()).toEqual([A])
  })

  test('a ref the reading had no page for is resolved again when the reading changes', async () => {
    const s = fakeStream()
    let known = false
    const { h } = host(() => Promise.resolve(known ? { rows: [{ ref: 'gh#1', url: A }], missing: [] } : { rows: [], missing: [{ ref: 'gh#1', reason: 'not-found' }] }))
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    expect(s.gos()).toEqual([])
    known = true
    await pick(['gh#1'], { trackerAt: 't2' })
    expect(s.gos()).toEqual([A])
  })

  test('a navigation asked while the socket was down is sent when it is up again', async () => {
    let up = true
    const s = fakeStream({ up: () => up })
    let answer: (v: unknown) => void = () => {}
    const { h } = host(() => new Promise((r) => (answer = r)))
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    /* The socket drops while the host is being asked. */
    up = false
    act(() => s.events().open?.(false))
    await act(async () => answer({ rows: [{ ref: 'gh#1', url: A }], missing: [] }))
    expect(s.gos()).toEqual([])
    up = true
    await act(async () => s.events().open?.(true))
    expect(s.gos()).toEqual([A])
  })
})

describe('what else could land over a pick', () => {
  test('a place’s remembered address read after a pick does not replace it, nor when the socket reconnects', async () => {
    const s = fakeStream()
    const reads: Array<(v: unknown) => void> = []
    const api = fakeApi({ place: (() => new Promise((r) => reads.push(r))) as unknown as Api['place'] })
    const { h } = host()
    const { pick } = mount(h, s, api)
    await pick(['gh#1'])
    await act(async () => reads[0]?.({ url: HOME }))
    expect(s.gos()).toEqual([A])
    act(() => s.events().open?.(false))
    await act(async () => s.events().open?.(true))
    await act(async () => reads.at(-1)?.({ url: HOME }))
    expect(s.gos()).toEqual([A])
  })

  test('following again opens what is picked now', async () => {
    const s = fakeStream()
    const { h } = host()
    const { pick } = mount(h, { ...s })
    await pick(['gh#1'], { kept: { follow: false } })
    expect(s.gos()).toEqual([])
    await pick(['gh#1'], { kept: { follow: true } })
    expect(s.gos()).toEqual([A])
  })

  test('a pick made while the page is hidden is still opened', async () => {
    const s = fakeStream()
    const { h } = host()
    const { pick } = mount(h, s)
    await pick(['gh#1'], { visible: false })
    expect(s.gos()).toEqual([A])
  })
})

describe('the host’s own cover', () => {
  test('says “Loading <title>…” while a pick opens, and is ended at the new page’s first frame', async () => {
    const s = fakeStream()
    const said: Array<string | null> = []
    const { h } = host(() => Promise.resolve({ rows: [{ ref: 'gh#1', url: A, title: 'Fix the thing' }], missing: [] }), {
      loading: ((label?: string | null) => said.push(label ?? null)) as Host['loading'],
      ready: (() => said.push('ready')) as Host['ready'],
    })
    const { pick } = mount(h, s)
    await pick(['gh#1'])
    expect(said).toEqual(['Loading gh#1…', 'Loading Fix the thing…'])
    act(() => s.events().page?.(page(A)))
    act(() => s.events().frame?.(frame))
    expect(said.at(-1)).toBe('ready')
  })

  test('as values', () => {
    const on = startOpening(null, { url: A, label: 'gh#1', title: 'Fix it', from: 'pick', before: HOME })
    expect(hostLoadingWords(on)).toBe('Loading Fix it…')
    expect(hostLoadingWords({ ...on, committed: true })).toBeNull()
    expect(hostLoadingWords(startOpening(null, { url: A, label: null, from: 'typed', before: HOME }))).toBeNull()
    expect(alreadyShown(A, A, null, false)).toBe(true)
    expect(alreadyShown(A, A, null, true)).toBe(false)
    expect(alreadyShown(A, A, on, false)).toBe(true)
    expect(alreadyShown(A, A, { ...on, url: B }, false)).toBe(false)
    expect(failureFor(`Could not open ${A}: net::ERR_FAILED`)).toBe(A)
    expect(failureFor('The browser has no page open. Press Try again.')).toBeNull()
  })
})
