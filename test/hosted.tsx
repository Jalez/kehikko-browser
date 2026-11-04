import { useRef, useState, type ComponentProps } from 'react'

import { Browser as Page } from '../src/app.tsx'
import type { Host, Kept } from '../src/wire/use-kehikot.ts'

/**
 * The page, with a host that keeps what it is told the way the protocol's `useHost` does: `remember`
 * updates `kept` for the next render (and still reaches the test's own `remember`), and `read` gives
 * the newest. A host handed in with a different `kept` — another kehikko — replaces what was kept.
 */
export function Browser(props: ComponentProps<typeof Page>) {
  const given = props.host.kept ?? null
  const [kept, setKept] = useState<Kept | null>(given)
  const newest = useRef<Kept | null>(given)
  const seen = useRef<Kept | null>(given)
  let shown = kept
  if (seen.current !== given) {
    seen.current = given
    newest.current = given
    shown = given
    setKept(given)
  }
  const host: Host = {
    ...props.host,
    kept: shown,
    read: () => ({ ...props.host, kept: newest.current }) as unknown as ReturnType<Host['read']>,
    remember: (next: Kept, after?: number) => {
      newest.current = next
      setKept(next)
      props.host.remember(next, after)
    },
  }
  return <Page {...props} host={host} />
}
