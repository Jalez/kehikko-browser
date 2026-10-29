import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'

import { watching } from 'kehikot-module-protocol/serve'

import { Engine } from '../browser/engine.ts'
import { call } from '../doors.ts'
import { ENDPOINT_EVENTS_PATH, ENDPOINT_TOPIC, endpointStream, type EndpointNews } from '../live.ts'

/**
 * The Playwright endpoint on the stream door: sent as it stands when a page follows it, then again
 * when the browser starts (here through an agent's `cdp_endpoint`) and when it stops. No browser is
 * ever started: the engine's launch is stood in for by one that only says which port it opened.
 */

/** A real `Engine` whose launch starts nothing: a context that can be closed, on a made-up DevTools port. */
function engineWithoutBrowser(port = 9555) {
  const engine = new Engine(() => 8020, () => {}, {})
  const context = new EventEmitter() as EventEmitter & { close(): Promise<void>; pages(): unknown[] }
  context.close = async () => void context.emit('close')
  context.pages = () => []
  const inner = engine as unknown as { launch(): Promise<unknown>; cdpPort: number | null; cdpWs: string | null; context: unknown; starting: unknown; setStatus(s: unknown): void }
  inner.launch = async () => {
    inner.cdpPort = port
    inner.cdpWs = null
    /* What the real launch does when the browser closes: the endpoint goes with it. */
    context.once('close', () => {
      inner.cdpPort = null
      inner.context = null
      inner.starting = null
      inner.setStatus({ state: 'failed', why: 'The browser closed. Press Try again to start it again.' })
    })
    return context
  }
  return engine
}

describe('the endpoint’s stream', () => {
  test('opens with the endpoint as it stands, then is told when the browser starts and when it stops', async () => {
    const engine = engineWithoutBrowser()
    const stream = endpointStream(engine)
    const heard: EndpointNews[] = []
    const live = stream('GET', ENDPOINT_EVENTS_PATH, new URLSearchParams(), (event) => void heard.push(event as EndpointNews), null)
    if (!live || !('close' in live)) throw new Error('not a stream')
    await Promise.resolve()
    expect(heard).toHaveLength(1)
    expect(heard[0]).toMatchObject({ endpoint: null, status: { state: 'idle' } })
    expect(watching(ENDPOINT_TOPIC)).toBe(1)

    /* An agent asks for the endpoint, which starts the browser. */
    const said = await call('cdp_endpoint', {}, engine)
    expect(said[0]).toMatchObject({ text: expect.stringContaining('endpoint: http://127.0.0.1:9555') })
    expect(heard.map((one) => one.status.state)).toEqual(['idle', 'starting', 'ready'])
    expect(heard.at(-1)).toMatchObject({ endpoint: { http: 'http://127.0.0.1:9555', port: 9555 } })
    expect(heard.at(-1)!.snippets).not.toBeNull()

    /* The browser stops: the endpoint is gone, and the page is told. */
    await engine.close()
    expect(heard.at(-1)).toMatchObject({ endpoint: null, snippets: null, status: { state: 'failed' } })
    const count = heard.length

    live.close()
    expect(watching(ENDPOINT_TOPIC)).toBe(0)
    await call('cdp_endpoint', {}, engine)
    expect(heard.length).toBe(count)
    await engine.close()
  })

  test('another path is not the stream, and the engine is listened to once however often it is asked', () => {
    const engine = engineWithoutBrowser()
    expect(endpointStream(engine)('GET', '/api/endpoint', new URLSearchParams(), () => {}, null)).toBeNull()
    const again = endpointStream(engine)
    const heard: unknown[] = []
    const live = again('GET', ENDPOINT_EVENTS_PATH, new URLSearchParams(), (event) => void heard.push(event), null)
    ;(engine as unknown as { setStatus(s: unknown): void }).setStatus({ state: 'starting', why: null })
    expect(heard).toHaveLength(2)
    if (live && 'close' in live) live.close()
  })
})
