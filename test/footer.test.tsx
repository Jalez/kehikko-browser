import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

import { FOOTER_KINDS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

import { Browser } from '../src/app.tsx'
import { FOOT, footerItems } from '../src/lib/footer.ts'
import type { Api } from '../src/wire/api.ts'
import type { PageState, Stream, StreamEvents } from '../src/wire/stream.ts'
import type { Host, Kept } from '../src/wire/use-kehikot.ts'

/**
 * The old top bar's buttons, in the footer the host draws (protocol 2.38.0) when it says it draws
 * one, and the top bar exactly as before when it does not. With a host that draws a footer field
 * (2.46.0) the address is in the footer too and the page has no row; with one that draws a footer
 * but no field, the address stays a field on the page.
 */

afterEach(cleanup)

const PAGE = 'https://github.com/Jalez/kehikko/pull/41'

function fakeStream() {
  const sent: Record<string, unknown>[] = []
  const shown: boolean[] = []
  let events: StreamEvents = {}
  const make = (e: StreamEvents) => {
    events = e
    return {
      start: () => {
        events.open?.(true)
        events.status?.({ state: 'ready', why: null, endpoint: null })
      },
      stop: () => {},
      send: (m: Record<string, unknown>) => sent.push(m),
      resize: () => {},
      shown: (on: boolean) => shown.push(on),
    } as unknown as Stream
  }
  return { sent, shown, make, events: () => events }
}

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

function host(over: Partial<Host> = {}) {
  const footers: FooterItem[][] = []
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
    request: () => Promise.resolve({ rows: [], missing: [] }),
    remember: () => {},
    header: () => {},
    footer: (items: FooterItem[]) => footers.push(items),
    drawsFooter: true,
    ...over,
  } as unknown as Host & { kept: Kept | null }
  return { h, footers, last: () => footers[footers.length - 1] ?? [] }
}

const state = (over: Partial<PageState> = {}): PageState => ({ url: PAGE, title: 'Fix the thing', canBack: true, canForward: false, loading: false, ...over })

describe('the footer it declares', () => {
  test('Back, Forward, Reload, what the page is, and Save; the protocol accepts it', () => {
    const items = footerItems({ url: PAGE, title: 'Fix the thing', canBack: true, canForward: false, loading: false, canSave: true })
    expect(footerItemsSchema.safeParse(items).success).toBe(true)
    expect(items.map((one) => one.id)).toEqual([FOOT.BACK, FOOT.FORWARD, FOOT.RELOAD, FOOT.PAGE, FOOT.SAVE])
    expect(items.find((one) => one.id === FOOT.BACK)).toMatchObject({ kind: 'run', icon: 'chevron-left', tool: 'back', disabled: null })
    expect((items.find((one) => one.id === FOOT.FORWARD) as { disabled: string | null }).disabled).toBeTruthy()
    expect(items.find((one) => one.id === FOOT.RELOAD)).toMatchObject({ icon: 'refresh', tool: 'reload' })
    expect(items.find((one) => one.id === FOOT.PAGE)).toMatchObject({ kind: 'text', text: 'Fix the thing', tooltip: PAGE, optional: true })
    expect(items.find((one) => one.id === FOOT.SAVE)).toMatchObject({ align: 'end', agents: true, optional: true, disabled: null })
  })

  test('while the page loads, Reload is Stop and the page says Loading', () => {
    const items = footerItems({ url: PAGE, title: '', canBack: false, canForward: false, loading: true, canSave: false })
    expect(items.some((one) => one.id === FOOT.RELOAD)).toBe(false)
    expect(items.find((one) => one.id === FOOT.STOP)).toMatchObject({ kind: 'run', icon: 'stop' })
    expect(items.find((one) => one.id === FOOT.PAGE)).toMatchObject({ text: 'Loading…' })
  })

  test('with a footer field: the address in place of what the page is, growing, with the page as it is shown', () => {
    const items = footerItems({ url: PAGE, title: 'Fix the thing', canBack: true, canForward: false, loading: false, canSave: true, field: true })
    expect(footerItemsSchema.safeParse(items).success).toBe(true)
    expect(items.map((one) => one.id)).toEqual([FOOT.BACK, FOOT.FORWARD, FOOT.RELOAD, FOOT.ADDRESS, FOOT.SAVE])
    expect(items.find((one) => one.id === FOOT.ADDRESS)).toMatchObject({ kind: 'input', label: 'Address', value: PAGE, grow: true, agents: false })
    const opening = footerItems({ url: PAGE, title: '', canBack: true, canForward: false, loading: true, canSave: false, field: true, shown: 'https://example.com/' })
    expect(opening.find((one) => one.id === FOOT.ADDRESS)).toMatchObject({ value: 'https://example.com/', tooltip: 'Loading…' })
    const blank = footerItems({ url: 'about:blank', title: '', canBack: false, canForward: false, loading: false, canSave: false, field: true })
    expect(blank.find((one) => one.id === FOOT.ADDRESS)).toMatchObject({ value: '' })
  })

  test('a blank page has nothing to reload and says so', () => {
    const items = footerItems({ url: 'about:blank', title: '', canBack: false, canForward: false, loading: false, canSave: false })
    expect(items.find((one) => one.id === FOOT.PAGE)).toMatchObject({ text: 'No page open' })
    expect((items.find((one) => one.id === FOOT.RELOAD) as { disabled: string | null }).disabled).toBeTruthy()
  })
})

