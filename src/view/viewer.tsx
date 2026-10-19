import { useEffect, useRef } from 'react'

import { buttonName, fitFrame, modifierBits, toViewport, viewportFor, type Rect } from '@/lib/input'
import type { Stream } from '@/wire/stream'

/**
 * The browser's screen: screencast frames drawn on a canvas, and the person's
 * pointer, wheel and keys sent back. Coordinates go through `toViewport` against
 * the frame actually drawn, so a frame from before a resize still maps true.
 *
 * Paste is the page's own paste event, typed in with `Input.insertText`: the
 * headless browser's clipboard is not the person's. Copy asks the browser for
 * what is selected and puts it on the person's clipboard.
 */
export function Viewer({
  stream,
  frames,
  onCopied,
}: {
  stream: Stream
  /** Where the parent's stream handler hands each frame. */
  frames: { current: ((frame: { data: string; width: number; height: number }) => void) | null }
  onCopied: { current: ((text: string) => void) | null }
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawn = useRef<Rect>({ left: 0, top: 0, width: 0, height: 0 })
  const frameSize = useRef({ width: 0, height: 0 })
  const clicks = useRef({ at: 0, x: 0, y: 0, count: 0 })
  const pressed = useRef(0)

  /* Frames: the latest one wins; a slow decode never queues. */
  useEffect(() => {
    let decoding = false
    let next: { data: string; width: number; height: number } | null = null
    const image = new Image()
    const draw = (frame: { data: string; width: number; height: number }) => {
      decoding = true
      image.onload = () => {
        const c = canvas.current
        if (c) {
          const ctx = c.getContext('2d')
          const scale = window.devicePixelRatio || 1
          const css = { width: c.clientWidth, height: c.clientHeight }
          if (c.width !== Math.round(css.width * scale) || c.height !== Math.round(css.height * scale)) {
            c.width = Math.round(css.width * scale)
            c.height = Math.round(css.height * scale)
          }
          const rect = fitFrame(frame, css)
          drawn.current = rect
          frameSize.current = { width: frame.width, height: frame.height }
          if (ctx) {
            ctx.setTransform(scale, 0, 0, scale, 0, 0)
            ctx.clearRect(0, 0, css.width, css.height)
            ctx.drawImage(image, rect.left, rect.top, rect.width, rect.height)
          }
        }
        decoding = false
        if (next) {
          const n = next
          next = null
          draw(n)
        }
      }
      image.onerror = () => {
        decoding = false
      }
      image.src = `data:image/jpeg;base64,${frame.data}`
    }
    frames.current = (frame) => {
      if (decoding) next = frame
      else draw(frame)
    }
    return () => {
      frames.current = null
    }
  }, [frames])

  /* Size: the browser's viewport follows this box. */
  useEffect(() => {
    const el = box.current
    if (!el) return
    let last = ''
    const say = () => {
      const size = viewportFor({ width: el.clientWidth, height: el.clientHeight })
      const scale = window.devicePixelRatio || 1
      const key = `${size.width}x${size.height}@${scale}`
      if (key === last) return
      last = key
      stream.resize({ ...size, scale })
    }
    const observer = new ResizeObserver(say)
    observer.observe(el)
    say()
    return () => observer.disconnect()
  }, [stream])

  /* Wheel and paste need non-passive listeners. */
  useEffect(() => {
    const el = box.current
    if (!el) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const at = point(event)
      if (!at) return
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1
      stream.send({ t: 'wheel', ...at, dx: event.deltaX * unit, dy: event.deltaY * unit, modifiers: modifierBits(event) })
    }
    const paste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain')
      if (text) {
        event.preventDefault()
        stream.send({ t: 'text', text })
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('paste', paste)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('paste', paste)
    }
  })

  useEffect(() => {
    onCopied.current = (text) => {
      if (!text) return
      void navigator.clipboard?.writeText(text).catch(() => {
        const area = document.createElement('textarea')
        area.value = text
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
        box.current?.focus()
      })
    }
    return () => {
      onCopied.current = null
    }
  }, [onCopied])

  function point(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const c = canvas.current
    if (!c || !frameSize.current.width) return null
    const r = c.getBoundingClientRect()
    return toViewport({ x: event.clientX - r.left, y: event.clientY - r.top }, drawn.current, frameSize.current)
  }

  function mouse(type: 'down' | 'up' | 'move', event: React.PointerEvent) {
    const at = point(event)
    if (!at) return
    let clickCount = 0
    if (type === 'down') {
      const now = performance.now()
      const c = clicks.current
      const near = Math.abs(c.x - at.x) < 5 && Math.abs(c.y - at.y) < 5
      c.count = now - c.at < 400 && near ? c.count + 1 : 1
      c.at = now
      c.x = at.x
      c.y = at.y
      clickCount = c.count
    } else if (type === 'up') clickCount = clicks.current.count
    stream.send({
      t: 'mouse',
      type,
      ...at,
      button: type === 'move' ? (pressed.current ? 'left' : 'none') : buttonName(event.button),
      buttons: event.buttons,
      clickCount,
      modifiers: modifierBits(event),
    })
  }

  const moving = useRef(false)
  const lastMove = useRef<React.PointerEvent | null>(null)

  return (
    <div
      ref={box}
      tabIndex={0}
      data-testid="viewer"
      aria-label="The browser's page. Click to give it the keyboard."
      className="relative min-h-0 flex-1 overflow-hidden bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onPointerDown={(event) => {
        box.current?.focus()
        ;(event.target as Element).setPointerCapture?.(event.pointerId)
        pressed.current = event.buttons
        mouse('down', event)
      }}
      onPointerUp={(event) => {
        pressed.current = event.buttons
        mouse('up', event)
      }}
      onPointerMove={(event) => {
        lastMove.current = event
        if (moving.current) return
        moving.current = true
        requestAnimationFrame(() => {
          moving.current = false
          if (lastMove.current) mouse('move', lastMove.current)
        })
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const chord = event.metaKey || event.ctrlKey
        /* Paste arrives as a paste event (above); copy is answered with the page's selection. */
        if (chord && event.code === 'KeyV') return
        if (chord && (event.code === 'KeyC' || event.code === 'KeyX')) stream.send({ t: 'copy' })
        event.preventDefault()
        stream.send({ t: 'key', type: 'down', key: event.key, code: event.code, keyCode: event.keyCode, modifiers: modifierBits(event), repeat: event.repeat })
      }}
      onKeyUp={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.code === 'KeyV') return
        event.preventDefault()
        stream.send({ t: 'key', type: 'up', key: event.key, code: event.code, keyCode: event.keyCode, modifiers: modifierBits(event) })
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
