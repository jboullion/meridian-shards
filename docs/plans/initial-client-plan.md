# Plan: Meridian Shards, a 1:1 browser port of the Meridian 59 client (Raza vertical slice)

## Context

We already have two experiments: the UE 5.8 "Unreal Meridian" (meridian-unreal) and the Roblox spin-off "Fantasy Blocks". The third is **Meridian Shards**: a faithful browser port of the original client.

- It connects to our own server running the unmodified Server 104 `blakserv`.
- It looks and plays like the original, with modernised controls and UI.
- The name comes from the lore: every server or world is a "shard" of one original universe.

It lives in a new repo at `E:\2026_Experiments\meridian-browser`. The user will start a new session there. This plan is the handoff.

**Decided with the user (2026-10-06):**
1. **Name: "Meridian Shards".** Never use "104" in the name or branding. Repo and folder: `meridian-browser`.
2. **Licence: GPLv2, fully open source.** The repo may start private while experimenting and go public once there's something worth showing.
3. **Own server only.** Browser players connect to our own server, which runs the same Server 104 code. We never connect to the live 104 server.
4. **Look: faithful and crisp.** The original's 2.5D look, sprites and textures, rendered with WebGL at modern resolutions and in widescreen.
5. **Art: cleared.** The 103/104 teams are fine with this use because the project is open source. Raw art still stays out of git; it's served from the asset build (see below).
6. **Server status:** the Server 104 source is downloaded (`E:\2026_Experiments\meridian-unreal\Server-104`) but has **never been built or run**. Getting it running is the first task.

## Feasibility verdict: yes, and the least risky of the three experiments

Findings, from reading `Server-104/` and searching the web:

- **The protocol is small and fully readable.**
  - Raw TCP on port 5959 (`blakserv/config.c:69`). The maintenance (admin) port is 9998, open to localhost only.
  - A 7-byte header: `u16 len | u16 crc | u16 len | u8 epoch` (`blakserv/session.c`, `clientd3d/com.c:248-277`).
  - About 32 AP_* login messages and about 120 BP_* game messages (`include/proto.h`). The client handles roughly 105 server-to-client types (`clientd3d/server.c:27-116` plus the modules).
  - The body formats the server sends are written in Kod `AddPacket` calls, e.g. `user.kod` `BP_ROOM_CONTENTS`.
  - Three quirks must be reproduced exactly:
    - **The LCG anti-spoof value** on client-to-server game messages: 5 seed streams from `AP_GETCHOICE` (`com.c:257-265, 575-587`, checked at `blakserv/game.c:173-201`). A mismatch hangs up the client.
    - **The message-type XOR** on server-to-client messages, driven by the "redbook" sliding token. `BP_ECHO_PING` resets it (`blakserv/commcli.c:140-180`, `game.c:370-403`, client `server.c:542-559`, `1755-1775`).
    - **Echoing the epoch.** Stale-epoch game messages are dropped silently (`game.c:203`).
- **The login sequence** (`blakserv/synched.c`) has a fork-specific `SecretKey` check (`synched.c:233-238`) and creates accounts automatically for unknown usernames (`synched.c:375-411`). The password is an unsalted MD5 with any 0x00 bytes replaced by 0x01.
- **Browsers can't open TCP, so we need a WebSocket-to-TCP gateway.** It passes bytes through unchanged. `blakserv` has no web support at all, but it builds on Linux (`makefile.linux`, epoll), so the gateway can sit beside it. This is the roBrowser (Ragnarok Online) pattern.
- **The server sends resource IDs, and the client resolves them locally** from `.rsb` (strings and filenames), `.roo` (rooms) and `.bgf` (sprites).
  - The browser must fetch the **same** `.rsb` and `.roo` files that our server was built with. The room checksum is sent in `BP_PLAYER`, and on a mismatch the client blinds the player (`clientd3d/game.c:295-302`).
- **Movement is effectively client-authoritative.**
  - The client does BSP collision and sends `BP_REQ_MOVE` at most every 250 ms (`clientd3d/move.c`).
  - The server skips wall checks for user moves (`room.kod` `ReqSomethingMoved`: "already been checked by client (HAHA!)"), and its speed check is commented out (`user.kod`).
  - So the browser must port `move.c` collision faithfully.
