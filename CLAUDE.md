# Browser — notes for agents

## Releasing

Kehikot installs and updates this module from its GitHub releases, not from `main`.

1. Bump `version` in `package.json` (semver). It is the only place the version
   is written: the manifest reads it.
2. Write `notes/<version>.md`: what a person notices (see `notes/README.md`).
3. Open a PR with both; merge it.
4. Tag the merge commit on `main` with an annotated tag and push it:
   `git tag -a v<version> -m v<version> <merge-commit> && git push origin v<version>`.
5. `.github/workflows/release.yml` checks that the tag matches `package.json`
   and is on `main`, checks the notes, typechecks and tests, then publishes the
   release "Browser <version>". If a check fails nothing is published: fix it on
   `main`, then tag again.

## Ready-built

`run.sh` serves the built page (`serve.ts`, the protocol's `run`) when
`dist/.kehikot-built` names the commit checked out, and Vite otherwise. `bun run
build` makes it; a host runs that at install and update, never at start. Under Bun
playwright-core works as under Node; the stream socket is Bun's own WebSocket.
Anything about what the module says lives in `doors.ts` and `browser/stream.ts`
(`streamSession`), shared by both servers; `serve.ts` and `vite.config.ts` only
mount them.
