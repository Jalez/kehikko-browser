import { LIMITS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

import { BLANK, labelFor } from './address.ts'

/**
 * The browser's controls in the footer the host draws (`kehikot.footer`, protocol 2.38.0): Back,
 * Forward, Reload (Stop while the page loads), what the page is, and Save. They were the row along
 * the top of the page; with a host that draws footers they sit along the bottom edge of the
 * container, in the host's look, and the page keeps only the address field at the top: a footer item
 * cannot take typing, and an address has to be typed.
 *
 * Declared only when the host says it draws a footer (`drawsFooter === true`). With any other host
 * the page draws its old top bar exactly as before (`Bar` in app.tsx). The page owns every bit of
 * state; the host draws the latest list and reports a press, and the page declares it again after.
 *
 * Back, Forward and Reload name the MCP tools that do the same (`back`, `forward`, `reload`), so an
 * agent is sent there rather than pressing; Save is pressable by agents as it is in the header.
 */

export const FOOT = { BACK: 'back', FORWARD: 'forward', RELOAD: 'reload', STOP: 'stop', PAGE: 'page', SAVE: 'save' } as const

export interface FooterState {
  url: string
  title: string
  canBack: boolean
  canForward: boolean
  /** The page is loading, or something is being opened: Reload becomes Stop. */
  loading: boolean
  canSave: boolean
}

export function footerItems(state: FooterState): FooterItem[] {
  const page = state.url === BLANK ? null : state.url
  const said = state.loading ? 'Loading…' : page ? labelFor(page, state.title || null, LIMITS.FOOTER_TEXT) : 'No page open'
  const items: unknown[] = [
    {
      kind: 'run',
      id: FOOT.BACK,
      label: 'Back',
      icon: 'chevron-left',
      tool: 'back',
      disabled: state.canBack ? null : 'There is no page before this one.',
    },
    {
      kind: 'run',
      id: FOOT.FORWARD,
      label: 'Forward',
      icon: 'chevron-right',
      tool: 'forward',
      disabled: state.canForward ? null : 'There is no page after this one.',
    },
    state.loading
      ? { kind: 'run', id: FOOT.STOP, label: 'Stop', icon: 'stop', tooltip: 'Stop loading this page.' }
      : { kind: 'run', id: FOOT.RELOAD, label: 'Reload', icon: 'refresh', tool: 'reload', disabled: page ? null : 'There is no page to reload.' },
    {
      kind: 'text',
      id: FOOT.PAGE,
      text: said,
      optional: true,
      ...(page ? { tooltip: page.slice(0, LIMITS.FOOTER_TOOLTIP) } : {}),
    },
    {
      kind: 'run',
      id: FOOT.SAVE,
      label: 'Save address',
      icon: 'save',
      align: 'end',
      optional: true,
      agents: true,
      disabled: state.canSave ? null : 'There is no web page open to save, or no project to save it in.',
    },
  ]
  return footerItemsSchema.parse(items)
}
