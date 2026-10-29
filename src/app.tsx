import { ArrowLeft, ArrowRight, Bookmark, Code, Copy, Pencil, RotateCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { headerItemsSchema, pickedParts, type HeaderItem, type PressValue } from 'kehikot-module-protocol'
import { Cover, useServerStanding } from 'kehikot-module-protocol/client/react'

import { Button } from '@/components/ui/button'
import { HeaderMenus } from '@/components/header-menus'
import { Input } from '@/components/ui/input'
import { BLANK, labelFor, normaliseAddress } from '@/lib/address'
import { urlForSelection, refsToAsk } from '@/lib/follow'
import { addressToOpen, handedSaid, type Handed } from '@/lib/handed'
import { addressShown, alreadyOpening, committed, openingSaid, painted, pickedOpening, startOpening, type Opening } from '@/lib/opening'
import { placeKeys } from '@/lib/places'
import type { Saved } from '@/lib/saved'
import { ConsoleView, RunsView, ShotsView, VIEWS, appendEntry, type View } from '@/view/panels'
import { Viewer } from '@/view/viewer'
import { Sheet } from '@/view/sheet'
import { api as realApi, type Api, type Endpoint } from '@/wire/api'
import { Stream, type ConsoleEntry, type Dialog, type PageState, type Status } from '@/wire/stream'
import { useKehikot, type Host } from '@/wire/use-kehikot'

/**
 * What this module puts in its container's header. The host draws them (View,
 * Go, Run, and the pinned button beside them) and relays a press; the page owns
 * every bit of state and declares the whole list again on each change.
 *
 * - Go › Saved addresses: jump to one. Agents may press it (open_address does the same by name).
 * - Run › Save this address: saved under its title; renamed in the page.
 * - View › Follow picked issues, and the pinned button that stops or resumes it.
 * - Run › Playwright endpoint…: the info view. An agent is sent to `cdp_endpoint`.
 * - Run › Edit saved addresses…: the page's list, to rename and remove.
 * - View › Show: the page, the Console, the Walkthroughs, Before and after. Agents may press it
 *   (show_view does the same from the MCP door).
 * - Run › Open DevTools: Chromium's own DevTools for the page, in a window of its own. The
 *   person's alone: it opens a window on their screen.
 */
export function headerItems({ saved, follow, canSave, view = 'browser' }: { saved: readonly Saved[]; follow: boolean; canSave: boolean; view?: View }): HeaderItem[] {
  const items: unknown[] = [{ kind: 'switch', id: 'view', label: 'Show', options: VIEWS.map((one) => ({ id: one.id, label: one.label })), value: view, agents: true }]
  if (saved.length) {
    items.push({
      kind: 'go',
      id: 'saved',
      label: 'Saved addresses',
      agents: true,
      options: saved.slice(0, 64).map((one) => ({ id: one.id, label: labelFor(one.url, one.name) })),
    })
  }
  items.push(
    { kind: 'toggle', id: 'follow', label: 'Follow picked issues', checked: follow, agents: true },
    {
      kind: 'run',
      id: 'pin',
      label: follow ? 'Stop following picks' : 'Follow picks again',
      icon: follow ? 'link' : 'play',
      pinned: true,
      agents: true,
    },
    {
      kind: 'run',
      id: 'save',
      label: 'Save this address',
      icon: 'save',
      agents: true,
      disabled: canSave ? null : 'There is no web page open to save, or no project to save it in.',
    },
    { kind: 'run', id: 'manage', label: 'Edit saved addresses…', icon: 'pencil', group: 'Addresses' },
    { kind: 'run', id: 'endpoint', label: 'Playwright endpoint…', icon: 'code', group: 'Playwright', tool: 'cdp_endpoint' },
    { kind: 'run', id: 'devtools', label: 'Open DevTools', icon: 'external', group: 'Playwright' },
  )
  return headerItemsSchema.parse(items)
}

type Press = { item: string; value?: PressValue }
type Panel = 'endpoint' | 'saved' | null

const NO_PAGE: PageState = { url: BLANK, title: '', canBack: false, canForward: false, loading: false }

/** How long "Opening …" is shown at most: the engine gives up on a navigation after 30 s. */
export const OPENING_AT_MOST = 30_000

export function App() {
  const pressRef = useRef<(press: Press) => string | void>(() => 'Not ready yet.')
  const host = useKehikot({ onPress: (press) => pressRef.current(press) })
  return <Browser host={host} pressRef={pressRef} />
}

export function Browser({
  host,
  api = realApi,
  pressRef,
  makeStream = (events) => new Stream(events),
}: {
  host: Host
  api?: Api
  pressRef?: { current: (press: Press) => string | void }
  makeStream?: (events: ConstructorParameters<typeof Stream>[0]) => Stream
}) {
  const [page, setPage] = useState<PageState>(NO_PAGE)
  const [status, setStatus] = useState<Status>({ state: 'idle', why: null, endpoint: null })
  const [connected, setConnected] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  /* The last address another module handed over and this one opened, offered for saving. */
  const [handed, setHanded] = useState<Handed | null>(null)
  const [saved, setSaved] = useState<Saved[]>([])
  const [panel, setPanel] = useState<Panel>(null)
  const [view, setView] = useState<View>('browser')
  const [focus, setFocus] = useState<string | null>(null)
  const [lines, setLines] = useState<{ entries: ConsoleEntry[]; dropped: number }>({ entries: [], dropped: 0 })
  const frames = useRef<((frame: { data: string; width: number; height: number }) => void) | null>(null)
  const copied = useRef<((text: string) => void) | null>(null)
  const server = useServerStanding()
  /* What is being opened, from the moment it is asked until the new page's first frame (see `opening.ts`). */
  const [opening, setOpeningState] = useState<Opening | null>(null)
  const openingRef = useRef<Opening | null>(null)
  const setOpening = useCallback((next: Opening | null) => {
    openingRef.current = next
    setOpeningState(next)
  }, [])
  const pageRef = useRef<PageState>(NO_PAGE)

  const stream = useMemo(
    () =>
      makeStream({
        frame: (frame) => {
          frames.current?.(frame)
          if (openingRef.current && painted(openingRef.current)) setOpening(null)
        },
        page: (state) => {
          pageRef.current = state
          setPage(state)
          const now = openingRef.current
          if (now) {
            const next = committed(now, state.url)
            if (next !== now) setOpening(next)
          }
        },
        status: setStatus,
        dialog: setDialog,
        copied: (text) => copied.current?.(text),
        said: (text) => {
          /* The server says something only when a press failed: a navigation that did not happen ends "Opening". */
          if (openingRef.current) setOpening(null)
          setSaid(text)
        },
        open: setConnected,
        console: (entry) => setLines((now) => ({ ...now, entries: appendEntry(now.entries, entry) })),
        consoleCleared: () => setLines({ entries: [], dropped: 0 }),
        show: (asked, id) => {
          if (!VIEWS.some((one) => one.id === asked)) return
          setPanel(null)
          setView(asked as View)
          setFocus(id)
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    stream.start({ width: 1280, height: 800, scale: window.devicePixelRatio || 1 })
    return () => stream.stop()
  }, [stream])

  /* View › Console: what the server kept, then the live lines on top. */
  useEffect(() => {
    if (view !== 'console') return
    let live = true
    api
      .console()
      .then((read) => {
        if (!live) return
        setLines((now) => {
          const newer = now.entries.filter((one) => one.n > read.last)
          return { entries: [...read.entries, ...newer], dropped: read.dropped }
        })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [view, api])

  const openDevtools = useCallback(() => {
    setSaid('Opening DevTools in a window of its own…')
    api.openDevtools().then(
      () => setSaid('DevTools is open in its own window, for the page shown here.'),
      (error: unknown) => setSaid(error instanceof Error ? error.message : String(error)),
    )
  }, [api])

  /* Never shown longer than the engine would try. */
  useEffect(() => {
    if (!opening) return
    const timer = setTimeout(() => openingRef.current === opening && setOpening(null), OPENING_AT_MOST)
    return () => clearTimeout(timer)
  }, [opening, setOpening])

  /**
   * Open an address. `from` says who asked: a pick does not send a second
   * navigation to an address already being opened, and a hand-over does not
   * send one to an address a pick is already opening (References hands over
   * the address AND picks the ref with one click). The address bar shows it at
   * once; the engine's committed address replaces it, redirect included.
   */
  const go = useCallback(
    (typed: string, how: { from?: Opening['from']; label?: string } = {}) => {
      const address = normaliseAddress(typed)
      if (!address.ok) {
        setSaid(address.why)
        return false
      }
      const from = how.from ?? 'typed'
      if (alreadyOpening(openingRef.current, address.url, from)) return true
      setSaid(null)
      setOpening(startOpening(openingRef.current, { url: address.url, label: how.label ?? null, from, before: pageRef.current.url }))
      stream.send({ t: 'go', url: address.url })
      return true
    },
    [setOpening, stream],
  )

  /* ---------------- Saved addresses, per project. ---------------- */
  const projectPath = host.projectPath
  useEffect(() => {
    if (!projectPath) {
      setSaved([])
      return
    }
    let live = true
    api
      .saved(projectPath)
      .then((list) => live && setSaved(list))
      .catch((error: unknown) => live && setSaid(error instanceof Error ? error.message : String(error)))
    return () => {
      live = false
    }
  }, [projectPath, api])

  const saveHere = useCallback(async (): Promise<string | void> => {
    if (!projectPath) return 'There is no project to save the address in.'
    if (!/^https?:/.test(page.url)) return 'There is no web page open to save.'
    try {
      const done = await api.save(projectPath, { url: page.url, title: page.title })
      setSaved(done.list)
      setSaid(done.saved ? `Saved as “${done.saved.name}”.` : 'Saved.')
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, [api, page.title, page.url, projectPath])

  /* ---------------- Following picks. ---------------- */
  const follow = host.kept?.follow ?? true
  const setFollow = useCallback((on: boolean) => host.remember({ ...(host.kept ?? {}), follow: on }), [host])
  const selection = host.selection.join(' ')
  const lastSelection = useRef<string | null>(null)
  const waiting = useRef<string | null>(null)
  /* A pick made while the stream was down, opened when it comes up if it is still the selection. */
  const unopened = useRef<string | null>(null)
  /* Bumped when a handed-over address or a pick opens, so a place's remembered address that arrives later does not replace it. */
  const opened = useRef(0)
  const { request } = host

  const openSelection = useCallback(async () => {
    const picked = selection ? selection.split(' ') : []
    const refs = refsToAsk(picked)
    if (!refs.length) return
    /* Said at once, before the host is asked: the address follows when the reading names it. */
    setOpening(pickedOpening(openingRef.current, refs[0]!, pageRef.current.url))
    let reading: { rows?: unknown; missing?: unknown } | null = null
    try {
      reading = (await request('tracker.get', { refs })) as typeof reading
    } catch {
      reading = null
    }
    /* Picked again meanwhile: that pick's own lookup opens it. */
    if (lastSelection.current !== selection) return
    const found = urlForSelection(picked, reading)
    if (found.kind === 'open') {
      waiting.current = null
      opened.current += 1
      if (found.url !== pageRef.current.url) go(found.url, { from: 'pick', label: found.ref })
      else if (openingRef.current && !openingRef.current.url) setOpening(null)
    } else {
      if (openingRef.current && !openingRef.current.url) setOpening(null)
      if (found.kind === 'pending') {
        waiting.current = selection
        setSaid(`Waiting for the host to read ${found.refs.join(', ')}…`)
      } else {
        waiting.current = null
        setSaid(found.why)
      }
    }
  }, [go, request, selection, setOpening])

  useEffect(() => {
    if (host.where !== 'hosted') return
    if (lastSelection.current === null) {
      /* Arriving is not a pick: the place's remembered address is shown instead. */
      lastSelection.current = selection
      return
    }
    if (selection === lastSelection.current) return
    lastSelection.current = selection
    if (!follow) return
    if (connected) {
      unopened.current = null
      void openSelection()
    } else unopened.current = selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, host.where])

  useEffect(() => {
    if (!connected || unopened.current === null) return
    const pick = unopened.current
    unopened.current = null
    if (pick === selection && follow) void openSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  useEffect(() => {
    if (waiting.current && waiting.current === selection && follow) void openSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.trackerAt])

  /* ---------------- The address remembered per place. ---------------- */
  const pickedIds = pickedParts(host.parts).map((part) => part.id)
  const keys = useMemo(
    () => placeKeys({ epic: host.epic, parts: pickedIds, kehikko: host.kehikko?.key ?? null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [host.epic, pickedIds.join(','), host.kehikko?.key],
  )
  const placeId = projectPath ? `${projectPath}::${keys[0]}` : null
  const arrived = useRef<string | null>(null)

  useEffect(() => {
    if (!placeId || !projectPath || !connected || host.where !== 'hosted') return
    let live = true
    arrived.current = null
    const before = opened.current
    api
      .place(projectPath, keys)
      .then((visit) => {
        if (!live) return
        /* A handed-over address opened meanwhile is what was asked for now: the place's memory does not replace it. */
        if (visit && visit.url !== page.url && opened.current === before) go(visit.url)
        arrived.current = placeId
      })
      .catch(() => {
        if (live) arrived.current = placeId
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, connected, host.where])

  useEffect(() => {
    if (!projectPath || !placeId || arrived.current !== placeId) return
    if (!/^https?:/.test(page.url)) return
    const timer = setTimeout(() => void api.record(projectPath, keys, page.url, page.title).catch(() => {}), 1200)
    return () => clearTimeout(timer)
  }, [api, keys, page.title, page.url, placeId, projectPath])

  /* ---------------- An address handed to the canvas (protocol 2.16.0). ---------------- */
  /* Opened once per `at`: the host stamps a new one on every hand-over, and the last one acted on is
     kept by the host for this module, so a reload does not open it again. After the place's effect, so
     that one has counted `opened` before this bumps it. */
  const actedAt = useRef<string | null>(null)
  if (actedAt.current === null && host.kept?.addressAt) actedAt.current = host.kept.addressAt
  const addressKey = host.address ? `${host.address.at ?? ''}|${host.address.url}` : ''
  useEffect(() => {
    if (host.where !== 'hosted' || !connected) return
    const next = addressToOpen(host.address, actedAt.current)
    if (!next) return
    actedAt.current = next.at ?? next.url
    if (next.at) host.remember({ ...(host.kept ?? {}), addressAt: next.at })
    opened.current += 1
    setPanel(null)
    setView('browser')
    if (go(next.url, { from: 'handed' })) {
      setHanded(next)
      setSaid(handedSaid(next))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, connected, host.where])

  const saveHanded = useCallback(async () => {
    if (!handed) return
    if (!projectPath) {
      setSaid('There is no project to save the address in.')
      return
    }
    try {
      const done = await api.save(projectPath, { url: handed.url, title: handed.title })
      setSaved(done.list)
      setHanded(null)
      setSaid(done.saved ? `Saved as “${done.saved.name}”.` : 'Saved.')
    } catch (error) {
      setSaid(error instanceof Error ? error.message : String(error))
    }
  }, [api, handed, projectPath])

  /* ---------------- Presses, from the host's header and from this page. ---------------- */
  const press = useCallback(
    ({ item, value }: Press): string | void => {
      if (item === 'saved') {
        const one = saved.find((s) => s.id === value)
        if (!one) return 'That saved address is gone.'
        go(one.url)
        return
      }
      if (item === 'follow') {
        if (typeof value !== 'boolean') return 'Say true or false.'
        setFollow(value)
        return
      }
      if (item === 'pin') {
        setFollow(!follow)
        return
      }
      if (item === 'save') {
        void saveHere().then((why) => why && setSaid(why))
        return
      }
      if (item === 'endpoint') {
        setPanel('endpoint')
        return
      }
      if (item === 'manage') {
        setPanel('saved')
        return
      }
      if (item === 'view') {
        if (!VIEWS.some((one) => one.id === value)) return 'Say browser, console, walkthroughs or shots.'
        setPanel(null)
        setView(value as View)
        setFocus(null)
        return
      }
      if (item === 'devtools') {
        openDevtools()
        return
      }
      return `Browser has nothing called "${item}" to press.`
    },
    [follow, go, openDevtools, saveHere, saved, setFollow],
  )
  if (pressRef) pressRef.current = press

  const canSave = Boolean(projectPath) && /^https?:/.test(page.url)
  const items = useMemo(() => headerItems({ saved, follow, canSave, view }), [saved, follow, canSave, view])
  const { header } = host
  useEffect(() => header(items), [header, items])

  if (server === 'stale') return <Cover state="stale" name="Browser" onRetry={() => location.reload()} />

  return (
    <div className="flex h-screen flex-col text-sm">
      <Bar
        page={page}
        shownUrl={addressShown(opening, page.url)}
        stream={stream}
        onGo={go}
        onSave={() => void saveHere().then((why) => why && setSaid(why))}
        canSave={canSave}
        onPanel={setPanel}
      >
        {host.where === 'unhosted' ? <HeaderMenus items={items} onPress={press} /> : null}
      </Bar>
      {opening ? (
        <div className="relative shrink-0 border-b px-2 py-0.5 text-xs" role="status" data-testid="opening">
          <span className="bg-primary/60 absolute inset-x-0 top-0 h-0.5 animate-pulse" aria-hidden="true" />
          <span className="text-muted-foreground block truncate">{openingSaid(opening)}</span>
        </div>
      ) : null}
      {said ? (
        <p className="text-muted-foreground flex items-center gap-2 border-b px-2 py-1 text-xs" data-testid="said">
          <span className="min-w-0 flex-1 truncate" title={said}>
            {said}
          </span>
          {handed && projectPath && said === handedSaid(handed) ? (
            <button type="button" className="hover:text-foreground shrink-0 underline" data-testid="save-handed" onClick={() => void saveHanded()}>
              Save address
            </button>
          ) : null}
          <button
            type="button"
            aria-label="dismiss"
            onClick={() => {
              setSaid(null)
              setHanded(null)
            }}
          >
            <X className="size-3" />
          </button>
        </p>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Viewer stream={stream} frames={frames} onCopied={copied} />
        {status.state !== 'ready' ? <Starting status={status} onRetry={() => stream.send({ t: 'retry' })} /> : null}
        {dialog ? <DialogBox dialog={dialog} onAnswer={(accept, text) => stream.send({ t: 'dialog', accept, text })} /> : null}
        {view === 'console' ? (
          <ConsoleView
            entries={lines.entries}
            dropped={lines.dropped}
            onClear={() => void api.clearConsole().then(() => setLines({ entries: [], dropped: 0 }), (error: unknown) => setSaid(error instanceof Error ? error.message : String(error)))}
            onDevtools={openDevtools}
            onClose={() => setView('browser')}
          />
        ) : null}
        {view === 'walkthroughs' ? <RunsView api={api} projectPath={projectPath} focus={focus} onClose={() => setView('browser')} /> : null}
        {view === 'shots' ? <ShotsView api={api} projectPath={projectPath} focus={focus} onClose={() => setView('browser')} /> : null}
        {panel === 'endpoint' ? <EndpointPanel api={api} onClose={() => setPanel(null)} /> : null}
        {panel === 'saved' ? (
          <SavedPanel
            saved={saved}
            projectPath={projectPath}
            api={api}
            onList={setSaved}
            onOpen={(url) => {
              go(url)
              setPanel(null)
            }}
            onClose={() => setPanel(null)}
          />
        ) : null}
      </div>
    </div>
  )
}

function Bar({
  page,
  shownUrl,
  stream,
  onGo,
  onSave,
  canSave,
  onPanel,
  children,
}: {
  page: PageState
  /** What the address bar says when nobody is typing: what is being opened, else the page's own address. */
  shownUrl: string
  stream: Stream
  onGo(typed: string): boolean
  onSave(): void
  canSave: boolean
  onPanel(panel: Panel): void
  children?: React.ReactNode
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (shownUrl === BLANK ? '' : shownUrl)
  return (
    <header className="flex min-h-9 shrink-0 items-center gap-1 border-b px-1 py-1">
      <Button variant="ghost" size="icon" className="size-7" aria-label="Back" disabled={!page.canBack} onClick={() => stream.send({ t: 'back' })}>
        <ArrowLeft className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" aria-label="Forward" disabled={!page.canForward} onClick={() => stream.send({ t: 'forward' })}>
        <ArrowRight className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" aria-label="Reload" onClick={() => stream.send({ t: 'reload' })}>
        <RotateCw className="size-4" />
      </Button>
      <form
        className="min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault()
          if (onGo(shown)) setDraft(null)
        }}
      >
        <Input
          aria-label="Address"
          className="h-7 text-xs"
          placeholder="Type an address: github.com/…, localhost:5173"
          value={shown}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(null)
              ;(event.target as HTMLInputElement).blur()
            }
          }}
        />
      </form>
      <Button variant="ghost" size="icon" className="size-7" aria-label="Save this address" title="Save this address" disabled={!canSave} onClick={onSave}>
        <Bookmark className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" aria-label="Playwright endpoint" title="Playwright endpoint" onClick={() => onPanel('endpoint')}>
        <Code className="size-4" />
      </Button>
      {children}
    </header>
  )
}

function Starting({ status, onRetry }: { status: Status; onRetry(): void }) {
  return (
    <div className="bg-background/90 absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center" data-testid="starting">
      {status.state === 'failed' ? (
        <>
          <p className="max-w-md text-sm">{status.why}</p>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">Starting the browser…</p>
      )}
    </div>
  )
}

function DialogBox({ dialog, onAnswer }: { dialog: Dialog; onAnswer(accept: boolean, text?: string): void }) {
  const [text, setText] = useState(dialog.defaultValue)
  return (
    <div className="absolute inset-x-0 top-0 flex justify-center p-3">
      <form
        className="bg-popover flex w-full max-w-md flex-col gap-2 rounded-md border p-3 shadow-md"
        onSubmit={(event) => {
          event.preventDefault()
          onAnswer(true, dialog.type === 'prompt' ? text : undefined)
        }}
      >
        <p className="text-muted-foreground text-xs">The page says (its words, not Kehikot’s):</p>
        <p className="max-h-40 overflow-auto text-sm whitespace-pre-wrap">{dialog.message}</p>
        {dialog.type === 'prompt' ? <Input value={text} onChange={(event) => setText(event.target.value)} /> : null}
        <div className="flex justify-end gap-2">
          {dialog.type !== 'alert' ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onAnswer(false)}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" size="sm">
            OK
          </Button>
        </div>
      </form>
    </div>
  )
}

function CopyLine({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 gap-1 px-2 text-xs"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => setDone(true),
              () => setDone(false),
            )
          }}
        >
          <Copy className="size-3" />
          {done ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="bg-muted overflow-auto rounded p-2 text-xs select-all">{text}</pre>
    </div>
  )
}

function EndpointPanel({ api, onClose }: { api: Api; onClose(): void }) {
  const [got, setGot] = useState<Endpoint | null>(null)
  /* Told as the panel opens and again when the browser starts or stops: the server's stream, never a clock. */
  useEffect(() => api.followEndpoint(setGot), [api])
  return (
    <Sheet title="Playwright endpoint" onClose={onClose}>
      {!got?.endpoint ? (
        <p className="text-muted-foreground text-sm">The endpoint opens once the browser has started.</p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="endpoint">
          <p className="text-muted-foreground text-xs">
            Attach Playwright to the very browser shown here. It listens on 127.0.0.1 only; anything that attaches can drive this browser, with its logins.
          </p>
          <CopyLine label="Endpoint" text={got.endpoint.http} />
          {got.snippets ? <CopyLine label="In a Playwright test" text={got.snippets.test} /> : null}
          {got.snippets ? <CopyLine label="Playwright MCP" text={got.snippets.mcp} /> : null}
          {got.snippets ? <CopyLine label="…added to Claude Code" text={got.snippets.claude} /> : null}
        </div>
      )}
    </Sheet>
  )
}

function SavedPanel({
  saved,
  projectPath,
  api,
  onList,
  onOpen,
  onClose,
}: {
  saved: Saved[]
  projectPath: string | null
  api: Api
  onList(list: Saved[]): void
  onOpen(url: string): void
  onClose(): void
}) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const act = (work: Promise<Saved[]>) =>
    work.then(
      (list) => {
        onList(list)
        setWhy(null)
      },
      (error: unknown) => setWhy(error instanceof Error ? error.message : String(error)),
    )
  return (
    <Sheet title="Saved addresses" onClose={onClose}>
      {!projectPath ? <p className="text-muted-foreground text-sm">Open a project to keep addresses in it.</p> : null}
      {projectPath && saved.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing saved in this project yet. Save the page you are on with the bookmark button.</p>
      ) : null}
      {why ? <p className="text-sm">{why}</p> : null}
      <ul className="flex flex-col gap-1" data-testid="saved-list">
        {saved.map((one) => (
          <li key={one.id} className="flex items-center gap-2">
            {editing?.id === one.id ? (
              <form
                className="flex flex-1 gap-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (projectPath) void act(api.rename(projectPath, one.id, editing.name)).then(() => setEditing(null))
                }}
              >
                <Input autoFocus className="h-7 text-xs" value={editing.name} onChange={(event) => setEditing({ id: one.id, name: event.target.value })} />
                <Button size="sm" type="submit" className="h-7">
                  Rename
                </Button>
              </form>
            ) : (
              <button type="button" className="hover:bg-accent min-w-0 flex-1 rounded px-1 text-left" onClick={() => onOpen(one.url)} title={one.url}>
                <span className="block truncate text-sm">{one.name}</span>
                <span className="text-muted-foreground block truncate text-xs">{one.url}</span>
              </button>
            )}
            <Button variant="ghost" size="icon" className="size-7" aria-label={`rename ${one.name}`} onClick={() => setEditing({ id: one.id, name: one.name })}>
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`remove ${one.name}`}
              onClick={() => projectPath && void act(api.remove(projectPath, one.id))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
