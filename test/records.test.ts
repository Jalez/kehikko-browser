import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TICKET, answer, call, skillSay, tools } from '../doors.ts'
import { requestSaid } from '../browser/console.ts'
import { readRun } from '../src/lib/runs.ts'
import { descriptionBlock, newSet, NOT_APPROVED, postPlan, readSet, refSlug, shotFile, withBlock, BLOCK_START } from '../src/lib/shots.ts'
import { fakeEngine } from './fake-engine.ts'

const project = mkdtempSync(join(tmpdir(), 'kehikko-browser-records-'))
afterAll(() => rmSync(project, { recursive: true, force: true }))
const browserDir = join(project, '.kehikot', 'browser')

const textOf = (content: { type: string; text?: string }[]) => content.map((c) => c.text ?? '').join('\n')
const idIn = (said: string) => /\b(\d{8}-\d{6}-[a-z0-9]{4})\b/.exec(said)![1]!

describe('a walkthrough record', () => {
  test('a start, steps with screenshots, and an end with a numbered list, under .kehikot/browser/walkthroughs/<id>/', async () => {
    const { engine } = fakeEngine()
    const id = idIn(textOf(await call('walkthrough_start', { project, goal: 'Sign in and open settings' }, engine)))
    const step = textOf(await call('walkthrough_step', { project, id, title: 'Click Sign in', why: 'the dashboard is behind the login' }, engine))
    expect(step).toContain('Step 1 recorded')
    await call('walkthrough_step', { project, id, title: 'Open Settings', why: 'the goal' }, engine)
    const ended = textOf(await call('walkthrough_end', { project, id, outcome: 'taken-over' }, engine))
    expect(ended).toContain('1. Click Sign in — the dashboard is behind the login')
    expect(ended).toContain('2. Open Settings')

    const folder = join(browserDir, 'walkthroughs', id)
    expect(readdirSync(folder).sort()).toEqual(['01.png', '02.png', 'walkthrough.json'])
    const run = readRun(JSON.parse(readFileSync(join(folder, 'walkthrough.json'), 'utf8')))!
    expect(run).toMatchObject({ version: 1, kind: 'walkthrough', id, goal: 'Sign in and open settings', outcome: 'taken-over', ref: null })
    expect(run.steps[0]).toMatchObject({ n: 1, title: 'Click Sign in', why: 'the dashboard is behind the login', url: 'https://app.test/start', shot: '01.png' })
    expect(typeof run.endedAt).toBe('string')
  })

  test('refuses a step after the end, and an ending it does not know', async () => {
    const { engine } = fakeEngine()
    const id = idIn(textOf(await call('walkthrough_start', { project, goal: 'x' }, engine)))
    await expect(call('walkthrough_end', { project, id, outcome: 'reproduced' }, engine)).rejects.toThrow(/done, taken-over, stopped/)
    await call('walkthrough_end', { project, id, outcome: 'done' }, engine)
    await expect(call('walkthrough_step', { project, id, title: 'late' }, engine)).rejects.toThrow(/ended/)
    await expect(call('walkthrough_step', { project, id: '../../etc', title: 'x' }, engine)).rejects.toThrow()
  })

  test('the page reads it, and its pictures, without a ticket', async () => {
    const { engine } = fakeEngine()
    const id = idIn(textOf(await call('walkthrough_start', { project, goal: 'look' }, engine)))
    await call('walkthrough_step', { project, id, title: 'Look' }, engine)
    const list = await answer('GET', '/api/runs', new URLSearchParams({ projectPath: project, kind: 'walkthrough' }), null, null)
    expect((list?.body as { runs: { id: string }[] }).runs.some((r) => r.id === id)).toBe(true)
    const png = await answer('GET', '/api/run/png', new URLSearchParams({ projectPath: project, kind: 'walkthrough', id, file: '01.png' }), null, null)
    expect(png?.raw?.type).toBe('image/png')
    const outside = await answer('GET', '/api/run/png', new URLSearchParams({ projectPath: project, kind: 'walkthrough', id, file: '../walkthrough.json' }), null, null)
    expect(outside?.status).toBe(400)
  })
})

