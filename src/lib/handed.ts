import { addressIsNews, isWebAddress, type SharedAddress } from 'kehikot-module-protocol'

import { ID } from '../../manifest.ts'
import { labelFor } from './address.ts'

/**
 * A web address another module (or an agent) handed to the canvas
 * (`context.address`, protocol 2.16.0). This module shows pages, so it opens
 * it — once, when its `at` is new. The `at` it last acted on is kept by the
 * host for this module (`state.set`), so reloading the page does not open the
 * same address again.
 */

export interface Handed {
  url: string
  title: string | null
  /** Who handed it over, for a person to read: a module id, or "an agent". */
  by: string | null
  at: string | null
}

/**
 * What to open for the context's address, or null when there is nothing new:
 * no address, one already acted on (`actedAt`), one this module sent itself,
 * or one the protocol would not take. The host checked the address; this end
 * checks it again rather than trusting the context.
 */
export function addressToOpen(address: SharedAddress | null | undefined, actedAt: string | null | undefined): Handed | null {
  if (!address) return null
  if (address.by === ID) return null
  if (!isWebAddress(address.url)) return null
  if (!addressIsNews(address, actedAt ? { at: actedAt, url: null } : null)) return null
  return {
    url: address.url,
    title: address.title ?? null,
    by: address.by ?? (address.agent ? 'an agent' : null),
    at: address.at ?? null,
  }
}

/** The line shown when it opens: what, and who asked. The words are another module's: shown as text. */
export function handedSaid(handed: Handed): string {
  const what = `“${labelFor(handed.url, handed.title, 64)}”`
  return handed.by ? `Opened ${what}, handed over by ${handed.by}.` : `Opened ${what}.`
}
