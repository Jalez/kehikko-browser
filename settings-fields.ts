import { settingsDeclarationSchema, type SettingsDeclaration } from 'kehikot-module-protocol'

import type { KeepSettings } from './browser/keep.ts'

/**
 * Browser's settings, drawn by the host as one form (`declares.settings`, protocol 2.15.0) and kept in
 * the project (`.kehikot/browser/settings.json`, `settings.ts`). None is needed: each starts at
 * Automatic, which adapts to the machine, and says in one sentence what it does. They are there to
 * tinker with. Pure: the manifest reads it.
 */

export const SETTINGS_FILE = '.kehikot/browser/settings.json'

const AUTO = { value: 'auto', label: 'Automatic' }

export const FIELDS: SettingsDeclaration = settingsDeclarationSchema.parse([
  {
    key: 'keepPages',
    label: 'Pages kept ready in the background',
    type: 'choice',
    default: 'auto',
    choices: [AUTO, ...[0, 2, 4, 6, 8, 12].map((n) => ({ value: String(n), label: n === 0 ? 'None' : String(n) }))],
    description: 'Automatic keeps the 6 pages you used most recently ready to show at once, 3 when your computer is short of memory, and none when it is very short.',
  },
  {
    key: 'keepMemory',
    label: 'Memory for pages kept ready',
    type: 'choice',
    default: 'auto',
    choices: [AUTO, ...[256, 512, 1024, 2048, 4096].map((mb) => ({ value: String(mb), label: mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB` }))],
    description: 'Automatic uses at most a tenth of your computer’s memory and never more than 1 GB, half of that when memory is short. Pages kept ready are paused, so they use no processor.',
  },
  {
    key: 'refresh',
    label: 'Refresh pages kept ready',
    type: 'choice',
    default: 'auto',
    choices: [AUTO, ...[5, 15, 30, 60].map((min) => ({ value: String(min), label: `After ${min} minutes away` })), { value: 'never', label: 'Never' }],
    description: 'Automatic refreshes a page you come back to when the site says it changed, or after 15 minutes away when the site does not say. Out of sight, and never over something you typed.',
  },
  {
    key: 'checkFirst',
    label: 'How a page is refreshed',
    type: 'choice',
    default: 'auto',
    choices: [AUTO, { value: 'full', label: 'Always load it again' }],
    description: 'Automatic asks the site whether the page changed and loads it again only then, which is quicker and lighter.',
  },
  {
    key: 'suggest',
    label: 'Suggest pages in an empty space',
    type: 'boolean',
    default: true,
    description: 'A space with nothing open offers the pages used near it, the project’s running dev servers and its recent pages.',
  },
])

export type Values = Record<string, unknown>

const count = (value: unknown): 'auto' | number => (value === 'auto' || typeof value !== 'string' || !/^\d+$/.test(value) ? 'auto' : Number(value))

/** The settings, as the keeper reads them. Anything not understood is Automatic. */
export function keepSettingsOf(values: Values): KeepSettings {
  return {
    pages: count(values.keepPages),
    memoryMb: count(values.keepMemory),
    refresh: values.refresh === 'never' ? 'never' : count(values.refresh),
    revalidate: values.checkFirst === 'full' ? 'full' : 'auto',
  }
}

