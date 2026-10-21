import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Engine } from './browser/engine.ts'
import type { Entry } from './browser/console.ts'
import { listRecords, readRecordJson, recordDir, recordSubdir, writeRecordFile, writeRecordJson, type Area } from './records.ts'
import type { Result } from './store.ts'
import { allowedUrl } from './src/lib/address.ts'
import { forgeUrl, remotesFrom, type Remote, type Repo } from './src/lib/forge.ts'
import { addStep, endRun, isRunId, readRun, reproComment, RUN_AREA, shotName, startRun, stepList, type Note, type Run, type RunKind } from './src/lib/runs.ts'
import {
  approve,
  missing,
  newSet,
  NOT_APPROVED,
  pairsOf,
  postBody,
  postPlan,
  readSet,
  recordCapture,
  refSlug,
  type Approval,
  type ShotSet,
  type Side,
  type Theme,
} from './src/lib/shots.ts'

/**
 * What the skills' tools do with the records: read, apply the pure change, write. Shared by the
 * MCP door (agents) and `/api` (the page), so both see one thing. Synchronous between awaits, so
 * two calls in this one process do not interleave a read and a write.
 */

const fileOf: Record<RunKind, string> = { walkthrough: 'walkthrough.json', repro: 'repro.json' }

/* ------------------------------------------------------------------ *
 * Walkthroughs and repros.
 * ------------------------------------------------------------------ */

export function readRunAt(projectPath: string, kind: RunKind, id: string): Result<Run> {
  if (!isRunId(id)) return { ok: false, error: `"${String(id).slice(0, 40)}" is not a ${kind} id.` }
  const read = readRecordJson(projectPath, RUN_AREA[kind] as Area, id, fileOf[kind])
  if (!read.ok) return read
  const run = readRun(read.value)
  return run && run.kind === kind ? { ok: true, value: run } : { ok: false, error: `There is no ${kind} ${id} in this project.` }
}

export function listRuns(projectPath: string, kind: RunKind): Result<Run[]> {
  const names = listRecords(projectPath, RUN_AREA[kind] as Area)
  if (!names.ok) return names
  const runs: Run[] = []
  for (const id of names.value.slice(0, 100)) {
    const read = readRunAt(projectPath, kind, id)
    if (read.ok) runs.push(read.value)
  }
  return { ok: true, value: runs }
}

function saveRun(projectPath: string, run: Run): Result<string> {
  return writeRecordJson(projectPath, RUN_AREA[run.kind] as Area, run.id, fileOf[run.kind], run)
}

export function runFolder(projectPath: string, kind: RunKind, id: string): Result<string> {
  return recordDir(projectPath, RUN_AREA[kind] as Area, id, false)
}

export function beginRun(projectPath: string, kind: RunKind, given: { goal: unknown; ref?: unknown }, engine: Engine): Result<Run> {
  const started = startRun(kind, given, engine.console.read().last)
  if (!started.ok) return { ok: false, error: started.why }
  const saved = saveRun(projectPath, started.run)
  return saved.ok ? { ok: true, value: started.run } : saved
}

const notesOf = (entries: Entry[]): Note[] => entries.map((one) => ({ level: one.level, text: one.text, source: one.source }))