describe('a repro’s evidence', () => {
  test('each step keeps the action, the result, a screenshot, and what the console and network said since the step before', async () => {
    const { engine, console } = fakeEngine('https://app.test/cart')
    console.add({ kind: 'console', level: 'error', text: 'before the repro', source: null, page: '' })
    const id = idIn(textOf(await call('repro_start', { project, ref: 'gh#41', title: 'Cart total is NaN' }, engine)))
    console.add({ kind: 'console', level: 'log', text: 'just a log', source: null, page: '' })
    console.add({ kind: 'exception', level: 'error', text: 'TypeError: price is undefined', source: 'https://app.test/cart.js:9:1', page: '' })
    console.add(requestSaid({ url: 'https://app.test/api/price', method: 'GET', status: 500, page: '' })!)
    const first = textOf(await call('repro_step', { project, id, action: 'Add a book to the cart', expected: 'Total 12 €', result: 'Total NaN' }, engine))
    expect(first).toContain('failed requests: 1')
    await call('repro_step', { project, id, action: 'Reload', result: 'Still NaN' }, engine)
    const ended = textOf(await call('repro_end', { project, id, verdict: 'reproduced', summary: 'The price request fails and the total shows NaN.' }, engine))
    expect(ended).toContain('Nothing was posted')

    const folder = join(browserDir, 'repros', id)
    const run = readRun(JSON.parse(readFileSync(join(folder, 'repro.json'), 'utf8')))!
    expect(run).toMatchObject({ kind: 'repro', ref: 'gh#41', goal: 'Cart total is NaN', outcome: 'reproduced' })
    expect(run.steps[0]).toMatchObject({ title: 'Add a book to the cart', why: 'Total 12 €', result: 'Total NaN', shot: '01.png' })
    expect(run.steps[0]!.console.map((n) => n.text)).toEqual(['TypeError: price is undefined'])
    expect(run.steps[0]!.network.map((n) => n.text)).toEqual(['GET https://app.test/api/price answered 500'])
    expect(run.steps[1]!.console).toEqual([])
    const comment = readFileSync(join(folder, 'comment.md'), 'utf8')
    expect(comment).toStartWith('**Reproduced.**')
    expect(comment).toContain('Happened: Total NaN')
    expect(comment).toContain('TypeError: price is undefined')
  })

  test('a step says what happened', async () => {
    const { engine } = fakeEngine()
    const id = idIn(textOf(await call('repro_start', { project, ref: '#2', title: 't' }, engine)))
    await expect(call('repro_step', { project, id, action: 'Click' }, engine)).rejects.toThrow(/what happened/)
  })
})