- **The server hangs up after 30 s of silence** (`game.c:98`). The client pings every 5 s.
- **Why not compile the C client to WASM?** `clientd3d` is about 56k lines of C plus 25k in DLL modules, and it's built on Win32: about 100 dialogs, D3D9, WinINet, irrKlang, and `LoadLibrary` modules. The portable parts total about 15k lines: protocol parsing, BSP, movement, palettes and `xlat.c`. **The realistic path is a TypeScript rewrite** that ports those parts and rebuilds the UI natively.
- **Prior art:**
  - No browser M59 client exists.
  - `cyberjunk/meridian59-dotnet` (C#, GPL-3, 2018) implements the full protocol plus BGF, ROO and RSB, with an Ogre client.
  - `tpeppers/m59-harness` (Node.js) is a current protocol client with good notes.
  - Both are references to read, not to copy (licence and drift).
- **Bonus:** on our own server, **the original Windows client and the browser client can share a room**, which gives us a side-by-side parity test.

## Architecture decisions (for ADR 0001 in the new repo)

1. **GPLv2.** Port `clientd3d` logic (protocol, `move.c`, `xlat.c`, `srvrstr.c`, `bspload.c`) directly; no clean room. `Server-104/roomedit/roogen/roofile.py` (the ROO reader) may be reused.
   - **Never copy Shard code into the UE remaster**, which stays non-GPL.
   - Before going public, check that nothing in git is original art or rooms.
2. **Server:** unmodified Server 104 `blakserv`, with config changes only:
   - our own `SecretKey` (it's in the shipped JS anyway, so it's not security);
   - patching and downloads off;
   - auto account creation on for the slice.
   - Build it from **a separate copy** of the Server 104 source. The remaster's `Server-104/` stays an untouched reference.
   - Platforms: the Windows build for local development first; the Linux build (Docker or WSL) for hosting.
   - Kod changes are allowed later but kept minimal, because Kod changes alter message formats.
3. **Gateway:** a small Node/TS WebSocket-to-TCP bridge (`ws`, about 200 lines).
   - Caddy in front provides WSS/TLS, which matters because of the unsalted MD5 login.
   - It enforces per-IP connection limits and logs real IPs (blakserv only sees the gateway).
4. **Client stack:**
   - Vite + TypeScript, with a **framework-free game core** split into packages: `protocol`, `formats`, `world`, `render`, `audio`, `input`.
   - **WebGL2 via Three.js with custom ShaderMaterials.**
   - **React 19 for the UI panels only**, with a custom M59-styled CSS skin. This matches the `meridian-remastered-website` stack, minus Mantine.
5. **Faithful palette rendering:**
   - Upload BGF and texture pixels as 8-bit index (R8) textures.
   - Draw them through a 256-colour palette LUT, the 64 light-level shading rows (`clientd3d/palette.c`) and per-object `xlat` LUTs (hair, skin and clothing colours).
   - Draw effects: translucency, black, invisible.
   - The result: exact original colours, crisp nearest-filtered pixels at any resolution.
   - Later options: D3D-style dynamic lights and fog (`d3dlighting.c`), and upscaled textures.
6. **Assets:** serve the original `.bgf`, `.roo`, `.rsb` and `.ogg` files as-is over HTTP, and parse them in the browser (zlib via `DecompressionStream`).
   - A build script copies them from our server build plus the 104 client install (`%LOCALAPPDATA%\Meridian-104\resource`) into a git-ignored `dist/assets/`, with a manifest and content hashes.
   - Check Ogg playback in Safari, and add an AAC fallback if needed.
7. **Modern controls and UI, with the original layout as the default:**
   - WASD with mouselook under pointer lock (the original had mouselook too, `clientd3d/key.c`).
   - Alt or right-click for a free cursor to click objects.
   - An "original keys" preset, and rebindable keys.
   - Resizable, scalable HTML panels: the 3D view, stat bars, inventory, spells, skills, chat with tabs, the minimap, and tooltips. Icons come from the original BGFs.
   - The `BP_LOAD_MODULE` DLLs map to built-in TS modules: merintr, char and mailnews.

## Vertical slice: Raza (RIDs 300–308, 330–333)

Same zones as the UE slice:
- Raza town, the inn, shops, the bank and vault, the crypt (mummies) and the museum;
- north into 330 Forest and 331 Farol West (bunnies, rats, spiders, centipedes).

The slice data is already extracted in meridian-unreal: `data/zones.json`, `zone_layout.json`, `monsters.json` and `data/audio/rooms.json`.

### Milestones

0. **Get the server running, then the de-risk spike (go/no-go).**
   - Copy the Server 104 source, then build `blakserv`, the Kod and `rsc0000.rsb` following `Server-104/README.md` (nmake from a VS developer prompt).
   - Run it locally and log in with the **original Windows client** pointed at localhost.
   - Write a headless Node protocol client that logs in **through the gateway**, enters a character, receives `BP_PLAYER` and `BP_ROOM_CONTENTS` for Raza, walks to an exit and changes room.
   - The LCG and redbook handling must survive 5+ minutes of play.
1. **Repo and pipeline.**
   - Workspace packages, lint and tests.
   - The asset build script.
   - One command starts the local dev stack: blakserv, the gateway and Vite.
2. **Formats and room viewer.**
   - TS parsers for BGF (port `meridian-unreal/tools/bgf2png/bgf2png.py`), ROO (`roofile.py` plus `bspload.c`), RSB, and the palette (`blakston.pal`).
   - Render Raza with textures, sector light, the WF_* wall UV flags (port `wall_uvs()` from `meridian-unreal/tools/roo2gltf/roo2gltf.py`), animated textures and sky, with a free camera.
   - Compare against original-client screenshots.
3. **Into the world.**
   - Login, character select, and entering the game.
   - Objects as camera-facing sprites with the view-angle frame (`clientd3d/draw.c:108-148`), animation groups, hotspot overlays, xlat colours and name labels.
4. **Moving and talking.**
   - Movement and collision ported from `move.c`; `REQ_MOVE` and `REQ_TURN`; interpolation for other movers.
   - Exits, room changes and teleports.
   - Look, use, get and drop.
   - Chat with `BP_MESSAGE` formatting ported from `srvrstr.c`.
   - Ping kept alive in a Web Worker, because background tabs throttle timers and the server hangs up after 30 s.
5. **The game UI.**
   - Stat bars, inventory, spells, skills and enchantments.
   - NPC buy and sell.
   - Minimap.
   - Sound and music via `BP_PLAY_WAVE`, `STOP_WAVE` and `PLAY_MUSIC`, following the original's rules in meridian-unreal ADR 0006.
   - Settings and keybinds.
6. **Combat and creation.**
   - Attack and cast against the 330/331 creatures and the mummies; death and respawn; loot.
   - The character creator (`module/char`).
7. **Host and playtest.**
   - One Linux VPS running blakserv and the gateway, with Caddy for WSS and static files. Use meridian-unreal ADR 0004 for sizing, but over TCP/WSS.
   - Test Chrome, Firefox and Safari.
   - A friends playtest mixing original-client and browser players.

### What the slice must prove

- [ ] An unmodified Server 104 `blakserv`, plus config changes only, serves browser players through the gateway.
- [ ] Raza looks like the original: same textures, colours, light and sprites, crisp at 1440p and in widescreen.
- [ ] Movement and collision match the original. There's no wall clipping, and original clients see browser players move normally.
- [ ] Chat, shops, combat, death and respawn, and room changes work end to end.
- [ ] Original-client and browser players play together on one server.
- [ ] The first room loads in under 5 s on broadband, and sessions stay stable for 1+ hour, including background tabs.
- [ ] The modern controls feel better than the original's, and the original preset still works.

## Risks

- **First server build.** It has never been run. The build toolchain (nmake and VS) may need fixing, and we need to find out whether blakserv's MySQL stats logging (`blakserv/database.c`) can be switched off. That's why it's milestone 0.
- **Protocol drift.** Formats live in Kod and the client's C code. Pin the server build and keep a recorded-session test fixture.
- **Easy cheating** against a client-authoritative server. Acceptable on our own small server; Kod speed and collision checks can be turned back on later.
- **UI scope creep.** merintr alone is 14k lines. Build only what Raza uses.

## Reuse from meridian-unreal

| Asset | Use |
|---|---|
| `tools/bgf2png/bgf2png.py` | Port the BGF decoder to TS (about 35 lines of logic). Transparent index is 254; grd textures are stored transposed. |
| `tools/roo2gltf/roo2gltf.py` | Port the mesh building, `wall_uvs()`, slope planes and the `sector_at` BSP lookup. |
| `game/.../Core/MRUnits.h`, `docs/findings.md` | Units: 1024 ROO per square, 64 Kod per square, 4096 per circle, 1-based rows and cols. |
| `data/*.json`, `data/audio/*.json` | Slice checklist and test expectations (exits, spawns, sounds). |
| ADR 0004 / 0006 | Hosting sizing; the original's audio rules. |
| `Server-104/claude-testbench/` | Maintenance-port tooling for test setup: spawn, give, teleport. |

## First session in `E:\2026_Experiments\meridian-browser`

1. Seed the docs, using the `fantasy-blocks` layout:
   - `README.md`
   - `AGENTS.md`. Hard rules:
     - the name is "Meridian Shards", never "104";
     - GPLv2;
     - raw art never in git;
     - the user commits;
     - ask before downloads;
     - `meridian-unreal\Server-104` is a read-only reference;
     - never copy code into the UE remaster.
   - `docs/adr/0001-direction.md`: the decisions and architecture above
   - `docs/roadmap.md`: the milestones and the "must prove" checklist
   - `docs/research/protocol.md`: the protocol facts and `file:line` references above, plus sources: meridian59-dotnet, m59-harness, roBrowser and wsProxy, websockify, M59 `doc/protocol.txt`
   - `LICENSE`: GPLv2
2. Start milestone 0 by getting `blakserv` built and running.
3. Save a project memory, "Meridian Shards browser port", linking [[m59-remaster-decisions]] and [[fantasy-blocks-roblox-spinoff]].

In meridian-unreal: at most one pointer line in the README. Don't commit; the user handles commits.

## Verification

- Check every cited `file:line` against `Server-104/` when writing `docs/research/protocol.md`.
- Check that the slice zones match `meridian-unreal/data/zones.json`.
- Make sure no "104" appears in any product name or branding.
- Milestone 0 passes when the original client and the headless Node client both log in to the local server and change rooms in Raza.