/** One step: the screenshot of what the person sees now, and (a repro) what the console said since the step before. */
export async function stepRun(
  projectPath: string,
  kind: RunKind,
  id: string,
  given: { title: unknown; why?: unknown; result?: unknown },
  engine: Engine,
): Promise<Result<{ run: Run; folder: string }>> {
  const read = readRunAt(projectPath, kind, id)
  if (!read.ok) return read
  const run = read.value
  if (run.endedAt) return { ok: false, error: `That ${kind} has ended.` }
  const n = run.steps.length + 1
  let shot: string | null = null
  try {
    const png = await engine.screenshot()
    const written = writeRecordFile(projectPath, RUN_AREA[kind] as Area, id, shotName(n), png)
    if (written.ok) shot = shotName(n)
  } catch {
    shot = null
  }
  const since = engine.console.read({ since: run.consoleFrom })
  const said = kind === 'repro'
    ? {
        console: notesOf(since.entries.filter((one) => one.kind !== 'network' && (one.level === 'error' || one.level === 'warn'))),
        network: notesOf(since.entries.filter((one) => one.kind === 'network')),
      }
    : {}
  const added = addStep(run, { ...given, url: engine.state().url, shot, ...said }, since.last)
  if (!added.ok) return { ok: false, error: added.why }
  const saved = saveRun(projectPath, added.run)
  if (!saved.ok) return saved
  const folder = runFolder(projectPath, kind, id)
  return { ok: true, value: { run: added.run, folder: folder.ok ? folder.value : '' } }
}

export function finishRun(projectPath: string, kind: RunKind, id: string, given: { outcome: unknown; summary?: unknown }): Result<{ run: Run; folder: string; comment: string | null }> {
  const read = readRunAt(projectPath, kind, id)
  if (!read.ok) return read
  const ended = endRun(read.value, given)
  if (!ended.ok) return { ok: false, error: ended.why }
  const saved = saveRun(projectPath, ended.run)
  if (!saved.ok) return saved
  let comment: string | null = null
  if (kind === 'repro') {
    const written = writeRecordFile(projectPath, 'repros', id, 'comment.md', `${reproComment(ended.run)}\n`)
    if (written.ok) comment = written.value
  }
  const folder = runFolder(projectPath, kind, id)
  return { ok: true, value: { run: ended.run, folder: folder.ok ? folder.value : '', comment } }
}

export { stepList }

/* ------------------------------------------------------------------ *
 * Before and after.
 * ------------------------------------------------------------------ */

function slugFor(ref: unknown): Result<string> {
  const slug = typeof ref === 'string' ? refSlug(ref) : null
  return slug ? { ok: true, value: slug } : { ok: false, error: 'Say the change: its ref (gh#12, !7) or its branch.' }
}

export function readShotSet(projectPath: string, ref: unknown): Result<{ set: ShotSet; slug: string; folder: string }> {
  const slug = slugFor(ref)
  if (!slug.ok) return slug
  const read = readRecordJson(projectPath, 'shots', slug.value, 'shots.json')
  if (!read.ok) return read
  const set = readSet(read.value)
  if (!set) return { ok: false, error: `Nothing is captured for ${String(ref).slice(0, 80)} in this project. Start with shots_begin.` }
  const folder = recordDir(projectPath, 'shots', slug.value, false)
  return folder.ok ? { ok: true, value: { set, slug: slug.value, folder: folder.value } } : folder
}

export function listShotSets(projectPath: string): Result<{ slug: string; set: ShotSet }[]> {
  const names = listRecords(projectPath, 'shots')
  if (!names.ok) return names
  const out: { slug: string; set: ShotSet }[] = []
  for (const slug of names.value.slice(0, 100)) {
    const read = readRecordJson(projectPath, 'shots', slug, 'shots.json')
    const set = read.ok ? readSet(read.value) : null
    if (set) out.push({ slug, set })
  }
  return { ok: true, value: out }
}

function saveSet(projectPath: string, set: ShotSet): Result<string> {
  const slug = slugFor(set.ref)
  if (!slug.ok) return slug
  return writeRecordJson(projectPath, 'shots', slug.value, 'shots.json', set)
}

export function beginShots(projectPath: string, given: Parameters<typeof newSet>[0]): Result<{ set: ShotSet; folder: string }> {
  const made = newSet(given)
  if (!made.ok) return { ok: false, error: made.why }
  const saved = saveSet(projectPath, made.set)
  if (!saved.ok) return saved
  const folder = recordDir(projectPath, 'shots', refSlug(made.set.ref)!, false)
  return folder.ok ? { ok: true, value: { set: made.set, folder: folder.value } } : folder
}

