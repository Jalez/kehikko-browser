import { Bug, Check, ExternalLink, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Run, RunKind } from '@/lib/runs'
import type { Pair, ShotSet } from '@/lib/shots'
import { runPng, shotPng, type Api, type ShotSummary } from '@/wire/api'
import type { ConsoleEntry } from '@/wire/stream'
import { Sheet } from '@/view/sheet'

/**
 * The container's other views, chosen with View › Show: the Console, the Walkthroughs (and
 * repros) the skills recorded, and Before and after. Everything a page or an agent wrote is shown
 * as TEXT — React escapes it, and nothing here sets HTML or makes a link from it.
 */

export type View = 'browser' | 'console' | 'walkthroughs' | 'shots'
export const VIEWS: { id: View; label: string }[] = [
  { id: 'browser', label: 'Browser' },
  { id: 'console', label: 'Console' },
  { id: 'walkthroughs', label: 'Walkthroughs' },
  { id: 'shots', label: 'Before and after' },
]

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))

/* ------------------------------------------------------------------ *
 * Console.
 * ------------------------------------------------------------------ */

export const LEVEL_FILTERS = [
  { id: 'error', label: 'Errors' },
  { id: 'warn', label: 'Warnings' },
  { id: 'info', label: 'Info' },
  { id: 'log', label: 'Logs' },
  { id: 'debug', label: 'Debug' },
] as const
export type LevelFilter = (typeof LEVEL_FILTERS)[number]['id']

/** The entries a filter shows: these levels, and (when given) the words somewhere in the text or source. */
export function filterEntries(entries: readonly ConsoleEntry[], levels: ReadonlySet<string>, words: string): ConsoleEntry[] {
  const q = words.trim().toLowerCase()
  return entries.filter((one) => levels.has(one.level) && (!q || one.text.toLowerCase().includes(q) || (one.source ?? '').toLowerCase().includes(q)))
}

/** The page's lines, newest kept at the end; at most `keep`. */
export function appendEntry(entries: readonly ConsoleEntry[], entry: ConsoleEntry, keep = 500): ConsoleEntry[] {
  if (entries.length && entries[entries.length - 1]!.n >= entry.n) return entries as ConsoleEntry[]
  const next = [...entries, entry]
  return next.length > keep ? next.slice(next.length - keep) : next
}

const LEVEL_STYLE: Record<string, string> = {
  error: 'text-destructive',
  warn: 'text-amber-600 dark:text-amber-400',
  info: 'text-sky-700 dark:text-sky-300',
  log: 'text-foreground',
  debug: 'text-muted-foreground',
}

