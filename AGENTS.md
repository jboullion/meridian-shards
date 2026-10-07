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
| `packages/formats/` | Readers for the original files: `.roo` (ported from `bspload.c`), `.bgf`, `.rsb`, `.bsf` sky boxes, and the palette. No Node APIs. |
| `packages/render/` | Three.js rendering: room geometry exactly as `d3drender.c` builds it (`roomGeometry.ts`, renderer-agnostic), the palette + original lighting shader with light maps (`lighting.ts`), `RoomView`, the sky box, xlats (`xlat.ts`), sprite compositing (`sprites.ts`), object lighting and `ObjectsView`. |
| `packages/world/` | `GameSession` (login, characters, game actions, chat and look events), `WorldState` (player, room objects with interpolated motion, inventory, online players, lighting), `PlayerMover` (the `move.c` port), the server-text formatter (`text.ts`) and bitmap-group animation. No DOM or Three.js. |
| `apps/client/` | The browser client (Vite + React): login, character select and the game view (`/`); the room viewer is at `/?viewer` or `/?rid=301`. In `src/game/`: `gameScene.ts` (3D view and input), `audio.ts` (sound, after `audio.c`), `icons.ts` (item pictures), `settings.ts` (sound and key settings, the two key presets), and `ui/` (the interface column, minimap and dialogs). |
| `tools/assets/` | `build-assets.ts`: copies the original files into `dist/assets` (git-ignored) with a manifest, plus the client's interface bitmaps as `ui/*.bmp`. |
| `tools/dev/` | `dev.ts`: the one-command dev stack. |
| `tools/gateway/` | WebSocket-to-TCP bridge in front of blakserv (`ws`). |
| `tools/headless/` | Headless protocol client for spikes and soak tests. |
| `tools/maint/` | Sends commands to blakserv's maintenance port (localhost:9998). |
| `server/config/blakserv.cfg` | Our server config, the source of truth. Copied into the run folder by `server/setup-run.cmd`. |
| `server/build.cmd`, `server/setup-run.cmd` | Build `blakserv` + Kod, and prepare the run folder. |
| `server/src/` | **Git-ignored** copy of the Server 104 source plus build output; `server/src/run/server` is the live run folder (savegames!). |
| `docs/` | ADRs, the roadmap, research notes and the original plan. |

## Running the local stack

```bash
npm install                 # workspaces + dependencies
server\build.cmd            # first time, or after Kod/C changes (VS 2026 x86 toolset)
server\setup-run.cmd        # creates run folders, installs server/config/blakserv.cfg
npm run assets              # dist/assets from our server build + the installed 104 client
npm run dev                 # blakserv (if not running) + gateway (ws://localhost:8059) + Vite (http://localhost:5173)
npm run headless -- --user shardbot --pass shardbot --walk "8.5,7.5 9.05,6.5" --go --stay 10
npm run check               # typecheck + lint + tests
```

- Our build of the original Windows client (for parity tests): `server\build.cmd Bclient Bmodules`, then `server\setup-client.cmd`, then run `server\src\run\localclient\meridian.exe /U:<user> /W:<pass> /H:localhost /P:5959`. Never use the installed 104 client's `rsc0000.rsb` or rooms with our server.
- blakserv takes about 35 s to load a fresh game. It's ready when ports 5959 and 9998 listen.
- `npm test` runs Vitest. The format tests read the real files in `dist/assets` and are skipped if you haven't built the assets.
- The room viewer is at `http://localhost:5173/?rid=<RID>`. In dev, `window.shards.roomScene.lookFrom(row, col, eyeHeight, compassYaw)` places the camera, which is handy for comparing against original-client screenshots.

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
- **Rendering: trust the C code over the Python tools.**
  - Grid textures are stored transposed in the `.bgf`, and the client's s/t coordinates already account for that, so upload the pixels as stored and use u = s, v = t.
  - Wall `length` and the texture offsets are in Kod units (64 per square); heights and positions are in client units (1024 per square). `PETER_FUDGE` (16) bridges them.
- Client coordinates are x east, y south, z up. The scene uses X = x, Y = z, Z = y, in squares, which mirrors handedness, so `RoomView` reverses the triangle winding.
- The room checksum the server sends goes through a 28-bit Kod integer. Compare the low 28 bits only.
- The Browser pane throttles `requestAnimationFrame` while it's hidden, so FPS readouts there are meaningless. Time `renderer.render` instead.
- **Sprites:** each object's base bitmap and overlays are composited on the CPU into one palette-index image (with each part's xlat applied), then drawn as a single billboard. That keeps exact palette colours and avoids z-fighting between coplanar overlays.
- **Handedness:** the D3D client's projection uses a *negative* horizontal FOV (`FovHorizontal`), which mirrors its left-handed view back. Our right-handed scene with X = x, Y = height, Z = y matches what players see, both the world and the sprites (bitmap column 0 on the left). Don't "fix" it.
- **Controls** come from `apps/client/src/game/settings.ts` (rebindable in the settings, O or F10). The modern preset:
  - Click the view to capture the mouse; Esc releases it.
  - WASD or arrows to move (left/right arrows turn), Shift to run, Space/E to open a door.
  - Click to look, F or double click to pick up or activate, right-click for the actions menu.
  - PgUp/PgDn/Home to look up, down and straight, End to turn around, +/- to zoom the map, I for the inventory tab, Enter to chat.
  - The original preset follows `merintr.c interface_key_table` (Alt+arrows strafe, typing starts a chat line).
  - In dev, `window.shards` has `gameScene`, `session` and `audio` (`audio.log` lists what played). `gameScene.frame(dt, t)` lets a script drive movement while the Browser pane is hidden (its rAF is throttled).
- **Object ids:** number items (shillings) carry a tag in the id's top 4 bits. Send plain id fields without it (`objId`, as `protocol.c GetObjId` does) and object-list fields with it plus the amount. Look ids up through `WorldState`'s maps, which ignore the tag like the client's `CompareIdObject`.
- **Settings** live in `localStorage`. Hot reloading `settings.ts` makes a second copy of its listeners, so reload the page after editing it.
- **Trying shops and rooms quickly:** `node tools/maint/maint.ts "send object <player id> TeleportTo RID int 303"` moves a logged-in character on our server (303 smithy, 332 vault, 333 bank, 330 Outskirts).
- **Movement is client-authoritative but checked:** keep `PlayerMover` byte-for-byte faithful to `move.c` (units, step sizes, thresholds). The server only rejects off-map destinations, and other players' original clients see our moves.
- **Uniform arrays** in Three.js `ShaderMaterial`s must be flat typed arrays (or `Vector` objects), not nested JS arrays.
- On Windows, never `spawn` with `shell: true` when the command path has spaces (Node's own path does). Use the shell only for `.cmd` shims such as `npx`.
