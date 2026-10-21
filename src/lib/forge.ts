import { readTrackerRef } from 'kehikot-module-protocol'

/**
 * Which page on its forge a ref names, for `/browser-open` and `open_ref`.
 *
 * A ref comes as the canvas spells it (`gh#12`, `gh:owner/repo#12`, `#12`, `!7`,
 * `gl:group/project!7`), as people write it (`owner/repo#12`, `group/project!7`, `PR 12`,
 * `MR !7`, `issue 12`), or as a forge address already. A short one means the project's own
 * repository, which is read from its git remotes: the first remote on github.com, or on a host
 * with "gitlab" in its name (`gitlab.com`, `gitlab.example.org`), `origin` first.
 *
 * Pure: the remotes are handed in.
 */

export type Forge = 'github' | 'gitlab'

export interface Remote {
  name: string
  url: string
}

export interface Repo {
  forge: Forge
  /** `gitlab.example.org`; `github.com` for GitHub. */
  host: string
  /** `owner/repo`, `group/sub/project`. */
  path: string
}

export type Found = { ok: true; url: string; repo: Repo; kind: 'issue' | 'change' | 'either'; number: number } | { ok: false; why: string }

const PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/

/** A remote's URL as a repository on a forge, or null for one that is not on a forge this knows. */
export function repoOf(url: string): Repo | null {
  const raw = url.trim()
  let host = ''
  let path = ''
  const scp = /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):(?!\/\/)(.+)$/.exec(raw)
  if (/^[a-z+]+:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      host = parsed.hostname.toLowerCase()
      path = parsed.pathname
    } catch {
      return null
    }
  } else if (scp) {
    host = scp[1]!.toLowerCase()
    path = scp[2]!
  } else return null
  path = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '')
  if (!PATH.test(path)) return null
  if (host === 'github.com' || host === 'www.github.com' || host === 'ssh.github.com') {
    const [owner, name] = path.split('/')
    return { forge: 'github', host: 'github.com', path: `${owner}/${name}` }
  }
  if (host.includes('gitlab')) return { forge: 'gitlab', host, path }
  return null
}

/** The project's own repository: `origin` first, then the other remotes in order. */
export function defaultRepo(remotes: readonly Remote[]): Repo | null {
  const ordered = [...remotes.filter((r) => r.name === 'origin'), ...remotes.filter((r) => r.name !== 'origin')]
  for (const remote of ordered) {
    const repo = repoOf(remote.url)
    if (repo) return repo
  }
  return null
}

/** `git config --get-regexp` output (`remote.origin.url git@…`) as remotes. */
export function remotesFrom(config: string): Remote[] {
  const out: Remote[] = []
  for (const line of config.split('\n')) {
    const m = /^remote\.(.+)\.url\s+(\S+)\s*$/.exec(line.trim())
    if (m) out.push({ name: m[1]!, url: m[2]! })
  }
  return out
}

export function pageFor(repo: Repo, kind: 'issue' | 'change' | 'either', number: number): string {
  if (repo.forge === 'github') return `https://github.com/${repo.path}/${kind === 'change' ? 'pull' : 'issues'}/${number}`
  return `https://${repo.host}/${repo.path}/-/${kind === 'change' ? 'merge_requests' : 'issues'}/${number}`
}

const NUMBER = '([1-9][0-9]{0,9})'

/** The forge page a ref names, given the project's remotes. */
export function forgeUrl(ref: string, remotes: readonly Remote[]): Found {
  const said = ref.trim()
  if (!said) return { ok: false, why: 'Say which issue, pull request or merge request.' }
  if (said.length > 300) return { ok: false, why: 'That is too long to be a ref.' }
  const own = defaultRepo(remotes)

  /* A forge address already: kept when it is one. */
  if (/^https:\/\//i.test(said)) {
    let url: URL
    try {
      url = new URL(said)
    } catch {
      return { ok: false, why: 'That is not an address.' }
    }
    const gh = /^\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)/.exec(url.pathname)
    if (url.hostname === 'github.com' && gh) {
      return { ok: true, url: url.href, repo: { forge: 'github', host: 'github.com', path: gh[1]! }, kind: gh[2] === 'pull' ? 'change' : 'issue', number: +gh[3]! }
    }
    const gl = /^\/(.+?)\/-\/(issues|merge_requests)\/(\d+)/.exec(url.pathname)
    if (url.hostname.includes('gitlab') && gl) {
      return { ok: true, url: url.href, repo: { forge: 'gitlab', host: url.hostname, path: gl[1]! }, kind: gl[2] === 'merge_requests' ? 'change' : 'issue', number: +gl[3]! }
    }
    return { ok: false, why: `${url.hostname} is not an issue, pull request or merge request page this knows.` }
  }

  /* The canvas's own spellings. */
  const tracker = readTrackerRef(said)
  if (tracker) {
    const repo: Repo | null = tracker.repo
      ? tracker.tracker === 'github'
        ? { forge: 'github', host: 'github.com', path: tracker.repo }
        : { forge: 'gitlab', host: own?.forge === 'gitlab' ? own.host : 'gitlab.com', path: tracker.repo }
      : own && own.forge === tracker.tracker
        ? own
        : null
    if (!repo) {
      return { ok: false, why: `${said} means the project's own ${tracker.tracker === 'github' ? 'GitHub' : 'GitLab'} repository, and no git remote of this project is one.` }
    }
    const kind = tracker.kind ?? 'either'
    return { ok: true, url: pageFor(repo, kind, tracker.number), repo, kind, number: tracker.number }
  }

  /* As people write them: owner/repo#12, group/project!7, PR 12, MR !7, issue #12, #12. */
  const qualified = new RegExp(`^([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+)([#!])${NUMBER}$`).exec(said)
  if (qualified) {
    const path = qualified[1]!
    const mark = qualified[2]!
    const forge: Forge = mark === '!' ? 'gitlab' : own?.forge ?? 'github'
    const repo: Repo = forge === 'github' ? { forge, host: 'github.com', path } : { forge, host: own?.forge === 'gitlab' ? own.host : 'gitlab.com', path }
    const kind = mark === '!' ? 'change' : forge === 'gitlab' ? 'issue' : 'either'
    return { ok: true, url: pageFor(repo, kind, +qualified[3]!), repo, kind, number: +qualified[3]! }
  }
  const worded = new RegExp(`^(pr|pull request|pull|mr|merge request|issue)?\\s*[#!]?${NUMBER}$`, 'i').exec(said)
  if (worded) {
    if (!own) return { ok: false, why: `${said} means the project's own repository, and no git remote of this project is on GitHub or GitLab.` }
    const word = (worded[1] ?? '').toLowerCase()
    const kind: 'issue' | 'change' | 'either' = /^(pr|pull|mr|merge)/.test(word) || said.includes('!') ? 'change' : word === 'issue' ? 'issue' : own.forge === 'gitlab' ? 'issue' : 'either'
    return { ok: true, url: pageFor(own, kind, +worded[2]!), repo: own, kind, number: +worded[2]! }
  }
  return { ok: false, why: `"${said.slice(0, 80)}" is not a ref this knows: try gh#12, owner/repo#12, !7, group/project!7, or the page's address.` }
}
