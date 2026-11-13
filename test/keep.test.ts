import { describe, expect, test } from 'bun:test'

import { AUTOMATIC, AUTO_PAGES, Keeper, PAGE_OVERHEAD, budgetOf, evictions, staleAfterMs, type KeepSettings, type Machine, type Notice, type PageOps, type Revalidated } from '../browser/keep.ts'

const GB = 1024 * 1024 * 1024
const MIN = 60_000

interface FakePage {
  id: number
  url: string
  closed: boolean
  frozen: boolean
  dirty: boolean
  heap: number
  loads: number
}

function world(over: { settings?: Partial<KeepSettings>; machine?: Partial<Machine>; revalidate?: Revalidated; loadFails?: string } = {}) {
  let n = 0
  let now = 1_000_000
  const log: string[] = []
  const notices: [string, Notice][] = []
  const state = {
    settings: { ...AUTOMATIC, ...over.settings } as KeepSettings,
    machine: { totalBytes: 16 * GB, pressure: 'normal', busy: false, ...over.machine } as Machine,
    revalidate: over.revalidate ?? ('unknown' as Revalidated),
    loadFails: over.loadFails ?? null,
    onScreen: null as FakePage | null,
  }
  const page = (url = 'about:blank'): FakePage => ({ id: ++n, url, closed: false, frozen: false, dirty: false, heap: 10 * 1024 * 1024, loads: 0 })
  const ops: PageOps<FakePage> = {
    open: async () => page(),
    close: async (p) => void ((p.closed = true), log.push(`close ${p.id}`)),
    show: async (p) => void ((state.onScreen = p), log.push(`show ${p.id}`)),
    freeze: async (p) => void ((p.frozen = true), log.push(`freeze ${p.id}`)),
    thaw: async (p) => void ((p.frozen = false), log.push(`thaw ${p.id}`)),
    alive: (p) => !p.closed,
    url: (p) => p.url,
    heapBytes: async (p) => p.heap,
    dirty: async (p) => p.dirty,
    revalidate: async () => state.revalidate,
    loadFresh: async (p) => {
      if (state.loadFails) throw new Error(state.loadFails)
      const fresh = page(p.url)
      fresh.loads = p.loads + 1
      log.push(`fresh ${fresh.id} for ${p.id}`)
      return fresh
    },
    machine: () => state.machine,
    settings: () => state.settings,
    now: () => now,
    notice: (key, notice) => void notices.push([key, notice]),
  }
  const keeper = new Keeper(ops)
  /* Show a place; a new one is pointed at `url`, as the page would after its memory said so. */
  const go = async (key: string, url = `https://${key}.example/`) => {
    const { page: p, kept } = await keeper.show(key)
    if (!kept) p.url = url
    await keeper.settled()
    return { p, kept }
  }
  return { keeper, go, state, log, notices, wait: (ms: number) => void (now += ms) }
}

describe('the budget', () => {
  test('Automatic: 6 pages within min(1 GB, 10% of memory); half when memory is short; none when very short', () => {
    expect(budgetOf(AUTOMATIC, { totalBytes: 16 * GB, pressure: 'normal' })).toEqual({ pages: AUTO_PAGES, bytes: GB })
    expect(budgetOf(AUTOMATIC, { totalBytes: 8 * GB, pressure: 'normal' })).toEqual({ pages: 6, bytes: 0.8 * GB })
    expect(budgetOf(AUTOMATIC, { totalBytes: 16 * GB, pressure: 'warn' })).toEqual({ pages: 3, bytes: GB / 2 })
    expect(budgetOf(AUTOMATIC, { totalBytes: 16 * GB, pressure: 'critical' })).toEqual({ pages: 0, bytes: 0 })
  })

  test('settings override Automatic, and Automatic again restores it; very short memory still wins', () => {
    const set: KeepSettings = { ...AUTOMATIC, pages: 12, memoryMb: 2048 }
    expect(budgetOf(set, { totalBytes: 16 * GB, pressure: 'normal' })).toEqual({ pages: 12, bytes: 2 * GB })
    expect(budgetOf(set, { totalBytes: 16 * GB, pressure: 'warn' })).toEqual({ pages: 12, bytes: 2 * GB })
    expect(budgetOf({ ...set, pages: 'auto', memoryMb: 'auto' }, { totalBytes: 16 * GB, pressure: 'normal' })).toEqual({ pages: 6, bytes: GB })
    expect(budgetOf(set, { totalBytes: 16 * GB, pressure: 'critical' })).toEqual({ pages: 0, bytes: 0 })
    expect(staleAfterMs(AUTOMATIC)).toBe(15 * MIN)
    expect(staleAfterMs({ ...AUTOMATIC, refresh: 5 })).toBe(5 * MIN)
    expect(staleAfterMs({ ...AUTOMATIC, refresh: 'never' })).toBe(Infinity)
  })

  test('the least worth keeping goes first (seen long ago and seldom), never the page on screen', () => {
    const at = (key: string, shownAt: number, shown = 1, bytes = 1) => ({ key, shownAt, shown, bytes })
    const all = [at('old', 0), at('often', 0, 10), at('new', 10 * MIN), at('screen', 0)]
    expect(evictions(all, 'screen', { pages: 2, bytes: Infinity })).toEqual(['old'])
    expect(evictions(all, 'screen', { pages: 0, bytes: 0 })).toEqual(['often', 'new', 'old'])
  })
})

