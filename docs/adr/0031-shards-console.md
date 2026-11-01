# ADR 0031: Shards Console (watching and shipping the game from inside Claude Code)

- Status: accepted (2026-10-31). Built 2026-10-31: the scripts (`tools/console/`, `tools/server/build.ts`, `tools/deploy/remote.ts`) and the mod (`tools/shards-console/`, its README says how to load it). Tried 2026-10-31: the pane reads the live VM, and the Cloudflare query (from memory, unverified in Cloudflare's docs) answers with real visits.
- Builds on: the live stack and `ship.ts` ([deploy/README.md](../../deploy/README.md)), the account service's use of the maintenance port ([ADR 0030](0030-account-recovery.md)), the AI playtester ([ADR 0020](0020-ai-playtester.md)), and the build traps listed in shards-server's `AGENTS.md`.

## Context

Most of the work on Meridian Shards happens in Claude Code sessions, in the Code tab of the desktop app. A few things come up again and again, and each needs its own steps:

- **Is the live server up, and who is on?** That means an ssh to the VM and `docker compose exec blakserv maint "who"` by hand. blakserv already knows the answer (`show status`: version, uptime, sessions; `who`; `channel/error.txt`), but only inside its container: the maintenance port takes connections from 127.0.0.1 alone.
- **Visits to m59-shards.com** are counted by Cloudflare Web Analytics (injected at the edge) and are seen only in Cloudflare's dashboard.
- **Releases** are `npm run ship -- -m "..."`, `release:patch` and `release:minor`, typed into a terminal. `bump.ts major` works but has no script. These commands stop on the first error and ask nothing. They end with `Shipped.`, `published: <url>`, `Would release vX (dry run).` or `!! <message>`.
- **The build traps** in shards-server's `AGENTS.md` are documented and nothing enforces them:
  - The build exits 0 when a `.kod` fails to compile, so `ship.ts` can ship a broken Kod.
  - A running blakserv blocks the `blakserv.exe` copy, and the build still reports success.
  - A `.khd` constant change doesn't recompile the `.kod` files that use it.
  - A failed `bc` can corrupt `kod/kodbase.txt`.

Claude Code runs mods: plugins of hooks written in TypeScript. They can draw a pane in the Code tab and a band above the prompt, add slash commands, give the model tools, run host commands, fetch over HTTP and keep state. They also see Claude's own tool calls as they happen. That is the place for these views and buttons: they sit beside the work, and Claude reads the same data.

## Decision

1. **A Claude Code mod, `shards-console`, in `tools/shards-console/`,** versioned with the client. It has three parts:
   - **A pane, `Shards`**, opened with `/shards`, and when a session opens in either repository. It has sections for the live server, visits, the local server and releases.
   - **A one-line band above the prompt**, e.g. `● live · 4 online · up 3d · 2 new errors │ local ● │ ship 2h ago v0.14.1`.
   - **Hooks on Claude's tool calls** for the build traps.

   It loads in the desktop app's sessions through `CLAUDE_CODE_PLUGIN_DIRS` in the user's settings (with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`, so edits reload it). Its `README.md` says how.
2. **Live data comes over ssh, one round trip per poll, with no new endpoint.** `tools/console/live-status.ts` uses `ship.ts`'s ssh helper (moved to `tools/deploy/remote.ts`) and `.env`'s `SHARDS_DEPLOY_HOST` and `SHARDS_DEPLOY_KEY`. It runs one small script on the VM that reads:
   - the blakserv container's state, start time and restart count (`docker inspect`);
   - maint `show status` and `who`;
   - the line count and tail of `channel/error.txt`.

   It prints one JSON object. A failure (no route, container down) is a field, not a crash.
   - **Maint is skipped while the container is under 90 seconds old.** Commands in blakserv's first minute have hung it before (the account service waits for the same reason).
   - **The mod polls every 60 seconds while the pane is shown,** and every 5 minutes otherwise, for the band.
   - **Nothing new is exposed on the internet.** A status endpoint would need admin auth of its own, and only the developer reads this.
3. **Visits come from Cloudflare's GraphQL Analytics API** (Web Analytics: `rumPageloadEventsAdaptiveGroups`), through `tools/console/analytics.ts`:
   - It shows visits and page views today, over 7 days, and per day.
   - It needs a read-only token and the site's ids in `.env`: `CLOUDFLARE_API_TOKEN` (Account Analytics: Read), `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_SITE_TAG`. The user makes the token. Without them it prints `{ "configured": false }`, and the pane says what to set.
   - The mod refreshes it every 15 minutes.
4. **Long commands run detached, through `tools/console/run.ts`, never as the mod's own children.** This covers ship, releases, builds and `npm run check`.
   - A mod's child process dies when the mod reloads, and a deploy killed between swapping the served folders and restarting the stack can leave the site half-updated.
   - Each run writes its output to `~/.meridian-shards/runs/<name>-<stamp>.log`, and its exit code to a file beside it when it ends.
   - A release or ship holds a lock, so only one runs at a time.
   - The pane tails the log. It finds the run again after a reload through the mod's store.
5. **Releases are buttons in the pane:** Ship, Patch, Minor and Major, beside a commit-message box and a dry-run switch.
   - A press shows what will happen before anything runs, and a second press confirms. The confirm shows the version change (read from `apps/desktop/package.json`), both repositories committed and pushed, the live server saved and restarted, and, for a release, the tag and the GitHub release.
   - The buttons run the existing `ship.ts` and `bump.ts`, unchanged in what they do. `npm run release:major` is added beside the others.
   - The output streams into the pane, and the verdict is read from the scripts' last line.
6. **The build traps are fixed in the scripts, not only in the mod.** `tools/server/build.ts` wraps `server\build.cmd`, and `ship.ts`, `dev.ts` and the pane call it. It:
   - backs up `kod/kodbase.txt` before building;
   - keeps the output in `server/build.log`;
   - fails (exit 1) on any `.kod(` error, a `bc` crash or a fatal nmake line;
   - when `Bserver` was built while the local game port listens, says that `run/server/blakserv.exe` is now older than the new build.

   `ship` therefore stops on a Kod that doesn't compile. The mod's hooks cover what Claude does around the wrapper:
   - **A raw `nmake` or `build.cmd`:** its output is scanned for `.kod(` errors, with a warning added to what Claude reads.
   - **A `Bserver` build while blakserv runs:** a note that the copy will fail.
   - **An edit to a `.khd`:** the `.kod` files that use the changed constants are listed, to be touched before the rebuild.
7. **Claude gets a read-only `shards_status` tool:** the pane's last snapshot of live, visits and local. Claude uses it in place of its own ssh to answer "who's on" or "is live up".
8. **Out of scope:**
   - Anything players see.
   - Any write to the live server beyond what ship and release already do.
   - Discord: no webhook exists in any repository yet.

## Consequences

- One look answers "is it up, who's on, did anything break". Shipping is a typed message and two presses, with a dry run one switch away.
- Polling costs one ssh connection a minute while the pane is open, on the e2-micro: a `docker inspect`, two maint commands and a `tail`. That is small next to a player, but it is not nothing; the 5-minute rate for the band keeps a forgotten session cheap.
- **`ship` now stops on a broken Kod,** which it used to ship. A build that worked by luck (an error in a file nothing loads) will now fail until the file is fixed.
- **The mod depends on Claude Code's mod API,** which is new. The scripts it runs (`live-status.ts`, `analytics.ts`, `run.ts`, `build.ts`) are plain Node and work from a terminal without it.
- **The ssh key and the Cloudflare token stay in `.env`** on this machine. The mod reads them only through the scripts and never shows them.

## Building it

1. Write `tools/deploy/remote.ts` (moved out of `ship.ts`), then `tools/console/live-status.ts` and `tools/console/analytics.ts`, and run them by hand.
2. Write `tools/console/run.ts` and `tools/server/build.ts`, then move `ship.ts` and `dev.ts` onto the wrapper. Add the npm scripts `release:major`, `console:status`, `console:visits` and `server:build`.
3. Write the mod: the pane's live and local sections, the band, `/shards` and `shards_status`; then the releases and runs; then visits; then the trap hooks.
4. Test it, then load it from the repository through the user's settings.

## Verifying

- **`node tools/console/live-status.ts`** matches a hand-run `ssh ... maint "who"`.
- **`analytics.ts`** prints `configured: false` without the token, and real numbers with it.
- **`build.ts`** exits 1 and names the file when a `.kod` is broken on purpose, and passes once it is put back. With the local server running, a `Bserver` build prints the stale-exe note.
- **The mod:** `claude plugin validate`, `tsc -p`, and `claude plugin test` on both the terminal and the desktop surface, covering:
  - the pane, the band and the confirm step;
  - `shards_status`;
  - the `.kod(` and `.khd` hooks.

  `$.process` and `$.http` are mocked.
- **In the app:**
  - `/shards` shows the same numbers as ssh.
  - The local server stops and starts from the pane.
  - Patch with dry run ends in `Would release`.
  - A dry-run ship keeps running through a mod reload, and the pane picks it up again.
  - No real ship or release is run to test it.
