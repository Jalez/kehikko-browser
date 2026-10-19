import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GlobalRegistrator } from '@happy-dom/global-registrator'

/* A document for the tests that render one; the pure tests do not care. */
GlobalRegistrator.register()

/* No test launches a browser, and none could reach the real profile if one did. */
process.env.KEHIKOT_BROWSER_PROFILE = mkdtempSync(join(tmpdir(), 'kehikko-browser-profile-'))

/* The host, stood in for: a folder that exists on disk is a project, any other is not.
   A test that wants a former path or no host at all replaces ASK.options. */
import { existsSync, statSync } from 'node:fs'

import { ASK } from '../project.ts'

export const hostStub = (async (url: string) => {
  const path = new URL(url).searchParams.get('path') ?? ''
  const here = existsSync(path) && statSync(path).isDirectory()
  return new Response(JSON.stringify({ ok: true, project: here, ...(here ? { id: 'proj-test0001' } : {}) }), { status: 200 })
}) as unknown as typeof fetch
export const DEFAULT_ASK = { env: { KEHIKOT_ORIGINS: 'http://127.0.0.1:4170' }, fetch: hostStub }
ASK.options = DEFAULT_ASK
