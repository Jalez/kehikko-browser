#!/usr/bin/env bun
import { run } from 'kehikot-module-protocol/run'

import { ENGINE, bindPort } from './browser/index.ts'
import { streamSockets } from './browser/stream.ts'
import { BUILD, MANIFEST, TICKET, answer, ours, servingAt } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * This module over its BUILT page (`bun run build`), on the same doors, the
 * same port and the same stream. `run.sh` starts this when `dist/` carries a
 * stamp of the commit checked out, and Vite otherwise.
 *
 * Nothing this module says is decided here. The doors are `answer` in
 * `doors.ts`, mounted by the protocol's `run` exactly as `doors()` mounts them
 * on Vite, with the same `ours`. The stream is `streamSession` in
 * `browser/stream.ts`, on Bun's WebSocket here and on `ws` there, fenced by
 * the protocol's `socketFence` (the same rule as `fenced`) and by the ticket
 * in its first message. The browser is the same `ENGINE`, driven by the same
 * playwright-core, which works under Bun as it does under Node.
 *
 * A build that is not this checkout's is never served: `run` answers the page
 * with a 503 saying which commit each is, and the command to run.
 */

const stream = streamSockets(ENGINE, TICKET, (line) => console.log(line))

const running = await run({
  id: ID,
  prefer: PREFERRED_PORT,
  dir: import.meta.dirname,
  manifest: MANIFEST,
  answer,
  build: BUILD,
  ticket: TICKET,
  ours,
  sockets: stream.sockets,
  onStop: stream.stopAll,
})

/* What `stream()` in vite.config.ts does once Vite is listening: the DevTools
   endpoint sits relative to the port actually bound, and the skills name the
   origin this process really serves on. */
bindPort(running.port)
servingAt(running.origin)
