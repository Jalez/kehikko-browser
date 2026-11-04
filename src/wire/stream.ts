import { ticket } from 'kehikot-module-protocol/client'

import { readFrame } from '@/lib/frame'

/**
 * The page's half of the stream socket (`browser/stream.ts`): frames and page
 * state in, pointer, keys and bar presses out. Reconnects on its own, a second
 * apart, so a restarted server is picked up without a reload.
 */

export interface PageState {
  url: string
  title: string
  canBack: boolean
  canForward: boolean
  loading: boolean
}

export interface Status {
  state: 'idle' | 'starting' | 'ready' | 'failed'
  why: string | null
  endpoint: { http: string; ws: string | null; port: number } | null
}

export interface Dialog {
  type: string
  message: string
  defaultValue: string
}

/** A screencast frame: the JPEG's bytes as they came over the socket (`frame.ts`), or base64 text. */
export interface Frame {
  data: Blob | string
  width: number
  height: number
}

export interface StreamEvents {
  frame?(frame: Frame): void
  page?(state: PageState): void
  status?(status: Status): void
  dialog?(dialog: Dialog | null): void
  copied?(text: string): void
  said?(text: string): void
  open?(connected: boolean): void
  /** One thing the page said, for View › Console. */
  console?(entry: ConsoleEntry): void
  consoleCleared?(): void
  /** An agent asked for a view (`show_view`). */
  show?(view: string, id: string | null): void
}

export interface ConsoleEntry {
  n: number
  at: string
  kind: 'console' | 'exception' | 'network'
  level: 'debug' | 'log' | 'info' | 'warn' | 'error'
  text: string
  source: string | null
  page: string
  status?: number
  method?: string
}

export class Stream {
  private ws: WebSocket | null = null
  private closed = false
  private retry: ReturnType<typeof setTimeout> | null = null
  private size = { width: 1280, height: 800, scale: 1 }
  private hidden = false

  constructor(private readonly events: StreamEvents) {}

  start(size: { width: number; height: number; scale: number }): void {
    this.size = size
    this.closed = false
    this.connect()
  }

  stop(): void {
    this.closed = true
    if (this.retry) clearTimeout(this.retry)
    this.ws?.close()
    this.ws = null
  }

  private connect(): void {
    const url = new URL('./stream', location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.search = ''
    url.hash = ''
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', ticket: ticket(), ...this.size }))
      if (this.hidden) ws.send(JSON.stringify({ t: 'shown', on: false }))
      this.events.open?.(true)
    }
    ws.onmessage = (event) => {
      /* A frame is the one binary message; everything else is JSON text. */
      if (event.data instanceof ArrayBuffer) {
        const frame = readFrame(event.data)
        if (frame) this.events.frame?.({ data: new Blob([frame.image], { type: 'image/jpeg' }), width: frame.width, height: frame.height })
        return
      }
      let m: Record<string, unknown>
      try {
        m = JSON.parse(String(event.data)) as Record<string, unknown>
      } catch {
        return
      }
      switch (m.t) {
        case 'frame':
          this.events.frame?.(m as never)
          break
        case 'page':
          this.events.page?.(m as never)
          break
        case 'status':
          this.events.status?.(m as never)
          break
        case 'dialog':
          this.events.dialog?.((m.dialog as Dialog | null) ?? null)
          break
        case 'copied':
          this.events.copied?.(String(m.text ?? ''))
          break
        case 'said':
          this.events.said?.(String(m.text ?? ''))
          break
        case 'console':
          if (m.entry && typeof m.entry === 'object') this.events.console?.(m.entry as ConsoleEntry)
          break
        case 'console-clear':
          this.events.consoleCleared?.()
          break
        case 'show':
          this.events.show?.(String(m.view ?? ''), typeof m.id === 'string' ? m.id : null)
          break
      }
    }
    ws.onclose = (event) => {
      if (this.ws !== ws) return
      this.ws = null
      this.events.open?.(false)
      if (event.code === 4003) {
        this.events.said?.(event.reason || 'This page is older than its server. Reload it.')
        return
      }
      if (!this.closed) this.retry = setTimeout(() => this.connect(), 1000)
    }
  }

  send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  /** Whether the host has this page on screen (`kehikot.visible`). Hidden, the server sends no frames; said again after a reconnect. */
  shown(on: boolean): void {
    if (this.hidden === !on) return
    this.hidden = !on
    this.send({ t: 'shown', on })
  }

  resize(size: { width: number; height: number; scale: number }): void {
    this.size = size
    this.send({ t: 'size', ...size })
  }
}
