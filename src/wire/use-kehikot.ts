import { useMemo } from 'react'

import { useHost, type Host as ProtocolHost } from 'kehikot-module-protocol/client/react'
import type { HostEvents } from 'kehikot-module-protocol/client'

import { ID } from '../../manifest.ts'
import type { View } from '@/view/panels'

/**
 * What the host keeps for one container of this module — this module on one kehikko (`state.set`):
 * whether it follows picks, and which view is in front. Every write keeps the other keys.
 */
export interface Kept {
  follow?: boolean
  /** Which view is in front (`useKept`): the page, the Console, the Walkthroughs, Before and after. */
  view?: View
  /** The `at` of the last handed-over address this module opened (`context.address`), so a reload does not open it again. */
  addressAt?: string
}

/**
 * What the screen needs from the host: the protocol's `useHost` plus the
 * tracker reading's stamp. A plain object, so a screen can be rendered in a test
 * without a host.
 */
export interface Host
  extends Pick<
    ProtocolHost<Kept>,
    'where' | 'project' | 'projectPath' | 'epic' | 'theme' | 'request' | 'header' | 'selection' | 'parts' | 'kehikko' | 'kept' | 'read' | 'remember' | 'address'
  >,
    /* The footer (2.38.0), whether the page is on screen (2.45.0) and which footer kinds the host draws (2.46.0):
       optional, so a screen renders in a test without them. */
    Partial<Pick<ProtocolHost<Kept>, 'footer' | 'drawsFooter' | 'visible' | 'footerKinds' | 'ready' | 'loading'>> {
  /** When the host's tracker reading last changed (`context.tracker.at`); a pending ref is asked again when it moves. */
  trackerAt: string | null
}

export function useKehikot(events: HostEvents = {}): Host {
  const host = useHost<Kept>(ID, events)
  const trackerAt = host.context?.tracker?.at ?? null
  return useMemo(() => ({ ...host, trackerAt }), [host, trackerAt])
}
