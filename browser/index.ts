import { PREFERRED_PORT } from '../manifest.ts'
import { Engine } from './engine.ts'

/**
 * The one browser this process runs. Its DevTools endpoint is placed relative
 * to the port this module actually bound, which only the server knows once it
 * is listening: `vite.config.ts` says it through `bindPort`.
 */
let bound = 0

export function bindPort(port: number): void {
  bound = port
}

export const ENGINE = new Engine(
  () => bound || Number(process.env.PORT) || PREFERRED_PORT,
  (line) => console.log(line),
)

let closing = false
async function shut(): Promise<void> {
  if (closing) return
  closing = true
  await ENGINE.close()
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    void shut().finally(() => process.exit(0))
  })
}
process.once('beforeExit', () => void shut())
