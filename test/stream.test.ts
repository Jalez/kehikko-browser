import { describe, expect, test } from 'bun:test'

import { socketFence } from 'kehikot-module-protocol/run'

import type { Engine, Listener } from '../browser/engine.ts'
import { fenced, streamSession, streamSockets, type Connection } from '../browser/stream.ts'

/** An engine that records who watches and what it was told, and hands back the listener. */
function watchedEngine() {
  const told: string[] = []
  let listener: Listener | null = null
  let unwatched = 0
  const engine = {
    endpoint: () => null,
    resize: async (box: { width: number; height: number }) => void told.push(`resize ${box.width}x${box.height}`),
    watch: (one: Listener) => {
      listener = one
      return () => {
        unwatched += 1
      }
    },
    navigate: async (url: string) => void told.push(`go ${url}`),
  }
  return { engine: engine as unknown as Engine, told, listener: () => listener, unwatched: () => unwatched }
}

function connection(buffered = 0) {
  const sent: string[] = []
  const frames: { text: string; done: () => void }[] = []
  const closed: [number, string][] = []
  const conn: Connection = {
    open: () => closed.length === 0,
    buffered: () => buffered,
    send: (text) => void sent.push(text),
    sendFrame: (text, done) => void frames.push({ text, done }),
    close: (code, reason) => void closed.push([code, reason]),
  }
  return { conn, sent, frames, closed }
}

const frame = { data: 'AAAA', width: 10, height: 10 }

describe('the stream session, the same on Vite and on the built server', () => {
  test('nothing is watched until the first message carries the ticket', () => {
    const { engine, listener } = watchedEngine()
    const { conn, closed } = connection()
    const held = streamSession(conn, engine, 'right')
    held.heard(JSON.stringify({ t: 'hello', ticket: 'wrong' }))
    expect(listener()).toBeNull()
    expect(closed[0]?.[0]).toBe(4003)
  })

  test('a viewer with the ticket is watched, and input after it reaches the engine', async () => {
    const { engine, told, listener } = watchedEngine()
    const { conn } = connection()
    const held = streamSession(conn, engine, 'right')
    held.heard(JSON.stringify({ t: 'hello', ticket: 'right', width: 800, height: 600 }))
    expect(listener()).not.toBeNull()
    held.heard(JSON.stringify({ t: 'go', url: 'https://example.test/' }))
    await Bun.sleep(0)
    expect(told).toEqual(['resize 800x600', 'go https://example.test/'])
  })

  test('a frame is sent only after the last one left', () => {
    const { engine, listener } = watchedEngine()
    const { conn, frames } = connection()
    streamSession(conn, engine, 't').heard(JSON.stringify({ t: 'hello', ticket: 't' }))
    listener()!.frame!(frame)
    listener()!.frame!(frame)
    expect(frames.length).toBe(1)
    frames[0]!.done()
    listener()!.frame!(frame)
    expect(frames.length).toBe(2)
  })

  test('a viewer far behind skips frames and console lines', () => {
    const { engine, listener } = watchedEngine()
    const { conn, frames, sent } = connection(3_000_000)
    streamSession(conn, engine, 't').heard(JSON.stringify({ t: 'hello', ticket: 't' }))
    const before = sent.length
    listener()!.frame!(frame)
    listener()!.said!({ kind: 'console', level: 'log', text: 'x' } as never)
    expect(frames.length).toBe(0)
    expect(sent.length).toBe(before)
  })

  test('the socket ending stops the watch once, and nothing is heard after', () => {
    const { engine, listener, unwatched } = watchedEngine()
    const { conn } = connection()
    const held = streamSession(conn, engine, 't')
    held.heard(JSON.stringify({ t: 'hello', ticket: 't' }))
    held.ended()
    held.ended()
    expect(unwatched()).toBe(1)
    const was = listener()
    held.heard(JSON.stringify({ t: 'hello', ticket: 't' }))
    expect(listener()).toBe(was)
  })
})

describe('the stream on Bun’s WebSocket', () => {
  function bunSocket(sendSays: number) {
    const sent: string[] = []
    return {
      sent,
      ws: {
        data: { held: null, drained: [] as (() => void)[] },
        readyState: 1,
        send: (text: string) => {
          sent.push(text)
          return sendSays
        },
        close: () => {},
        terminate: () => {},
        getBufferedAmount: () => 0,
      },
    }
  }

  test('a frame queued behind backpressure is gone at the next drain', () => {
    const { engine, listener } = watchedEngine()
    const { sockets } = streamSockets(engine, 't', () => {})
    const { ws, sent } = bunSocket(-1)
    sockets.open!(ws as never)
    sockets.message(ws as never, JSON.stringify({ t: 'hello', ticket: 't' }))
    listener()!.frame!(frame)
    listener()!.frame!(frame)
    expect(sent.filter((s) => s.includes('"frame"')).length).toBe(1)
    sockets.drain!(ws as never)
    listener()!.frame!(frame)
    expect(sent.filter((s) => s.includes('"frame"')).length).toBe(2)
  })

  test('closing the socket stops the watch', () => {
    const { engine, unwatched } = watchedEngine()
    const { sockets } = streamSockets(engine, 't', () => {})
    const { ws } = bunSocket(10)
    sockets.open!(ws as never)
    sockets.message(ws as never, new TextEncoder().encode(JSON.stringify({ t: 'hello', ticket: 't' })))
    sockets.close!(ws as never, 1000, '')
    expect(unwatched()).toBe(1)
  })

  test('the protocol’s fence on the built server is the same rule as `fenced`', () => {
    const cases: { origin?: string; host?: string }[] = [
      { origin: 'http://127.0.0.1:8020', host: '127.0.0.1:8020' },
      { origin: 'http://localhost:8020', host: 'localhost:8020' },
      { origin: 'https://evil.example', host: '127.0.0.1:8020' },
      { origin: 'http://127.0.0.1:8020', host: 'evil.example:8020' },
      { host: '127.0.0.1:8020' },
    ]
    for (const one of cases) {
      const headers = new Headers(Object.entries(one).filter((pair): pair is [string, string] => pair[1] !== undefined))
      expect(socketFence(headers, 8020).ok).toBe(fenced(one, 8020).ok)
    }
  })
})
