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
- [x] Sloped-texture rotation (the slope's texture angle), done in milestone 13.
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
- Not yet at the time: `tell`, the who list, mail, guilds, and casting at a chosen target. Casting landed in milestone 6, and `tell` and the who list in milestone 9; mail and guilds are in milestone 13.
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
- Not yet at the time: weather, blur and waver, `EFFECT_XLATOVERRIDE` (all done in milestone 13), and the "attack on click" option. The crypt's mummies were fought in milestone 13.

### 7. Host and playtest

- [x] The hosted stack in Docker (`deploy/`, run book in [deploy/README.md](../deploy/README.md)): blakserv built for Linux, the gateway, and Caddy for HTTPS/WSS, the client and the assets. `tools/deploy/stage.ts` gathers it; `tools/deploy/push.ts` ships it to the VM.
  - blakserv's Linux build works with two compiler flags (`-D__forceinline=inline`, `-fno-unreachable-traps`) and the `-i` console option (its daemon mode runs two servers). Kod's differently cased room names get symlinks.
  - Tested locally on 2026-10-07: a fresh game loads in about a second; a headless login and the browser client work through Caddy at http://localhost:8080; the first room is about 4.9 MB; the stack uses about 200 MB of RAM.
- [x] The VM (2026-10-07): Google Cloud, Debian 12, about 1 GB of RAM (e2-micro class), 1 GB swap, Docker from Docker's repository. Live at https://35-206-75-121.sslip.io with a Let's Encrypt certificate. A browser login over WSS, character creation and entering the Inn of Raza took about 4 s and 4.6 MB. The stack uses about 230 MB; the VM has ~300 MB to spare plus swap. (DigitalOcean if it goes live.)
  - The gateway only accepts the site's own Origin (`GATEWAY_ORIGINS`), so headless tools can't connect from outside; run them on the VM or against the local stack.
- [x] The menus in the game's own look (2026-10-07): a dialog kit (`apps/client/src/game/ui/kit.tsx`) draws windows with the stone edge treatment (`drawint.c`), the noise background (`bkgnd.bmp`), Heidelberg titles (`Heidelb1.ttf` from the asset build, its cmap patched so browsers accept it), the edit box treatment, owner-drawn lists and the BlakGraph bar (`graphctl.c`). Controls are placed in dialog units straight from the `.rc` templates.
  - The login dialog (`IDD_LOGIN`, no Server field), Select character (`IDD_CHARPICK`: names sorted, every free slot listed, Log off confirm), and the creator as a property sheet (`IDD_CHAR*` pages, OK/Cancel, message boxes for the checks). Created "Shardkit" through it.
  - The buy, withdraw, offer, deposit and amount dialogs, and the settings as "Preferences" and "Keys" tabs.
  - Reference shots of the original's creator tabs and Preferences are in `docs/research/reference-images/` (git-ignored).
- [ ] Test Chrome, Firefox and Safari against the hosted server.
- [ ] A friends playtest mixing original-client and browser players.

### 8. Desktop client (2026-10-07)

- [x] The decision: Electron over Tauri, game files in the installer with only server changes downloaded, releases on GitHub, and WSS kept ([ADR 0002](adr/0002-desktop-shell.md)).
- [x] `apps/desktop`: the page is `app://shards/`, with the client build and a caching proxy for the selected server's `/assets/`.
  - No reload or close shortcuts, no background throttling, sound without a click, F11 / Alt+Enter fullscreen, and the window remembered.
  - "Log off and quit?" when closing mid-game.
- [x] The login dialog's Server field (the original `IDD_LOGIN` had one): Shards VM, Local (Docker), Local (dev), plus any in `servers.json`.
- [x] Tested on Windows on 2026-10-07:
  - logged in through the dev app and the packaged app (`app://`) and entered the Inn of Raza on the local server;
  - the VM's files load and the cache serves them on the next launch;
  - a gateway limited to `GATEWAY_ORIGINS=app://shards` accepts the app;
  - timers keep their rate while minimized;
  - closing mid-game asks first.
- [x] Packaging: the Windows NSIS installer (112 MB, unsigned) and `latest.yml`. Electron fuses are on. CI for all three OSes (`.github/workflows/desktop.yml`).
- [x] Loading (2026-10-07):
  - The rooms next to yours load ahead (`roomlinks.json` from the Kod exits, `roomCache.ts`).
  - A new room appears at once with its objects and sky.
  - The desktop app ships the game files and downloads only what the server changed, with a health-bar-style progress bar.
  - The client reloads if the server was updated before you log in.
- [x] Hosting: installers on GitHub Releases (`npm run desktop:release`, or the workflow on a `v*` tag); a download page at `/download/` on the VM (on GitHub Pages since 2026-10-08).
- [x] Released (2026-10-07): the repo is public, the VM is deployed, and `npm run release -- <x.y.z>` bumps, tags and pushes. The workflow builds all three platforms into one draft and publishes it. v0.1.3 is the first full release: Windows, macOS (universal) and Linux (AppImage, deb).
- [x] Auto-update checked end to end (2026-10-07): an installed 0.1.3 found 0.1.4 on GitHub, downloaded it in the background, offered "Restart to update" and restarted as 0.1.4.
- [ ] macOS and Linux builds from CI, tried on real machines (pointer lock, sound, WebGL).
- [ ] Signing before going public: Windows (Azure Trusted Signing) and macOS (an Apple Developer account and notarization).

### 9. Options (2026-10-07)

- [x] The ☰ menu in a title bar showing the room (the window title follows it): Preferences, Configuration, Actions.
- [x] **Preferences** as `IDD_SETTINGS`, without Web Browser. Working:
  - targeting: the halo colour (red by default, the original's), Show targeting light, Can attack innocent players;
  - drawing: pain flash, player/NPC/sign names, inventory amounts, bounce;
  - sound, scroll lock, chat timestamps, dynamic map, colored text, FPS, XP as percent;
  - the six server-kept Game Options (`UC_SEND_PREFERENCES`), tested against our server.
  - The rest are kept for later ([missing features](missing-features.md)).
- [x] **Configuration** as the Bind Editor: six tabs plus Interface, Alt/Ctrl and mouse-button bindings, Quick Chat, Always Run, Attack On Target, Dynamic Lighting, mouselook X/Y scales.
- [x] **Actions**:
  - Who (ignore players, all broadcasts, everyone);
  - groups with group messages and `tell` (`BP_SAY_GROUP`, tested);
  - hotkey aliases on F1–F12 and command aliases;
  - the Map key's full-screen map.
  - Guilds (milestone 13): the guild window comes from the server.
- [x] Emotes and moods, on the Actions menu (milestone 13).

### 10. Looking and picking up (2026-10-07)

- [x] The description dialog (`dialog.c`, IDD_DESC and IDD_DESCPLAYER) on right click, everywhere:
  - the picture (animated), the name, the text, and inscriptions in pages;
  - a player's own words and web page, editable for us;
  - the original's buttons: Get, Drop, Use, Unuse, apply.
- [x] Picking up as the original does: dragging to the inventory, Get, and Pick Up / `get` with the pick list (`lookdlg.c`).
- [x] Targeting only what can be attacked (`gameuser.c UserAttack`); no hover tint, no target name over the view.
- [x] Containers (`BP_SEND_OBJECT_CONTENTS`, `BP_OBJECT_CONTENTS`, `BP_REQ_GET_FROM_CONTAINER`, `BP_REQ_PUT`): Inside, double click or drag to open, take out with amounts, typed `put`. Tested with a storage box on our server.
- [x] A list when several objects are under the cursor (look, target, activate, get), and the Look key / `look` listing everything in view.
- [x] The title bar on the desktop is our own: the system frame is gone, with the flower icon, ☰, the room name (no longer over the 3D view), the latency meter, and minimize / maximize / close (close logs off, asking first mid-game).
  - The latency meter is lagbox.c's ping-to-echo round trip: green to 250 ms, yellow to 750 ms, red beyond, with its wording on hover ("fast connection: approximately 73ms latency"). "Show latency meter" in Preferences turns it off.

### 11. Sky and polish (2026-10-08)

- [x] The sun and moon (`BP_ADD/CHANGE/REMOVE_BG_OVERLAY`), placed as the software renderer does (`drawbsp.c`); the D3D client never drew them. Right click looks at them (the sun dazzles you, as Kod says).
- [x] After a server save: `BP_WAIT` clears the target and `BP_INVALIDATE_DATA` fetches the player, room, players and inventory again (`game.c ResetUserData`). Before this, ids went stale after every save.
- [x] Tall item pictures (emeralds, potions) fit their inventory boxes; the description picture is padded and contained.
- [x] Mouselook keeps the cursor in the window (a plain pointer lock); the Preferences window plays its audio choices as you make them.
- [x] The chat window: tabs (All, Chat, Combat, Server), each keeping its own 300 lines, with a mark for new lines; drag its top edge to resize. Both are remembered.
- [x] The desktop app's window and taskbar button use the shard icon, grouped with the installer's shortcuts (`AppUserModelId`).
- [x] Damage numbers (ours): the damage we deal rises over what we hit and fades. It's read from `battler.kod`'s "Your mace bashes the centipede for 4 damage." (melee, ranged and attack spells), so the server is unchanged. Turn it off with Damage Numbers in the Bind Editor's Options.

### 12. Android (proposed, 2026-10-08)

- [x] The investigation: Capacitor around the same client, a native port of the asset cache, a touch layout for phones in landscape, and a signed APK on GitHub releases before the Play Store ([ADR 0003](adr/0003-android.md)).
- [x] Phase 0: the hosted web build on an Android phone runs well; the space is cramped. The phone layout: health, mana and vigor on the view, with the interface column and a full-screen chat sliding out. Frame time and memory aren't measured yet.
- [x] Phase 1: the shell (`apps/android`, Capacitor 8.5) and the host seam. The app logs in to the local stack in the emulator and draws the game; `npm run android` builds, installs and launches it.
- [x] Phase 2: the game files: bundled in release builds, cached and checked against their hashes, downloaded in full on Wi-Fi (`AssetCache.java`).
- [x] Phase 3: Touch Controls and the phone layout, plus the back button and the soft keyboard (emulator; a real phone next).
- [ ] Phase 4: the update notice, CI and the signed APK.

### 13. Feature parity (2026-10-08: phases 0-5 done; what is left is in missing-features.md)

The goal: everything the original client and its modules do. The comparison (the original's message tables against ours, the Kod that sends them, and our UI) is written up as the checklist in [missing-features.md](missing-features.md). Our own additions stay beside the original's features. World fidelity comes first.

- [x] **Phase 0: bookkeeping and fixes.**
  - The checklist.
  - Receiving a trade: our Accept sent `BP_ACCEPT_OFFER`, which the server rejects until you have counteroffered. The Receive Offer dialog is now `IDD_OFFERRECEIVE`: Receive and Send lists, Set items... or Offer nothing (`BP_REQ_COUNTEROFFER`), the echo (`BP_COUNTEROFFERED`), and double click to look. Tested between two local accounts, scripted and in the browser.
  - The wait state while the server saves (`BP_WAIT` to `BP_UNWAIT`): no movement, the wait cursor.
  - `BP_UNLOAD_MODULE` and `BP_LOAD_MODULE` reach the client as a `module` event.
  - `AP_TIMEOUT` and `AP_DOWNLOAD` end the login with a reason instead of hanging.
  - `EFFECT_FIREWORKS` is kept.
  - Fixed `buy`/`offer` with words after them being taken as the command.
- [x] **Phase 1: world fidelity** (2026-10-08).
  - **Rooms that change** (`roomanim.c`): `packages/world/src/roomAnim.ts` keeps a copy of the room per visit (`LiveRoom`), started over on every `BP_PLAYER`. It applies lifts (`BP_SECTOR_MOVE`, animated at their speed, with the walls' heights following), wall bitmaps and their end actions (`BP_WALL_ANIMATE`), `BP_SECTOR_ANIMATE`, texture changes and sector flags. Collision uses the same copy. The scene draws the cache's view until the first change, then its own, rebuilt only when something changed (2.7 ms a frame while the crypt door lifts).
  - Tested on our server: the Raza clock shows the hour, the crypt door lifts from the maintenance port and you can walk through it, and a mummy behind it was fought and killed.
  - **Sloped textures** follow the slope's texture angle (`bspload.c LoadSlopeInfo` with the client's fixed-point maths, `d3drender.c` floor and ceiling extraction): the thatched roofs in Raza.
  - **Blur and waver** as the D3D client draws both (the last eight frames at a quarter opacity, swelling and shrinking), and **`EFFECT_XLATOVERRIDE`** (the phase spell's white).
  - **Weather** (`d3dparticle.c`): rain, snow (`ui/weather_snow.png` from the asset build), sand and fireworks, at the original's 70 steps a second, only outdoors. Show Weather and Particle Density work.
  - **Objects:** `OF_FLASHING` (how detect invisible shows invisible things), `OF_BOUNCING`, projectiles flying from source height to target height or along the ground.
  - **The remote view** (`BP_SET_VIEW`, `BP_RESET_VIEW`), tested with `SetPlayerView` on the maintenance port; Esc comes back.
  - **Resync in the game** (`BP_RESYNC`, a bad frame): the beacon handshake, then the game data again, with the original's 60 s timeout. Server 104 can't finish the handshake (see [protocol.md](research/protocol.md)), so in practice it ends in a disconnect, as with the original client.
  - Left: a side-by-side check with the original client from the same spots.
- [x] **Phase 2: commands and interaction** (2026-10-08).
  - **The command table** (`apps/client/src/game/commands.ts`): merintr's commands with the German names, `parse.c ParseCommand`'s matching (the start of a name will do, "What?" for nothing), and command aliases after them (whole verbs, `~~` for the rest of the line, `alias word command` to define one). By default a line is still said unless it starts with a command; "/" or the Original Command Typing option (the original preset turns it on) parse every line like the original.
  - New commands: `use`, `drop`, `cast <spell>`, `time` (the server's game date), `appeal`, `tellguild`, `suicide` (`IDD_SUICIDE`, checking the password), `password` (`IDD_PASSWORD`, `BP_CHANGE_PASSWORD`; also on the ☰ menu), `newgroup` / `addgroup` / `delgroup`, `tell` to a group, the `safety`, `tempsafe`, `grouping`, `autoloot`, `autocombine`, `reagentbag` and `spellpower on|off` toggles, `hel` and `suicid`.
  - **Emotes and moods** (`BP_ACTION`): typed, on the ☰ menu's Actions submenu (laid out as `actions.c`'s menu) and in the Actions window. Moods change the face on the server (tested: happy, sad, neutral).
  - **Resting** (`mermain.c`): no moving, attacking, casting or doors until `stand`; below 10 vigor you walk.
  - **The Spells menu** (`UC_SPELL_SCHOOLS`): a submenu per school on the ☰ menu, spells sorted, a click casts.
  - **Inventory** (`inventry.c`): drag an item onto another to move it there (`BP_REQ_INVENTORY_MOVE`; the server keeps the order), drop one on a container in the view to put it in, double click an appliable item to use it on something, and the keys (arrows and the numeric pad move, Space/R/U use, L looks, P puts, Delete drops, Esc, Tab).
  - **Chat:** Up and Down go through the last 20 lines; `say.c`'s filter (control characters, runs of spaces and colour codes); a ding (`imp.ogg`) for tells, and `BP_SAY_BLOCKED` when an ignored player's tell is hidden. Speech from non-players always shows, as in the original.
  - **Smaller:** the pick lists' Find box, right click on an enchantment looks, Tab Forward / Back (Tab in the original preset) between the view, the inventory and the chat line, and `UC_SEND_QUIT`.
  - Tested on our server with Shardbot and a scripted Shardpal: the commands' replies, password changes (right and wrong old password), the tell ding and the blocked notice, inventory order kept by the server.
- [x] **Phase 3: social systems** (2026-10-08).
  - **News globes** (`newsread.c`, `newssend.c`): looking at a globe opens its newsgroup (`BP_LOOK_NEWSGROUP`), with the articles (Subject, Author, Date), the chosen one's text (in parts, `BP_ARTICLE`), Reply, Mail author, Post (`IDD_NEWSPOST`), Rescan and Delete, as the globe's permissions allow. Posters you ignore aren't listed.
  - **Mail** (`mailread.c`, `mailsend.c`, `mailfile.c`): `mail` or the ☰ menu opens Read Mail. New messages come from the server one at a time (`BP_REQ_GET_MAIL`, `BP_MAIL`); each is kept in the page's storage per server and character (`apps/client/src/game/mailbox.ts`), and only then deleted on the server (`BP_DELETE_MAIL`). Write, Reply and Reply All open Send Mail, which checks the names first (`BP_REQ_LOOKUP_NAMES`) and says which one is wrong.
  - **Stat reallocation** (`module/stats`): when an elder offers it (`BP_REQ_STAT_CHANGE`), the "Adjust your character" sheet: the six stats sharing 220 points, the eight schools that can only go down, intellect no lower than the levels you keep need, the original's three warnings, then `BP_CHANGED_STATS`.
  - **Guilds** (`guild*.c`): the guild window from `UC_GUILDINFO` (the `guild` command or the Actions window), with Membership (ranks, exile, support for guildmaster, abdicating, leaving; members logged on in red), Alliances, Invite, Guildmaster (the hall's password, abandoning the hall, disbanding) and Shield (colours and pattern, who has claimed a design, claiming), each only as your rank allows. Create New Guild (`UC_GUILD_ASK`) and Rent Guild Hall (`UC_GUILD_HALLS`) open when Frular offers them. The Actions window's placeholder is gone.
  - Tested on our server with Shardbot and a scripted Shardpal: the Inn's and Hall's globes (posting, reading, deleting), mail both ways and a wrong name, a stat change with a `StatsResetToken`, and creating a guild, claiming a shield, inviting Shardpal (the invitation arrived), asking for a hall (refused: the guild is too new) and disbanding.
- [x] **Phase 4: interface** (2026-10-08).
  - **The toolbar** (`toolbar.c`) over the view: Help, Drop items, Get items, Rest/Stand (a toggle that stays in while resting) and Read mail, each bitmap's out and in halves. Show toolbar works.
  - **Tooltips** (`tooltip.c`): on the toolbar, the stat tabs, the enchantments, the latency meter and map annotations (and our own on inventory items and the face), all off with Show tooltips.
  - **Map annotations** (`annotate.c`): a right click on the map adds or edits a note (`IDD_ANNOTATE`, up to 20 a room), drawn as `annotate.bmp` and shown on hover; kept per server and room checksum. Map annotations works.
  - **The profanity filter** (`profane.c`): `profane.dat`'s terms, each letter matching its look-alikes with colour codes and punctuation between, `VerifyProfaneUsage`; incoming lines obscured with symbols or replaced by "profane message blocked", outgoing speech blocked with the original's warning. Profanity Options and Policy is `IDC_PROFANESETTINGS`, with adding and removing terms.
  - **The logout timer** (`logoff.c`, `IDD_TIMEOUT`, on the ☰ menu): logs off after so many minutes without a key or a click.
  - **About Meridian Shards** (`about.c`): our version, the Meridian 59 copyright, and `about.bgf`'s credits scrolling a pixel each 80 ms (a click for the next page). The two sparring figures need resource 19999, which this server doesn't define, so they don't show, as in the original.
  - **The splash** (`module/intro`): "Click here to log on!" under the splash picture, `main.ogg` after 3 s, at startup and after logging off (see [missing features](missing-features.md) for the picture and the logo).
  - **Cursors** (`cursor.c`): the original's target, cross, inside (Shift over a container) and get (dragging) cursors over the view.
  - **Borders** (`drawint.c`): the view's eight corner pieces, the map's, the inventory's and the graph bars' treatments, drawn transparently.
  - **Language** (`language.c`): a ☰ Language menu with the languages the `.rsb` has (English, German, Portuguese on our server); strings fall back to English, and the redbook token and our chat-tab and damage matching stay on English.
  - **The desktop command line** (`config.c ConfigOverride`): `/H` `/P` `/U` `/W` `/Q` (or `-H` and so on); `/Q` logs on at once and, with one character, goes straight in (`charpick.c`). A second start brings the running app forward.
  - Tested on our server: each of the above in the browser, the timer logging off after a minute, and the desktop app with `-U -W -q` going straight into the Inn as Shardpal (one character) and stopping at the character list for Shardbot (three).
- [x] **Phase 5: mini-games and admin** (2026-10-08).
  - **Chess** (`module/chess`): using a chess board loads the module (`BP_LOAD_MODULE` "chess.dll") and opens the window: the board, the players with whose turn it is, check, checkmate, stalemate and resignations, Resign, Restart game, Reset players and Close window, and the pawn promotion dialog. The rules are `cmove.c`'s, in `packages/world/src/chess.ts`; the server only keeps the state string (`UC_MINIGAME_STATE` in, `UC_MINIGAME_MOVE`, `START` and `PLAYER` out). The window is modeless, as the original's.
  - **The admin console** (`module/admin`, for admin characters, who get "admin.dll" on logon): Shift+4 opens it; the command line with its history, the server's answers (`BP_REQ_ADMIN`, `BP_ADMIN`), Go to room, Reset data, and the users logged on with Show, Go to and Rescue. With the console showing, looking at something shows the object there. The object box and its dialogs are left out. How to use it: [admin-console.md](admin-console.md).
  - Tested on our server: a game between Shardbot in the browser and a scripted Shardpal (moves both ways, red's castling flag, resigning, restarting), and Shardadmin's console (`show status`, `show object` from a right click, hiding and reopening).

### 14. The Modern interface (2026-10-09)

Ours, beside the original's layout: Minecraft- and Diablo-style HUD clusters over a view that fills the window, in the original's stone art, after the UE remaster's ADR 0009 UI. Desktop only; the phone keeps its touch layout. New installs start in Modern; players who already had settings keep Classic. It's switched on the ☰ menu (Modern interface) or the Bind Editor's Options.

- [x] **The HUD** (`ui/ModernHud.tsx`):
  - our face, name, Rest/Stand and mail, and our enchantments at the top left;
  - the target's picture and name at the top centre (red if attackable);
  - the minimap in a round frame at the top right (a click opens the full map, and a click on that closes it), with zoom buttons and the room's name and enchantments;
  - health, mana, vigor, the quick slots and experience at the bottom centre.
- [x] **The hands** stay in the view's corners. Beside the action bar the swing showed a straight cut: the weapon art (`pov*.bgf`) is cut along its outer edge, where the original runs it off the screen.
- [x] **The chat** runs down the left side, its width dragged by the right edge. Idle, only lines from the last 10 s show over the view; hovering or typing shows the whole panel.
- [x] **The character window** (`ui/CharacterWindow.tsx`; I): the five stat tabs; on Inventory, a paper doll with Head, Neck, Shirt, Body, Legs, Hands, two rings, Off hand and Weapon, what we wield, weight and bulk from the Stats group, and the bag as a grid of sunk boxes.
  - Where a worn item goes comes from `itemslots.json`, which the asset build reads from each Kod item class's `viUse_type` and pictures (`tools/assets/itemSlots.ts`; 154 pictures on our server). Used items with no slot stay in the bag with the sun.
  - Double click or drag to put on and take off; right click looks.
  - Drag its title to move it; the spot is kept (`characterWindowAt`) and its title always stays in view. Double click the title to put it back beside the map.
- [x] **From play testing** (2026-10-09):
  - drag across the figure to turn it through its eight views (double click faces it front again);
  - drop an item on the figure to put it on;
  - **Sort** puts the bag in the original's list order (amounts first, then by name) with the server's own inventory moves (`inventoryOrder.ts`), and an item dropped on the bag's empty space goes to the end; dragging onto another item still takes its place;
  - the numpad's digits use the quick slots too (modern preset; added to saved keys by settings version 7);
  - the graph bars' top and bottom strips no longer show past their rounded ends (Classic's too).
- [x] **Camera views** (Camera View, V; the wheel): first person, then chase, behind and front, as the UE remaster's.
  - The outside views draw our own sprite (walking while we move) and hide the first-person hands. They tilt at most 20° and start a little above. They turn about our head and zoom toward it. The camera sits a little higher than the line to the head, looking the same way, so we stand low in the view (the action bar may cover our legs) with the head at the same place at any distance.
  - Chase orbits with the mouse; the keys point the way as the camera sees it, and we turn to face that way and walk forward, so the server sees plain turns and steps. Behind and front are fixed to us; the mouse turns us.
  - The camera stops short of the first wall between it and us (a ray against the room, as the name labels' occlusion). The wheel moves it nearer or farther; out of first person it starts the chase view, all the way in from chase goes back.
  - Modern interface on the desktop only; Classic and the phone stay in first person.
  - Tested on our server: all four views in the Outskirts and the Inn, the camera pulling in against the Inn's walls, and chase steering (S turned Shardbot round toward the camera and walked him to it).
- [x] **HUD Size** (the Bind Editor's Options, under Modern Interface): 75–150 %, the bars, quick slots, map, target, chat and character window together, each grown where it stands (CSS `zoom`).
- Tested on our server with Shardbot: a helmet, a ring of acid resistance and a metal shield put on and taken off, the mace on Weapon, the layout at 1024 × 768 and 1600 × 900, the chat's fading and hover panel, the target frame, and switching to Classic and back while playing.

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
- **Possible feature: the gateway adds the login key.** Today every client ships `[Login] SecretKey` (it's in our JavaScript and in the Unreal client's `servers.json`), so the key keeps nothing out. The gateway could write the key into each `AP_LOGIN` on its way to blakserv instead:
  - Login frames are only CRC-checked, not encrypted, so the gateway rewrites the key string and recomputes the CRC. blakserv doesn't change.
  - Clients would send no key, and the real key would live only in the VM's `.env`. The key would become a secret again, so the raw port (5959) would only take original Windows clients we've built.
  - The gate for WebSocket clients would then be the gateway (its origin list and per-address limit), which a non-browser client can get past by sending any `Origin`.
  - Not built: the game has run with a public key for 30 years. Worth doing if we only ever run our own servers and want them tighter. It's also how a Server 104 operator could take our clients without publishing their key.

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
  - Milestone 8 began: the desktop app (Electron) runs the same client, with the game files in its installer and only server changes downloaded. There's a Windows installer, an update feed, a download page and CI for macOS and Linux.
  - Milestone 6 is done: targeting with the original halo, attacking, the weapon hand, screen effects, projectiles, casting at targets, death and the Underworld, and the full character creator.
  - Death and respawn need nothing special from the client: the server moves you to the Underworld and you walk out through its rip in space.
- **2026-10-08:**
  - The hosted browser client is taken down: it was only for early testing. The VM keeps blakserv, the gateway, the game files and the download page, and its front page now goes to the download page. Players use the desktop app (and later the Android app); the browser stays for development.