export async function captureShot(
  projectPath: string,
  given: { ref: unknown; screen: string; side: Side; origin: string; width: number; height: number; theme: Theme; fullPage?: boolean },
  engine: Engine,
): Promise<Result<{ file: string; path: string; url: string; left: string[] }>> {
  const read = readShotSet(projectPath, given.ref)
  if (!read.ok) return read
  const { set, slug } = read.value
  const screen = set.screens.find((one) => one.id === given.screen)
  if (!screen) return { ok: false, error: `${given.screen} is not one of this set's screens: ${set.screens.map((s) => s.id).join(', ')}.` }
  let url: string
  try {
    const origin = new URL(given.origin)
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') throw new Error('not http')
    url = new URL(screen.path, origin.origin).href
  } catch {
    return { ok: false, error: `${String(given.origin).slice(0, 80)} is not an http or https origin, like http://127.0.0.1:5174.` }
  }
  if (!allowedUrl(url)) return { ok: false, error: 'Only http and https pages are captured.' }
  /* Checked before the browser is asked, so a capture the set did not ask for costs nothing. */
  const dry = recordCapture(set, { screen: screen.id, width: given.width, height: given.height, theme: given.theme, side: given.side, url })
  if (!dry.ok) return { ok: false, error: dry.why }
  const shot = await engine.capture({ url, width: given.width, height: given.height, theme: given.theme, fullPage: given.fullPage === true })
  const written = writeRecordFile(projectPath, 'shots', slug, dry.file, shot.png)
  if (!written.ok) return written
  /* Read again: another capture may have landed while this one ran. */
  const again = readShotSet(projectPath, given.ref)
  if (!again.ok) return again
  const recorded = recordCapture(again.value.set, { screen: screen.id, width: given.width, height: given.height, theme: given.theme, side: given.side, url: shot.url })
  if (!recorded.ok) return { ok: false, error: recorded.why }
  const saved = saveSet(projectPath, recorded.set)
  if (!saved.ok) return saved
  return { ok: true, value: { file: dry.file, path: written.value, url: shot.url, left: missing(recorded.set) } }
}

/** The person's OK to post. Reached only by the page's ticketed press and the skill's typed `post`. */
export function approveShots(projectPath: string, ref: unknown, via: Approval['via']): Result<ShotSet> {
  const read = readShotSet(projectPath, ref)
  if (!read.ok) return read
  const approved = approve(read.value.set, via)
  if (!approved.ok) return { ok: false, error: approved.why }
  const saved = saveSet(projectPath, approved.set)
  return saved.ok ? { ok: true, value: approved.set } : saved
}

export function markPosted(projectPath: string, ref: unknown, where: string): Result<ShotSet> {
  const read = readShotSet(projectPath, ref)
  if (!read.ok) return read
  if (!read.value.set.approved) return { ok: false, error: 'Those were never OK’d for posting.' }
  const set: ShotSet = { ...read.value.set, posted: { at: new Date().toISOString(), where: where.slice(0, 300) } }
  const saved = saveSet(projectPath, set)
  return saved.ok ? { ok: true, value: set } : saved
}