describe('before and after', () => {
  const ref = 'gh#12'
  const screens = [{ id: 'settings', name: 'Settings', path: '/settings' }]

  test('the layout: one folder per change, one picture per screen × size × theme × side', async () => {
    const { engine, captured } = fakeEngine()
    await call('shots_begin', { project, ref, title: 'Darker header', screens, viewports: [{ width: 1280, height: 800 }] }, engine)
    expect(refSlug(ref)).toBe('gh-12')
    for (const side of ['before', 'after']) {
      for (const theme of ['light', 'dark']) {
        await call('shot_capture', { project, ref, screen: 'settings', side, origin: side === 'before' ? 'http://127.0.0.1:5301' : 'http://127.0.0.1:5302', width: 1280, height: 800, theme }, engine)
      }
    }
    const folder = join(browserDir, 'shots', 'gh-12')
    expect(readdirSync(folder).sort()).toEqual([
      'settings--1280x800--dark--after.png',
      'settings--1280x800--dark--before.png',
      'settings--1280x800--light--after.png',
      'settings--1280x800--light--before.png',
      'shots.json',
    ])
    expect(captured.map((c) => [c.url, c.theme])).toContainEqual(['http://127.0.0.1:5301/settings', 'light'])
    expect(captured.every((c) => c.width === 1280 && c.height === 800)).toBe(true)
    const set = readSet(JSON.parse(readFileSync(join(folder, 'shots.json'), 'utf8')))!
    expect(set.captured).toHaveLength(4)
    expect(set.approved).toBeNull()
    expect(textOf(await call('shots_status', { project, ref }, engine))).toContain('pairs captured: 2 of 2')
  })

  test('a capture the set did not ask for is refused before the browser is asked', async () => {
    const { engine, captured } = fakeEngine()
    await expect(call('shot_capture', { project, ref, screen: 'nope', side: 'after', origin: 'http://127.0.0.1:5302', width: 1280, height: 800, theme: 'dark' }, engine)).rejects.toThrow()
    await expect(call('shot_capture', { project, ref, screen: 'settings', side: 'after', origin: 'http://127.0.0.1:5302', width: 999, height: 800, theme: 'dark' }, engine)).rejects.toThrow(/sizes/)
    await expect(call('shot_capture', { project, ref, screen: 'settings', side: 'after', origin: 'file:///etc', width: 1280, height: 800, theme: 'dark' }, engine)).rejects.toThrow()
    expect(captured).toHaveLength(0)
  })

  test('nothing is posted without the person’s OK, and no tool can give it', async () => {
    const { engine } = fakeEngine()
    expect(tools().some((t) => /approve|ok/i.test(t.name))).toBe(false)
    await expect(call('shots_post_plan', { project, ref }, engine)).rejects.toThrow(NOT_APPROVED)
    await expect(call('shots_post_body', { project, ref, current: 'desc' }, engine)).rejects.toThrow(NOT_APPROVED)
    /* The page's press needs the page's ticket. */
    expect((await answer('POST', '/api/shots/approve', new URLSearchParams(), { projectPath: project, ref }, null))?.status).toBe(403)
    expect((await answer('POST', '/api/shots/approve', new URLSearchParams(), { projectPath: project, ref }, 'not-it'))?.status).toBe(403)
    await expect(call('shots_post_plan', { project, ref }, engine)).rejects.toThrow(NOT_APPROVED)
  })

  test('the person’s typed OK lets the plan through; a new capture takes the OK away', async () => {
    const { engine } = fakeEngine()
    const said = await skillSay('browser-before-after', `post ${ref}`, project, engine)
    expect(said).toStartWith('Browser:')
    expect(said).toContain("The person OK'd posting")
    const set = readSet(JSON.parse(readFileSync(join(browserDir, 'shots', 'gh-12', 'shots.json'), 'utf8')))!
    expect(set.approved?.via).toBe('typed')

    const plan = await answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shots_post_plan', arguments: { project, ref, change: 'gh:octo/app#12' } } }, null)
    const planText = textOf((plan?.body as { result: { content: { type: string; text: string }[] } }).result.content)
    expect(planText).toContain('gh api --method PUT repos/octo/app/contents/gh-12/')
    expect(planText).toContain('gh pr view 12 --repo octo/app')
    expect(existsSync(join(browserDir, 'shots', 'gh-12', 'post', 'settings--1280x800--dark--after.png.json'))).toBe(true)

    const body = textOf(await call('shots_post_body', { project, ref, change: 'gh:octo/app#12', current: 'Makes the header darker.' }, engine))
    expect(body).toContain('gh pr edit 12 --repo octo/app --body-file')
    const written = readFileSync(join(browserDir, 'shots', 'gh-12', 'post', 'body.md'), 'utf8')
    expect(written).toStartWith('Makes the header darker.\n\n' + BLOCK_START)
    expect(written).toContain('| Before | After |')
    expect(written).toContain('![Before: Settings, 1280×800, light](https://github.com/octo/app/raw/kehikot-shots/gh-12/')

    await call('shot_capture', { project, ref, screen: 'settings', side: 'after', origin: 'http://127.0.0.1:5302', width: 1280, height: 800, theme: 'dark' }, engine)
    await expect(call('shots_post_plan', { project, ref, change: 'gh:octo/app#12' }, engine)).rejects.toThrow(NOT_APPROVED)
  })

  test('the page’s press, with its ticket, is the other way to say OK', async () => {
    const reply = await answer('POST', '/api/shots/approve', new URLSearchParams(), { projectPath: project, ref }, TICKET)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { set: { approved: { via: string } } }).set.approved.via).toBe('page')
  })

  test('a description keeps its own text and gets one block, replaced on a second post', () => {
    const made = newSet({ ref: '!7', screens, viewports: [{ width: 400, height: 800 }], themes: ['light'] })
    if (!made.ok) throw new Error(made.why)
    const set = { ...made.set, captured: (['before', 'after'] as const).map((side) => ({ screen: 'settings', width: 400, height: 800, theme: 'light' as const, side, file: shotFile({ screen: 'settings', width: 400, height: 800, theme: 'light', side }), url: '', at: '' })) }
    const block = descriptionBlock(set, (file) => `/uploads/abc123/${file}`)
    const once = withBlock('Fixes the menu.', block)
    const twice = withBlock(once, block.replaceAll('abc123', 'def456'))
    expect(twice.match(/kehikot:before-after -->/g)).toHaveLength(2)
    expect(twice).toContain('def456')
    expect(twice).not.toContain('abc123')
    expect(twice).toStartWith('Fixes the menu.')
    expect(postPlan(set, { repo: { forge: 'gitlab', host: 'gitlab.com', path: 'g/app' }, number: 7 }, '/p', 's')).toEqual({ ok: false, why: NOT_APPROVED })
  })
})

