/**
 * What pages kept ready cost: six typical pages (three heavy) kept out of sight, frozen, for a while,
 * and Browser's whole Chromium (every process of it) measured: processor time and resident memory.
 * Then, for comparison, the same six pages open but not frozen. Throwaway profile, headless, pages on
 * loopback; nothing of the person's is touched.
 *
 * First, what the browser costs with only the page on screen and nothing kept, so the cost of the
 * kept pages is what is above that.
 *
 *   bun run bench/hidden-pages.ts [seconds kept, default 300] [seconds unfrozen, default 60] [seconds idle, default 60]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { Engine } from '../browser/engine.ts'
import { servePages } from './pages.ts'

const KEPT_S = Number(process.argv[2] ?? 300)
const UNFROZEN_S = Number(process.argv[3] ?? 60)
const IDLE_S = Number(process.argv[4] ?? 60)
const SIX = ['/dashboard', '/timers', '/motion', '/article-1', '/article-2', '/article-3']

/** Every process under the one whose command line names `marker`: its CPU seconds and RSS bytes. */
function tree(marker: string): { cpu: number; rss: number; count: number } {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time=,rss=,command='], { encoding: 'utf8' }).trim().split('\n')
  const procs = rows.map((row) => {
    const [pid, ppid, time, rss, ...cmd] = row.trim().split(/\s+/)
    return { pid: Number(pid), ppid: Number(ppid), time: time!, rss: Number(rss) * 1024, cmd: cmd.join(' ') }
  })
  const roots = procs.filter((p) => p.cmd.includes(marker) && !procs.some((q) => q.pid === p.ppid && q.cmd.includes(marker)))
  const ids = new Set(roots.map((p) => p.pid))
  for (let grew = true; grew; ) {
    grew = false
    for (const p of procs) if (!ids.has(p.pid) && ids.has(p.ppid)) (ids.add(p.pid), (grew = true))
  }
  const secs = (t: string) => t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)
  const mine = procs.filter((p) => ids.has(p.pid))
  return { cpu: mine.reduce((s, p) => s + secs(p.time), 0), rss: mine.reduce((s, p) => s + p.rss, 0), count: mine.length }
}

async function measure(marker: string, seconds: number) {
  const start = tree(marker)
  let peak = start.rss
  for (let t = 0; t < seconds; t += 5) {
    await new Promise((r) => setTimeout(r, 5000))
    peak = Math.max(peak, tree(marker).rss)
  }
  const end = tree(marker)
  return { cpuPercentOfOneCore: ((end.cpu - start.cpu) / seconds) * 100, rssMB: end.rss / 1048576, peakMB: peak / 1048576, processes: end.count }
}

const pages = await servePages()
const profile = mkdtempSync(join(tmpdir(), 'kehikko-browser-bench-'))
/* A scratch project whose settings keep six, whatever this machine's memory pressure says today. */
const project = mkdtempSync(join(tmpdir(), 'kehikko-browser-bench-project-'))
mkdirSync(join(project, '.kehikot', 'browser'), { recursive: true })
writeFileSync(join(project, '.kehikot', 'browser', 'settings.json'), JSON.stringify({ version: 1, value: { keepPages: '6' } }))
const pressure = execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8' }).trim()

/* Nothing kept: the browser alone, with the page on screen. */
const idleProfile = mkdtempSync(join(tmpdir(), 'kehikko-browser-bench-idle-'))
const idleEngine = new Engine(() => 47_950, () => {}, { ...process.env, KEHIKOT_BROWSER_PROFILE: idleProfile, KEHIKOT_BROWSER_HEADLESS: '1' })
await idleEngine.place('bench::/front', project)
await idleEngine.navigate(`${pages.origin}/front`)
await new Promise((r) => setTimeout(r, 3000))
const idle = await measure(idleProfile, IDLE_S)
await idleEngine.end()

const engine = new Engine(() => 47_950, () => {}, { ...process.env, KEHIKOT_BROWSER_PROFILE: profile, KEHIKOT_BROWSER_HEADLESS: '1' })
for (const path of SIX) {
  await engine.place(`bench::${path}`, project)
  await engine.navigate(`${pages.origin}${path}`)
  await new Promise((r) => setTimeout(r, 1500))
}
await engine.place('bench::/front', project)
await engine.navigate(`${pages.origin}/front`)
await new Promise((r) => setTimeout(r, 3000))
const kept = engine.keptCount()
const frozen = await measure(profile, KEPT_S)
await engine.end()

/* The same six, open and not frozen, as before pages were kept frozen. */
const plainProfile = mkdtempSync(join(tmpdir(), 'kehikko-browser-bench-plain-'))
const plain = await chromium.launchPersistentContext(plainProfile, { headless: true, channel: 'chrome' }).catch(() => chromium.launchPersistentContext(plainProfile, { headless: true }))
for (const path of SIX) await (await plain.newPage()).goto(`${pages.origin}${path}`)
await (await plain.newPage()).goto(`${pages.origin}/front`)
await new Promise((r) => setTimeout(r, 3000))
const unfrozen = await measure(plainProfile, UNFROZEN_S)
await plain.close()

pages.stop()
for (const dir of [profile, plainProfile, idleProfile, project]) rmSync(dir, { recursive: true, force: true })
console.log(JSON.stringify({ memoryPressureLevel: pressure, keptReady: kept, nothingKept: { seconds: IDLE_S, ...idle }, frozen: { seconds: KEPT_S, ...frozen }, unfrozen: { seconds: UNFROZEN_S, ...unfrozen } }, null, 2))
