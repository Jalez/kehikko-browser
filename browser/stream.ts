import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

import { WebSocketServer, type WebSocket } from 'ws'

import type { Engine, Listener } from './engine.ts'

/**
 * The socket between the browser and this module's own page: frames and page
 * state out, the person's pointer, wheel, keys and bar presses in.
 *
 * It lives on the server that serves the page (`noServer`, attached to Vite's
 * HTTP server), so it is the page's own origin. Two fences, both needed:
 *
 * - `fenced`: the handshake's `Origin` and `Host` must both be this module's
 *   own address on loopback. A page on another site, or a name that merely
 *   resolves to 127.0.0.1, is refused before the upgrade.
 * - The first message must carry the write ticket printed into `/app`, so only
 *   a page this server served can drive the browser.
 */

export const PATH = '/stream'

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

type In = Record<string, unknown> & { t?: unknown }

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

export function serveStream(http: Server, port: number, engine: Engine, ticket: string, log: (line: string) => void): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })

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
    wss.handleUpgrade(request, socket, head, (ws) => opened(ws))
  })

  function opened(ws: WebSocket): void {
    let stop: (() => void) | null = null
    let busy = false
    const send = (message: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
    }
    const listener: Listener = {
      frame(frame) {
        /* A slow viewer skips frames rather than queueing seconds of them. */
        if (busy || ws.bufferedAmount > 2_000_000) return
        busy = true
        ws.send(JSON.stringify({ t: 'frame', ...frame }), () => {
          busy = false
        })
      },
      page: (state) => send({ t: 'page', ...state }),
      status: (status) => send({ t: 'status', ...status, endpoint: engine.endpoint() }),
      dialog: (dialog) => send({ t: 'dialog', dialog }),
      /* View › Console, live. Text only: the page shows it as text. A viewer far behind skips lines; it reads /api/console when it opens the view. */
      said: (entry) => {
        if (ws.bufferedAmount < 2_000_000) send({ t: 'console', entry })
      },
      cleared: () => send({ t: 'console-clear' }),
      show: (view, id) => send({ t: 'show', view, id }),
    }

    ws.on('message', (raw) => {
      let m: In
      try {
        m = JSON.parse(String(raw)) as In
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
    })
    ws.on('close', () => stop?.())
    ws.on('error', () => stop?.())

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
  }
}
