import { PREFERRED_PORT } from '../manifest.ts'
import { sweepDevtoolsProfiles } from './devtools.ts'
import { Engine } from './engine.ts'

/**
 * The one browser this process runs. Its DevTools endpoint is placed relative
 * to the port this module actually bound, which only the server knows once it
 * is listening: both servers say it through `serving`.
 */
let bound = 0

export function bindPort(port: number): void {
  bound = port
}

const log = (line: string) => console.log(line)

export const ENGINE = new Engine(() => bound || Number(process.env.PORT) || PREFERRED_PORT, log)

/**
 * What both servers do once they are listening: say the port they bound, and
 * remove the DevTools profiles an earlier run of this module left behind.
 */
export function serving(port: number): void {
  bindPort(port)
  sweepDevtoolsProfiles(log)
}

/**
 * How long a stop waits for Chrome to close. Under the protocol's `run` cap (2.5 s) and the host's
 * 3 s quit grace, after which the process group is killed. Chrome takes tens of milliseconds to close
 * with what it has to write; this is for one that hangs.
 */
export const STOP_WITHIN_MS = 2000

/**
 * A stop, once, whoever asks: the browser is closed (asked to quit, which is when Chrome writes its
 * cookies and storage), for at most `within` ms, and then the DevTools window's profile is removed,
 * whether or not it closed in time. Nothing starts the browser after (`Engine.end`).
 */
export function stopperFor(
  engine: Pick<Engine, 'end' | 'forgetDevtools'>,
  within: number = STOP_WITHIN_MS,
  say: (line: string) => void = log,
): () => Promise<void> {
  let stopping: Promise<void> | null = null
  return () => {
    stopping ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), within)
      })
      const said = await Promise.race([engine.end().then(() => 'done' as const, (error: unknown) => error), late])
      clearTimeout(timer)
      if (said === 'late') say(`browser: the browser did not close within ${within} ms; stopping anyway.`)
      else if (said !== 'done') say(`browser: closing the browser failed: ${said instanceof Error ? said.message : String(said)}`)
      engine.forgetDevtools()
    })()
    return stopping
  }
}

/**
 * This process's stop. The built server hands it to the protocol's `run` as `onStop`, which waits
 * for it; Vite waits for it in `closeBundle` (vite.config.ts), since its own SIGTERM handler exits
 * once the server has closed. The signal handlers here wait for the same promise.
 */
export const stopEngine = stopperFor(ENGINE)

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    void stopEngine().finally(() => process.exit(0))
  })
}
process.once('beforeExit', () => void stopEngine())
/* An exit nobody waited for (a stop cut short): nothing can be awaited, but the profile can go. */
process.once('exit', () => ENGINE.forgetDevtools())
