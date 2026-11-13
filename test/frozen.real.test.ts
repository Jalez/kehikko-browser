import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Engine, UNLOAD_MARK, dirtyInPage, inPage } from '../browser/engine.ts'
import { servePages } from '../bench/pages.ts'

/**
 * Pages kept ready cost memory, not processor: a page out of sight runs no script. Against a real
 * Chromium, so only when asked (`KEHIKOT_BROWSER_REAL=1`), in a throwaway profile, headless, on
 * loopback pages: the default suite never launches a browser.
 */
const REAL = process.env.KEHIKOT_BROWSER_REAL === '1'

describe.skipIf(!REAL)('a kept page out of sight, in a real browser', () => {
  let profile = ''
  let pages = { origin: '', stop: () => {} }
  let engine: Engine
  beforeAll(async () => {
    profile = mkdtempSync(join(tmpdir(), 'kehikko-browser-frozen-'))
    pages = await servePages()
    engine = new Engine(() => 47_900, () => {}, { ...process.env, KEHIKOT_BROWSER_PROFILE: profile, KEHIKOT_BROWSER_HEADLESS: '1' })
  })
  afterAll(async () => {
    await engine?.end()
    pages.stop()
    if (profile) rmSync(profile, { recursive: true, force: true })
  })

  const ticks = async () => (await engine.page()).evaluate(() => (window as unknown as { ticks: number }).ticks)

  test('is frozen while away, and comes back as it was without loading again', async () => {
    await engine.place('bench::busy', null)
    await engine.navigate(`${pages.origin}/timers`)
    const page = await engine.page()
    await new Promise((r) => setTimeout(r, 500))
    const running = await ticks()
    expect(running).toBeGreaterThan(10)

    await engine.place('bench::other', null)
    await engine.navigate(`${pages.origin}/front`)
    const before = running
    await new Promise((r) => setTimeout(r, 2000))

    const back = await engine.place('bench::busy', null)
    expect(back.kept).toBe(true)
    expect(await engine.page()).toBe(page)
    const after = await ticks()
    /* 2 s of a 10 ms timer is ~200 ticks; frozen, only the few around the hand-over. */
    expect(after - before).toBeLessThan(40)
    await new Promise((r) => setTimeout(r, 300))
    expect((await ticks()) - after).toBeGreaterThan(10)
  }, 60_000)

  test('an animation-frame loop is held while away and runs again on return', async () => {
    await engine.place('bench::motion', null)
    await engine.navigate(`${pages.origin}/motion`)
    await new Promise((r) => setTimeout(r, 500))
    const running = await ticks()
    await engine.place('bench::still', null)
    await engine.navigate(`${pages.origin}/front`)
    await new Promise((r) => setTimeout(r, 1500))
    expect((await engine.place('bench::motion', null)).kept).toBe(true)
    const after = await ticks()
    /* 1.5 s at 60 frames a second is ~90; held, only the frames around the hand-overs. */
    expect(after - running).toBeLessThan(20)
    await new Promise((r) => setTimeout(r, 500))
    expect((await ticks()) - after).toBeGreaterThan(5)
  }, 60_000)

  test('a page with something typed in it, or listening for beforeunload, reads as dirty; a clean one does not', async () => {
    await engine.place('bench::form', null)
    await engine.navigate(`${pages.origin}/article-1`)
    const page = await engine.page()
    const dirty = () => page.evaluate(inPage(dirtyInPage, UNLOAD_MARK))
    expect(await dirty()).toBe(false)
    await page.evaluate(() => {
      const input = document.createElement('input')
      document.body.append(input)
      input.value = 'half a sentence'
    })
    expect(await dirty()).toBe(true)
    await engine.navigate(`${pages.origin}/article-2`)
    expect(await dirty()).toBe(false)
    await page.evaluate(() => window.addEventListener('beforeunload', () => {}))
    expect(await dirty()).toBe(true)
  }, 60_000)
})
