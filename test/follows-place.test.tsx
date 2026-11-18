import { afterEach, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { expectFollowsPlace } from 'kehikot-module-protocol/testing'

import { Browser } from './hosted.tsx'
import type { Api } from '../src/wire/api.ts'
import type { Stream, StreamEvents } from '../src/wire/stream.ts'
import type { Host, Kept } from '../src/wire/use-kehikot.ts'

/* The shared check for a module that follows the place (protocol 2.105.0): switching to a space where nothing
   was shown must show nothing of the page the space before had (its address, its title), and coming back
   restores it. `empty.test.tsx` holds the finer rules (the empty space, what it offers). */

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


type Place = Host
type Shown = { rerender: (place: Place) => void; s: ReturnType<typeof fakeStream> }

/** Everything the person can read of the module: its text and what is typed in its fields (the address bar). */
const visible = () => `${document.body.textContent ?? ''}\n${[...document.querySelectorAll('input,textarea')].map((one) => (one as HTMLInputElement).value).join('\n')}`

test('switching to a space where nothing was shown shows nothing of the page the space before had', async () => {
  const keyA = 'epic:thesis/parts:method/kehikko:main'
  await expectFollowsPlace<Place, Shown>({
    render: async (place) => {
      const s = fakeStream()
      const api = fakeApi(keyA)
      const view = render(<Browser host={place} api={api} makeStream={s.make} />)
      act(() => s.events().status?.({ state: 'ready', why: null, endpoint: null }))
      await act(async () => {})
      act(() => s.events().page?.(page(PAGE)))
      act(() => s.events().frame?.({ data: '', width: 1, height: 1 }))
      return { s, rerender: (next) => view.rerender(<Browser host={next} api={api} makeStream={s.make} />) }
    },
    switchTo: async (shown, place) => {
      await act(async () => shown.rerender(place))
      /* The engine says what it now shows: the page of the place, or the blank one of an empty space. */
      const blank = place.space?.path.at(-1)?.id === 'figures'
      act(() => shown.s.events().page?.(page(blank ? 'about:blank' : PAGE)))
    },
    text: visible,
    filled: { place: host({ space: space('thesis', 'method') }), marker: 'github.com/Jalez/kehikko/pull/41' },
    empty: host({ space: space('thesis', 'results', 'figures') }),
  })
})