describe('keeping pages ready', () => {
  test('switching away and back gives the same page, frozen while away, thawed on return, never reloaded', async () => {
    const w = world()
    const a = await w.go('a')
    expect(a.kept).toBe(false)
    const b = await w.go('b')
    expect(a.p.frozen).toBe(true)
    expect(b.p.frozen).toBe(false)
    w.wait(30_000)
    const again = await w.go('a')
    expect(again.kept).toBe(true)
    expect(again.p).toBe(a.p)
    expect(a.p.frozen).toBe(false)
    expect(a.p.loads).toBe(0)
    expect(w.state.onScreen).toBe(a.p)
    expect(b.p.frozen).toBe(true)
  })

  test('a new place gets a new blank page of its own: nothing of the place before shows', async () => {
    const w = world()
    const a = await w.go('a')
    const { page, kept } = await w.keeper.show('b')
    expect(kept).toBe(false)
    expect(page).not.toBe(a.p)
    expect(page.url).toBe('about:blank')
    expect(w.state.onScreen).toBe(page)
  })

  test('least recently shown goes first once more than the budget is kept', async () => {
    const w = world({ settings: { pages: 2 } })
    const a = await w.go('a')
    w.wait(MIN)
    await w.go('b')
    w.wait(MIN)
    await w.go('c')
    w.wait(MIN)
    await w.go('d')
    expect(a.p.closed).toBe(true)
    expect([...w.keeper.kept.keys()].sort()).toEqual(['b', 'c', 'd'])
  })

  test('the memory budget: heavy pages go until what is kept fits', async () => {
    const w = world({ settings: { memoryMb: 100 } })
    const heavy = await w.go('heavy')
    heavy.p.heap = 200 * 1024 * 1024
    w.wait(MIN)
    const light = await w.go('light')
    w.wait(2 * MIN)
    await w.go('now')
    expect(heavy.p.closed).toBe(true)
    expect(light.p.closed).toBe(false)
    expect(w.keeper.kept.get('light')!.bytes).toBe(10 * 1024 * 1024 + PAGE_OVERHEAD)
  })

  test('adapts to memory pressure: fewer kept when short, only the page on screen when very short, more again after', async () => {
    const w = world()
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      await w.go(key)
      w.wait(MIN)
    }
    expect(w.keeper.kept.size).toBe(7) // 6 kept and the one on screen
    w.state.machine.pressure = 'warn'
    await w.keeper.trim()
    expect(w.keeper.kept.size).toBe(4)
    w.state.machine.pressure = 'critical'
    await w.keeper.trim()
    expect([...w.keeper.kept.keys()]).toEqual(['g'])
    w.state.machine.pressure = 'normal'
    for (const key of ['h', 'i', 'j']) {
      await w.go(key)
      w.wait(MIN)
    }
    expect(w.keeper.kept.size).toBe(4)
  })

  test('no setting needed: a keeper with Automatic keeps, freezes and refreshes', async () => {
    const w = world()
    expect(w.state.settings).toEqual(AUTOMATIC)
    const a = await w.go('a')
    await w.go('b')
    expect(a.p.frozen).toBe(true)
  })

  test('a popup is its place’s page until it closes; then the page it came from is back', async () => {
    const w = world()
    const a = await w.go('a')
    const popup = { ...a.p, id: 99, url: 'https://login.example/' }
    w.keeper.popup(popup)
    expect(w.keeper.page()).toBe(popup)
    expect(w.keeper.holds(a.p)).toBe(true)
    popup.closed = true
    await w.keeper.closed(popup)
    expect(w.keeper.page()).toBe(a.p)
    expect(w.state.onScreen).toBe(a.p)
  })
})

