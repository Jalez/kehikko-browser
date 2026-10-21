import { ConsoleBuffer } from '../browser/console.ts'
import type { CaptureAsk, Engine } from '../browser/engine.ts'

/** An engine with no browser: a console buffer, a page address, and pictures that are a few bytes saying what they are. */
export function fakeEngine(url = 'https://app.test/start') {
  const console = new ConsoleBuffer()
  const captured: CaptureAsk[] = []
  const shown: [string, string | null][] = []
  const navigated: string[] = []
  const engine = {
    console,
    state: () => ({ url, title: 'App', canBack: false, canForward: false, loading: false }),
    getStatus: () => ({ state: 'ready', why: null }),
    screenshot: async () => Buffer.from(`png of ${url}`),
    capture: async (ask: CaptureAsk) => {
      captured.push(ask)
      return { png: Buffer.from(`png of ${ask.url} ${ask.width}x${ask.height} ${ask.theme}`), url: ask.url, title: 'App' }
    },
    navigate: async (to: string) => {
      navigated.push(to)
      return { url: to, title: 'Page', canBack: true, canForward: false, loading: false }
    },
    show: (view: string, id: string | null) => {
      shown.push([view, id])
      return 1
    },
  }
  return { engine: engine as unknown as Engine, console, captured, shown, navigated }
}
