import type { Repo } from './forge.ts'

/**
 * `/browser-before-after`: each affected screen of a change captured on `main` and on the change's
 * branch, at the same viewport sizes, in light and dark, kept in the project:
 *
 *   <project>/.kehikot/browser/shots/<ref>/shots.json
 *   <project>/.kehikot/browser/shots/<ref>/<screen>--<width>x<height>--<theme>--before.png
 *   <project>/.kehikot/browser/shots/<ref>/<screen>--<width>x<height>--<theme>--after.png
 *   <project>/.kehikot/browser/shots/<ref>/post/…   (only once the person said OK to posting)
 *
 * `<ref>` is the ref made safe as a folder name (`gh#12` → `gh-12`).
 *
 * ## Nothing is posted without the person's OK
 *
 * Uploading the pictures into the pull or merge request's description is the person's to allow,
 * and they allow it in one of two ways, both theirs alone: typing `/browser-before-after post <ref>`
 * (the skill's `!` line records it before the model reads anything), or pressing "OK to post" in
 * Browser › View › Before and after (a write the page's ticket guards). No MCP tool can set it.
 * Until it is set, `postPlan` and `postBody` refuse, so an agent is never handed the commands.
 * Even then the commands are run through the person's own gh or glab, which Claude Code asks
 * them about: the skill does not pre-approve a write.
 */

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]
export const SIDES = ['before', 'after'] as const
export type Side = (typeof SIDES)[number]

export interface Viewport {
  width: number
  height: number
}

/** The sizes a screen is captured at when nobody says: a laptop and a phone. */
export const DEFAULT_VIEWPORTS: readonly Viewport[] = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]

export interface Screen {
  /** A short id, safe in a file name: `settings`, `issue-list`. */
  id: string
  name: string
  /** The path on the app (`/settings`), joined to each side's origin. */
  path: string
}

export interface Captured {
  screen: string
  width: number
  height: number
  theme: Theme
  side: Side
  file: string
  url: string
  at: string
}

export interface Approval {
  at: string
  /** `typed`: the person typed `/browser-before-after post`. `page`: they pressed OK to post. */
  via: 'typed' | 'page'
}

export interface ShotSet {
  version: 1
  ref: string
  title: string
  screens: Screen[]
  viewports: Viewport[]
  themes: Theme[]
  captured: Captured[]
  approved: Approval | null
  posted: { at: string; where: string } | null
  createdAt: string
}

export const LIMIT = { SCREENS: 12, VIEWPORTS: 4, NAME: 80, PATH: 300, TITLE: 200 } as const

/** A ref, or a branch, as a folder name: `gh#12` → `gh-12`, `gl:group/app!7` → `gl-group-app-7`. */
export function refSlug(ref: string): string | null {
  const slug = ref
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || null
}

const SCREEN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
export const isScreenId = (id: unknown): id is string => typeof id === 'string' && SCREEN_ID.test(id)

/** `settings--1280x800--dark--after.png` */
export function shotFile(shot: { screen: string; width: number; height: number; theme: Theme; side: Side }): string {
  return `${shot.screen}--${shot.width}x${shot.height}--${shot.theme}--${shot.side}.png`
}

const FILE = /^[a-z0-9][a-z0-9-]{0,39}--\d{2,4}x\d{2,4}--(light|dark)--(before|after)\.png$/
export const isShotFile = (name: unknown): name is string => typeof name === 'string' && FILE.test(name)

export function goodViewport(v: unknown): Viewport | null {
  if (!v || typeof v !== 'object') return null
  const { width, height } = v as { width?: unknown; height?: unknown }
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if ((width as number) < 200 || (width as number) > 3840 || (height as number) < 200 || (height as number) > 2400) return null
  return { width: width as number, height: height as number }
}

