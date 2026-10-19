import { useMemo } from 'react'

import { useHost, type Host as ProtocolHost } from 'kehikot-module-protocol/client/react'
import type { HostEvents } from 'kehikot-module-protocol/client'

import { ID } from '../../manifest.ts'

/** What the host keeps for one container of this module (`state.set`): whether it follows picks. */
export interface Kept {
  follow?: boolean
}

/**
 * What the screen needs from the host: the protocol's `useHost` plus the
 * tracker reading's stamp. A plain object, so a screen can be rendered in a test
 * without a host.
 */
export interface Host
  extends Pick<
    ProtocolHost<Kept>,
    'where' | 'project' | 'projectPath' | 'epic' | 'theme' | 'request' | 'header' | 'selection' | 'parts' | 'kehikko' | 'kept' | 'remember'
  > {
  /** When the host's tracker reading last changed (`context.tracker.at`); a pending ref is asked again when it moves. */
  trackerAt: string | null
}

export function useKehikot(events: HostEvents = {}): Host {
  const host = useHost<Kept>(ID, events)
  const trackerAt = host.context?.tracker?.at ?? null
  return useMemo(() => ({ ...host, trackerAt }), [host, trackerAt])
}
