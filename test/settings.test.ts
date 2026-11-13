import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SETTINGS_PATH, settingsDeclarationSchema } from 'kehikot-module-protocol'

import { AUTOMATIC } from '../browser/keep.ts'
import { MANIFEST, TICKET, answer } from '../doors.ts'
import { FIELDS, keepSettingsOf } from '../settings-fields.ts'
import { keepSettingsFor, suggestsIn } from '../settings.ts'

const project = mkdtempSync(join(tmpdir(), 'kehikko-browser-settings-'))
afterAll(() => rmSync(project, { recursive: true, force: true }))

const set = (key: string, value: unknown) => answer('POST', SETTINGS_PATH, new URLSearchParams(), { project, key, value, by: 'person' }, TICKET)

describe('Browser’s settings', () => {
  test('are declared, each starts at Automatic (or on), and says in one sentence what Automatic does', () => {
    expect(settingsDeclarationSchema.parse(MANIFEST.declares.settings)).toEqual(FIELDS)
    for (const field of FIELDS) {
      expect(field.default === 'auto' || field.default === true).toBe(true)
      expect(field.description.length).toBeGreaterThan(20)
      if (field.type === 'choice') expect(field.choices?.[0]).toEqual({ value: 'auto', label: 'Automatic' })
    }
  })

  test('none is needed: a project with no settings file keeps pages the Automatic way', () => {
    expect(keepSettingsFor(project)).toEqual(AUTOMATIC)
    expect(keepSettingsFor(null)).toEqual(AUTOMATIC)
    expect(suggestsIn(project)).toBe(true)
  })

  test('a setting overrides Automatic; Automatic again restores it', async () => {
    expect(((await set('keepPages', '12'))?.body as { outcome: string }).outcome).toBe('saved')
    expect((await set('refresh', 'never'))?.status).toBe(200)
    expect((await set('checkFirst', 'full'))?.status).toBe(200)
    expect((await set('keepMemory', '2048'))?.status).toBe(200)
    expect(keepSettingsFor(project)).toEqual({ pages: 12, memoryMb: 2048, refresh: 'never', revalidate: 'full' })
    for (const key of ['keepPages', 'refresh', 'checkFirst', 'keepMemory']) await set(key, 'auto')
    expect(keepSettingsFor(project)).toEqual(AUTOMATIC)
  })

  test('a value not offered is refused, and suggestions can be turned off', async () => {
    expect(((await set('keepPages', '9999'))?.body as { outcome: string }).outcome).toBe('refused')
    await set('suggest', false)
    expect(suggestsIn(project)).toBe(false)
    const got = await answer('GET', SETTINGS_PATH, new URLSearchParams({ project }), null, null)
    expect((got?.body as { values: Record<string, unknown> }).values).toMatchObject({ suggest: false, keepPages: 'auto' })
    const offered = await answer('GET', '/api/suggest', new URLSearchParams({ projectPath: project, key: 'epic:e' }), null, null)
    expect(offered?.body).toMatchObject({ off: true, nearby: [], servers: [] })
  })

  test('anything not understood reads as Automatic', () => {
    expect(keepSettingsOf({ keepPages: 'lots', refresh: 7, checkFirst: 'maybe' })).toEqual(AUTOMATIC)
  })
})
