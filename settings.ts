import { settingsValues } from 'kehikot-module-protocol'

import { AUTOMATIC, type KeepSettings } from './browser/keep.ts'
import { FIELDS, keepSettingsOf, type Values } from './settings-fields.ts'
import { readData, writeData } from './store.ts'

/** Browser's settings, read and written in the project. The fields are `settings-fields.ts`. */

export function readValues(projectPath: string | null | undefined): { values: Values; problem?: string } {
  const read = readData(projectPath, 'settings')
  if (!read.ok) return { values: settingsValues(FIELDS, {}), problem: read.error }
  const raw = read.value && typeof read.value === 'object' && !Array.isArray(read.value) ? (read.value as Values) : {}
  return { values: settingsValues(FIELDS, raw) }
}

/** One checked change written, every other key kept. A sentence when it was not written. */
export function writeValue(projectPath: string | null | undefined, key: string, value: unknown): string | null {
  const read = readData(projectPath, 'settings')
  if (!read.ok) return read.error
  const raw = read.value && typeof read.value === 'object' && !Array.isArray(read.value) ? (read.value as Values) : {}
  const written = writeData(projectPath, 'settings', { ...raw, [key]: value })
  return written.ok ? null : written.error
}

export function keepSettingsFor(projectPath: string | null | undefined): KeepSettings {
  return projectPath ? keepSettingsOf(readValues(projectPath).values) : AUTOMATIC
}

export function suggestsIn(projectPath: string | null | undefined): boolean {
  return readValues(projectPath).values.suggest !== false
}
