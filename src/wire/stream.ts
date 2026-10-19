import { ticket } from 'kehikot-module-protocol/client'

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

export interface StreamEvents {
  frame?(frame: { data: string; width: number; height: number }): void
  page?(state: PageState): void
  status?(status: Status): void
  dialog?(dialog: Dialog | null): void
  copied?(text: string): void
  said?(text: string): void
  open?(connected: boolean): void
}

export class Stream {
  private ws: WebSocket | null = null
  private closed = false
  private retry: ReturnType<typeof setTimeout> | null = null
  private size = { width: 1280, height: 800, scale: 1 }

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
    this.ws = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', ticket: ticket(), ...this.size }))
      this.events.open?.(true)
    }
    ws.onmessage = (event) => {
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

  resize(size: { width: number; height: number; scale: number }): void {
    this.size = size
    this.send({ t: 'size', ...size })
  }
}
