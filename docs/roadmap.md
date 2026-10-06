# Roadmap: the Raza vertical slice

The slice zones are the same as the UE slice: Raza town, the inn, shops, bank and vault, the crypt (mummies) and the museum (RIDs 300–308), then north into 330 Forest and 331 Farol West (bunnies, rats, spiders, centipedes) (RIDs 330–333). The slice data already exists in meridian-unreal: `data/zones.json`, `zone_layout.json`, `monsters.json` and `data/audio/rooms.json`.

New characters start in the Inn of Raza, so the starting zone is the slice zone.

## Milestones

### 0. Server running + de-risk spike (go/no-go)

- [x] Copy the Server 104 source into `server/src`, then build `blakserv`, the Kod and `rsc0000.rsb` (`server/build.cmd`, VS 2026).
- [x] Run it locally (`server/setup-run.cmd`, then `server/src/run/server/blakserv.exe`).
- [ ] Log in with the **original Windows client** pointed at localhost. Our own `clientd3d` build with our `SecretKey` is ready in `server/src/run/localclient` (`server/build.cmd Bclient Bmodules`, then `server\setup-client.cmd`); it needs a hands-on test.
- [x] Headless Node client logs in **through the gateway**, creates a character, enters the game and receives `BP_PLAYER` and `BP_ROOM_CONTENTS` (the Inn of Raza).
- [x] Walks to an exit and changes room: Inn → Raza via `BP_REQ_GO`.
- [x] LCG and redbook handling survive 5+ minutes of play: a 330 s soak sent 1,321 game messages (walking a loop in Raza, chatting every 3 s) and got 65 pings / 65 echoes, with no resync or hang-up.

### 1. Repo and pipeline

- Workspace packages, lint and tests (npm dependencies need the user's OK).
- The asset build script (`.bgf`, `.roo`, `.rsb`, `.ogg` → `dist/assets/` with a manifest).
- One command starts the local dev stack: blakserv, the gateway and Vite.

### 2. Formats and room viewer

- TS parsers for BGF (port `meridian-unreal/tools/bgf2png/bgf2png.py`), ROO (`roofile.py` plus `bspload.c`), RSB (done: `packages/formats/src/rsb.ts`) and the palette.
- Render Raza with textures, sector light, the WF_* wall UV flags, animated textures and sky, with a free camera.
- Compare against original-client screenshots.

### 3. Into the world

- Login, character select, and entering the game.
- Objects as camera-facing sprites with view-angle frames (`clientd3d/draw.c:108-148`), animation groups, hotspot overlays, xlat colours and name labels.

### 4. Moving and talking

- Movement and collision ported from `move.c`; `REQ_MOVE` and `REQ_TURN`; interpolation for other movers.
- Exits (`REQ_GO` on door squares, edge exits), room changes and teleports.
- Look, use, get and drop. Chat with `BP_MESSAGE` formatting ported from `srvrstr.c`.
- Ping from a Web Worker, because background tabs throttle timers and the server hangs up after 30 s.

### 5. The game UI

- Stat bars, inventory, spells, skills and enchantments; NPC buy and sell; the minimap.
- Sound and music via `BP_PLAY_WAVE`, `STOP_WAVE` and `PLAY_MUSIC`, following meridian-unreal ADR 0006.
- Settings and keybinds.

### 6. Combat and creation

- Attack and cast against the 330/331 creatures and the mummies; death and respawn; loot.
- The character creator (`module/char`).

### 7. Host and playtest

- One Linux VPS with blakserv, the gateway, and Caddy for WSS and static files (sizing: meridian-unreal ADR 0004).
- Test Chrome, Firefox and Safari.
- A friends playtest mixing original-client and browser players.

## What the slice must prove

- [ ] An unmodified Server 104 `blakserv` (plus config changes only) serves browser players through the gateway.
- [ ] Raza looks like the original: the same textures, colours, light and sprites, crisp at 1440p and in widescreen.
- [ ] Movement and collision match the original. No wall clipping, and original clients see browser players move normally.
- [ ] Chat, shops, combat, death and respawn, and room changes work end to end.
- [ ] Original-client and browser players play together on one server.
- [ ] The first room loads in under 5 s on broadband, and sessions stay stable for 1+ hour, including background tabs.
- [ ] The modern controls feel better than the original's, and the original preset still works.

## Open questions

- **The original Windows client and the `SecretKey`.** The installed 104 client has the live server's key compiled in, so it can't log in to our server as-is. We build our own instead:
  - `login.c` comes from `login.c-example` with our key. The example is stale: `LoginOk` needs a second `int sessionid` parameter to match `login.h`.
  - `dm.dll` (the DM tools module) fails to link (`ShowBGFEditorDlg`); players don't need it.
  - `server\setup-client.cmd` adds the art and music from the installed 104 client but keeps our `rsc0000.rsb` and rooms, which must match the server.

## Progress log

- **2026-10-06:**
  - Built and ran `blakserv` from a copy of the Server 104 source with VS 2026 (needed `/WX-` only).
  - Wrote `packages/protocol` (framing, LCG security, redbook token, login and game messages), `packages/formats` (RSB), the gateway, the headless client and the maintenance helper.
  - The bot logged in through the gateway, created "Shardbot", spawned in the Inn of Raza, and walked through the door to Raza.
  - Found two corrections to the plan (see [protocol.md](research/protocol.md)): fresh connections skip the beacon handshake, and the server rejects moves to spots outside the room.
  - Ran the 5.5-minute soak (passed), and built our own Windows client (`meridian.exe` plus the char, merintr and mailnews modules) for the parity test.
