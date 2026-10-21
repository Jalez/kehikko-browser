/**
 * The records `/browser-walkthrough` and `/browser-repro` leave behind, one folder each:
 *
 *   <project>/.kehikot/browser/walkthroughs/<id>/walkthrough.json, 01.png, 02.png, …
 *   <project>/.kehikot/browser/repros/<id>/repro.json, 01.png, …, comment.md
 *
 * A walkthrough is the steps an agent took while the person watched, each with the line it said
 * and a screenshot. A repro is the steps of an issue followed in the Browser, each with what was
 * done, what happened, a screenshot, and the console errors and failed requests since the step
 * before. Pure: the server reads, applies and writes (records.ts).
 */

export const RUN_KINDS = ['walkthrough', 'repro'] as const
export type RunKind = (typeof RUN_KINDS)[number]

/** The folder under `.kehikot/browser/` each kind is kept in. */
export const RUN_AREA: Record<RunKind, string> = { walkthrough: 'walkthroughs', repro: 'repros' }

export const WALKTHROUGH_END = ['done', 'taken-over', 'stopped'] as const
export type WalkthroughEnd = (typeof WALKTHROUGH_END)[number]
export const VERDICTS = ['reproduced', 'not-reproduced', 'unclear'] as const
export type Verdict = (typeof VERDICTS)[number]

export const LIMIT = { GOAL: 500, TITLE: 200, WHY: 600, RESULT: 2000, STEPS: 60, NOTES: 20, NOTE: 600, SUMMARY: 2000 } as const

/** A console error or a failed request, as a repro step keeps it: text, already cut short. */
export interface Note {
  level: string
  text: string
  source: string | null
}

export interface Step {
  n: number
  /** What was done, in one line: "Click Sign in". */
  title: string
  /** Why (a walkthrough), or what should happen (a repro). */
  why: string
  /** What happened. Repros say it always; a walkthrough may. */
  result: string
  url: string
  /** The screenshot's file name in the run's folder, or null when none could be taken. */
  shot: string | null
  at: string
  console: Note[]
  network: Note[]
}

export interface Run {
  version: 1
  kind: RunKind
  id: string
  /** What the person asked for (a walkthrough), or the issue (a repro). */
  goal: string
  /** A repro's issue ref, as given. */
  ref: string | null
  startedAt: string
  endedAt: string | null
  /** How a walkthrough ended, or a repro's verdict. */
  outcome: WalkthroughEnd | Verdict | null
  summary: string
  steps: Step[]
  /** Where the console stood when the run (or its last step) began: the next step reads what came after. */
  consoleFrom: number
}

const ID = /^\d{8}-\d{6}-[a-z0-9]{4}$/

export const isRunId = (id: unknown): id is string => typeof id === 'string' && ID.test(id)

/** `20261021-143205-k3x9`: sorts by time, safe as a folder name. */
export function newRunId(now: Date = new Date(), random: () => number = Math.random): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  const tail = Array.from({ length: 4 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)]).join('')
  return `${stamp}-${tail}`
}

/** `01.png`, … `60.png`. */
export const shotName = (n: number) => `${String(n).padStart(2, '0')}.png`

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

export function startRun(kind: RunKind, given: { goal: unknown; ref?: unknown }, consoleFrom: number, now = new Date(), id = newRunId(now)): { ok: true; run: Run } | { ok: false; why: string } {
  const goal = text(given.goal, LIMIT.GOAL)
  if (!goal) return { ok: false, why: kind === 'walkthrough' ? 'Say the goal of the walkthrough.' : 'Say the issue being reproduced.' }
  return {
    ok: true,
    run: {
      version: 1,
      kind,
      id,
      goal,
      ref: text(given.ref, 300) || null,
      startedAt: now.toISOString(),
      endedAt: null,
      outcome: null,
      summary: '',
      steps: [],
      consoleFrom,
    },
  }
}