describe('refreshing a kept page', () => {
  test('a page the site says changed is loaded again off screen and swapped in: the old view stays until then', async () => {
    const w = world({ revalidate: 'changed' })
    const a = await w.go('a')
    await w.go('b')
    w.wait(2 * MIN)
    const shown = w.log.length
    const again = await w.keeper.show('a')
    /* The kept page is on screen at once, before any refresh. */
    expect(again.page).toBe(a.p)
    expect(w.log.slice(shown)).toContain(`show ${a.p.id}`)
    await w.keeper.settled()
    const now = w.keeper.page()!
    expect(now).not.toBe(a.p)
    expect(now.loads).toBe(1)
    expect(w.state.onScreen).toBe(now)
    const order = w.log.slice(shown)
    expect(order.indexOf(`show ${now.id}`)).toBeLessThan(order.indexOf(`close ${a.p.id}`))
  })

  test('a page the site says is the same is not loaded again', async () => {
    const w = world({ revalidate: 'same' })
    const a = await w.go('a')
    await w.go('b')
    w.wait(30 * MIN)
    await w.go('a')
    expect(w.keeper.page()).toBe(a.p)
  })

  test('a site that does not say: loaded again only after the time out of sight (15 min Automatic, or the setting)', async () => {
    const w = world({ revalidate: 'unknown' })
    const a = await w.go('a')
    await w.go('b')
    w.wait(5 * MIN)
    await w.go('a')
    expect(w.keeper.page()).toBe(a.p)
    await w.go('b')
    w.wait(16 * MIN)
    await w.go('a')
    expect(w.keeper.page()).not.toBe(a.p)

    const set = world({ revalidate: 'unknown', settings: { refresh: 2 } })
    const one = await set.go('a')
    await set.go('b')
    set.wait(3 * MIN)
    await set.go('a')
    expect(set.keeper.page()).not.toBe(one.p)
  })

  test('a page with unsaved input is never replaced: the footer offers the newer one', async () => {
    const w = world({ revalidate: 'changed' })
    const a = await w.go('a')
    a.p.dirty = true
    await w.go('b')
    w.wait(30 * MIN)
    await w.go('a')
    expect(w.keeper.page()).toBe(a.p)
    expect(w.notices.at(-1)).toEqual(['a', { kind: 'newer' }])
  })

  test('never refreshed when the person said so for the page, or the setting says never', async () => {
    const w = world({ revalidate: 'changed' })
    const a = await w.go('a')
    w.keeper.setAsIs('a', true)
    await w.go('b')
    w.wait(30 * MIN)
    await w.go('a')
    expect(w.keeper.page()).toBe(a.p)

    const never = world({ revalidate: 'changed', settings: { refresh: 'never' } })
    const one = await never.go('a')
    await never.go('b')
    never.wait(30 * MIN)
    await never.go('a')
    expect(never.keeper.page()).toBe(one.p)
  })

  test('not while the machine is busy; offline says so in the footer; a failed load leaves the kept page', async () => {
    const busy = world({ revalidate: 'changed', machine: { busy: true } })
    const a = await busy.go('a')
    await busy.go('b')
    busy.wait(30 * MIN)
    await busy.go('a')
    expect(busy.keeper.page()).toBe(a.p)

    const off = world({ revalidate: 'offline' })
    await off.go('a')
    await off.go('b')
    off.wait(30 * MIN)
    await off.go('a')
    expect(off.notices.at(-1)).toEqual(['a', { kind: 'failed', why: 'Couldn’t refresh: offline.' }])

    const failing = world({ revalidate: 'changed', loadFails: 'the site did not answer' })
    const f = await failing.go('a')
    await failing.go('b')
    failing.wait(30 * MIN)
    await failing.go('a')
    expect(failing.keeper.page()).toBe(f.p)
    expect(failing.notices.at(-1)?.[1]).toMatchObject({ kind: 'failed' })
  })

  test('full reload, as set: loaded again after the time even when the site would say it is the same', async () => {
    const w = world({ revalidate: 'same', settings: { revalidate: 'full' } })
    const a = await w.go('a')
    await w.go('b')
    w.wait(16 * MIN)
    await w.go('a')
    expect(w.keeper.page()).not.toBe(a.p)
  })
})
