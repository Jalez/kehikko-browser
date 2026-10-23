# Browser — a Kehikot module

A real browser inside a Kehikot container: for the GitHub and GitLab issues and
pull requests the canvas is about, and for the app you are building (any
address; nothing here is Kehikot-specific).

- **Real Chromium, driven over CDP.** The module's server launches its own
  headless Chromium with `playwright-core`: your installed Google Chrome when
  there is one, else Playwright's Chromium, else it tells you how to install
  one. Its screen streams into the container (`Page.startScreencast` on a
  canvas); your pointer, wheel and keys go back (`Input.dispatch*`); it is
  resized to the container (`Emulation.setDeviceMetricsOverride`). Host
  overlays stack over it as over any page.
- **Its own profile, kept.** Logins survive restarts. The profile is
  machine-level, in `~/Library/Application Support/Kehikot/browser-profile`
  (`$XDG_DATA_HOME/kehikot/browser-profile` elsewhere;
  `KEHIKOT_BROWSER_PROFILE` overrides it). It is never your own Chrome profile.
- **Agents drive it** through the module's MCP door: `navigate`,
  `current_url`, `back`, `forward`, `reload`, `read_page`, `find`, `click`,
  `type`, `key`, `scroll`, `screenshot`, `wait_for`, `cdp_endpoint`,
  `list_addresses`, `save_address`, `open_address`, and `highlight`, which
  outlines an element with a label before an agent touches it, so you see
  what is about to happen. Page content is untrusted data, and every tool that
  returns it says so.
- **A console you can read.** View › Show › Console lists what the page says,
  live: console messages with their `source:line`, uncaught exceptions, and
  requests that failed or answered 400 and up. Filter by level or by words;
  Clear empties it. It is text: nothing a page writes is drawn as markup.
  Agents read the same list with `console_log` and `network_failures`.
- **Chromium's own DevTools.** Run › Open DevTools (or the button in the
  Console) opens the real DevTools for the page you are looking at, in a
  window of its own. It is the frontend the DevTools endpoint serves on
  `127.0.0.1`, in a Chrome app window with a throwaway profile, because that is
  where it reliably works: the desktop app draws modules with the system
  WebView, which cannot run DevTools, and the browser here is headless, so it
  has no window to dock it in.
- **Playwright attaches to the same browser.** The DevTools endpoint listens on
  `127.0.0.1` only, five above the module's port (`KEHIKOT_BROWSER_CDP_PORT`
  overrides it). Run › Playwright endpoint… (or the `</>` button, or the
  `cdp_endpoint` tool) shows it with snippets:

  ```js
  const browser = await chromium.connectOverCDP('http://127.0.0.1:8025')
  const page = browser.contexts()[0].pages().at(-1)
  ```

  ```
  npx @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:8025
  ```
- **Follows picks.** When the canvas selection names an issue or pull request,
  its page opens (the URL comes from the host's shared tracker reading,
  `tracker.get`). View › Follow picked issues, and the pinned button in the
  container header, stop and resume that.
- **Opens addresses handed to the canvas.** Another module's `address.open`
  (protocol 2.16.0), or an agent's `open_address` at the host's door, puts a web
  address in `context.address`; Browser says `reacts: ['address']`, so the host
  knows it shows pages, and opens each address once (by its `at`, kept with
  `state.set`), says who handed it over, and offers "Save address".
- **Remembers the address per place.** The address shown is recorded at every
  level of project › epic › part › kehikko; arriving somewhere restores the
  most specific level that has one.
- **Saved addresses**, per project, in the Go menu; Run › Save this address;
  Run › Edit saved addresses… to rename and remove.

## Skills

Four Claude Code skills, offered in Kehikot's Skills window like any module's.
Each is typed by you; an agent cannot start one.

- **`/browser-walkthrough <goal>`**: the agent does it in the Browser while you
  watch. Before each action it outlines the element and says in one line what
  and why; after each meaningful step it pauses for you to say "go on", and
  "I'll take it from here" stops it. It ends with a numbered step list with
  screenshots, kept in View › Show › Walkthroughs.
- **`/browser-before-after [ref]`**: for a UI change (the picked pull or merge
  request, or the one you name), the agent works out which screens the diff
  touches and asks you to confirm the list. It starts the app from `main` and
  from the change's branch in two scratch worktrees, on spare ports, captures
  each screen at the same sizes in light and dark, then stops both servers and
  removes the worktrees. The pairs show side by side in View › Show › Before
  and after. **Nothing is posted until you say so**: type
  `/browser-before-after post <ref>`, or press OK to post there. The pictures
  then go into the description through your own gh or glab, and Claude Code
  asks you before each command. On GitHub they are kept on a `kehikot-shots`
  branch of the repository, never on the change's own branch. Review's Before /
  after view reads them from the description.
- **`/browser-repro <issue>`**: the agent reads the issue's steps and follows
  them in the Browser, outlined as it goes. Each step keeps what was done, what
  happened, a screenshot, and the console errors and failed requests since the
  step before. It tells you plainly whether the bug reproduced, then offers to
  post the evidence as a comment on the issue (only on your yes) or to start a
  Factory job with `/factory`.
