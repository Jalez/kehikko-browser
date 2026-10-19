import { DOOR_PROJECT_SAYS, resolveDoorProject, type HostHasProjectOptions } from 'kehikot-module-protocol/serve'

/**
 * The one project check. A project is the host's to vouch for: a folder that exists
 * on disk is not enough, because a folder renamed away leaves its old path free for
 * an unrelated one. Every door and every route that is handed a project path resolves
 * it here and works only on the path that comes back.
 */
export const ASK: { options: HostHasProjectOptions } = { options: {} }

export type Project = { ok: true; path: string; followed: string | null } | { ok: false; error: string }

export async function resolveProject(input: string | null | undefined | Record<string, unknown>): Promise<Project> {
  const at = await resolveDoorProject(input ?? '', ASK.options)
  if (!at.ok) return { ok: false, error: at.why }
  return { ok: true, path: at.path, followed: at.movedFrom ? DOOR_PROJECT_SAYS.followed(at.movedFrom, at.path) : null }
}