/** The project's git remotes, read with git itself. Empty when it is not a repository. */
export function readRemotes(projectPath: string): Remote[] {
  try {
    const out = execFileSync('git', ['-C', projectPath, 'config', '--get-regexp', '^remote\\..*\\.url$'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    return remotesFrom(out)
  } catch {
    return []
  }
}

const stampOf = (set: ShotSet) => (set.approved?.at ?? '').replace(/[^0-9]/g, '').slice(0, 14)

function targetOf(set: ShotSet, change: unknown, remotes: Remote[]): Result<{ repo: Repo; number: number }> {
  const ref = typeof change === 'string' && change.trim() ? change.trim() : set.ref
  const found = forgeUrl(ref, remotes)
  if (!found.ok) return { ok: false, error: `${found.why} Pass change as the pull or merge request (gh#12, !7).` }
  if (found.kind === 'issue') return { ok: false, error: `${ref} is an issue; the pictures go in a pull or merge request's description.` }
  return { ok: true, value: { repo: found.repo, number: found.number } }
}

export function planPost(projectPath: string, ref: unknown, change: unknown, remotes = readRemotes(projectPath)): Result<{ text: string }> {
  const read = readShotSet(projectPath, ref)
  if (!read.ok) return read
  const { set, slug, folder } = read.value
  /* The gate first: without the person's OK, nothing about posting is worked out at all. */
  if (!set.approved) return { ok: false, error: NOT_APPROVED }
  const target = targetOf(set, change, remotes)
  if (!target.ok) return target
  const plan = postPlan(set, target.value, folder, stampOf(set))
  if (!plan.ok) return { ok: false, error: plan.why }
  if (plan.forge === 'github') {
    const post = recordSubdir(projectPath, 'shots', slug, 'post')
    if (!post.ok) return post
    for (const one of plan.files) {
      const data = readPng(folder, one.file)
      if (!data) return { ok: false, error: `${one.file} is missing from ${folder}. Capture it again.` }
      writeFileSync(join(post.value, `${one.file}.json`), JSON.stringify({ message: `Before/after for ${set.ref}: ${one.file}`, branch: 'kehikot-shots', content: data.toString('base64') }))
    }
  }
  const lines = [
    `The person said OK to posting (${set.approved!.via === 'typed' ? 'typed /browser-before-after post' : 'pressed OK to post'} at ${set.approved!.at}).`,
    `Target: ${plan.forge === 'github' ? 'GitHub pull request' : 'GitLab merge request'} ${plan.repo.path} ${plan.forge === 'github' ? '#' : '!'}${plan.number}.`,
    '',
    'Run these with Bash, one at a time, exactly as written, through the person’s own ' + (plan.forge === 'github' ? 'gh' : 'glab') + ':',
    ...plan.commands.map((c, i) => `${i + 1}. ${c}`),
    '',
    plan.forge === 'github'
      ? 'Then call shots_post_body with the description the last command printed (as current), and run the gh pr edit it gives you.'
      : 'Then call shots_post_body with the description from the last command (its "description" field, as current) and, as uploaded, each picture’s file name mapped to the "url" glab answered for it; run the glab mr update it gives you.',
  ]
  return { ok: true, value: { text: lines.join('\n') } }
}

function readPng(folder: string, file: string): Buffer | null {
  try {
    return readFileSync(join(folder, file))
  } catch {
    return null
  }
}

export function bodyForPost(projectPath: string, ref: unknown, change: unknown, current: string, uploaded: Record<string, string>, remotes = readRemotes(projectPath)): Result<{ path: string; command: string }> {
  const read = readShotSet(projectPath, ref)
  if (!read.ok) return read
  const { set, slug } = read.value
  if (!set.approved) return { ok: false, error: NOT_APPROVED }
  const target = targetOf(set, change, remotes)
  if (!target.ok) return target
  const made = postBody(set, { repo: target.value.repo, stamp: stampOf(set) }, current.slice(0, 200_000), uploaded)
  if (!made.ok) return { ok: false, error: made.why }
  const post = recordSubdir(projectPath, 'shots', slug, 'post')
  if (!post.ok) return post
  const path = join(post.value, 'body.md')
  writeFileSync(path, made.body)
  const quoted = `'${path.replace(/'/g, `'\\''`)}'`
  const { repo, number } = target.value
  const command = repo.forge === 'github'
    ? `gh pr edit ${number} --repo ${repo.path} --body-file ${quoted}`
    : `glab mr update ${number} --repo ${repo.path} --description "$(cat ${quoted})"`
  return { ok: true, value: { path, command } }
}

export { pairsOf, missing }
