# AGENTS.md

Guidance for AI coding agents (and humans who like the detail) working in this repo.

## What this is

**Meridian Shards** is a faithful browser port of the Meridian 59 client. It talks to **our own** server, which runs the unmodified Server 104 `blakserv` through a WebSocket-to-TCP gateway. It's the third experiment beside the UE remaster (`E:\2026_Experiments\meridian-unreal`) and the Roblox spin-off "Fantasy Blocks".

- Decisions: [docs/adr/0001-direction.md](docs/adr/0001-direction.md)
- Milestones and progress: [docs/roadmap.md](docs/roadmap.md)
- Protocol notes: [docs/research/protocol.md](docs/research/protocol.md)

## Hard rules

- **The name is "Meridian Shards".** Never use "104" in any product name, branding, UI text or package name. Referring to the "Server 104" *code* in docs is fine.
- **GPLv2.** Everything here is GPLv2 (see `LICENSE`). We port `clientd3d` C logic directly.
- **Never copy code from this repo into the UE remaster** (`meridian-unreal`), which must stay non-GPL.
- **Raw art never goes in git.** That covers `.bgf`, `.roo`, `.rsb`, `.ogg`, `.wav`, `.bmp` and extracted PNGs. They're served from the git-ignored asset build.
- **The user makes the commits.** Don't `git commit` or push unless explicitly asked. Finish by listing the changed files.
- **Ask before downloading or installing anything** (npm packages, tools, client builds), stating what it is, the source and the size.
- **`meridian-unreal\Server-104` is a read-only reference.** Build and run from our copy in `server/src`.
- **Own server only.** Never point any client or tool at the live 104 server.

## Repo layout

| Path | What it holds |
|---|---|
| `packages/protocol/` | Wire protocol: framing, LCG security word, redbook token, message builders and parsers, the `Connection` state machine. Transport-agnostic; the same code runs in Node and the browser. |
| `packages/formats/` | Readers for the original files: `.rsb` now; `.roo`, `.bgf` and the palette next. |
| `tools/gateway/` | WebSocket-to-TCP bridge in front of blakserv (zero dependencies). |
| `tools/headless/` | Headless protocol client for spikes and soak tests. |
| `tools/maint/` | Sends commands to blakserv's maintenance port (localhost:9998). |
| `server/config/blakserv.cfg` | Our server config, the source of truth. Copied into the run folder by `server/setup-run.cmd`. |
| `server/build.cmd`, `server/setup-run.cmd` | Build `blakserv` + Kod, and prepare the run folder. |
| `server/src/` | **Git-ignored** copy of the Server 104 source plus build output; `server/src/run/server` is the live run folder (savegames!). |
| `docs/` | ADRs, the roadmap, research notes and the original plan. |

## Running the local stack

```bash
server\build.cmd            # first time, or after Kod/C changes (VS 2026 x86 toolset)
server\setup-run.cmd        # creates run folders, installs server/config/blakserv.cfg
server\src\run\server\blakserv.exe   # Windows GUI app; run with the working directory set to that folder
npm run gateway             # ws://localhost:8059 -> 127.0.0.1:5959
npm run headless -- --user shardbot --pass shardbot --walk "8.5,7.5 9.05,6.5" --go --stay 10
```

- Our build of the original Windows client (for parity tests): `server\build.cmd Bclient Bmodules`, then `server\setup-client.cmd`, then run `server\src\run\localclient\meridian.exe /U:<user> /W:<pass> /H:localhost /P:5959`. Never use the installed 104 client's `rsc0000.rsb` or rooms with our server.
- blakserv takes about 35 s to load a fresh game. It's ready when ports 5959 and 9998 listen.
- Run `npm test` for the unit tests (Node's built-in runner, no dependencies).

## Code conventions

- TypeScript run directly by Node 24 (type stripping), so use **erasable syntax only**: no `enum`, no constructor parameter properties, no `namespace`. Use `as const` objects instead of enums. Import with explicit `.ts` extensions.
- Keep `packages/protocol` and `packages/formats` free of Node APIs, so they run in the browser.
- When porting C, cite the source as `file:line` in a comment. Keep wire formats byte-exact, and decode strings as Latin-1 one byte per char. Never use `TextDecoder("latin1")`, which is windows-1252 in browsers.

## Known traps

- The redbook token needs the **same `rsc0000.rsb` the server built**. A wrong string shows up as "first packet after each echo is fine, the second has a garbage type".
- Every game message steps the LCG. Never drop or reorder outgoing game messages after they've been encoded.
- Fresh connections start in login mode (`AP_GETLOGIN` arrives first). The beacon handshake is only for resyncs.
- `BP_CHARACTERS` flag `1` means "needs creation", whatever `blakserv/game.c` says in its comment.
- The maintenance port ends commands with CR (`\r`), not LF.
- The server snaps you back with `BP_MOVE` when a move lands outside the room. Exits need `BP_REQ_GO` while standing on the exit square.