- **`/browser-open [what]`**: the picked issue, pull request or merge request
  (or a ref you name: `#12`, `!7`, `PR 41`, `owner/repo#5`) on its forge, read
  from the project's git remotes; or documentation: the project's own docs, or
  the official docs of the library the change or conversation is about, found
  from the project's dependencies and the version it pins. It says which page
  it chose and why, and saves it as a saved address when you ask.

Each skill is one `SKILL.md` in `plugin/skills/`, served at
`/kehikot/skills/<name>.md` with this module's real address filled in. A
session started for one process can be given all four with
`--plugin-dir <folder>` (`sessionPlugin()` in `skills.ts` writes that folder,
filled in, to the temporary directory), where they are listed as
`kehikot-browser:<name>` and typed as `/<name>`.

Only `http:`, `https:` and `about:blank` are opened. Nothing is sent anywhere:
frames go to this module's own page over its own fenced socket, and text to
whoever called the MCP door on this machine.

## Data

- `<project>/.kehikot/browser/saved.json` — saved addresses.
- `<project>/.kehikot/browser/places.json` — the address last shown at each place.
- `<project>/.kehikot/browser/walkthroughs/<id>/` — `walkthrough.json` and a
  screenshot per step (`01.png`, …).
- `<project>/.kehikot/browser/repros/<id>/` — `repro.json`, a screenshot per
  step, and `comment.md`, the evidence as text for the issue.
- `<project>/.kehikot/browser/shots/<ref>/` — `shots.json` and
  `<screen>--<width>x<height>--<theme>--<before|after>.png`; `post/` holds what
  is sent once you said OK.

## Development

```
./run.sh          # starts it; open http://127.0.0.1:8020/app
bun test
bun run typecheck
bun run build     # the page, built and stamped with the commit (a host does this)
```

`KEHIKOT_BROWSER_HEADLESS=0` shows the browser window, for debugging.

## Served ready-built

An installed copy is served from a page built ahead of time, by one Bun process
(`serve.ts`, the protocol's `run`), whenever `dist/` carries a stamp of the commit
checked out. Otherwise, as in a checkout somebody edits, `run.sh` runs Vite as
before, and says why when there is a stamp of another commit. `bun run build`
makes the build and the stamp; a host runs it when it installs or updates the
module, so a start never builds. A stale build is never served: `serve.ts`
answers the page and its files with a 503 that names both commits, while the
doors keep answering.

Both servers share the doors (`answer` and `ours` in `doors.ts`, mounted by
`doors()` on Vite and by `run` on Bun) and the stream (`streamSession` in
`browser/stream.ts`, on `ws` there and on Bun's WebSocket here). On Bun the
handshake fence is the protocol's `socketFence`, the same rule as `fenced`; the
ticket is still the first message. A frame waits for the last one to have left,
which is `ws.send`'s callback on Vite and Bun's `drain` here.

**playwright-core works under Bun** (Bun 1.4.0, playwright-core 1.64.1, Chrome
155, macOS arm64), so nothing else changed. Checked against a local test page,
the built server and Vite (Node) side by side, each with its own scratch home,
registry and profile:

- `launchPersistentContext` (the `chrome` channel), CDP sessions,
  `connectOverCDP` from outside and the `cdp_endpoint` snippets;
- every MCP tool, in one scripted run per server (navigate, read_page, find,
  highlight, click, type, key, scroll, wait_for, screenshot, console_log,
  network_failures, back/forward/reload, show_view, the saved addresses,
  open_ref, walkthroughs, repros and before/after shots through to posting):
  the same answers on both, apart from times, ids and the port;
- the skills: each SKILL.md and its `!` line (`/api/skill/say`), and an OK to
  post typed through `/browser-before-after post <ref>`;
- the live view in a page, standalone and framed from another origin: frames
  drawn, the address bar, Back, pointer, keys and wheel through the canvas,
  console lines live; an animated page streams at 60 frames a second, about
  9 MB/s, on both;
- the fences: another origin, no origin and a rebound host name are refused
  with 403, and a wrong ticket closes with 4003;
- a download link is not downloaded (`acceptDownloads: false`) and DevTools
  opens its window, on both;
- a login kept in the profile survives a restart on both. On either server a
  stop kills Chrome rather than closing it, so a cookie set in the last moments
  before a stop can be lost; that is as it was.

Start, load and memory, Vite (0.3.0) against the built server, each started
fresh five times in a scratch environment. Memory is the module server only
(node and esbuild, or bun), not the Chromium it drives, which is the same
either way:

| | Vite dev | built (`serve.ts`) |
|---|---|---|
| spawn → first 200 | 272–428 ms | **169–192 ms** |
| page `load` | 276–345 ms, 45 requests | **38–53 ms, 3 requests** |
| page opened → first frame | 618–683 ms | **358–416 ms** |
| resident memory, started | 200–209 MB | **109–115 MB** |
| resident memory, page open and browsing | 308–311 MB | **116–122 MB** |

playwright-core itself is about 125 ms and 78 MB of that under Bun (Bun alone is
10 MB), which is why this module stays above the others that run ready-built.