export function ConsoleView({
  entries,
  dropped,
  onClear,
  onDevtools,
  onClose,
}: {
  entries: ConsoleEntry[]
  dropped: number
  onClear(): void
  onDevtools(): void
  onClose(): void
}) {
  const [levels, setLevels] = useState<Set<string>>(() => new Set(['error', 'warn', 'info', 'log']))
  const [words, setWords] = useState('')
  const shown = useMemo(() => filterEntries(entries, levels, words), [entries, levels, words])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const one of entries) c[one.level] = (c[one.level] ?? 0) + 1
    return c
  }, [entries])
  return (
    <Sheet
      title="Console"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onDevtools} title="Chromium’s own DevTools for this page, in a window of its own">
            <Bug className="size-3.5" />
            Open DevTools
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onClear} aria-label="Clear the console">
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Levels">
        {LEVEL_FILTERS.map((one) => {
          const on = levels.has(one.id)
          return (
            <Button
              key={one.id}
              variant={on ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              aria-pressed={on}
              onClick={() => {
                const next = new Set(levels)
                if (on) next.delete(one.id)
                else next.add(one.id)
                setLevels(next)
              }}
            >
              {on ? <Check className="size-3" /> : null}
              {one.label}
              <span className="text-muted-foreground tabular-nums">{counts[one.id] ?? 0}</span>
            </Button>
          )
        })}
        <Input aria-label="Filter the console" placeholder="Filter" className="ml-auto h-6 w-40 text-xs" value={words} onChange={(event) => setWords(event.target.value)} />
      </div>
      <p className="text-muted-foreground text-xs">Written by the page: console messages, uncaught exceptions and failed requests, live.</p>
      {dropped ? <p className="text-muted-foreground text-xs">{dropped} older lines were let go; the newest 500 are kept.</p> : null}
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="console-empty">
          {entries.length ? 'Nothing matches this filter.' : 'The page has said nothing yet.'}
        </p>
      ) : (
        <ol className="flex flex-col font-mono text-xs" data-testid="console-lines">
          {shown.map((one) => (
            <li key={one.n} className="flex flex-col gap-0.5 border-b py-1" data-level={one.level} data-kind={one.kind}>
              <div className="flex gap-2">
                <span className={`w-12 shrink-0 uppercase ${LEVEL_STYLE[one.level] ?? ''}`}>{one.level}</span>
                <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                  {one.kind === 'exception' ? 'Uncaught ' : ''}
                  {one.text}
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">{one.at.slice(11, 19)}</span>
              </div>
              {one.source && one.kind !== 'network' ? <span className="text-muted-foreground truncate pl-14">{one.source}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ *
 * Walkthroughs and repros.
 * ------------------------------------------------------------------ */

const ENDINGS: Record<string, string> = {
  done: 'Done',
  'taken-over': 'You took over',
  stopped: 'Stopped',
  reproduced: 'Reproduced',
  'not-reproduced': 'Did not reproduce',
  unclear: 'Unclear',
}

export function RunsView({ api, projectPath, focus, onClose }: { api: Api; projectPath: string | null; focus: string | null; onClose(): void }) {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [open, setOpen] = useState<string | null>(focus)
  const [why, setWhy] = useState<string | null>(null)
  useEffect(() => setOpen(focus), [focus])
  useEffect(() => {
    if (!projectPath) return
    let live = true
    Promise.all([api.runs(projectPath, 'walkthrough'), api.runs(projectPath, 'repro')])
      .then(([walks, repros]) => live && setRuns([...walks, ...repros]))
      .catch((error: unknown) => live && setWhy(failure(error)))
    return () => {
      live = false
    }
  }, [api, projectPath, focus])
  const chosen = runs?.find((one) => one.id === open) ?? null
  return (
    <Sheet title={chosen ? chosen.goal : 'Walkthroughs'} onClose={onClose} actions={chosen ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(null)}>All</Button> : null}>
      {!projectPath ? <p className="text-muted-foreground text-sm">Open a project to see its walkthroughs.</p> : null}
      {why ? <p className="text-sm">{why}</p> : null}
      {chosen && projectPath ? (
        <RunSteps run={chosen} projectPath={projectPath} />
      ) : runs && runs.length === 0 ? (
        <p className="text-muted-foreground text-sm">None yet. Type /browser-walkthrough &lt;goal&gt; or /browser-repro &lt;issue&gt; in Claude Code.</p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="runs">
          {(runs ?? []).map((one) => (
            <li key={`${one.kind}-${one.id}`}>
              <button type="button" className="hover:bg-accent w-full rounded px-2 py-1 text-left" onClick={() => setOpen(one.id)}>
                <span className="block truncate text-sm">{one.goal}</span>
                <span className="text-muted-foreground block text-xs">
                  {one.kind === 'repro' ? `Repro${one.ref ? ` of ${one.ref}` : ''}` : 'Walkthrough'} · {one.steps.length} step{one.steps.length === 1 ? '' : 's'} ·{' '}
                  {one.outcome ? ENDINGS[one.outcome] : 'in progress'} · {one.startedAt.slice(0, 16).replace('T', ' ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

function RunSteps({ run, projectPath }: { run: Run; projectPath: string }) {
  const kind: RunKind = run.kind
  return (
    <div className="flex flex-col gap-3" data-testid="run-steps">
      <p className="text-muted-foreground text-xs">
        {run.kind === 'repro' ? `Repro${run.ref ? ` of ${run.ref}` : ''}` : 'Walkthrough'} · {run.outcome ? ENDINGS[run.outcome] : 'in progress'}
        {run.summary ? ` — ${run.summary}` : ''}
      </p>
      <ol className="flex flex-col gap-4">
        {run.steps.map((step) => (
          <li key={step.n} className="flex flex-col gap-1">
            <p className="text-sm">
              <span className="text-muted-foreground tabular-nums">{step.n}. </span>
              <span className="font-medium">{step.title}</span>
              {step.why ? <span className="text-muted-foreground"> — {step.why}</span> : null}
            </p>
            {step.result ? <p className="text-sm">{step.result}</p> : null}
            {[...step.console, ...step.network].map((note, i) => (
              <p key={i} className="text-muted-foreground font-mono text-xs break-words">
                {note.level}: {note.text}
              </p>
            ))}
            {step.shot ? <img className="max-w-full rounded border" alt={`Step ${step.n}: ${step.title}`} src={runPng(projectPath, kind, run.id, step.shot)} /> : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Before and after.
 * ------------------------------------------------------------------ */

export function ShotsView({ api, projectPath, focus, onClose }: { api: Api; projectPath: string | null; focus: string | null; onClose(): void }) {
  const [sets, setSets] = useState<ShotSummary[] | null>(null)
  const [open, setOpen] = useState<string | null>(focus)
  const [chosen, setChosen] = useState<{ set: ShotSet; pairs: Pair[]; missing: string[] } | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  useEffect(() => setOpen(focus), [focus])
  useEffect(() => {
    if (!projectPath) return
    let live = true
    api
      .shotSets(projectPath)
      .then((list) => live && setSets(list))
      .catch((error: unknown) => live && setWhy(failure(error)))
    return () => {
      live = false
    }
  }, [api, projectPath, focus])
  useEffect(() => {
    if (!projectPath || !open) {
      setChosen(null)
      return
    }
    let live = true
    api
      .shotSet(projectPath, open)
      .then((got) => live && setChosen(got))
      .catch((error: unknown) => live && setWhy(failure(error)))
    return () => {
      live = false
    }
  }, [api, projectPath, open])

  const approve = () => {
    if (!projectPath || !chosen) return
    api.approveShots(projectPath, chosen.set.ref).then(
      (set) => setChosen({ ...chosen, set }),
      (error: unknown) => setWhy(failure(error)),
    )
  }

  return (
    <Sheet
      title={chosen ? `Before and after: ${chosen.set.ref}` : 'Before and after'}
      onClose={onClose}
      actions={chosen ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(null)}>All</Button> : null}
    >
      {!projectPath ? <p className="text-muted-foreground text-sm">Open a project to see its before and after pictures.</p> : null}
      {why ? <p className="text-sm">{why}</p> : null}
      {chosen && projectPath ? (
        <div className="flex flex-col gap-4" data-testid="pairs">
          <Posting set={chosen.set} missing={chosen.missing.length} onApprove={approve} />
          {chosen.pairs.map((pair) => (
            <section key={`${pair.screen.id}-${pair.width}-${pair.height}-${pair.theme}`} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">
                {pair.screen.name} <span className="text-muted-foreground font-normal">· {pair.width}×{pair.height} · {pair.theme}</span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {(['before', 'after'] as const).map((side) => {
                  const shot = pair[side]
                  return (
                    <figure key={side} className="flex min-w-0 flex-col gap-1">
                      <figcaption className="text-muted-foreground text-xs">{side === 'before' ? 'Before' : 'After'}</figcaption>
                      {shot ? (
                        <img className="max-w-full rounded border" alt={`${side === 'before' ? 'Before' : 'After'}: ${pair.screen.name}, ${pair.width}×${pair.height}, ${pair.theme}`} src={shotPng(projectPath, chosen.set.ref, shot.file)} />
                      ) : (
                        <p className="text-muted-foreground rounded border border-dashed p-4 text-center text-xs">Not captured</p>
                      )}
                    </figure>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      ) : sets && sets.length === 0 ? (
        <p className="text-muted-foreground text-sm">None yet. Type /browser-before-after on a UI change in Claude Code.</p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="sets">
          {(sets ?? []).map((one) => (
            <li key={one.slug}>
              <button type="button" className="hover:bg-accent w-full rounded px-2 py-1 text-left" onClick={() => setOpen(one.ref)}>
                <span className="block truncate text-sm">
                  {one.ref}
                  {one.title ? ` — ${one.title}` : ''}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {one.captured} picture{one.captured === 1 ? '' : 's'} · {one.posted ? 'posted' : one.approved ? 'OK to post' : 'not posted'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

/** Where the set stands on posting, and the person's own OK. */
export function Posting({ set, missing, onApprove }: { set: ShotSet; missing: number; onApprove(): void }) {
  if (set.posted && (!set.approved || set.posted.at >= set.approved.at)) {
    return (
      <p className="text-muted-foreground flex items-center gap-1 text-xs" data-testid="posting">
        <ExternalLink className="size-3" /> Posted to {set.posted.where} on {set.posted.at.slice(0, 16).replace('T', ' ')}.
      </p>
    )
  }
  if (set.approved) {
    return (
      <p className="text-muted-foreground text-xs" data-testid="posting">
        You said OK to posting on {set.approved.at.slice(0, 16).replace('T', ' ')}. The conversation puts them in the description through your gh or glab, which asks you first.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="posting">
      <p className="text-muted-foreground min-w-0 flex-1 text-xs">
        Nothing is posted until you say so.{missing ? ` ${missing} picture${missing === 1 ? ' is' : 's are'} still missing.` : ''} Say OK here, or type /browser-before-after post {set.ref}.
      </p>
      <Button size="sm" className="h-7" onClick={onApprove}>
        OK to post
      </Button>
    </div>
  )
}
