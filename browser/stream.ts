import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

import type { RunSockets } from 'kehikot-module-protocol/run'
import { WebSocketServer } from 'ws'

import type { Engine, Listener } from './engine.ts'

/**
 * The socket between the browser and this module's own page: frames and page
 * state out, the person's pointer, wheel, keys and bar presses in.
 *
 * It lives on the server that serves the page, so it is the page's own origin:
 * on Vite's HTTP server through `ws` (`serveStream`, `noServer`), and on the
 * built server through Bun's own WebSocket (`streamSockets`, handed to the
 * protocol's `run`). What is said on it is `streamSession`, the same for both.
 * Two fences, both needed:
 *
 * - `fenced`: the handshake's `Origin` and `Host` must both be this module's
 *   own address on loopback. A page on another site, or a name that merely
 *   resolves to 127.0.0.1, is refused before the upgrade. On the built server
 *   it is the protocol's `socketFence`, the same rule in its words.
 * - The first message must carry the write ticket printed into `/app`, so only
 *   a page this server served can drive the browser.
 */

export const PATH = '/stream'

/** The largest message read from the page: an input event is a few bytes, a pasted text a few KiB. */
const MOST_READ = 256 * 1024
/** A viewer with this much still unsent skips frames and console lines rather than queueing seconds of them. */
const BEHIND = 2_000_000

export type Fenced = { ok: true; why: '' } | { ok: false; why: string }

export function fenced(headers: { origin?: string; host?: string }, port: number): Fenced {
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  const origin = headers.origin
  if (!origin) return { ok: false, why: 'That handshake carried no Origin, so it did not come from a page.' }
  if (!allowed.has(origin)) return { ok: false, why: `${origin} is not this module's own page.` }
  const host = headers.host
  if (!host || !allowed.has(`http://${host}`)) return { ok: false, why: `${host ?? '(no host)'} is not this module's address.` }
  return { ok: true, why: '' }
}

/**
 * One viewer's socket as `streamSession` needs it, whichever server holds it.
 * `sendFrame` calls `done` once the frame has left (or was dropped), so that a
 * slow viewer is sent the next frame only after the last one went.
 */
export interface Connection {
  open: () => boolean
  /** Bytes queued on the socket and not yet sent. */
  buffered: () => number
  send: (text: string) => void
  sendFrame: (text: string, done: () => void) => void
  close: (code: number, reason: string) => void
}

/** What a server tells a session: a message heard, or the socket gone. */
export interface StreamSession {
  heard: (text: string) => void
  ended: () => void
}

export function serveStream(http: Server, port: number, engine: Engine, ticket: string, log: (line: string) => void): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MOST_READ })

  http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (request.url ?? '').split('?')[0]
    if (path !== PATH) return /* Vite's own HMR socket, and anything else, is not ours. */
    const fence = fenced({ origin: request.headers.origin, host: request.headers.host }, port)
    if (!fence.ok) {
      log(`browser: refused a stream: ${fence.why}`)
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const held = streamSession(
        {
          open: () => ws.readyState === ws.OPEN,
          buffered: () => ws.bufferedAmount,
          send: (text) => ws.send(text),
          sendFrame: (text, done) => ws.send(text, () => done()),
          close: (code, reason) => ws.close(code, reason),
        },
        engine,
        ticket,
      )
      ws.on('message', (raw) => held.heard(String(raw)))
      ws.on('close', () => held.ended())
      ws.on('error', () => held.ended())
    })
  })
}

/**
 * The stream on the BUILT server (`serve.ts`), as the protocol's `run` takes it:
 * the same session, on Bun's own WebSocket. Bun's `send` says -1 when a message
 * was queued behind backpressure; a frame sent then is "gone" at the next
 * `drain`, which is when `ws.send`'s callback would have fired on Vite.
 */
