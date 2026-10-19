/**
 * From the person's pointer and keys on the module's page to what Chromium's
 * `Input.dispatch*` takes. Pure, and shared: the page maps coordinates, the
 * server builds the CDP parameters.
 */

export interface Size {
  width: number
  height: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where the frame is drawn inside the canvas: scaled to fit, centred, aspect
 * kept. When the browser's viewport matches the canvas (the normal case) this is
 * the whole canvas; for the moment after a resize, before Chromium has caught
 * up, it is letterboxed rather than stretched.
 */
export function fitFrame(frame: Size, box: Size): Rect {
  if (frame.width <= 0 || frame.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { left: 0, top: 0, width: Math.max(0, box.width), height: Math.max(0, box.height) }
  }
  const scale = Math.min(box.width / frame.width, box.height / frame.height)
  const width = frame.width * scale
  const height = frame.height * scale
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height }
}

/**
 * A point on the page's canvas (CSS pixels, relative to the canvas) as a point
 * in the browser's viewport (CSS pixels), or null when it is outside the drawn
 * frame. `viewport` is the size the browser was told (`Emulation.setDeviceMetricsOverride`).
 */
export function toViewport(point: { x: number; y: number }, drawn: Rect, viewport: Size): { x: number; y: number } | null {
  if (drawn.width <= 0 || drawn.height <= 0) return null
  const fx = (point.x - drawn.left) / drawn.width
  const fy = (point.y - drawn.top) / drawn.height
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null
  return {
    x: Math.min(viewport.width - 1, Math.max(0, Math.round(fx * viewport.width))),
    y: Math.min(viewport.height - 1, Math.max(0, Math.round(fy * viewport.height))),
  }
}

/** The viewport to ask for, given the canvas's CSS size: whole pixels, bounded both ways. */
export function viewportFor(box: Size): Size {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))
  return { width: clamp(box.width, 200, 3840), height: clamp(box.height, 150, 2160) }
}

export interface Modifiers {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** CDP's modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function modifierBits(m: Modifiers): number {
  return (m.altKey ? 1 : 0) | (m.ctrlKey ? 2 : 0) | (m.metaKey ? 4 : 0) | (m.shiftKey ? 8 : 0)
}

export type Button = 'left' | 'middle' | 'right' | 'none'

/** A DOM `MouseEvent.button` as CDP names it. */
export function buttonName(button: number): Button {
  return button === 0 ? 'left' : button === 1 ? 'middle' : button === 2 ? 'right' : 'none'
}

/** A key event as the page sends it to the server. */
export interface KeyIn {
  type: 'down' | 'up'
  key: string
  code: string
  keyCode: number
  modifiers: number
  repeat?: boolean
}

/** What a key types, if anything: one character, Enter as a carriage return, nothing under Ctrl/Meta. */
export function textOf(key: string, modifiers: number): string | undefined {
  if (modifiers & (2 | 4)) return undefined
  if (key === 'Enter') return '\r'
  if (key.length === 1) return key
  return undefined
}

/** macOS editing commands Chromium does not derive from Meta+key on its own, as `Input.dispatchKeyEvent` takes them. */
const COMMANDS: Record<string, string> = {
  KeyA: 'selectAll',
  KeyC: 'copy',
  KeyX: 'cut',
  KeyZ: 'undo',
}

/** The parameters of one `Input.dispatchKeyEvent`, or null for a key event that cannot be sent. */
export function keyEventParams(k: KeyIn): Record<string, unknown> | null {
  if (typeof k.key !== 'string' || k.key.length === 0 || k.key.length > 32) return null
  const text = k.type === 'down' ? textOf(k.key, k.modifiers) : undefined
  const params: Record<string, unknown> = {
    type: k.type === 'up' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
    key: k.key,
    code: typeof k.code === 'string' ? k.code.slice(0, 32) : '',
    windowsVirtualKeyCode: Number.isInteger(k.keyCode) ? k.keyCode : 0,
    modifiers: k.modifiers & 15,
  }
  if (text) {
    params.text = text
    params.unmodifiedText = text
  }
  if (k.repeat) params.autoRepeat = true
  if (k.type === 'down' && k.modifiers & 4 && !(k.modifiers & 2)) {
    const command = COMMANDS[k.code]
    if (command) params.commands = [k.modifiers & 8 && command === 'undo' ? 'redo' : command]
  }
  return params
}
