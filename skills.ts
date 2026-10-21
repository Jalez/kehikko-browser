import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { skillPath, skillTextIssue, type ModuleSkill } from 'kehikot-module-protocol'
import { originFor, preferred } from 'kehikot-module-protocol/serve'

import { PREFERRED_PORT } from './manifest.ts'

/**
 * The Claude Code skills this module offers (protocol 2.5.0, `declares.skills`). Every one starts
 * with "browser": `/browser-walkthrough`, `/browser-before-after`, `/browser-repro`, `/browser-open`.
 *
 * Each is ONE file, `plugin/skills/<name>/SKILL.md`, which is a template: where it says
 * `{{origin}}` this module writes the origin it is really serving on (`serveFrom`, from the port
 * Vite ended up bound to), and where it says `{{version}}` the skill's version. The same scheme as
 * the Claude and Factory modules' skills.
 *
 *  - **A host** asks for the text at `skillPath(name)`, shows it, and installs it on the person's
 *    press (Kehikot's Skills window). This module installs nothing.
 *  - **A session started for one process** is given them with `--plugin-dir <sessionPlugin()>`: a
 *    copy of `plugin/` with every text filled in, in this user's temporary folder. That is the
 *    flag the Claude module passes its own plugin with; the plugin's skills are then listed as
 *    `kehikot-browser:<name>` and the bare `/<name>` runs them.
 *
 * The version is the first twelve hex digits of the sha256 of the text with the origin filled in
 * and `{{version}}` still unfilled, so a changed template or a moved port makes an installed copy
 * "outdated" and the host's sync brings it level.
 */

export const PLUGIN_DIR = join(import.meta.dirname, 'plugin')
export const ORIGIN_SLOT = '{{origin}}'
export const VERSION_SLOT = '{{version}}'

export const OFFERED = [
  {
    name: 'browser-walkthrough',
    summary:
      'Type /browser-walkthrough <goal>: an agent does it in the Browser while you watch, outlining each element first and pausing at checkpoints.',
  },
  {
    name: 'browser-before-after',
    summary:
      'Type /browser-before-after on a UI change: its screens on main and on its branch, light and dark, side by side; posted to the PR or MR only on your OK.',
  },
  {
    name: 'browser-repro',
    summary:
      'Type /browser-repro <issue>: its steps followed in the Browser with screenshots, console errors and failed requests, and a plain answer: reproduced or not.',
  },
  {
    name: 'browser-open',
    summary:
      'Type /browser-open [what]: the picked issue, PR or MR on its forge, or the right documentation page for what you are working on.',
  },
] as const

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

let served = originFor(preferred(PREFERRED_PORT))

/** Say the origin this process is really on (`http://127.0.0.1:<port>`). Refuses anything else. */
export function serveFrom(origin: string): void {
  if (!LOOPBACK_ORIGIN.test(origin)) throw new Error(`not a loopback origin: ${JSON.stringify(origin)}`)
  served = origin
}

export const servedOrigin = (): string => served

export function skillTemplate(name: string): string | null {
  if (!OFFERED.some((one) => one.name === name)) return null
  return readFileSync(join(PLUGIN_DIR, 'skills', name, 'SKILL.md'), 'utf8')
}

const sha12 = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** A template filled in for one origin: the text as served, and its version. */
export function fill(template: string, origin: string): { text: string; version: string } {
  const placed = template.replaceAll(ORIGIN_SLOT, origin)
  const version = sha12(placed)
  return { text: placed.replaceAll(VERSION_SLOT, version), version }
}

export function skillText(name: string, origin = served): string | null {
  const template = skillTemplate(name)
  return template === null ? null : fill(template, origin).text
}

export function skillDeclarations(origin = served): ModuleSkill[] {
  return OFFERED.map((one) => ({ name: one.name, summary: one.summary, version: fill(skillTemplate(one.name)!, origin).version }))
}

/** The skill a path asks for, or null for a path that is not one of ours (or text that would not pass). */
export function skillAt(path: string): { name: string; text: string } | null {
  for (const one of OFFERED) {
    if (skillPath(one.name) !== path) continue
    const text = skillText(one.name)
    if (text === null || skillTextIssue(text, one.name)) return null
    return { name: one.name, text }
  }
  return null
}

export const isSkillPath = (path: string): boolean => OFFERED.some((one) => skillPath(one.name) === path)

/**
 * The plugin folder a session is given with `--plugin-dir`: `plugin.json` as kept, and each skill
 * filled in for `origin`. One folder per set of versions, in this user's temporary folder (0700),
 * written once and then reused. Nothing is written into `~/.claude`.
 */
export function sessionPlugin(origin = served, base = tmpdir()): string {
  const skills = skillDeclarations(origin)
  const dir = join(base, `kehikot-browser-plugin-${sha12(skills.map((one) => `${one.name}@${one.version}`).join(','))}`)
  const manifest = join(dir, '.claude-plugin', 'plugin.json')
  if (existsSync(manifest)) return dir
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true, mode: 0o700 })
  for (const one of skills) {
    mkdirSync(join(dir, 'skills', one.name), { recursive: true, mode: 0o700 })
    writeFileSync(join(dir, 'skills', one.name, 'SKILL.md'), skillText(one.name, origin)!, { mode: 0o600 })
  }
  /* Last, so a folder with its plugin.json is a whole one. */
  writeFileSync(manifest, readFileSync(join(PLUGIN_DIR, '.claude-plugin', 'plugin.json')), { mode: 0o600 })
  return dir
}
