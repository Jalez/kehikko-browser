import { events, publish, type Stream } from 'kehikot-module-protocol/serve'

import type { Engine, Endpoint, Status } from './browser/engine.ts'
import { snippets } from './src/lib/endpoint.ts'

/**
 * The Playwright endpoint, told to the page when it changes rather than asked for on a clock
 * (protocol 2.32.0, `events`/`subscribe`). The endpoint appears when the browser starts — from the
 * page, or from an agent's `cdp_endpoint` — and the page's Run › Playwright endpoint… panel used to
 * ask `/api/endpoint` every 2 s until it did.
 *
 * The page follows `/api/endpoint/events`: it is sent the endpoint as it stands when the stream opens
 * (and again on every reopen), then the new one each time the browser's status changes — starting,
 * ready, failed or closed. What travels is the same body `/api/endpoint` answers, which is small.
 */

export const ENDPOINT_EVENTS_PATH = '/api/endpoint/events'
export const ENDPOINT_TOPIC = 'endpoint'

export interface EndpointNews {
  ok: true
  endpoint: Endpoint | null
  snippets: ReturnType<typeof snippets> | null
  status: Status
}

/** What `/api/endpoint` answers, and what the stream sends. */
export function endpointNews(engine: Pick<Engine, 'endpoint' | 'getStatus'>): EndpointNews {
  const at = engine.endpoint()
  return { ok: true, endpoint: at, snippets: at ? snippets(at.http) : null, status: engine.getStatus() }
}

const heard = new WeakSet<object>()

/**
 * The doors' stream for one engine: `/api/endpoint/events`. The engine's status changes are published
 * from the moment this is made; with no page following, each is a publish that reaches nobody.
 */
export function endpointStream(engine: Pick<Engine, 'endpoint' | 'getStatus' | 'onStatus'>): Stream {
  if (!heard.has(engine)) {
    heard.add(engine)
    engine.onStatus(() => void publish(ENDPOINT_TOPIC, endpointNews(engine)))
  }
  return events((path) => (path === ENDPOINT_EVENTS_PATH ? { topic: ENDPOINT_TOPIC, initial: () => endpointNews(engine) } : null))
}