describe('the page', () => {
  test('with a host that draws the footer: the footer is declared, and only the address stays on top', async () => {
    const s = fakeStream()
    const { h, last } = host()
    render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => s.events().page?.(state()))
    await waitFor(() => expect(last().find((one) => one.id === FOOT.PAGE)).toMatchObject({ text: 'Fix the thing' }))
    expect(screen.getByLabelText('Address')).toBeDefined()
    expect(screen.getByTestId('address-row')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  test('with a host that draws a footer field: the address is in the footer, and the page draws no row', async () => {
    const s = fakeStream()
    const { h, last } = host({ footerKinds: [...FOOTER_KINDS] })
    render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => s.events().page?.(state()))
    await waitFor(() => expect(last().find((one) => one.id === FOOT.ADDRESS)).toMatchObject({ kind: 'input', value: PAGE }))
    expect(last().some((one) => one.id === FOOT.PAGE)).toBe(false)
    expect(screen.queryByLabelText('Address')).toBeNull()
    expect(screen.queryByTestId('address-row')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  test('a host that names footer kinds without the field keeps the address on the page', async () => {
    const s = fakeStream()
    const { h, last } = host({ footerKinds: ['text', 'meter', 'switch', 'toggle', 'go', 'run'] })
    render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
    act(() => s.events().page?.(state()))
    await waitFor(() => expect(last().find((one) => one.id === FOOT.PAGE)).toBeDefined())
    expect(last().some((one) => one.id === FOOT.ADDRESS)).toBe(false)
    expect(screen.getByTestId('address-row')).toBeDefined()
  })

  test('Enter in the footer field opens the address as the old bar did; a bad one is refused with why', async () => {
    const s = fakeStream()
    const { h, last } = host({ footerKinds: [...FOOTER_KINDS] })
    const pressRef = { current: (_: { item: string; value?: string | boolean; text?: string }) => undefined as string | void }
    render(<Browser host={h} api={fakeApi()} makeStream={s.make} pressRef={pressRef} />)
    act(() => s.events().page?.(state()))
    let said: string | void = 'unset'
    act(() => {
      said = pressRef.current({ item: FOOT.ADDRESS, text: 'github.com/Jalez/kehikko' })
    })
    expect(said).toBeUndefined()
    expect(s.sent[s.sent.length - 1]).toEqual({ t: 'go', url: 'https://github.com/Jalez/kehikko' })
    /* The field shows what is being opened at once. */
    await waitFor(() => expect(last().find((one) => one.id === FOOT.ADDRESS)).toMatchObject({ value: 'https://github.com/Jalez/kehikko' }))
    const before = s.sent.length
    expect(pressRef.current({ item: FOOT.ADDRESS })).toBeTruthy()
    expect(typeof pressRef.current({ item: FOOT.ADDRESS, text: '   ' })).toBe('string')
    expect(s.sent.length).toBe(before)
  })

  test('with a host that does not: the old top bar, and no footer declared', () => {
    for (const drawsFooter of [false, null, undefined]) {
      const s = fakeStream()
      const { h, footers } = host({ drawsFooter })
      render(<Browser host={h} api={fakeApi()} makeStream={s.make} />)
      expect(screen.getByRole('button', { name: 'Back' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined()
      expect(screen.queryByTestId('address-row')).toBeNull()
      expect(footers).toEqual([])
      cleanup()
    }
  })

  test('a footer press is the old button’s: back, forward, reload, and stop while loading', async () => {
    const s = fakeStream()
    const { h, last } = host()
    const pressRef = { current: (_: { item: string; value?: string | boolean }) => undefined as string | void }
    render(<Browser host={h} api={fakeApi()} makeStream={s.make} pressRef={pressRef} />)
    act(() => s.events().page?.(state({ canForward: true })))
    for (const item of [FOOT.BACK, FOOT.FORWARD, FOOT.RELOAD]) expect(pressRef.current({ item })).toBeUndefined()
    expect(s.sent).toEqual([{ t: 'back' }, { t: 'forward' }, { t: 'reload' }])
    act(() => s.events().page?.(state({ loading: true })))
    await waitFor(() => expect(last().some((one) => one.id === FOOT.STOP)).toBe(true))
    expect(pressRef.current({ item: FOOT.STOP })).toBeUndefined()
    expect(s.sent[s.sent.length - 1]).toEqual({ t: 'stop' })
  })

  test('a page the host hides asks for no frames, and asks again when shown', () => {
    const s = fakeStream()
    const { h } = host()
    const { rerender } = render(<Browser host={{ ...h, visible: true }} api={fakeApi()} makeStream={s.make} />)
    rerender(<Browser host={{ ...h, visible: false }} api={fakeApi()} makeStream={s.make} />)
    rerender(<Browser host={{ ...h, visible: true }} api={fakeApi()} makeStream={s.make} />)
    expect(s.shown).toEqual([true, false, true])
  })
})
