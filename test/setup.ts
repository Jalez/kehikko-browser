import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GlobalRegistrator } from '@happy-dom/global-registrator'

/* A document for the tests that render one; the pure tests do not care. */
GlobalRegistrator.register()

/* No test launches a browser, and none could reach the real profile if one did. */
process.env.KEHIKOT_BROWSER_PROFILE = mkdtempSync(join(tmpdir(), 'kehikko-browser-profile-'))
