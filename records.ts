import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { kehikotDir, moduleDir } from 'kehikot-module-protocol'

import { ID } from './manifest.ts'
import { escapes, escapesAny, projectRoot, type Result } from './store.ts'

/**
 * The folders the skills leave behind, under this module's own folder in the project:
 *
 *   <project>/.kehikot/browser/walkthroughs/<id>/   (src/lib/runs.ts)
 *   <project>/.kehikot/browser/repros/<id>/          (src/lib/runs.ts)
 *   <project>/.kehikot/browser/shots/<ref>/          (src/lib/shots.ts)
 *
 * Every level is realpath'd and checked to stay inside the project before anything is read or
 * written, as `store.ts` does for the two JSON files; a `.kehikot` or an area that is a symlink out
 * of the project is refused rather than followed. Names come from the pure modules' own checks
 * (`isRunId`, `refSlug`, `isShotFile`) and nothing else.
 */

export const AREAS = ['walkthroughs', 'repros', 'shots'] as const
export type Area = (typeof AREAS)[number]

const NAME = /^[a-z0-9][a-z0-9-]{0,99}$/
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/

/** One record's folder: `<project>/.kehikot/browser/<area>/<name>`, checked. `make` creates it first. */
export function recordDir(projectPath: string | null | undefined, area: Area, name: string, make: boolean): Result<string> {
  if (!NAME.test(name)) return { ok: false, error: `"${name.slice(0, 40)}" is not a record's name.` }
  const root = projectRoot(projectPath)
  if (!root.ok) return root
  const mine = moduleDir(root.value, ID)!
  const levels = [kehikotDir(root.value)!, mine, join(mine, area), join(mine, area, name)]
  const escaped = escapesAny(root.value, levels)
  if (escaped) return { ok: false, error: escaped }
  const dir = levels[3]!
  if (make) {
    mkdirSync(dir, { recursive: true })
    const after = escapesAny(root.value, levels)
    if (after) return { ok: false, error: after }
  }
  return { ok: true, value: dir }
}

/** The names of an area's records, newest first (ids and slugs sort by time and by name). */
export function listRecords(projectPath: string | null | undefined, area: Area): Result<string[]> {
  const root = projectRoot(projectPath)
  if (!root.ok) return root
  const dir = join(moduleDir(root.value, ID)!, area)
  if (!existsSync(dir)) return { ok: true, value: [] }
  const escaped = escapes(root.value, dir)
  if (escaped) return { ok: false, error: escaped }
  return { ok: true, value: readdirSync(dir).filter((name) => NAME.test(name)).sort().reverse() }
}

function fileIn(dir: string, file: string, projectPath: string | null | undefined): Result<string> {
  if (!FILE.test(file)) return { ok: false, error: `"${file.slice(0, 40)}" is not a file name.` }
  const path = join(dir, file)
  if (existsSync(path)) {
    const root = projectRoot(projectPath)
    if (!root.ok) return root
    const escaped = escapes(root.value, path)
    if (escaped) return { ok: false, error: escaped }
  }
  return { ok: true, value: path }
}

export function readRecordJson(projectPath: string | null | undefined, area: Area, name: string, file: string): Result<unknown> {
  const dir = recordDir(projectPath, area, name, false)
  if (!dir.ok) return dir
  const path = fileIn(dir.value, file, projectPath)
  if (!path.ok) return path
  if (!existsSync(path.value)) return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(readFileSync(path.value, 'utf8')) }
  } catch {
    return { ok: false, error: `${path.value} is not readable JSON. Nothing was changed; fix or remove the file.` }
  }
}

/** Write one file into a record's folder: to a temporary name, then renamed. */
export function writeRecordFile(projectPath: string | null | undefined, area: Area, name: string, file: string, data: string | Buffer): Result<string> {
  const dir = recordDir(projectPath, area, name, true)
  if (!dir.ok) return dir
  const path = fileIn(dir.value, file, projectPath)
  if (!path.ok) return path
  const temporary = `${path.value}.${process.pid}.tmp`
  writeFileSync(temporary, data)
  renameSync(temporary, path.value)
  return { ok: true, value: path.value }
}

export function writeRecordJson(projectPath: string | null | undefined, area: Area, name: string, file: string, value: unknown): Result<string> {
  return writeRecordFile(projectPath, area, name, file, `${JSON.stringify(value, null, 2)}\n`)
}

/** A picture from a record's folder, for the page. Only `.png`. */
export function readRecordPng(projectPath: string | null | undefined, area: Area, name: string, file: string): Result<Buffer | null> {
  if (!file.endsWith('.png')) return { ok: false, error: 'Only pictures are read here.' }
  const dir = recordDir(projectPath, area, name, false)
  if (!dir.ok) return dir
  const path = fileIn(dir.value, file, projectPath)
  if (!path.ok) return path
  return { ok: true, value: existsSync(path.value) ? readFileSync(path.value) : null }
}

/** A sub-folder of a record (`post/`), made and checked. */
export function recordSubdir(projectPath: string | null | undefined, area: Area, name: string, sub: string): Result<string> {
  const dir = recordDir(projectPath, area, name, true)
  if (!dir.ok) return dir
  if (!NAME.test(sub)) return { ok: false, error: 'not a folder name' }
  const path = join(dir.value, sub)
  mkdirSync(path, { recursive: true })
  const root = projectRoot(projectPath)
  if (!root.ok) return root
  const escaped = escapes(root.value, path)
  return escaped ? { ok: false, error: escaped } : { ok: true, value: path }
}
