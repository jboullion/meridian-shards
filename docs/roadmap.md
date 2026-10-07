# Roadmap: the Raza vertical slice

The slice zones are the same as the UE slice: Raza town, the inn, shops, bank and vault, the crypt (mummies) and the museum (RIDs 300–308), then north into 330 Forest and 331 Farol West (bunnies, rats, spiders, centipedes) (RIDs 330–333). The slice data already exists in meridian-unreal: `data/zones.json`, `zone_layout.json`, `monsters.json` and `data/audio/rooms.json`.

New characters start in the Inn of Raza, so the starting zone is the slice zone.

## Milestones

### 0. Server running + de-risk spike (go/no-go)

- [x] Copy the Server 104 source into `server/src`, then build `blakserv`, the Kod and `rsc0000.rsb` (`server/build.cmd`, VS 2026).
- [x] Run it locally (`server/setup-run.cmd`, then `server/src/run/server/blakserv.exe`).
- [x] Log in with the **original Windows client** pointed at localhost: our own `clientd3d` build with our `SecretKey` (`server/build.cmd Bclient Bmodules`, then `server\setup-client.cmd`). On 2026-10-06 the user saw Shardbot (the headless bot) standing in the Inn of Raza from the original client.
- [x] Headless Node client logs in **through the gateway**, creates a character, enters the game and receives `BP_PLAYER` and `BP_ROOM_CONTENTS` (the Inn of Raza).
- [x] Walks to an exit and changes room: Inn → Raza via `BP_REQ_GO`.
- [x] LCG and redbook handling survive 5+ minutes of play: a 330 s soak sent 1,321 game messages (walking a loop in Raza, chatting every 3 s) and got 65 pings / 65 echoes, with no resync or hang-up.

### 1. Repo and pipeline (done 2026-10-06)

- [x] npm workspaces (`packages/protocol`, `packages/formats`, `packages/render`, `apps/client`); `npm run check` = `tsc` + ESLint + Vitest.
- [x] The asset build script, `npm run assets`. It writes `.bgf`, `.roo`, `.rsb`, `.ogg`/`.wav`/`.mp3` and the `.bsf` sky boxes to `dist/assets/` with a manifest and content hashes, plus the palette as `palette.bin`.
- [x] One command for the local dev stack, `npm run dev`. It starts blakserv if needed, then the gateway and Vite.

### 2. Formats and room viewer (core done 2026-10-06)

