# ADR 0001: Direction and architecture

- **Status:** accepted, 2026-10-06
- **Source:** [docs/plans/initial-client-plan.md](../plans/initial-client-plan.md) (the handoff plan); this ADR is the decision record.

## Context

Meridian Shards is the third Meridian 59 experiment, beside the UE 5.8 "Unreal Meridian" (`E:\2026_Experiments\meridian-unreal`) and the Roblox spin-off "Fantasy Blocks". It is a faithful browser port of the original client. It talks to our own server, which runs the unmodified Server 104 `blakserv`.

The name comes from the lore: every server or world is a "shard" of one original universe.

## Decisions

1. **Name: "Meridian Shards".** Never "104" in any name or branding. Repo and folder: `meridian-browser`.
2. **Licence: GPLv2.** We port `clientd3d` logic directly (protocol, `move.c`, `xlat.c`, `srvrstr.c`, `bspload.c`); no clean room. `Server-104/roomedit/roogen/roofile.py` may be reused.
   - ~~**Never copy Shards code into the UE remaster**, which stays non-GPL.~~ Changed 2026-10-08: the remaster is GPLv2 too, with an Unreal Engine linking exception, so our own code may go there. Code we ported from the Meridian 59 source still may not, because that exception can only cover code we own (AGENTS.md, "Hard rules").
   - Before going public, check that nothing in git is original art or rooms.
3. **Our server only.** Browser players connect to our server running Server 104 code. We never connect to the live 104 server.
   - Changed 2026-10-08: the hosted browser client was only for early testing and has been taken down. Players use the desktop app (and later the Android app), which runs this same client; the browser is for development.
   - Changed 2026-10-09: the hosted browser client is back, because players asked to try the game without a download. The apps stay the main way to play (their game files are local, so they cost the VM far less traffic).
4. **Server: unmodified `blakserv`, config changes only.** The config is [server/config/blakserv.cfg](../../server/config/blakserv.cfg):
   - our own `SecretKey` (it ships in the JS, so it isn't security);
   - patching and downloads off (the default when the patch hosts are empty);
   - automatic account creation, which is built into `synched.c` and needs no setting.

   Kod changes are allowed later but kept minimal, because Kod defines message formats.
   - We build from **a copy** of the source in `server/src` (git-ignored). `meridian-unreal\Server-104` stays an untouched reference.
   - Windows build for development, Linux build (Docker or WSL) for hosting.
5. **Gateway:** a small Node/TS WebSocket-to-TCP bridge (`tools/gateway`). It passes bytes through unchanged, enforces per-IP limits and logs real IPs. Caddy in front provides WSS/TLS, which matters because the login uses unsalted MD5.
6. **Client stack:**
   - Vite + TypeScript, with a framework-free game core split into packages: `protocol`, `formats`, `world`, `render`, `audio`, `input`.
   - WebGL2 via Three.js with custom ShaderMaterials.
   - React 19 for the UI panels only, with a custom M59-styled CSS skin.
7. **Faithful palette rendering:**
   - BGF and texture pixels are uploaded as 8-bit index (R8) textures.
   - They're drawn through the 256-colour palette LUT, the 64 light-level shading rows (`clientd3d/palette.c`) and per-object `xlat` LUTs.
   - Translucent, black and invisible draw effects are supported.
   - Pixels are nearest-filtered, so they stay crisp at any resolution.
   - Later options: D3D-style lights and fog, and upscaled textures.
8. **Assets:** the original `.bgf`, `.roo`, `.rsb` and `.ogg` files are served as-is over HTTP and parsed in the browser.
   - A build script copies them from our server build plus the 104 client install into a git-ignored `dist/assets/`, with a manifest and content hashes.
   - The client must use the **same `.rsb` and `.roo` files as the server**. The redbook token and the room checksum both depend on them; see [protocol.md](../research/protocol.md).
9. **Modern controls and UI, with the original layout as the default:**
   - WASD with mouselook under pointer lock; Alt or right-click for a free cursor.
   - An "original keys" preset, and rebindable keys.
   - Resizable HTML panels.
   - The `BP_LOAD_MODULE` DLLs (`char`, `merintr`, `mailnews`) map to built-in TS modules.

## Implementation notes (milestone 0, 2026-10-06)

- **Build toolchain:** VS 2026 (MSVC 14.51) builds the VS2015-era source unchanged once warnings stop being errors. `server/build.cmd` sets `_CL_=/WX-`, which appends `/WX-` to every `cl` call; no source edits are needed. MySQL logging is off by default (`[MySQL] Enabled No`).
- **Run folder:** the downloaded source has no `run/server` folder (git-ignored upstream). `server/setup-run.cmd` creates the folders `blakserv` and the Kod install step expect, and installs our config.
- **Zero dependencies so far:** Node 24 runs TypeScript directly (type stripping) and has a WebSocket client. The gateway has a minimal RFC 6455 server (`tools/gateway/ws.ts`), so milestone 0 needed no npm downloads. We can swap in `ws` later behind the same interface.
- Our TS sources must use **erasable syntax only** (no enums, no parameter properties, no namespaces), so Node can run them without a build step. Vite handles them the same way later.

## Implementation notes (milestones 1–2, 2026-10-06)

- **The rendering target is the D3D client** (the one 104 players use), not the old software renderer:
  - Brightness is a per-vertex grey from `GetLightPaletteIndex` at a fixed distance, times the palette colour.
  - Distance falloff is black linear fog whose end depends on each sector's light (`D3DRenderFogEndCalc`).
  - We don't use the 64 palette shading rows from the plan; the D3D path doesn't use them for world geometry.
- **Port the C code, not the Python tools.** Room geometry and texture coordinates come straight from `d3drender.c` / `bspload.c`. The meridian-unreal Python tools were useful maps, but they differ in details (e.g. transposed images).
- **The original 50° × 32° view** (`FovHorizontal`/`FovVertical`) is the default, keeping 32° vertical and widening for widescreen. Other FOVs are an option.
- **Asset priority:** our server build's `rsc0000.rsb` and rooms always win (the protocol depends on them), then the installed 104 client's art (what live players see; about 8% of sprites differ from the source tree), then the Server 104 source tree for gaps.
- **Room ambient** follows Kod `GetRoomLight`: base light + outside factor × (brightness − 50) / 4.

## Implementation notes (milestone 3, 2026-10-06)

- **Sprites are composited on the CPU per object.** The D3D client draws the base and each overlay as separate coplanar quads separated by z-bias. We composite base and overlays into one palette-index image instead, in the same layer order, with each part's xlat applied. Then each object is a single billboard. The pixels and colours are the same, with no z-fighting and one draw per object. The composite is rebuilt only when the frame, animation group or look changes.
- **Name labels are HTML overlays** projected from the sprite tops. They're crisp at any resolution, and later we can click them. Colour and dimming follow `D3DRenderNamesDraw3D`.
- **Keep-alive pings run in a Web Worker**, because the server hangs up after 30 s and background tabs throttle timers.
- **The login secret key** is read from `server/config/blakserv.cfg` at build time (Vite `define`), so there's one source of truth.

## Consequences

- The browser can play with original Windows clients on the same server. That gives us a parity test.
- Movement is mostly client-authoritative. The server rejects only destinations outside the room, so the browser must port `move.c` collision faithfully.
- Protocol drift risk: formats live in Kod and C. We pin the server build and should keep a recorded-session fixture.