export function newSet(
  given: { ref: unknown; title?: unknown; screens: unknown; viewports?: unknown; themes?: unknown },
  now = new Date(),
): { ok: true; set: ShotSet } | { ok: false; why: string } {
  const ref = typeof given.ref === 'string' ? given.ref.trim().slice(0, 300) : ''
  if (!refSlug(ref)) return { ok: false, why: 'Say the change: its ref (gh#12, !7) or its branch.' }
  if (!Array.isArray(given.screens) || given.screens.length === 0) return { ok: false, why: 'Say the screens to capture, as the person confirmed them.' }
  if (given.screens.length > LIMIT.SCREENS) return { ok: false, why: `At most ${LIMIT.SCREENS} screens.` }
  const screens: Screen[] = []
  for (const raw of given.screens as unknown[]) {
    const one = (raw ?? {}) as { id?: unknown; name?: unknown; path?: unknown }
    const id = typeof one.id === 'string' ? one.id.trim().toLowerCase() : ''
    if (!isScreenId(id)) return { ok: false, why: `"${String(one.id).slice(0, 40)}" is not a screen id: lowercase letters, digits and dashes.` }
    if (screens.some((s) => s.id === id)) return { ok: false, why: `Two screens are called ${id}.` }
    const path = typeof one.path === 'string' ? one.path.trim() : ''
    if (!path.startsWith('/') || path.startsWith('//') || path.length > LIMIT.PATH) return { ok: false, why: `The path of ${id} is not a path on the app (it starts with one /).` }
    screens.push({ id, name: typeof one.name === 'string' && one.name.trim() ? one.name.trim().slice(0, LIMIT.NAME) : id, path })
  }
  let viewports = [...DEFAULT_VIEWPORTS]
  if (given.viewports !== undefined) {
    if (!Array.isArray(given.viewports) || !given.viewports.length || given.viewports.length > LIMIT.VIEWPORTS) {
      return { ok: false, why: `Say 1 to ${LIMIT.VIEWPORTS} viewport sizes.` }
    }
    const read = given.viewports.map(goodViewport)
    if (read.some((v) => !v)) return { ok: false, why: 'A viewport is a width of 200–3840 and a height of 200–2400 pixels.' }
    viewports = read as Viewport[]
  }
  let themes: Theme[] = [...THEMES]
  if (given.themes !== undefined) {
    if (!Array.isArray(given.themes) || !given.themes.length || given.themes.some((t) => !THEMES.includes(t as Theme))) {
      return { ok: false, why: 'Themes are light, dark, or both.' }
    }
    themes = [...new Set(given.themes as Theme[])]
  }
  return {
    ok: true,
    set: {
      version: 1,
      ref,
      title: typeof given.title === 'string' ? given.title.trim().slice(0, LIMIT.TITLE) : '',
      screens,
      viewports,
      themes,
      captured: [],
      approved: null,
      posted: null,
      createdAt: now.toISOString(),
    },
  }
}

export function readSet(raw: unknown): ShotSet | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<ShotSet>
  if (s.version !== 1 || typeof s.ref !== 'string' || !Array.isArray(s.screens) || !Array.isArray(s.captured)) return null
  return s as ShotSet
}

/** Every capture the set asks for, in the order they are best taken (one side's server at a time). */
export function wanted(set: ShotSet): { screen: Screen; viewport: Viewport; theme: Theme; side: Side; file: string }[] {
  const out: { screen: Screen; viewport: Viewport; theme: Theme; side: Side; file: string }[] = []
  for (const side of SIDES) {
    for (const screen of set.screens) {
      for (const viewport of set.viewports) {
        for (const theme of set.themes) out.push({ screen, viewport, theme, side, file: shotFile({ screen: screen.id, ...viewport, theme, side }) })
      }
    }
  }
  return out
}

/** Record one capture (replacing an earlier one of the same file). A capture the set did not ask for is refused. */
export function recordCapture(set: ShotSet, shot: Omit<Captured, 'file' | 'at'>, now = new Date()): { ok: true; set: ShotSet; file: string } | { ok: false; why: string } {
  if (!set.screens.some((s) => s.id === shot.screen)) return { ok: false, why: `${shot.screen} is not one of this set's screens: ${set.screens.map((s) => s.id).join(', ')}.` }
  if (!set.viewports.some((v) => v.width === shot.width && v.height === shot.height)) {
    return { ok: false, why: `${shot.width}×${shot.height} is not one of this set's sizes: ${set.viewports.map((v) => `${v.width}×${v.height}`).join(', ')}.` }
  }
  if (!set.themes.includes(shot.theme)) return { ok: false, why: `${shot.theme} is not one of this set's themes.` }
  const file = shotFile(shot)
  const captured = [...set.captured.filter((one) => one.file !== file), { ...shot, file, at: now.toISOString() }]
  /* A new picture is not the one the person said OK to: the OK goes with it. */
  return { ok: true, set: { ...set, captured, approved: null }, file }
}

