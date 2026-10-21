import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Browser, headerItems } from '../src/app.tsx'
import type { Run } from '../src/lib/runs.ts'
import type { ShotSet } from '../src/lib/shots.ts'
import { appendEntry, ConsoleView, filterEntries, Posting } from '../src/view/panels.tsx'
import type { Api } from '../src/wire/api.ts'
import type { ConsoleEntry, Stream, StreamEvents } from '../src/wire/stream.ts'
import type { Host } from '../src/wire/use-kehikot.ts'

afterEach(cleanup)

const entry = (n: number, level: ConsoleEntry['level'], text: string, kind: ConsoleEntry['kind'] = 'console'): ConsoleEntry => ({
  n,
  at: '2026-10-21T10:00:0' + (n % 10) + '.000Z',
  kind,
  level,
  text,
  source: kind === 'network' ? text : 'https://app.test/main.js:3:9',
  page: 'https://app.test/',
})

describe('the Console view', () => {
  test('shows what the page said as text: a page’s markup is never markup here', () => {
    render(<ConsoleView entries={[entry(1, 'error', '<img src=x onerror="alert(1)">boom'), entry(2, 'log', 'hello')]} dropped={0} onClear={() => {}} onDevtools={() => {}} onClose={() => {}} />)
    const lines = screen.getByTestId('console-lines')
    expect(lines.querySelector('img')).toBeNull()
    expect(lines.textContent).toContain('<img src=x onerror="alert(1)">boom')
    expect(lines.textContent).toContain('https://app.test/main.js:3:9')
  })

  test('filters by level, and debug starts hidden', () => {
    render(
      <ConsoleView entries={[entry(1, 'error', 'bad'), entry(2, 'warn', 'meh'), entry(3, 'debug', 'noise')]} dropped={0} onClear={() => {}} onDevtools={() => {}} onClose={() => {}} />,
    )
    const shown = () => Array.from(screen.getByTestId('console-lines').querySelectorAll('li')).map((li) => li.getAttribute('data-level'))
    expect(shown()).toEqual(['error', 'warn'])
    fireEvent.click(screen.getByRole('button', { name: /Warnings/ }))
    expect(shown()).toEqual(['error'])
    fireEvent.click(screen.getByRole('button', { name: /Debug/ }))
    expect(shown()).toEqual(['error', 'debug'])
  })

  test('Clear and Open DevTools are the person’s buttons', () => {
    const pressed: string[] = []
    render(<ConsoleView entries={[]} dropped={0} onClear={() => pressed.push('clear')} onDevtools={() => pressed.push('devtools')} onClose={() => {}} />)
    expect(screen.getByTestId('console-empty').textContent).toContain('nothing yet')
    fireEvent.click(screen.getByRole('button', { name: 'Clear the console' }))
    fireEvent.click(screen.getByRole('button', { name: /Open DevTools/ }))
    expect(pressed).toEqual(['clear', 'devtools'])
  })

  test('the filter and the live list are pure', () => {
    const all = [entry(1, 'error', 'Cannot read x'), entry(2, 'log', 'ok')]
    expect(filterEntries(all, new Set(['error', 'log']), 'read').map((e) => e.n)).toEqual([1])
    expect(appendEntry(all, entry(2, 'log', 'dup'))).toBe(all)
    expect(appendEntry(all, entry(3, 'log', 'new'), 2).map((e) => e.n)).toEqual([2, 3])
  })
})

function fakeStream() {
  let events: StreamEvents = {}
  const make = (e: StreamEvents) => {
    events = e
    return { start: () => events.open?.(true), stop: () => {}, send: () => {}, resize: () => {} } as unknown as Stream
  }
  return { make, events: () => events }
}

const run: Run = {
  version: 1,
  kind: 'walkthrough',
  id: '20261021-100000-abcd',
  goal: 'Open settings',
  ref: null,
  startedAt: '2026-10-21T10:00:00.000Z',
  endedAt: '2026-10-21T10:01:00.000Z',
  outcome: 'done',
  summary: '',
  steps: [{ n: 1, title: 'Click Settings', why: 'it is the goal', result: '', url: 'https://app.test/', shot: '01.png', at: '', console: [], network: [] }],
  consoleFrom: 0,
}

const set: ShotSet = {
  version: 1,
  ref: 'gh#12',
  title: 'Darker header',
  screens: [{ id: 'home', name: 'Home', path: '/' }],
  viewports: [{ width: 1280, height: 800 }],
  themes: ['dark'],
  captured: [
    { screen: 'home', width: 1280, height: 800, theme: 'dark', side: 'before', file: 'home--1280x800--dark--before.png', url: '', at: '' },
    { screen: 'home', width: 1280, height: 800, theme: 'dark', side: 'after', file: 'home--1280x800--dark--after.png', url: '', at: '' },
  ],
  approved: null,
  posted: null,
  createdAt: '2026-10-21T10:00:00.000Z',
}

