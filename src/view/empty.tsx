import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { labelFor } from '@/lib/address'
import type { Api, Offered } from '@/wire/api'

/**
 * The empty space: where Browser stands at a place nothing was shown at. Never the page of the place
 * before it. It offers, in order, what the person most likely wants here, each opened with one press:
 *
 * - pages used near this space (the spaces above it, its siblings and its children, on any kehikko);
 * - the project's own dev servers that are running now (only the ports the project names);
 * - the project's other recent pages;
 * - the address, typed (focused when this frame already has the keyboard, never taken from the host).
 */

export const EMPTY_SAYS = 'Nothing is open in this space yet.'
export const AGENTS_SAY = 'An agent can open a page here for you too.'

const NONE: Offered = { nearby: [], recent: [], servers: [] }

export function EmptySpace({
  api,
  projectPath,
  placeKey,
  onOpen,
}: {
  api: Api
  projectPath: string | null
  placeKey: string
  onOpen(url: string): boolean
}) {
  const [offered, setOffered] = useState<Offered>(NONE)
  const [typed, setTyped] = useState('')
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setOffered(NONE)
    if (!projectPath) return
    let live = true
    api.suggest(projectPath, placeKey).then(
      (got) => live && setOffered(got),
      () => {},
    )
    return () => {
      live = false
    }
  }, [api, projectPath, placeKey])

  useEffect(() => {
    if (typeof document !== 'undefined' && document.hasFocus()) field.current?.focus()
  }, [placeKey])

  const groups: { id: string; title: string; items: { url: string; label: string; detail: string | null }[] }[] = [
    { id: 'nearby', title: 'Used near this space', items: offered.nearby.map((one) => ({ url: one.url, label: labelFor(one.url, one.title || null, 80), detail: null })) },
    { id: 'servers', title: 'Running in this project', items: offered.servers.map((one) => ({ url: one.url, label: labelFor(one.url, null, 80), detail: `from ${one.from}` })) },
    { id: 'recent', title: 'Recent in this project', items: offered.recent.map((one) => ({ url: one.url, label: labelFor(one.url, one.title || null, 80), detail: null })) },
  ].filter((group) => group.items.length)

  return (
    <div className="bg-background absolute inset-0 overflow-auto p-4" data-testid="empty-space">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{EMPTY_SAYS}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (onOpen(typed)) setTyped('')
            }}
          >
            <Input
              ref={field}
              aria-label="Open an address here"
              className="h-8 text-sm"
              placeholder="Type an address: github.com/…, localhost:5173"
              value={typed}
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </form>
        </div>
        {groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-1" data-testid={`offer-${group.id}`}>
            <h2 className="text-muted-foreground text-xs">{group.title}</h2>
            <ul className="flex flex-col">
              {group.items.map((item) => (
                <li key={item.url}>
                  <button
                    type="button"
                    className="hover:bg-muted flex w-full min-w-0 flex-col rounded px-2 py-1 text-left"
                    title={item.url}
                    onClick={() => onOpen(item.url)}
                  >
                    <span className="truncate text-sm">{item.label}</span>
                    {item.detail ? <span className="text-muted-foreground truncate text-xs">{item.detail}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-muted-foreground text-xs">{AGENTS_SAY}</p>
      </div>
    </div>
  )
}