export interface Pair {
  screen: Screen
  width: number
  height: number
  theme: Theme
  before: Captured | null
  after: Captured | null
}

/** Before and after side by side, one row per screen × size × theme, in the set's order. */
export function pairsOf(set: ShotSet): Pair[] {
  const out: Pair[] = []
  for (const screen of set.screens) {
    for (const viewport of set.viewports) {
      for (const theme of set.themes) {
        const find = (side: Side) => set.captured.find((c) => c.file === shotFile({ screen: screen.id, ...viewport, theme, side })) ?? null
        out.push({ screen, ...viewport, theme, before: find('before'), after: find('after') })
      }
    }
  }
  return out
}

export const missing = (set: ShotSet): string[] => wanted(set).filter((one) => !set.captured.some((c) => c.file === one.file)).map((one) => one.file)

/** Record the person's OK. Only the page's ticketed press and the skill's typed command reach this. */
export function approve(set: ShotSet, via: Approval['via'], now = new Date()): { ok: true; set: ShotSet } | { ok: false; why: string } {
  if (!set.captured.length) return { ok: false, why: 'There is nothing captured to post yet.' }
  return { ok: true, set: { ...set, approved: { at: now.toISOString(), via } } }
}

export const NOT_APPROVED =
  'The person has not said OK to posting these. Show them the pictures and ask; they say OK by typing /browser-before-after post <ref>, '
  + 'or by pressing "OK to post" in Browser › View › Before and after. Do not post them any other way.'

/** The branch GitHub pictures are kept on, so the change's own branch is never touched. */
export const SHOTS_BRANCH = 'kehikot-shots'

export const BLOCK_START = '<!-- kehikot:before-after -->'
export const BLOCK_END = '<!-- /kehikot:before-after -->'

/** Where one picture is kept on the forge, once uploaded. */
export function githubPath(set: ShotSet, file: string, stamp: string): string {
  return `${refSlug(set.ref)}/${stamp}/${file}`
}

export function githubImage(repo: Repo, path: string): string {
  return `https://github.com/${repo.path}/raw/${SHOTS_BRANCH}/${path}`
}

/**
 * The markdown that goes in the description: a `| Before | After |` table per screen, each image's
 * alt text starting "Before" or "After", which is how Review's Before / after view labels them.
 * `urlOf` is each picture's address on the forge.
 */
export function descriptionBlock(set: ShotSet, urlOf: (file: string) => string | null): string {
  const lines = [BLOCK_START, '### Before and after', '']
  for (const pair of pairsOf(set)) {
    if (!pair.before || !pair.after) continue
    const before = urlOf(pair.before.file)
    const after = urlOf(pair.after.file)
    if (!before || !after) continue
    const what = `${pair.screen.name.replace(/[[\]|]/g, ' ')}, ${pair.width}×${pair.height}, ${pair.theme}`
    lines.push(`**${pair.screen.name.replace(/[*_|]/g, ' ')}** · ${pair.width}×${pair.height} · ${pair.theme}`, '')
    lines.push('| Before | After |', '| --- | --- |', `| ![Before: ${what}](${before}) | ![After: ${what}](${after}) |`, '')
  }
  lines.push('<sub>Captured with /browser-before-after in Kehikot.</sub>', BLOCK_END)
  return lines.join('\n')
}