describe('the other skill tools', () => {
  test('show_view asks the person’s page; open_ref opens the forge page from the project’s remotes', async () => {
    const { engine, shown, navigated } = fakeEngine()
    expect(textOf(await call('show_view', { view: 'shots', id: 'gh#12' }, engine))).toContain('show shots')
    expect(shown).toEqual([['shots', 'gh#12']])
    await expect(call('show_view', { view: 'files' }, engine)).rejects.toThrow()
    const opened = textOf(await call('open_ref', { project, ref: 'https://github.com/Jalez/kehikko/pull/93' }, engine))
    expect(navigated).toEqual(['https://github.com/Jalez/kehikko/pull/93'])
    expect(opened).toContain('pull request 93 of Jalez/kehikko')
  })

  test('console_log and network_failures read the one buffer', async () => {
    const { engine, console } = fakeEngine()
    console.add({ kind: 'console', level: 'warn', text: 'deprecated', source: 'https://a.test/x.js:1:1', page: '' })
    console.add(requestSaid({ url: 'https://a.test/api', method: 'GET', status: 0, failure: 'net::ERR_FAILED', page: '' })!)
    expect(textOf(await call('console_log', { levels: ['warn'] }, engine))).toContain('WARN deprecated')
    const failed = textOf(await call('network_failures', {}, engine))
    expect(failed).toContain('net::ERR_FAILED')
    expect(failed).not.toContain('deprecated')
  })

  test('the skills’ door answers plain text, starting "Browser:"', async () => {
    const { engine } = fakeEngine()
    const said = await skillSay('browser-open', 'gh#1', project, engine)
    expect(said).toStartWith('Browser: answering at')
    expect(said).toContain(`Project: `)
    expect(await skillSay('rm-rf', '', project, engine)).toContain('Stop.')
    const reply = await answer('GET', '/api/skill/say', new URLSearchParams({ skill: 'browser-open' }), null, null)
    expect(reply?.status).toBe(405)
  })
})
