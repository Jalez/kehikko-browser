import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

/**
 * The project's own local dev servers that are running now, for the empty space to offer.
 *
 * Only ports the PROJECT names are looked at: `--port N` / `PORT=N` in its package.json scripts, a
 * `port: N` in its Vite, Astro or Next config, `PORT=N` in its `.env` files, and the framework's own
 * default when it uses one and names none. Each is asked whether anything answers on this machine's
 * loopback (127.0.0.1 and ::1), once, briefly. Nothing else is scanned: another program's ports are
 * never looked at, and nothing is sent to what answers.
 */

export interface DevServer {
  url: string
  /** Where the port was read, in a person's words: "the dev script", "vite.config.ts". */
  from: string
}

/** At most this many ports are asked about, so a strange project cannot make this a scan. */
export const MAX_PORTS = 8

const CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'astro.config.mjs', 'astro.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.ts']
const DEFAULTS: [dependency: string, port: number][] = [
  ['vite', 5173],
  ['astro', 4321],
  ['next', 3000],
  ['@sveltejs/kit', 5173],
]

const goodPort = (n: number) => Number.isInteger(n) && n > 1024 && n < 65536

/** The ports a project names, with where each was read. Pure on what it is given: reads only these files. */
export function namedPorts(projectPath: string, read: (file: string) => string | null = readText): { port: number; from: string }[] {
  const found = new Map<number, string>()
  const add = (n: number, from: string) => {
    if (goodPort(n) && !found.has(n) && found.size < MAX_PORTS) found.set(n, from)
  }
  const pkgText = read(join(projectPath, 'package.json'))
  let pkg: { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> } = {}
  try {
    pkg = pkgText ? JSON.parse(pkgText) : {}
  } catch {
    pkg = {}
  }
  for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
    if (typeof script !== 'string') continue
    for (const m of script.matchAll(/(?:--port[= ]|-p |PORT=)(\d{2,5})\b/g)) add(Number(m[1]), `the ${name} script`)
  }
  for (const config of CONFIGS) {
    const text = read(join(projectPath, config))
    if (!text) continue
    for (const m of text.matchAll(/\bport\s*:\s*(\d{2,5})\b/g)) add(Number(m[1]), config)
  }
  for (const env of envFiles(projectPath)) {
    const text = read(join(projectPath, env))
    if (!text) continue
    for (const m of text.matchAll(/^\s*(?:[A-Z_]*_)?PORT\s*=\s*(\d{2,5})\s*$/gm)) add(Number(m[1]), env)
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  for (const [dep, port] of DEFAULTS) if (dep in deps) add(port, `${dep}'s usual port`)
  return [...found].map(([port, from]) => ({ port, from }))
}

function envFiles(projectPath: string): string[] {
  try {
    return readdirSync(projectPath).filter((name) => name === '.env' || /^\.env\.[a-z.]+$/.test(name)).slice(0, 4)
  } catch {
    return []
  }
}

function readText(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8').slice(0, 200_000) : null
  } catch {
    return null
  }
}

/** Whether something answers on this machine's loopback at `port`, within `ms`. Connects and hangs up; sends nothing. */
export function answers(port: number, host: string, ms = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host })
    const done = (yes: boolean) => {
      socket.destroy()
      resolve(yes)
    }
    socket.setTimeout(ms, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** The project's named ports that answer now, as addresses to open. `skip` leaves out this module's own ports. */
export async function runningDevServers(projectPath: string, skip: readonly number[] = [], ask = answers): Promise<DevServer[]> {
  const named = namedPorts(projectPath).filter((one) => !skip.includes(one.port))
  const up = await Promise.all(named.map(async (one) => ((await ask(one.port, '127.0.0.1')) || (await ask(one.port, '::1')) ? one : null)))
  return up.filter((one): one is { port: number; from: string } => one !== null).map((one) => ({ url: `http://localhost:${one.port}/`, from: one.from }))
}
