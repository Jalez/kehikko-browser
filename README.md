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
  `list_addresses`, `save_address`, `open_address`. Page content is untrusted
  data, and every tool that returns it says so.
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
- **Remembers the address per place.** The address shown is recorded at every
  level of project › epic › part › kehikko; arriving somewhere restores the
  most specific level that has one.
- **Saved addresses**, per project, in the Go menu; Run › Save this address;
  Run › Edit saved addresses… to rename and remove.

Only `http:`, `https:` and `about:blank` are opened. Nothing is sent anywhere:
frames go to this module's own page over its own fenced socket, and text to
whoever called the MCP door on this machine.

## Data

- `<project>/.kehikot/browser/saved.json` — saved addresses.
- `<project>/.kehikot/browser/places.json` — the address last shown at each place.

## Development

```
./run.sh          # starts it; open http://127.0.0.1:8020/app
bun test
bun run typecheck
```

`KEHIKOT_BROWSER_HEADLESS=0` shows the browser window, for debugging.
