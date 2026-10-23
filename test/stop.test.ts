import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEVTOOLS_PREFIX, released, sweepDevtoolsProfiles } from '../browser/devtools.ts'
import { STOP_WITHIN_MS, stopperFor } from '../browser/index.ts'

describe('the stop', () => {
  function engine(closesIn: number | 'fails') {
    const seen = { ends: 0, forgot: 0 }
    return {
      seen,
      engine: {
        end: async () => {
          seen.ends += 1
          if (closesIn === 'fails') throw new Error('no browser')
          await Bun.sleep(closesIn)
        },
        forgetDevtools: () => {
          seen.forgot += 1
        },
      },
    }
  }

  test('fits inside run’s 2.5 s cap and the host’s 3 s quit grace', () => {
    expect(STOP_WITHIN_MS).toBeLessThan(2500)
  })

  test('closes the browser once, whoever asks, and then removes the DevTools profile', async () => {
    const { engine: e, seen } = engine(30)
    const stop = stopperFor(e, 1000, () => {})
    const first = stop()
    expect(stop()).toBe(first)
    await first
    expect(seen).toEqual({ ends: 1, forgot: 1 })
  })

  test('a browser that does not close in time is given up on, and its profile still removed', async () => {
    const { engine: e, seen } = engine(5000)
    const said: string[] = []
    const at = performance.now()
    await stopperFor(e, 100, (line) => said.push(line))()
    expect(performance.now() - at).toBeLessThan(1000)
    expect(seen.forgot).toBe(1)
    expect(said[0]).toContain('did not close within 100 ms')
  })

  test('a close that fails is said, and the profile still removed', async () => {
    const { engine: e, seen } = engine('fails')
    const said: string[] = []
    await stopperFor(e, 1000, (line) => said.push(line))()
    expect(seen.forgot).toBe(1)
    expect(said[0]).toContain('no browser')
  })
})

describe('sweeping the DevTools profiles an earlier run left', () => {
  const HOUR_AGO = Date.now() / 1000 - 3600

  function temp() {
    const dir = mkdtempSync(join(tmpdir(), 'kehikko-browser-sweep-'))
    const make = (name: string, { old = true, lock }: { old?: boolean; lock?: string } = {}) => {
      const at = join(dir, name)
      mkdirSync(at)
      if (lock) symlinkSync(lock, join(at, 'SingletonLock'))
      if (old) utimesSync(at, HOUR_AGO, HOUR_AGO)
      return at
    }
    return { dir, make, env: { TMPDIR: dir } }
  }

  test('removes an old one nobody holds, and says so', () => {
    const { make, env } = temp()
    const plain = make(`${DEVTOOLS_PREFIX}aaaaaa`)
    const dead = make(`${DEVTOOLS_PREFIX}bbbbbb`, { lock: 'host.local-999999' })
    const said: string[] = []
    const removed = sweepDevtoolsProfiles((line) => said.push(line), env, { alive: () => false })
    expect(removed.sort()).toEqual([plain, dead].sort())
    expect(existsSync(plain) || existsSync(dead)).toBe(false)
    expect(said[0]).toContain('removed 2 DevTools profile(s)')
  })

  test('keeps one a live Chrome holds: another copy of Browser may have its window open', () => {
    const { make, env } = temp()
    const live = make(`${DEVTOOLS_PREFIX}cccccc`, { lock: 'host.local-4242' })
    expect(sweepDevtoolsProfiles(() => {}, env, { alive: (pid) => pid === 4242 })).toEqual([])
    expect(existsSync(live)).toBe(true)
  })

  test('keeps one made in the last minute: a window may be opening', () => {
    const { make, env } = temp()
    const young = make(`${DEVTOOLS_PREFIX}dddddd`, { old: false })
    expect(sweepDevtoolsProfiles(() => {}, env, { alive: () => false })).toEqual([])
    expect(existsSync(young)).toBe(true)
  })

  test('touches nothing that is not this module’s, nor a link', () => {
    const { dir, make, env } = temp()
    const other = make('kehikot-something-else-eeeeee')
    const target = make('elsewhere')
    symlinkSync(target, join(dir, `${DEVTOOLS_PREFIX}ffffff`))
    expect(sweepDevtoolsProfiles(() => {}, env, { alive: () => false })).toEqual([])
    expect(existsSync(other) && existsSync(target)).toBe(true)
  })
})

describe('waiting for Chrome to let go of a profile', () => {
  test('until its SingletonLock is gone, which Chrome removes last as it quits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kehikko-browser-released-'))
    symlinkSync('host.local-1', join(dir, 'SingletonLock'))
    setTimeout(() => rmSync(join(dir, 'SingletonLock')), 150)
    const at = performance.now()
    await released(dir, 2000)
    expect(performance.now() - at).toBeGreaterThanOrEqual(140)
    expect(performance.now() - at).toBeLessThan(1000)
  })

  test('at once when there is no lock, and no longer than asked when it stays', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kehikko-browser-released-'))
    let at = performance.now()
    await released(dir, 2000)
    expect(performance.now() - at).toBeLessThan(50)
    symlinkSync('host.local-1', join(dir, 'SingletonLock'))
    at = performance.now()
    await released(dir, 120)
    expect(performance.now() - at).toBeLessThan(600)
  })
})