export function addStep(
  run: Run,
  given: { title: unknown; why?: unknown; result?: unknown; url: string; shot: string | null; console?: Note[]; network?: Note[] },
  consoleNow: number,
  now = new Date(),
): { ok: true; run: Run; step: Step } | { ok: false; why: string } {
  if (run.endedAt) return { ok: false, why: `That ${run.kind} has ended.` }
  if (run.steps.length >= LIMIT.STEPS) return { ok: false, why: `A ${run.kind} keeps at most ${LIMIT.STEPS} steps.` }
  const title = text(given.title, LIMIT.TITLE)
  if (!title) return { ok: false, why: 'Say what the step did, in one line.' }
  const result = text(given.result, LIMIT.RESULT)
  if (run.kind === 'repro' && !result) return { ok: false, why: 'Say what happened at this step.' }
  const notes = (list: Note[] | undefined) =>
    (list ?? []).slice(-LIMIT.NOTES).map((one) => ({ level: text(one.level, 10), text: text(one.text, LIMIT.NOTE), source: one.source ? text(one.source, 300) : null }))
  const step: Step = {
    n: run.steps.length + 1,
    title,
    why: text(given.why, LIMIT.WHY),
    result,
    url: text(given.url, 2000),
    shot: given.shot,
    at: now.toISOString(),
    console: notes(given.console),
    network: notes(given.network),
  }
  return { ok: true, run: { ...run, steps: [...run.steps, step], consoleFrom: consoleNow }, step }
}

export function endRun(run: Run, given: { outcome: unknown; summary?: unknown }, now = new Date()): { ok: true; run: Run } | { ok: false; why: string } {
  const allowed: readonly string[] = run.kind === 'walkthrough' ? WALKTHROUGH_END : VERDICTS
  if (typeof given.outcome !== 'string' || !allowed.includes(given.outcome)) {
    return { ok: false, why: `Say how it ended: ${allowed.join(', ')}.` }
  }
  return { ok: true, run: { ...run, endedAt: now.toISOString(), outcome: given.outcome as Run['outcome'], summary: text(given.summary, LIMIT.SUMMARY) } }
}

/** A stored record read back, or null for one that is not a run. */
export function readRun(raw: unknown): Run | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Run>
  if (r.version !== 1 || !RUN_KINDS.includes(r.kind as RunKind) || !isRunId(r.id) || !Array.isArray(r.steps)) return null
  return r as Run
}

/** The numbered list a walkthrough ends with, screenshots named by their path. */
export function stepList(run: Run, folder: string): string {
  const lines = run.steps.map((step) => `${step.n}. ${step.title}${step.why ? ` — ${step.why}` : ''}${step.shot ? `  (${folder}/${step.shot})` : ''}`)
  return lines.join('\n') || '(no steps)'
}

const VERDICT_WORDS: Record<Verdict, string> = {
  reproduced: 'Reproduced.',
  'not-reproduced': 'Did not reproduce.',
  unclear: 'Unclear: see the steps.',
}

/** The evidence as an issue comment, in markdown: what was done, what happened, what the page said. Text only. */
export function reproComment(run: Run): string {
  const verdict = run.outcome && run.outcome in VERDICT_WORDS ? VERDICT_WORDS[run.outcome as Verdict] : 'Not finished.'
  const fence = (s: string) => s.replace(/`/g, 'ˋ')
  const out = [`**${verdict}** ${run.summary}`.trim(), '', `Followed the steps in Kehikot's Browser (${run.steps.length} step${run.steps.length === 1 ? '' : 's'}).`, '']
  for (const step of run.steps) {
    out.push(`${step.n}. **${step.title}**${step.url ? ` at \`${fence(step.url)}\`` : ''}`)
    if (step.why) out.push(`   - Expected: ${step.why}`)
    out.push(`   - Happened: ${step.result}`)
    for (const note of step.console) out.push(`   - Console ${note.level}: \`${fence(note.text.slice(0, 300))}\`${note.source ? ` (${fence(note.source)})` : ''}`)
    for (const note of step.network) out.push(`   - Request: \`${fence(note.text.slice(0, 300))}\``)
  }
  out.push('', '<sub>Recorded with /browser-repro. Screenshots are kept in the project under .kehikot/browser/repros/' + run.id + '/.</sub>')
  return out.join('\n')
}