export function streamSockets(
  engine: Engine,
  ticket: string,
  log: (line: string) => void,
): { sockets: RunSockets<{ held: StreamSession | null; drained: (() => void)[] }>; stopAll: () => void } {
  const live = new Set<StreamSession>()
  return {
    sockets: {
      paths: [PATH],
      data: () => ({ held: null, drained: [] }),
      open: (ws) => {
        const held = streamSession(
          {
            open: () => ws.readyState === 1,
            buffered: () => ws.getBufferedAmount(),
            send: (text) => {
              ws.send(text)
            },
            sendFrame: (text, done) => {
              if (ws.send(text) === -1) ws.data.drained.push(done)
              else done()
            },
            close: (code, reason) => ws.close(code, reason),
          },
          engine,
          ticket,
        )
        ws.data.held = held
        live.add(held)
      },
      message: (ws, message) => ws.data.held?.heard(typeof message === 'string' ? message : new TextDecoder().decode(message)),
      drain: (ws) => {
        for (const done of ws.data.drained.splice(0)) done()
      },
      close: (ws) => {
        for (const done of ws.data.drained.splice(0)) done()
        const held = ws.data.held
        if (!held) return
        live.delete(held)
        held.ended()
      },
      refused: (why) => log(`browser: refused a stream: ${why}`),
      maxPayloadLength: MOST_READ,
    },
    /* Every viewer stops watching when the process stops; the engine itself is closed by its owner. */
    stopAll: () => {
      for (const held of live) held.ended()
      live.clear()
    },
  }
}

type In = Record<string, unknown> & { t?: unknown }

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/**
 * One viewer: nothing is watched until the first message carries this process's
 * ticket; after that, frames, page state and the console go out and the
 * person's input comes in.
 */
export function streamSession(ws: Connection, engine: Engine, ticket: string): StreamSession {
  let stop: (() => void) | null = null
  let gone = false
  let busy = false
  const send = (message: unknown) => {
    if (ws.open()) ws.send(JSON.stringify(message))
  }
  const listener: Listener = {
    frame(frame) {
      /* A slow viewer skips frames rather than queueing seconds of them. */
      if (busy || !ws.open() || ws.buffered() > BEHIND) return
      busy = true
      ws.sendFrame(JSON.stringify({ t: 'frame', ...frame }), () => {
        busy = false
      })
    },
    page: (state) => send({ t: 'page', ...state }),
    status: (status) => send({ t: 'status', ...status, endpoint: engine.endpoint() }),
    dialog: (dialog) => send({ t: 'dialog', dialog }),
    /* View › Console, live. Text only: the page shows it as text. A viewer far behind skips lines; it reads /api/console when it opens the view. */
    said: (entry) => {
      if (ws.buffered() < BEHIND) send({ t: 'console', entry })
    },
    cleared: () => send({ t: 'console-clear' }),
    show: (view, id) => send({ t: 'show', view, id }),
  }

  const heard = (raw: string) => {
    if (gone) return
    let m: In
    try {
      m = JSON.parse(raw) as In
    } catch {
      return
    }
    if (!stop) {
      if (m.t !== 'hello' || m.ticket !== ticket) {
        ws.close(4003, 'This page is older than the server behind it. Reload it.')
        return
      }
      void engine.resize({ width: num(m.width, 1280), height: num(m.height, 800) }, num(m.scale, 1))
      stop = engine.watch(listener)
      return
    }
    void handle(m).catch((error: unknown) => send({ t: 'said', text: error instanceof Error ? error.message : String(error) }))
  }

  /* Once: a socket that closes after an error reports both. */
  const ended = () => {
    if (gone) return
    gone = true
    stop?.()
  }

  async function handle(m: In): Promise<void> {
    switch (m.t) {
      case 'size':
        return engine.resize({ width: num(m.width, 1280), height: num(m.height, 800) }, num(m.scale, 1))
      case 'mouse':
        return engine.mouse({
          type: String(m.type),
          x: num(m.x),
          y: num(m.y),
          button: String(m.button),
          buttons: num(m.buttons),
          clickCount: num(m.clickCount, 1),
          modifiers: num(m.modifiers),
        })
      case 'wheel':
        return engine.wheel({ x: num(m.x), y: num(m.y), dx: num(m.dx), dy: num(m.dy), modifiers: num(m.modifiers) })
      case 'key':
        return engine.key({
          type: m.type === 'up' ? 'up' : 'down',
          key: String(m.key ?? ''),
          code: String(m.code ?? ''),
          keyCode: num(m.keyCode),
          modifiers: num(m.modifiers),
          repeat: m.repeat === true,
        })
      case 'text':
        return engine.insertText(String(m.text ?? ''))
      case 'copy':
        return send({ t: 'copied', text: await engine.selectedText() })
      case 'go':
        await engine.navigate(String(m.url ?? ''))
        return
      case 'back':
        await engine.back()
        return
      case 'forward':
        await engine.forward()
        return
      case 'reload':
        await engine.reload()
        return
      case 'stop':
        return engine.stop()
      case 'dialog':
        return engine.answerDialog(m.accept === true, typeof m.text === 'string' ? m.text : undefined)
      case 'retry':
        await engine.ready()
        return
      default:
        return
    }
  }

  return { heard, ended }
}
