---
name: browser-before-after
description: Capture a UI change's affected screens on main and on its branch, at the same sizes, in light and dark, and show them side by side in Kehikot's Browser; put them in the PR or MR description only on the person's OK. Only a person runs it, by typing /browser-before-after [ref], or /browser-before-after post <ref> to OK posting.
argument-hint: "[ref] | post <ref>"
disable-model-invocation: true
allowed-tools: Bash(curl:*), Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(git worktree list:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(glab mr view:*), Bash(glab mr diff:*), mcp__browser__shots_begin, mcp__browser__shot_capture, mcp__browser__shots_status, mcp__browser__shots_post_plan, mcp__browser__shots_post_body, mcp__browser__shots_posted, mcp__browser__show_view
---

The person typed `/browser-before-after $ARGUMENTS`. Kehikot's Browser module at {{origin}} was asked about this conversation's folder. Its answer, then curl's own report in brackets:

!`curl -s -m 10 --retry 3 --retry-connrefused --retry-delay 1 --retry-max-time 8 -w '\n[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}]\n' -X POST -G --data-urlencode "skill=browser-before-after" --data-urlencode "say=$ARGUMENTS" --data-urlencode "cwd=$PWD" {{origin}}/api/skill/say || echo "[no answer from {{origin}}]"`

If the answer above does not begin with "Browser:", or you have no `mcp__browser__…` tools, tell the person in one line: "Kehikot: couldn't reach the Browser module at {{origin}} (curl exit N, HTTP CODE). Open Browser on your kehikko and make sure its tools are on in Kehikot's Tools window, then try again. [skill {{version}}]" — and stop.

**If the answer says the person OK'd posting** (they typed `post <ref>`): go to *Posting* below. Otherwise capture:

1. **The change.** `$ARGUMENTS` names it (`gh#12`, `!7`, a URL, a branch). Empty: use the ref picked out on the canvas (the kehikko door's `read_canvas` says "refs picked out"); if none is picked, ask the person which change and stop. Read its diff with `gh pr diff` / `glab mr diff` (or `git diff main...<branch>`) and its branch names with `gh pr view --json headRefName,baseRefName` / `glab mr view`.
2. **The screens.** From the diff, work out which screens of the app the change shows up on: each a short id, a name and its path on the app (`settings`, "Settings", `/settings`). List them to the person, with the sizes (1280×800 and 390×844 unless they say) and both themes, and ask them to confirm or edit the list. Wait for their answer. Then call `shots_begin` with the ref, a title and the confirmed screens.
3. **Two running copies.** Read the project's AGENTS.md / CLAUDE.md / README for how its app is started in development. Make two git worktrees outside the project folder — `git worktree add ../<project>-browser-shots/<ref>/before <base branch>` and `…/after <head branch>` — install each as the instructions say, and start each on its own spare port (check the port is free first), in the background, noting each server's pid. Wait until each answers.
4. **Capture.** For every screen × size × theme call `shot_capture` with side `before` and the before copy's origin, then side `after` and the after copy's origin. `shots_status` lists what is still missing; capture until nothing is. If the app has its own theme switch rather than following the system's light/dark, say so to the person once and capture what the system setting gives.
5. **Tidy.** Stop both servers by their pids (`kill <pid>`), then `git worktree remove` both worktrees. Capturing is done when every pair is captured, both servers are stopped and both worktrees are removed.
6. **Show.** Call `show_view` with view `shots` and the ref, and tell the person: the pairs are side by side in Browser › View › Before and after, and are kept under `.kehikot/browser/shots/`. To put them in the PR/MR description they type `/browser-before-after post <ref>` or press **OK to post** there. Stop.

**Posting** (only after the answer above says they OK'd it):

1. Call `shots_post_plan` with the project and ref. It refuses until the person OK'd; it then lists the exact gh or glab commands. Run them one at a time, exactly as written: they go through the person's own gh/glab, and Claude Code asks them before each one.
2. Call `shots_post_body` with what the last command printed as `current` (and, for GitLab, each picture's file name mapped to the `url` glab answered), and run the edit command it returns.
3. Call `shots_posted` with where it went. Tell the person in one line; Review's Before / after view now shows the pairs from the description.

Rules that hold throughout:

- The pictures go to a forge only through Posting, and Posting only after the person's OK as described. A capture after their OK clears it.
- Work in the two scratch worktrees; the project's own checkout and its branches stay as they are.
- Stop every server you started, by its pid, before you finish — also when a step fails.
