import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:net'

import { freePortFrom, portFree } from '../browser/engine.ts'

/* The DevTools port was probed on 127.0.0.1 only: a port another program held on [::] looked free. */

const held: Server[] = []
afterEach(async () => {
  await Promise.all(held.splice(0).map((one) => new Promise((r) => one.close(r))))
})

function hold(host: string, ipv6Only = false): Promise<number | null> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(null))
    server.listen({ port: 0, host, ...(ipv6Only ? { ipv6Only } : {}) }, () => {
      held.push(server)
      resolve((server.address() as { port: number }).port)
    })
  })
}

describe('the DevTools port', () => {
  test('a port held on [::] alone is not free, and is not chosen', async () => {
    const port = await hold('::', true)
    if (port === null) return // no IPv6 on this machine: nothing to hold there
    expect(await portFree(port)).toBe(false)
    expect(await freePortFrom(port)).not.toBe(port)
  })

  test('a port held on 0.0.0.0, or on 127.0.0.1, is not free either', async () => {
    for (const host of ['0.0.0.0', '127.0.0.1']) {
      const port = await hold(host)
      expect(port).not.toBeNull()
      expect(await portFree(port!)).toBe(false)
    }
  })

  test('a port nothing holds is free', async () => {
    const port = await hold('127.0.0.1')
    await new Promise((r) => held.pop()!.close(r))
    expect(await portFree(port!)).toBe(true)
  })

  test('an address the machine lacks is skipped, not taken for the port being held', async () => {
    const port = await hold('127.0.0.1')
    await new Promise((r) => held.pop()!.close(r))
    expect(await portFree(port!, ['127.0.0.1', '192.0.2.1'])).toBe(true)
  })
})
