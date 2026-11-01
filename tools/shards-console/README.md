# Shards Console

A Claude Code mod for watching and shipping Meridian Shards from inside a Claude Code session ([ADR 0031](../../docs/adr/0031-shards-console.md)).

- **The `Shards` pane** opens when a session starts in meridian-browser or shards-server, or with `/shards` (`/shards refresh` fetches everything again). It has four sections:
  - **Live:** whether the VM's blakserv is up, its uptime and restarts, who is in the game, new lines in `error.txt` (Show, Mark seen), and the last ship and release tag.
  - **Visits:** m59-shards.com today and over 7 days, from Cloudflare Web Analytics.
  - **Local:** blakserv's ports, the gateway and Vite, with Start, Stop, Restart, Build Kod and Check.
  - **Release:** a commit message, a dry-run switch (on by default), and Ship, Patch, Minor and Major. Each release button shows what it will do, and runs only after Confirm.
- **A band above the prompt:** `● live · 4 online · up 3d │ local ● │ ship 2h ago v0.14.1`, plus any run in progress.
- **The `shards_status` tool:** Claude reads the same snapshots through it instead of sshing to the VM.
- **Build-trap notes for Claude:**
  - A raw `nmake` or `build.cmd` run gets its `.kod(N): error` lines pointed out, along with a `Bserver` build made while blakserv ran.
  - An edit to a `.khd` gets the `.kod` files that use the changed constants listed, to be touched before rebuilding.

## Where the data comes from

The mod runs meridian-browser's scripts and reads their JSON. Each works from a terminal too:

| Script | What it prints |
|---|---|
| `npm run console:status` (`tools/console/live-status.ts`) | The live server, over one ssh call. It uses `.env`'s `SHARDS_DEPLOY_HOST` and `SHARDS_DEPLOY_KEY`, as `ship.ts` does. |
| `node tools/console/local-status.ts` | The local stack. |
| `npm run console:visits` (`tools/console/analytics.ts`) | Visits. Needs `CLOUDFLARE_API_TOKEN` (Account > Account Analytics > Read), `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_SITE_TAG` in `.env`. `node tools/console/analytics.ts --sites` lists the account's sites and their tags once the other two are set. |
| `node tools/console/run.ts` | Runs ships, releases, builds and checks detached. Each run has a log in `~/.meridian-shards/runs`, and a lock lets only one ship or release go at a time. A reload of the mod or a closed session doesn't stop a run; the pane picks the run up again. |

The pane fetches live every minute while it's shown and every 5 minutes otherwise, the local stack every 15 seconds while shown, and visits every 15 minutes.

## Loading it

Add the folder to `env` in your user settings (`~/.claude/settings.json`), then start a new session:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "E:\\2026_Experiments\\meridian-browser\\tools\\shards-console",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

`CLAUDE_CODE_PLUGIN_DIR_WATCH` makes the desktop app's sessions reload the mod when its files change. From a terminal, `claude --plugin-dir tools/shards-console` loads it for one session.

## Working on it

```
claude plugin validate tools/shards-console
claude plugin test tools/shards-console
```

- `hooks/register.tsx` holds the hooks and the drawing, `hooks/console.ts` the fetching, runs, confirm step and trap notes, and `hooks/logic.ts` the pure parts.
- `types/index.d.ts` is the state contract.
- The repository's own `tsc`, eslint and vitest skip this folder, because it is typed against Claude Code's mod API.
- The engine writes `.claude-plugin/types/` (git-ignored) when it loads the mod. After that, `npx tsc -p tools/shards-console` type-checks it with the editor's types.
- The validator's rules shape the code:
  - A function that takes `$` must be a top-level function declaration.
  - An atom is read only in the file that declares it, so `register.tsx` and `console.ts` each declare the atoms they use.
