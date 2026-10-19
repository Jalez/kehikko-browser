/**
 * What may be shown, and how a typed address becomes one.
 *
 * Shared by the page (the address bar) and the server (every navigation, the
 * person's and an agent's). The server's copy is the one that decides: a page
 * or an agent can send anything, and only `http:`, `https:` and `about:blank`
 * are ever opened.
 */

export const BLANK = 'about:blank'

/** The longest address kept or opened. Longer is almost always a mistake or a payload. */
export const MAX_ADDRESS = 4096

export type Address = { ok: true; url: string } | { ok: false; why: string }

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$|\?|#)/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i
/* host:port with no scheme parses as a scheme ("localhost:3000" → protocol "localhost:"). */
const HOST_PORT = /^[a-z0-9.-]+:\d+(\/|$|\?|#)/i

/** Whether an address that already parsed is one this module opens. */
export function allowedUrl(url: string): boolean {
  if (url === BLANK) return true
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * What a person typed, as an address to open, or why not.
 *
 * - `github.com/x` → `https://github.com/x`
 * - `localhost:5173` (and 127.x, [::1]) → `http://…`, since a dev server rarely speaks TLS
 * - `about:blank` stays itself
 * - anything with a scheme other than http(s) is refused, by name
 */
export function normaliseAddress(typed: string): Address {
  const raw = typed.trim()
  if (!raw) return { ok: false, why: 'There is no address to open.' }
  if (raw.length > MAX_ADDRESS) return { ok: false, why: `That address is longer than ${MAX_ADDRESS} characters.` }
  if (/\s/.test(raw)) return { ok: false, why: 'An address has no spaces in it.' }
  if (raw.toLowerCase() === BLANK) return { ok: true, url: BLANK }

  let candidate: string
  if (LOCAL.test(raw)) candidate = `http://${raw}`
  else if (HOST_PORT.test(raw)) candidate = `http://${raw}`
  else if (HAS_SCHEME.test(raw)) candidate = raw
  else candidate = `https://${raw}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, why: `"${raw.slice(0, 80)}" is not an address.` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, why: `This browser opens http and https addresses only, not ${parsed.protocol.replace(/:$/, '')}.` }
  }
  if (!parsed.hostname) return { ok: false, why: `"${raw.slice(0, 80)}" names no host.` }
  /* A bare word ("issues") would become https://issues/, which is never meant. */
  if (!HAS_SCHEME.test(raw) && !parsed.hostname.includes('.') && !LOCAL.test(raw) && !HOST_PORT.test(raw)) {
    return { ok: false, why: `"${raw.slice(0, 80)}" is not an address. Type the whole host, like github.com.` }
  }
  return { ok: true, url: parsed.href }
}

/** A short label for an address: the page title when there is one, else host and path. */
export function labelFor(url: string, title: string | null | undefined, max = 48): string {
  const said = (title ?? '').replace(/\s+/g, ' ').trim()
  let text = said
  if (!text) {
    try {
      const parsed = new URL(url)
      text = `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
    } catch {
      text = url
    }
  }
  if (!text) text = 'Untitled'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
