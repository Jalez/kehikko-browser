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
```

`KEHIKOT_BROWSER_HEADLESS=0` shows the browser window, for debugging.