- [x] TS readers ported from the client's own loaders: ROO (`bspload.c`; all 362 rooms parse and pass their checksums), BGF (`dibutil.c`), RSB, the palette and the `.bsf` sky boxes.
- [x] Room geometry built exactly like the D3D client (`d3drender.c`): wall sections and heights, bowties, the WF_* flags (top-down/bottom-up, backwards, no-vtile, transparent), floor and ceiling texture origins, sloped planes.
- [x] Palette rendering: 8-bit index textures through the palette, transparent index 254, nearest filtering.
- [x] The D3D client's lighting: `GetLightPaletteIndex` brightness, sun shading on walls and sloped planes, and the per-sector black fog. Room ambient comes from the Kod formula (base light + outside factor × time of day).
- [x] Animated textures (cycling groups) and scrolling walls and floors, the sky box, and the original 50° × 32° view (Hor+ for widescreen) at the original eye height.
- [x] The room viewer (`apps/client`, `?rid=301`) shows every slice room, with no missing textures.
- [ ] Sloped-texture rotation (the slope's texture angle). Sloped planes currently use the flat mapping.
- [x] Dynamic lights (the light maps around torches and lamps), done in milestone 3.
- [ ] A side-by-side check against original-client screenshots from the same spot. The user's inn screenshot matches in layout, texture orientation and proportions; the remaining brightness difference is the torch light maps.

### 3. Into the world (done 2026-10-06)

- [x] Login, character select (plus a minimal "create with default looks" form until the real creator in milestone 6), and entering the game, all in the browser through the gateway. Keep-alive pings run from a Web Worker.
- [x] `packages/world`: `GameSession` (login → characters → game) and `WorldState` (player, room objects, lighting, sky, dynamic resources), fed by the protocol.
- [x] Objects as camera-facing sprites:
  - frames chosen by view angle (`draw.c GetObjectPdib`) and bitmap-group animations (`animate.c`);
  - overlays placed at hotspots, in the D3D layer order;
  - every xlat ported (`xlat.c`, including guild colours; the light-based ones use the client's own `light_palettes`, extracted from our build's `pal.c`);
  - draw effects (translucent, black, invisible), water depth and hanging objects.
- [x] Object lighting (`D3DObjectLightingCalc`: sector light plus the nearest light source) and the light maps on walls and floors (the warm glow around the inn's torches).
- [x] Name labels (`OF_DISPLAY_NAME`, name colour, dimmed by the object's light, 15-square range).
- Checked in the browser with a second headless player: body, head, hair, arms and legs line up, with skin and clothing xlats.

### 4. Moving and talking (done 2026-10-06)

- [x] Movement and collision ported from `move.c` (`packages/world/src/movement.ts`):
  - steps, wall sliding and sideways nudges;
  - step-up and headroom limits, passable walls;
  - wading slowdown, blocking objects, teleporter pads and hot plates;
  - climbing and falling.
- [x] Server updates follow `MoveUpdateServer`: `REQ_MOVE` every 250 ms when moved, `REQ_TURN` on angle change. Server corrections and teleports move us back.
- [x] Other movers glide (`moveobj.c MoveObject2` and its catch-up rule), switch to their walking look, and turn to face their direction.
- [x] Exits: doors with Space or E (`BP_REQ_GO` on the exit square); edge exits by walking off the map (off-room `REQ_MOVE` once a second); room changes and teleports. Tested: inn ↔ Raza both ways, and Raza → Outskirts over the north edge.
- [x] Look (description panel), pick up, drop, use and activate (click, F, right-click menu, a simple inventory list on I).
- [x] Chat: the server-text formatter (`srvrstr.c`: `%s %i %q %r %%`, `$N` reordering) and the `~` colour/style codes, in the original grey chat box. Typed commands: say (default), emote / `:`, yell, broadcast.
- [x] Keep-alive pings from a Web Worker (done in milestone 3).
- Server and client agree on position (checked against `show object` on the maintenance port).

### 5. The game UI (done 2026-10-06)

- [x] The original's right-hand column (`module/merintr`), drawn on its own background bitmaps (`ui/*.bmp` from the asset build):
  - our face (`userarea.c`: the face overlays only) and our enchantments;
  - the health, mana, vigor and experience bars (`statmain.c`, `graphctl.c`: value, limit bar, low-vigor red);
  - the minimap (`map.c`): walls on the map paper, object dots by minimap flags, the player's arrow, zoom with +/-, room enchantments in its corner;
  - the tabs (`statbtn.c` bitmaps): Inventory (40 px boxes, "in use" sun, amounts, double click to use, right click for a menu, drag onto the view to drop), Stats, Spells, Skills and Quests.
- [x] Item and object pictures as `DrawObject` draws them: base plus overlays, front view, xlats, stretched to fit.
- [x] Buying (`BP_BUY_LIST` dialog), selling by offer (`BP_OFFERED`/`COUNTEROFFER`, accept or cancel), the vault (withdraw and deposit lists), bank money commands (`deposit N`, `withdraw N`, `balance`), and an amount prompt for dropping part of a stack. Tested with Tomas the smith, Gamos the banker and Bentu the vaultman.
- [x] Sound and music (`audio.c` rules on Web Audio): one music track per room, up to 24 sounds, 2D or 3D with the original's rolloff and stereo pan, loops stopped on leaving a room, the wading splash. Settings: music and sound on/off and volume, looping and random sounds.
- [x] Settings (O or F10): sound, mouselook speed and inversion, and key bindings with two presets. **Modern** is WASD plus mouselook. **Original** is the original's table: arrows, Alt+arrows to strafe, PgUp/PgDn/Home/End, Space, Enter to look, and typing a letter starts a chat line. Every key can be rebound.
- Not yet: `tell`, the who list and the players window, mail, guilds, and casting at a chosen target (with combat, in milestone 6). Double clicking a spell casts it now; a spell that needs a target is cast on yourself.
- To judge by ear against the original: how loud far-away sounds are. `audio.c` gives irrKlang a 32-square max distance, which in irrKlang means "stop getting quieter" (not "silent"), so Raza's country ambience at square (1, 1) plays at about 16% across the town.

### 6. Combat and creation (done 2026-10-07)

- [x] Targeting (`gameuser.c`): click an object to target it; `]` / `[` cycle through attackable things on screen, `\` targets yourself, Esc clears. The target gets the D3D client's green halo (its silhouette, enlarged, behind it) and its name shows under the room name. Entering a room or the target leaving clears it.
- [x] Attacking (`UserAttackClosest`): E (Ctrl in the original preset) attacks the target if it's on screen ("You can't see your selected target." otherwise), or the closest attackable thing within 5 squares; at most every 250 ms, after sending our exact position. Also "Attack" in the right-click menu.
- [x] The first-person hands (`BP_PLAYER_OVERLAY`, `D3DRenderPlayerOverlaysDraw`): the weapon and shield bitmaps at their screen hotspot, sized as the D3D client sizes them on its 800 × 600 back buffer, lit like the player, with the swing animations.
- [x] Screen effects (`BP_EFFECT`, `effect.c`): the red pain flash, whiteout, colour flashes, blindness, shake, invert and paralysis.
- [x] Projectiles (`BP_SHOOT`, `BP_RADIUS_SHOOT`, `project.c`): fully lit sprites flying source to target, or in a ring.
- [x] Casting at targets (`spells.c SpellCast`): no-target spells cast at once; others go to the target, or you pick one (an object in the view, your face, or an inventory item; Esc or right click cancels).
- [x] Tested on our server: killed baby spiders in the Outskirts with the mace (hits, misses, damage messages, XP, unbound energy, auto-loot); died (death sound, the Underworld with its music and lava), walked into the rip in space and came back in the Inn of Raza.
- [x] The character creator (`module/char`): Name, Appearance (the face from the server's parts, gender, hair, eyes, nose, mouth, hair and skin colour), Statistics (1–50, 70 points, the four suggestions), Spells and Skills (45 shared points, Shal'ille and Qor exclusive). Created "Shardmage" with it.
- Not yet: weather (rain, snow, sand), blur and waver, `EFFECT_XLATOVERRIDE`, and the "attack on click" option. The mummies in the crypt aren't fought yet, only the forest creatures.

### 7. Host and playtest

- [x] The hosted stack in Docker (`deploy/`, run book in [deploy/README.md](../deploy/README.md)): blakserv built for Linux, the gateway, and Caddy for HTTPS/WSS, the client and the assets. `tools/deploy/stage.ts` gathers it; `tools/deploy/push.ts` ships it to the VM.
  - blakserv's Linux build works with two compiler flags (`-D__forceinline=inline`, `-fno-unreachable-traps`) and the `-i` console option (its daemon mode runs two servers). Kod's differently cased room names get symlinks.
  - Tested locally on 2026-10-07: a fresh game loads in about a second; a headless login and the browser client work through Caddy at http://localhost:8080; the first room is about 4.9 MB; the stack uses about 200 MB of RAM.
- [x] The VM (2026-10-07): Google Cloud, Debian 12, about 1 GB of RAM (e2-micro class), 1 GB swap, Docker from Docker's repository. Live at https://35-206-75-121.sslip.io with a Let's Encrypt certificate. A browser login over WSS, character creation and entering the Inn of Raza took about 4 s and 4.6 MB. The stack uses about 230 MB; the VM has ~300 MB to spare plus swap. (DigitalOcean if it goes live.)
  - The gateway only accepts the site's own Origin (`GATEWAY_ORIGINS`), so headless tools can't connect from outside; run them on the VM or against the local stack.
- [ ] Test Chrome, Firefox and Safari against the hosted server.
- [ ] A friends playtest mixing original-client and browser players.

## What the slice must prove

- [x] An unmodified Server 104 `blakserv` (plus config changes only) serves browser players through the gateway (the protocol side; proven with the headless client).
- [ ] Raza looks like the original: the same textures, colours, light and sprites, crisp at 1440p and in widescreen.
- [ ] Movement and collision match the original. No wall clipping, and original clients see browser players move normally.
- [x] Chat, shops, combat, death and respawn, and room changes work end to end.
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
  - The user saw Shardbot from the original client, so milestone 0 is done.
  - Milestone 1 (workspaces, checks, asset build, `npm run dev`) and the core of milestone 2 (the room viewer) are done. All 13 slice rooms render with textures, the original lighting model, animations and sky.
  - Milestone 3 is done. You can log in from the browser, pick or create a character, and stand in the Inn of Raza or Raza with every object drawn, lit and labelled like the D3D client.
  - Milestone 4 is done. You can walk with the original collision, open doors, cross edge exits, chat, look, and pick up and drop items. Other players move smoothly.
  - Milestone 5 is done: the original's interface column (bars, face, enchantments, minimap, inventory, stats, spells, skills, quests), shops, selling, the bank and vault, sound and music, and settings with rebindable keys.
  - Found along the way: the client must ask for its inventory, plain id fields drop the number tag, and `BP_CHANGE` updates inventory stacks (see [protocol.md](research/protocol.md)).
- **2026-10-07:**
  - Milestone 6 is done: targeting with the original halo, attacking, the weapon hand, screen effects, projectiles, casting at targets, death and the Underworld, and the full character creator.
  - Death and respawn need nothing special from the client: the server moves you to the Underworld and you walk out through its rip in space.