/** A description with the block put in: an earlier block replaced, else added at the end. */
export function withBlock(body: string, block: string): string {
  const start = body.indexOf(BLOCK_START)
  const end = body.indexOf(BLOCK_END)
  if (start >= 0 && end > start) return `${body.slice(0, start)}${block}${body.slice(end + BLOCK_END.length)}`
  const trimmed = body.replace(/\s+$/, '')
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`
}

export interface PlanFile {
  /** The picture, in the set's folder. */
  file: string
  /** GitHub: where it goes on the shots branch, and the request body written for it. */
  path?: string
  body?: string
}

export type Plan =
  | { ok: false; why: string }
  | { ok: true; forge: 'github'; repo: Repo; number: number; files: Required<PlanFile>[]; commands: string[] }
  | { ok: true; forge: 'gitlab'; repo: Repo; number: number; files: PlanFile[]; commands: string[] }

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * The commands that put the pictures on the forge, through the person's own gh or glab. Refused
 * until the person said OK. `folder` is the set's folder (absolute); `bodies` are the GitHub
 * request bodies the server wrote into `<folder>/post/`.
 */
export function postPlan(set: ShotSet, target: { repo: Repo; number: number }, folder: string, stamp: string): Plan {
  if (!set.approved) return { ok: false, why: NOT_APPROVED }
  if (set.posted && set.posted.at > set.approved.at) return { ok: false, why: `These were posted already (${set.posted.where}). Capture again, and the person says OK again, to post new ones.` }
  const pictures = pairsOf(set).flatMap((pair) => (pair.before && pair.after ? [pair.before.file, pair.after.file] : []))
  if (!pictures.length) return { ok: false, why: 'No screen has both its before and its after captured.' }
  const { repo, number } = target
  if (repo.forge === 'github') {
    const files = pictures.map((file) => ({ file, path: githubPath(set, file, stamp), body: `${folder}/post/${file}.json` }))
    const commands = [
      `gh api repos/${repo.path}/branches/${SHOTS_BRANCH} --silent || gh api repos/${repo.path}/git/refs -f ref=refs/heads/${SHOTS_BRANCH} -f sha="$(gh api repos/${repo.path}/commits/HEAD --jq .sha)"`,
      ...files.map((one) => `gh api --method PUT repos/${repo.path}/contents/${one.path} --input ${quote(one.body)} --silent`),
      `gh pr view ${number} --repo ${repo.path} --json body --jq .body`,
    ]
    return { ok: true, forge: 'github', repo, number, files, commands }
  }
  const project = encodeURIComponent(repo.path)
  const host = repo.host === 'gitlab.com' ? '' : ` --hostname ${repo.host}`
  return {
    ok: true,
    forge: 'gitlab',
    repo,
    number,
    files: pictures.map((file) => ({ file })),
    commands: [
      ...pictures.map((file) => `glab api${host} --method POST projects/${project}/uploads -F file=@${quote(`${folder}/${file}`)}`),
      `glab mr view ${number} --repo ${repo.path} --output json`,
    ],
  }
}

/**
 * The description to post: the person's current one with the block put in. GitHub's picture
 * addresses are known from the plan; GitLab's come back from its uploads (`/uploads/<hash>/<name>`)
 * and are handed in as `uploaded`.
 */
export function postBody(
  set: ShotSet,
  target: { repo: Repo; stamp: string },
  current: string,
  uploaded: Record<string, string> = {},
): { ok: true; body: string } | { ok: false; why: string } {
  if (!set.approved) return { ok: false, why: NOT_APPROVED }
  const { repo, stamp } = target
  const urlOf = (file: string): string | null => {
    if (repo.forge === 'github') return githubImage(repo, githubPath(set, file, stamp))
    const said = uploaded[file]
    if (typeof said !== 'string') return null
    return /^\/uploads\/[A-Za-z0-9]+\/[A-Za-z0-9._-]+$/.test(said) ? said : null
  }
  if (repo.forge === 'gitlab') {
    const lacking = pairsOf(set).flatMap((pair) => (pair.before && pair.after ? [pair.before.file, pair.after.file] : [])).filter((file) => !urlOf(file))
    if (lacking.length) return { ok: false, why: `No upload address (/uploads/…) for ${lacking.join(', ')}. Pass each picture's url from glab's answer.` }
  }
  return { ok: true, body: withBlock(current, descriptionBlock(set, urlOf)) }
}