function api(over: Partial<Api> = {}): Api {
  return {
    saved: () => Promise.resolve([]),
    save: () => Promise.resolve({ list: [] }),
    remove: () => Promise.resolve([]),
    rename: () => Promise.resolve([]),
    place: () => Promise.resolve(null),
    record: () => Promise.resolve(),
    endpoint: () => Promise.resolve({ endpoint: null, snippets: null }),
    console: () => Promise.resolve({ entries: [entry(1, 'error', 'from before')], dropped: 0, last: 1 }),
    clearConsole: () => Promise.resolve(),
    openDevtools: () => Promise.resolve(''),
    runs: (_p, kind) => Promise.resolve(kind === 'walkthrough' ? [run] : []),
    shotSets: () => Promise.resolve([{ slug: 'gh-12', ref: 'gh#12', title: 'Darker header', createdAt: '', captured: 2, approved: null, posted: null }]),
    shotSet: () => Promise.resolve({ set, pairs: [{ screen: set.screens[0]!, width: 1280, height: 800, theme: 'dark', before: set.captured[0]!, after: set.captured[1]! }], missing: [] }),
    approveShots: () => Promise.resolve({ ...set, approved: { at: '2026-10-21T10:05:00.000Z', via: 'page' } }),
    ...over,
  }
}

const host = { where: 'hosted', project: 'P', projectPath: '/work/p', epic: null, theme: 'light', selection: [], parts: [], kehikko: null, kept: null, trackerAt: null, request: () => Promise.resolve(null), remember: () => {}, header: () => {} } as unknown as Host

describe('View › Show', () => {
  test('the header has the switch, which agents may press, and the person’s Open DevTools', () => {
    const items = headerItems({ saved: [], follow: true, canSave: false, view: 'console' })
    expect(items.find((i) => i.id === 'view')).toMatchObject({ kind: 'switch', value: 'console', agents: true })
    expect(items.find((i) => i.id === 'devtools')).toMatchObject({ kind: 'run', agents: false })
  })

  test('the console view loads what the server kept, then adds live lines', async () => {
    const s = fakeStream()
    const pressRef = { current: (_: { item: string; value?: string | boolean }) => undefined as string | void }
    render(<Browser host={host} api={api()} makeStream={s.make} pressRef={pressRef} />)
    act(() => void pressRef.current({ item: 'view', value: 'console' }))
    await waitFor(() => expect(screen.getByTestId('console-lines').textContent).toContain('from before'))
    act(() => s.events().console?.(entry(2, 'error', 'live one')))
    expect(screen.getByTestId('console-lines').textContent).toContain('live one')
    act(() => s.events().consoleCleared?.())
    expect(screen.queryByTestId('console-lines')).toBeNull()
  })

  test('an agent’s show_view opens a walkthrough, with its steps and screenshot', async () => {
    const s = fakeStream()
    render(<Browser host={host} api={api()} makeStream={s.make} />)
    act(() => s.events().show?.('walkthroughs', run.id))
    await waitFor(() => expect(screen.getByTestId('run-steps').textContent).toContain('Click Settings'))
    const img = screen.getByAltText('Step 1: Click Settings') as HTMLImageElement
    expect(img.getAttribute('src')).toContain('/api/run/png?')
    expect(img.getAttribute('src')).toContain('file=01.png')
  })

  test('before and after side by side, and OK to post is the person’s press', async () => {
    const s = fakeStream()
    const approved: string[] = []
    render(<Browser host={host} api={api({ approveShots: (_p, ref) => (approved.push(ref), Promise.resolve({ ...set, approved: { at: '2026-10-21T10:05:00.000Z', via: 'page' } })) })} makeStream={s.make} />)
    act(() => s.events().show?.('shots', 'gh#12'))
    await waitFor(() => expect(screen.getByTestId('pairs')).toBeDefined())
    expect(screen.getByAltText('Before: Home, 1280×800, dark')).toBeDefined()
    expect(screen.getByAltText('After: Home, 1280×800, dark')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'OK to post' }))
    await waitFor(() => expect(screen.getByTestId('posting').textContent).toContain('You said OK'))
    expect(approved).toEqual(['gh#12'])
  })

  test('posting says where it stands', () => {
    render(<Posting set={{ ...set, posted: { at: '2026-10-21T11:00:00.000Z', where: 'https://github.com/o/r/pull/12' }, approved: { at: '2026-10-21T10:00:00.000Z', via: 'typed' } }} missing={0} onApprove={() => {}} />)
    expect(screen.getByTestId('posting').textContent).toContain('Posted to https://github.com/o/r/pull/12')
  })
})
