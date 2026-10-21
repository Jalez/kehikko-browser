/**
 * The outline an agent puts round an element before it acts on it, so the person watching sees
 * what is about to be clicked or typed into, and the label says why.
 *
 * Both functions run IN THE PAGE (the engine sends them with `Runtime.evaluate`, as it does
 * `collect` and `locate`), so each is self-contained: no imports, no closures. The overlay is one
 * element at the end of `<body>`, `pointer-events: none` so a click goes through it to the page,
 * with its own shadow root so the page's styles do not reach it. The label is set as text, never
 * as markup. It removes itself after `ms`, and `clearHighlight` removes it at once; a second
 * highlight replaces the first.
 */

export interface HighlightArgs {
  /** The window slot where read_page / find keep their refs (the engine's SLOT). */
  slot: string
  ref?: string | null
  selector?: string | null
  /** A point instead of an element: a small box round it. */
  x?: number | null
  y?: number | null
  label: string
  ms: number
  /** The overlay's element id. */
  id: string
}

export type Highlighted = { x: number; y: number; width: number; height: number } | { why: string }

export function showHighlight(args: HighlightArgs): Highlighted {
  const w = window as unknown as Record<string, unknown>
  const timers = `${args.id}-timer`
  const old = document.getElementById(args.id)
  if (old) old.remove()
  if (w[timers] !== undefined) clearTimeout(w[timers] as never)

  let rect: { left: number; top: number; width: number; height: number } | null = null
  if (args.ref) {
    const map = w[args.slot] as Map<string, { el: WeakRef<Element> }> | undefined
    const el = map?.get(args.ref)?.el.deref()
    if (!el || !el.isConnected) return { why: `There is no ${args.ref} on the page now. Call read_page or find again for fresh refs.` }
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
    rect = el.getBoundingClientRect()
  } else if (args.selector) {
    let el: Element | null = null
    try {
      el = document.querySelector(args.selector)
    } catch {
      return { why: `"${args.selector.slice(0, 80)}" is not a CSS selector.` }
    }
    if (!el) return { why: `Nothing on the page matches ${args.selector.slice(0, 80)}.` }
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior })
    rect = el.getBoundingClientRect()
  } else if (typeof args.x === 'number' && typeof args.y === 'number') {
    rect = { left: args.x - 12, top: args.y - 12, width: 24, height: 24 }
  } else {
    return { why: 'Say what to highlight: a ref from read_page or find, a CSS selector, or x and y.' }
  }

  const pad = 4
  const host = document.createElement('div')
  host.id = args.id
  host.setAttribute('data-kehikot-highlight', '')
  host.setAttribute('aria-hidden', 'true')
  const box = {
    left: Math.round(rect.left - pad),
    top: Math.round(rect.top - pad),
    width: Math.round(rect.width + pad * 2),
    height: Math.round(rect.height + pad * 2),
  }
  host.style.cssText =
    `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;`
    + 'pointer-events:none;z-index:2147483647;margin:0;padding:0;border:0;background:none;'
  const root = host.attachShadow({ mode: 'open' })
  const ring = document.createElement('div')
  ring.style.cssText =
    'position:absolute;inset:0;border:3px solid #f59e0b;border-radius:6px;'
    + 'box-shadow:0 0 0 2px rgba(255,255,255,.85),0 0 16px rgba(245,158,11,.55);box-sizing:border-box;'
  const tag = document.createElement('div')
  tag.setAttribute('part', 'label')
  /* Text, never markup: whatever the agent wrote is shown as written. */
  tag.textContent = String(args.label ?? '').slice(0, 160)
  const above = box.top > 28
  tag.style.cssText =
    `position:absolute;left:-3px;${above ? 'bottom:100%;margin-bottom:4px;' : 'top:100%;margin-top:4px;'}`
    + 'max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    + 'font:600 12px/1.4 system-ui,-apple-system,sans-serif;color:#111;background:#fbbf24;'
    + 'padding:2px 8px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.3);'
  if (!tag.textContent) tag.style.display = 'none'
  root.append(ring, tag)
  ;(document.body ?? document.documentElement).append(host)
  const ms = Math.min(30_000, Math.max(300, Number(args.ms) || 2500))
  w[timers] = setTimeout(() => host.remove(), ms)
  return { x: box.left, y: box.top, width: box.width, height: box.height }
}

export function clearHighlight(args: { id: string }): boolean {
  const w = window as unknown as Record<string, unknown>
  const timers = `${args.id}-timer`
  if (w[timers] !== undefined) clearTimeout(w[timers] as never)
  const old = document.getElementById(args.id)
  if (!old) return false
  old.remove()
  return true
}
