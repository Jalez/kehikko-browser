import { LIMITS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

import { BLANK, labelFor } from './address.ts'

/**
 * The browser's controls in the footer the host draws (`kehikot.footer`, protocol 2.38.0): Back,
 * Forward, Reload (Stop while the page loads), the address, and Save. They were the row along the
 * top of the page; with a host that draws footers they sit along the bottom edge of the container,
 * in the host's look.
 *
 * Three hosts, decided by what the greeting said (`footerDraws` in the protocol):
 *
 * - draws a footer field (2.46.0, `footerKinds` names `input`): the address is a field in the footer
 *   (`field: true`), and the page draws no row of its own at all;
 * - draws a footer but no field (2.38.0 to 2.45.0): the footer has what the page is instead, and the
 *   page keeps the address field alone along the top;
 * - draws no footer: the page draws its old top bar exactly as before (`Bar` in app.tsx).
 *
 * The page owns every bit of state; the host draws the latest list and reports a press (Enter in
 * the field, with the typed text), and the page declares it again after.
 *
 * Back, Forward and Reload name the MCP tools that do the same (`back`, `forward`, `reload`), so an
 * agent is sent there rather than pressing; Save is pressable by agents as it is in the header.
 */

export const FOOT = { BACK: 'back', FORWARD: 'forward', RELOAD: 'reload', STOP: 'stop', PAGE: 'page', ADDRESS: 'address', SAVE: 'save' } as const

/** What the address field says when it is empty: the same words as the page's own field. */
export const ADDRESS_PLACEHOLDER = 'Type an address: github.com/…, localhost:5173'

export interface FooterState {
  url: string
  title: string
  canBack: boolean
  canForward: boolean
  /** The page is loading, or something is being opened: Reload becomes Stop. */
  loading: boolean
  canSave: boolean
  /**
   * The host draws a footer field (protocol 2.46.0): the address goes in the footer, as `shown`.
   * Without it the footer says what the page is, and the address stays a field on the page.
   */
  field?: boolean
  /** What the address field holds when nobody is typing: what is being opened, else the page's own address. Defaults to `url`. */
  shown?: string
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
    state.field
      ? {
          kind: 'input',
          id: FOOT.ADDRESS,
          label: 'Address',
          value: addressValue(state.shown ?? state.url),
          placeholder: ADDRESS_PLACEHOLDER,
          grow: true,
          /* What the page is called, which the field has no room to say: the title, or Loading. */
          ...(state.loading ? { tooltip: 'Loading…' } : page && state.title ? { tooltip: labelFor(page, state.title, LIMITS.FOOTER_TOOLTIP) } : {}),
        }
      : {
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

/** The address as the field holds it: nothing for a blank page, and never longer than a field takes. */
function addressValue(url: string): string {
  return url === BLANK ? '' : url.slice(0, LIMITS.FOOTER_INPUT)
}
