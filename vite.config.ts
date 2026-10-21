import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { doors, originFor, serves } from 'kehikot-module-protocol/serve'
import { defineConfig, type Plugin } from 'vite'

import { ENGINE, bindPort } from './browser/index.ts'
import { serveStream } from './browser/stream.ts'
import { BUILD, MANIFEST, TICKET, answer, servingAt } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'
import { isSkillPath } from './skills.ts'

/**
 * The stream socket, beside the doors and on the one server that serves the
 * page: a module is ONE ORIGIN, and a socket on a second port would be
 * cross-origin to the page and outside the fence in `browser/stream.ts`.
 * Attached once the server is listening, because the fence and the DevTools
 * port both need the port it actually BOUND, which `serves()` may have moved.
 */
function stream(): Plugin {
  return {
    name: 'browser-stream',
    apply: 'serve',
    configureServer(server) {
      const http = server.httpServer
      if (!http) {
        server.config.logger.error('browser: no HTTP server to attach the stream to; the container will draw no page.')
        return
      }
      http.once('listening', () => {
        const address = http.address()
        const port = address && typeof address === 'object' ? address.port : PREFERRED_PORT
        bindPort(port)
        /* The skills name the origin they reach this module at: the one it really bound. */
        servingAt(originFor(port))
        serveStream(http as never, port, ENGINE, TICKET, (line) => server.config.logger.info(line))
      })
      http.once('close', () => void ENGINE.close())
    },
  }
}

/**
 * - `serves()` first: it claims the port from PREFERRED_PORT (or $PORT from a
 *   host) and keeps the registration true.
 * - `doors()` serves the manifest, `/app` with the write ticket printed into it,
 *   and `/healthz`, `/mcp`, `/api/*` and each skill's SKILL.md
 *   (`/kehikot/skills/<name>.md`) through `answer` in doors.ts.
 * - `host: '127.0.0.1'` and `cors: false`: nothing off this machine reaches the
 *   page, the doors or the stream, and no other origin reads the ticket.
 */
export default defineConfig({
  base: './',
  plugins: [
    serves({ id: ID, prefer: PREFERRED_PORT }),
    stream(),
    doors({
      manifest: MANIFEST,
      answer,
      build: BUILD,
      page: { title: 'Browser', ticket: TICKET },
      ours: (path) => path === '/healthz' || path === '/mcp' || path.startsWith('/api/') || isSkillPath(path),
    }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: { host: '127.0.0.1', cors: false },
})
