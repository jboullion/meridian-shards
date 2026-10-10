# AGENTS.md

Guidance for AI coding agents (and humans who like the detail) working in this repo.

## What this is

**Meridian Shards** is a faithful browser port of the Meridian 59 client. It talks to **our own** server, which runs the unmodified Server 104 `blakserv` through a WebSocket-to-TCP gateway. It's the third experiment beside the UE remaster (`E:\2026_Experiments\meridian-unreal`) and the Roblox spin-off "Fantasy Blocks".

- Decisions: [docs/adr/0001-direction.md](docs/adr/0001-direction.md), the desktop app in [docs/adr/0002-desktop-shell.md](docs/adr/0002-desktop-shell.md), the Android app in [docs/adr/0003-android.md](docs/adr/0003-android.md), and the move to our own domain behind Cloudflare in [docs/adr/0004-own-domain.md](docs/adr/0004-own-domain.md)
- Milestones and progress: [docs/roadmap.md](docs/roadmap.md)
- Protocol notes: [docs/research/protocol.md](docs/research/protocol.md)
- What the original has that we don't yet: [docs/missing-features.md](docs/missing-features.md). Add to it whenever something is skipped.
- Using the in-game admin console (admin accounts, commands, cautions): [docs/admin-console.md](docs/admin-console.md)

## Hard rules

- **The name is "Meridian Shards".** Never use "104" in any product name, branding, UI text or package name. Referring to the "Server 104" *code* in docs is fine.
- **GPLv2.** Everything here is GPLv2 (see `LICENSE`). We port `clientd3d` C logic directly.
- **Code may go from this repo to the UE remaster** (`meridian-unreal`), which is GPLv2 too, with an Unreal Engine linking exception (its `LICENSE-EXCEPTION.md`). **Except code ported from the Meridian 59 source**, which follows the original's own logic (`roo.ts`, `bgf.ts`, `roomGeometry.ts`, `movement.ts`, `chess.ts` and the like). That's the original authors' code, which the exception can't cover, so the remaster re-implements it from written-down facts. Code that only implements wire formats, such as `packages/protocol`, isn't a port. The remaster's AGENTS.md has the full rule. Code from the remaster may come here freely.
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
| `packages/render/` | Three.js rendering: room geometry exactly as `d3drender.c` builds it (`roomGeometry.ts`, renderer-agnostic), the palette + original lighting shader with light maps (`lighting.ts`), `RoomView`, the sky box, xlats (`xlat.ts`), sprite compositing (`sprites.ts`), object lighting and `ObjectsView`, weather (`particles.ts`) and blurred vision (`trailBlur.ts`). Ours: smooth textures (`colorTexture.ts`) and, for Enhanced Lighting,, light occlusion (`lightOcclusion.ts`), shaded corners (`roomAo.ts`) and glow and vignette (`postFx.ts`). |
| `packages/world/` | `GameSession` (login, characters, game actions, chat and look events), `WorldState` (player, room objects with interpolated motion, inventory, online players, lighting), `PlayerMover` (the `move.c` port), rooms that change (`roomAnim.ts`, the `roomanim.c` port), the server-text formatter (`text.ts`) and bitmap-group animation. No DOM or Three.js. |
| `apps/client/` | The browser client (Vite + React): login, character select and the game view (`/`); the room viewer is at `/?viewer` or `/?rid=301`. In `src/game/`: `gameScene.ts` (3D view and input), `audio.ts` (sound, after `audio.c`), `icons.ts` (item pictures), `settings.ts` (every option and key binding, the two key presets), and `ui/` (the interface column, minimap and dialogs, `ModernHud.tsx` and `CharacterWindow.tsx` for the Modern interface, `OptionsDialogs.tsx` for the ☰ menu's Preferences, Configuration and Actions windows, and `kit.tsx`, the dialog kit every menu is drawn with: stone frames, lists, buttons, stat bars, laid out in dialog units from the original `.rc` templates). |
| `apps/desktop/` | The desktop app (Electron) around the browser client. `src/main.ts` serves the page as `app://shards/`: the client build, and the game files from the chosen server through a disk cache (`assetCache.ts`). Also the preload (`window.shardsDesktop`), the server list and window state (`settings.ts`), and `electron-builder.yml` (installers, the update feed). `apps/client/src/host.ts` is the client's side of it. |
| `apps/android/` | The Android app (Capacitor) around the browser client ([ADR 0003](docs/adr/0003-android.md)). `capacitor.config.ts`, and the native project in `android/`, where `app/src/main/java/net/meridianshards/client/` holds our code: `ShardsPlugin` (sets the page up before it loads), `ShardsHost` (`window.shardsAndroid`: the server list and choice, the game file download) and `ShardsWebViewClient` (answers `/assets/*` through `AssetCache`, the port of the desktop's `assetCache.ts`). `apps/client/src/host.ts` turns `shardsAndroid` into the same bridge the desktop has. |
| `tools/android/` | `run.ts`: builds the Android app and runs it on a phone or the emulator (`npm run android`). |
| `tools/icons/` | `make-icons.ts`: draws the app icon (a gold shard on stone, our own) as the desktop's `build/icon.png` and the Android launcher icons and splash. Rerun it after changing the drawing. |
| `tools/assets/` | `build-assets.ts`: copies the original files into `dist/assets` (git-ignored) with a manifest, plus the client's interface bitmaps as `ui/*.bmp`, `roomlinks.json` (which rooms connect, from the Kod exits) and `itemslots.json` (where worn items go, from the Kod item classes: `itemSlots.ts`). `fetch-assets.ts`: copies a server's game files into `dist/assets`, for packaging without a server build. |
| `tools/dev/` | `dev.ts`: the one-command dev stack. |
| `tools/gateway/` | WebSocket-to-TCP bridge in front of blakserv (`ws`). |
| `tools/headless/` | Headless protocol client for spikes and soak tests. |
| `tools/maint/` | Sends commands to blakserv's maintenance port (localhost:9998). |
| `tools/deploy/` | `stage.ts` gathers the Docker build context in `deploy/.stage` (git-ignored: game data and art); `push.ts` ships it to the VM over ssh and restarts the stack; `release.ts` releases the desktop app (`npm run release -- <x.y.z>`). |
| `deploy/` | The hosted stack: `docker-compose.yml`, the blakserv Linux image, the gateway image, the Caddyfile, the download page (`web/site/download/`, published to GitHub Pages by `.github/workflows/pages.yml`), and the run book (`deploy/README.md`). |
| `server/config/blakserv.cfg` | Our server config, the source of truth. Copied into the run folder by `server/setup-run.cmd`. |
| `server/config/motd.txt` | The message of the day on the character screen (CRLF line endings, for original clients). `server/setup-run.cmd` copies it into the run folder and deploys put it in the image. |
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
npm run smoke               # headless shardbot: log in, enter, stay 10 s, quit (is the stack up?)
npm run soak                # headless shardbot walking back and forth for 5 min (LCG and token soak)
npm run check               # typecheck + lint + tests
npm run test:watch          # Vitest in watch mode
npm run icons               # redraw the app icons (tools/icons/make-icons.ts)
npm run desktop             # the dev stack plus the desktop app on Vite (F12 for DevTools)
npm run desktop:start       # the desktop app as it ships (app://shards), unpackaged
npm run desktop:build       # an unpacked build in apps/desktop/dist/win-unpacked
npm run desktop:dist        # installers + latest*.yml for this OS, with dist/assets inside
npm run desktop:release     # the same, uploaded to a draft GitHub release (CI does this on a v* tag)
npm run release -- 0.2.0     # bump, commit, tag and push; CI builds all three OSes and publishes v0.2.0
npm run android             # build the client and the debug APK, install it on the phone or emulator, adb reverse 5173, launch
npm run android -- --no-build --device emulator-5554   # reinstall and relaunch only, on one of several devices
npm run android -- --bundle   # with the game files in the APK (dist/assets, ~380 MB), as release builds have them
npm run android -- --release  # the signed release APK as players get it (uninstalls a debug build first: another key)
npm run android:sync        # build the client and copy it into apps/android/android (then build in Android Studio)
```

- **Android** needs Android Studio (the SDK; `apps/android/android/local.properties` says where, e.g. `sdk.dir=J\:/AndroidSDK`) and a JDK 21 for Gradle (`org.gradle.java.home` in `~/.gradle/gradle.properties`). Android Studio's own JDK 25 can't run the template's Gradle 8.14; in Android Studio, set Settings → Build Tools → Gradle → Gradle JDK to the JDK 21 too. Debug builds list "Local (dev)" (`http://localhost:5173` on the device, through `adb reverse`) next to the VM; pick it on the login screen.

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
- **Looking** goes through `GameView`'s `lookAt(id, buttons)`: it sets the next description's DESC_* buttons (`dialog.c SetDescParams`), then sends `BP_REQ_LOOK`. The answer is `BP_LOOK`, or `UC_LOOK_PLAYER` for a player (the Player Description, with their own words and web page). A ¶ (0xB6) splits an inscription into pages.
- **Options** come from `apps/client/src/game/settings.ts`, edited in the game's ☰ menu, laid out like the original's windows (`ui/OptionsDialogs.tsx`):
  - **Preferences** is `client.rc IDD_SETTINGS` without Web Browser (O or F10). Options we don't implement yet are kept anyway and shown in italics; list them in `docs/missing-features.md`.
  - The Game Options and "Can attack innocent players" live on the **server**: `UC_REQ_PREFERENCES` on entering, `UC_RECEIVE_PREFERENCES` back, `UC_SEND_PREFERENCES` (the `CF_*` flags) on OK.
  - **Configuration** is the Bind Editor (`m59bind.exe`): the six tabs and Options (Quick Chat, Always Run, Attack On Target, Dynamic Lighting), plus our Interface tab.
  - Bindings take Alt or Ctrl, and mouse buttons as `Mouse0` (left), `Mouse1` (right), `Mouse2` (middle), like `config.ini`. Unbound F1–F12 send the hotkey aliases.
  - **Actions** has Who (ignoring players), groups (`BP_SAY_GROUP`), hotkey and command aliases, the guild window (from the server: `UC_REQ_GUILDINFO`), and the emotes and moods (`BP_ACTION`). The ☰ menu has the same as an Actions submenu, plus Spells by school.
  - Settings saved by older versions are migrated in `migrate()`; bump `SETTINGS_VERSION` when a saved field changes meaning.
- **Controls**, the modern preset:
  - The mouse is never captured but while the right button is held: hold it and drag to turn the view (orbit the chase camera), the lock asked for on the press (the user's gesture) and let go on release; the drag threshold (`RIGHT_DRAG_SLOP`) counts `movementX/Y`, since the locked cursor doesn't move. A right click without dragging examines, on release (`gameScene.ts rightDrag`). Both interfaces on the desktop; the phone drags with a finger. The original's mouselook (a click, Mouselook Toggle) is gone, and saved bindings for it are dropped in `migrate()`.
  - WASD or arrows to move (left/right arrows turn), Shift to run (or walk, with Always Run), Space to open a door.
  - Left click targets players and monsters only (Select Target, `gameuser.c UserAttack`); E attacks; `]` `[` `\` Esc pick the next, previous, yourself or no target; R looks at the target. Only the target gets the halo; hovering just changes the cursor.
  - Right click looks (Examine, in both presets): the description dialog (`ui/LookDialogs.tsx`, `dialog.c`), with the buttons the original gives it (Get/Use close by, Drop/Use/Unuse in the inventory). Right click on the inventory, the spell list or your portrait looks too.
  - Picking up: drag an item from the view onto the inventory, the dialog's Get, or F (Pick Up) / typing `get`, which takes what's close by (a list when there are several). Double click (or double tap) activates; on a shopkeeper or vault keeper (`OF_BUYABLE`) it opens their Buy or Withdraw window (`GameView askTrader`: BP_REQ_WITHDRAWAL first, since only a vault keeper answers it, then BP_REQ_BUY); on someone who only takes things (`OF_OFFERABLE`, not attackable: a banker) it opens Deposit. Typing `buy` or `offer` deals with the nearest shopkeeper.
  - Several objects under the cursor: a list asks which one (`lookdlg.c DisplayLookList`), for looking, targeting, activating and getting. R (Look) or typed `look` lists everything in view.
  - Containers (storage boxes in rented rooms): Inside in the description, a double click, or dragging the box to the inventory shows what's in it, to take out with amounts; typed `put` stores inventory items in one close by.
  - To try containers on our server: `node tools/maint/maint.ts "create object StorageBox"`, then `"send object <room id> NewHold what object <box id> new_row int <r> new_col int <c>"` (the room is the player's `poOwner` in `show object <player id>`), and `"send object <box id> Delete"` afterwards.
  - T, Y, B and ; start a tell, yell, broadcast or emote; Enter chats.
  - **Quick slots** (ours; `quickSlots.ts`, `ui/QuickSlots.tsx`): ten spells or items per character, kept in `localStorage` (`shards.quickslots.<game socket url>.<character>`) by name, never by object id (saves renumber objects). On the desktop, a hotbar along the bottom of the view: 1-9 and 0 (Quick Slot 1-10 in the Bind Editor's Interface tab; none in the original preset) or a click uses one, a right click or an empty slot opens the picker, and spells (from the Spells list), items and other slots can be dropped on it. On the phone, the Cast button: hold and slide to a slot, rest on one to change it, tap to repeat the last (its icon is on the button, and it's kept per character too, `shards.quickslots.last.*`). The Attack button shows the weapon we wield: the in-use item named by the right hand's player overlay (`TouchControls.tsx wieldedWeapon`). A targeted spell with no target waits for a pick; our face or main stat bars (the phone's HUD bars) pick ourselves.
  - PgUp/PgDn/Home to look up, down and straight, End to turn around, +/- to zoom the map, I for the inventory tab.
  - The original preset follows `merintr.c interface_key_table` (Alt+arrows strafe, typing starts a chat line). Restore Defaults goes back to the modern preset.
  - In dev, `window.shards` has `gameScene`, `session` and `audio` (`audio.log` lists what played). `gameScene.frame(dt, t)` lets a script drive movement while the Browser pane is hidden (its rAF is throttled).
- **Two-player tests on our server:** the test accounts are `shardbot` and `shardpal` (password = name), and `shardadmin` (password = name), an admin account whose character gets the admin console (made with `create account admin shardadmin shardadmin none`, then `create admin <account id>`). If `shardpal` is missing on a fresh server: `node tools/maint/maint.ts "create account user shardpal shardpal none"`, then `"create user <account id>"`, then log in once with `npm run headless -- --user shardpal --pass shardpal` to create its character. Script the second player with a `GameSession` in Node (Node 24 has `WebSocket`), and put both in one room with `TeleportTo`.
- **Rooms that change** (`packages/world/src/roomAnim.ts`): `WorldState.roomChanges` holds the room's changes since the last `BP_PLAYER`. The scene makes a `LiveRoom` (a copy of the cached room) on every `BP_PLAYER` and applies them; movement, the minimap and objects all use `live.room`. Never change the cached `Room` (`roomCache.ts` shares it between visits). Rebuilt geometry comes from `RoomView.rebuild`, only when `live.version` moved.
  - To try a lift: `node tools/maint/maint.ts "send object <room id> SetSector sector int 3 animation int 5 height int 172 speed int 16"` in the Raza crypt (RID 306; height 84 shuts it). The room's object id is the player's `poOwner`.
- **Weather** (`packages/render/src/particles.ts`) steps at 70 a second (the original's frame cap), whatever our frame rate. Snow needs `ui/weather_snow.png` from `npm run assets`; without it, snow falls as lines. three.js sizes points by half the screen height, so `WeatherParticles.setFov` scales the flakes to the camera.
- **Resync:** Server 104 can't complete the beacon handshake (a signed `char` compared with 255 in `blakserv/game.c GameSyncInputChar`), so a transmission error ends in a disconnect after up to 60 s. That's the server, not us.
- **Trading with players** (`offer.c`): the receiver answers an offer with a counteroffer (`BP_REQ_COUNTEROFFER`, possibly empty); only then may the offerer accept (`BP_ACCEPT_OFFER`). The server cancels an accept that comes before the counteroffer (`user.kod UserAcceptOffer`).
- **Object ids:** number items (shillings) carry a tag in the id's top 4 bits. Send plain id fields without it (`objId`, as `protocol.c GetObjId` does) and object-list fields with it plus the amount. Look ids up through `WorldState`'s maps, which ignore the tag like the client's `CompareIdObject`.
- **Testing combat on our server:** `send object <id> SetHealth amount int 1` and `send object <id> Killed` on the maintenance port force a death; the Underworld's "rip in space" brings you back. Never do this on a server with real players.
- **The first-person hands** are sized like the D3D client's 800 × 600 back buffer: a bitmap pixel is 1.75/800 of the view's width and 2.25/600 of its height (`screenOverlays.ts`).
- **Hosting:** blakserv runs on Linux from `deploy/blakserv/Dockerfile`; keep `deploy/blakserv/blakserv.cfg` in step with `server/config/blakserv.cfg`. The game data in the image comes from our Windows build, so rebuild with `serveruild.cmd` and restage after Kod changes. Vite's bundles go to `/assets-client/` because `/assets/` is the game files. The VM hosts the browser client again (taken down 2026-10-08, back 2026-10-09 for players who asked): Caddy serves `deploy/.stage/client` at `/play/` (built with `--base /play/` by `stage.ts`, so `apps/client/dist` stays the apps' build at `/`), everything else but `/assets` and `/ws` redirects there until the marketing site exists, the old `/download/` redirects to the download page on GitHub Pages (`https://jboullion.github.io/meridian-shards/`), and `GATEWAY_ORIGINS` must list the site's own origin next to the apps. `node tools/deploy/push.ts ... --web-only` ships just the client and Caddy's config without restarting blakserv. Caddy takes player addresses from `CF-Connecting-IP` only from Cloudflare's ranges (its `trusted_proxies`, for [ADR 0004](docs/adr/0004-own-domain.md)) and hands the gateway `{client_ip}` as `X-Forwarded-For`; refresh the ranges if Cloudflare's list changes.
- **The desktop app** (`apps/desktop`, [ADR 0002](docs/adr/0002-desktop-shell.md)):
  - The window has no system frame (`frame: false`; macOS keeps its traffic lights with `titleBarStyle: "hidden"`). `apps/client/src/game/TitleBar.tsx` is the title bar on every screen: it drags the window (`-webkit-app-region: drag`, with `no-drag` on anything clickable), and its minimize/maximize/close go over IPC. Close goes through the window's close handler, so it still asks first mid-game.
  - Register the `app` scheme before `ready` (`protocol.registerSchemesAsPrivileged`). Without it the page has no origin of its own: no localStorage, workers or module scripts.
  - The preload is sandboxed, so it must be one CommonJS file importing only `electron`. `vite.config.ts` builds the main process and the preload in two passes.
  - The installer carries `dist/assets`. Files the server has changed since then are cached in `%APPDATA%\Meridian Shards\asset-cache` by name and content hash, checked on download; delete the folder to start over. `logs\main.log` beside it says what came from the install, the cache and the server.
  - Main-process downloads must use `net.fetch(url, { cache: "no-store" })`. Chromium's HTTP cache would keep a second copy and drops the rate to about 8 files a second.
  - Releases are GitHub releases of this repo (`electron-builder.yml` publish). The workflow gets the game files from the VM, so deploy the server before tagging a release.
  - Switching servers reloads the page, because the manifest, `rsc0000.rsb` and rooms come from the server.
  - The gateway sees `Origin: app://shards`, so the VM's `GATEWAY_ORIGINS` must list it next to the site.
  - `npm run desktop` loads Vite, so there's one server (the dev stack) and `window.shards` exists; packaged builds hide the room viewer.
  - Electron is pinned to an exact version (electron-builder needs it), and the builds are unsigned (SmartScreen and Gatekeeper warnings).
  - Timers keep full speed while minimized (`backgroundThrottling: false`); `requestAnimationFrame` still slows down, because Windows stops drawing a minimized window.
  - To drive it from a script, start it with `--remote-debugging-port=9222` and use the Chrome DevTools Protocol.
- **The Modern interface** (ours; `settings.ts interfaceStyle`, desktop only, `!touchUi`):
  - The view fills the window and the HUD sits over it (`ui/ModernHud.tsx`): `UnitFrame` top left, `TargetFrame` top centre, `MapCluster` (the round minimap) top right, and `ActionBar` (bars, `Hotbar`, XP) bottom centre. The chat is the same `.chat` element, placed down the left by `.game.modern-ui` CSS; lines older than `CHAT_FRESH_MS` lose their `fresh` class and fade until the panel is hovered or focused.
  - Classic is untouched: every Modern rule is under `.game.modern-ui`, and `GameView` renders either `<Sidebar>` or the HUD.
  - The hands stay in the view's corners, as in Classic. Their art (`pov*.bgf`) is cut flat along the outer and bottom edges, because the original runs it off the screen there. Placed anywhere else (we tried beside the action bar), the swing shows a straight cut.
  - A click on the minimap opens the full map, and a click on the full map closes it. There are no buttons for the character window or spells: desktop players use the keys.
  - The character window (`ui/CharacterWindow.tsx`, I) reuses `Sidebar.tsx`'s `Inventory`, `StatList`, `NumericStats` and `StatTab`. Its paper doll places used items by `itemslots.json` (`equipment.ts`: picture file name to slot; a missing file puts everything in the bag). Rebuild the assets after Kod item changes. Weight and bulk are the Stats group's "Weight Carried" and "Bulk Carried", matched in English. Its title drags it (`settings.characterWindowAt`, clamped by CSS so the title stays in view); a double press on the title puts it back, detected in the pointer handler because the pointer capture retargets `dblclick`.
  - HUD Size (`settings.hudScale`, the Bind Editor's Options) is CSS `zoom: var(--hud-scale)` on each cluster. Chromium's standardized zoom multiplies a zoomed element's own lengths (its `left`, `top`, `bottom` too) but not percentages of the view. Pointer maths inside a zoomed cluster must convert page pixels: the chat's resize divides by the zoom, the character window keeps its spot in view pixels and divides when it places itself, and `MiniMap.toRoom` scales by `clientWidth / getBoundingClientRect().width`.
  - The inventory's order is the server's (`user.kod UserMoveInventoryItem`: the item takes the other's place). It keeps `plPassive` newest first, so its list is the client's order reversed. Sort is a run of those moves (`inventoryOrder.ts sortMoves`, each taking an item up to an earlier place); `show object <player id>` then `show list <plPassive>` on the maintenance port shows the server's side.
  - Camera views (`gameScene.ts ViewMode`, Camera View: V, the wheel) are the Modern interface's only (`outsideViews()`); switching to Classic or the phone puts us back in first person. Outside, `ObjectsView.update` is given -1 for our id so our sprite is drawn (`pick`/`pickAll` skip it), our look is switched to `self.moving` while the mover moves (the server never moves us), the hands aren't drawn, and the sprites' view angles come from the camera's position (`ctx.viewer`). The chase view steers like the phone's map mode: turn to face the way, then forward. `RoomView.firstHit` keeps the camera in front of walls.
  - Hide Interface (H, `GameView hudHidden`, the `hud-hidden` class) is Modern only and resets when Modern is turned off. The chat is put away with opacity, not `display: none`, so focusing its line (a chat key) brings it back, as on the phone.
  - Spell cooldowns (`cooldowns.ts CastCooldown`, `QuickSlots.tsx CooldownMask`) show on the Modern hotbar and the phone's Cast button and ring, not Classic's. The server sends no cooldowns: `GameSession.onCastSent` starts one for the spell's post-cast delay (`spelltimes.json` by English name, from Kod), and it's taken back unless our mana drops within `CONFIRM_MS`. Melee attacks share the server's timer but aren't shown. Rebuild the assets after changing a spell's `viPostCast_time`.
  - New installs start in Modern. Settings saved before version 8 (0.4.0) move to Modern once, whatever they had; Classic is in the Bind Editor's Options.
- **Settings** live in `localStorage`. Hot reloading `settings.ts` makes a second copy of its listeners, so reload the page after editing it.
- **Typed commands** (`apps/client/src/game/commands.ts`, run by `GameView`'s `runCommand`/`runParsed`): `COMMAND_TABLE` is merintr's, in order (ties go to the first). `interpretLine` decides between a command, an alias, speech and "What?"; keep it pure and tested (`commands.test.ts`). Hotkey aliases and the ☰ Actions items go through `runCommand` too.
- **Chat tabs** (ours; the original has one text window): `packages/world/src/chatChannel.ts` puts each line in Chat (everything `BP_SAID`), Combat or Server. Server messages have no kind, so Combat is matched on the message's *format string*, before names are filled in; add words there when a fight message lands in Server. Everything in the first 5 s after choosing a character or entering the game is the logon's and goes to Server whatever it says (`LOGON_SERVER_TAB_MS` in `session.ts`; attacking or casting ends that early). `appendChatLine` caps each channel at 300 lines.
- **Damage numbers** (ours) come from the attacker's hit message (`battler_attacker_hit` / `_mob` in `battler.kod`), matched by its format string and read from its parameters (`packages/world/src/combatHit.ts`). The message names the target but doesn't give its id, so `GameScene.showDamage` uses the target when the name matches, else the nearest object with that name.
- **Saves renumber objects.** blakserv's garbage collection (every save, or `save game` on the maintenance port) compacts object ids. Clients get `BP_WAIT`, then `BP_INVALIDATE_DATA`, and must ask for everything again (`GameSession` does). Maintenance commands that name an object id are only good until the next save: `show object` it again first.
- **The sun and moon** are background overlays (`packages/render/src/skyOverlays.ts`), sent at logon and every game hour. Kod's negative heights arrive as WORDs above 32767 and aren't drawn (below the horizon). To see one in daylight, check `window.shards.session.world.bgOverlays`.
- **The message of the day:** blakserv reads `motd.txt` from the run folder at startup or on `node tools/maint/maint.ts "reload motd"`, and *moves* it into `memmap\`, so the run folder copy disappears; that's normal. Without one it sends `[MessageOfTheDay] Default` ("<Default>"), which the client hides. To change it, edit `server/config/motd.txt`, run `server\setup-run.cmd`, then `reload motd`.
- **Mail** is kept in `localStorage` (`shards.mail.<game socket url>.<character>`), and a message is only deleted on the server once it's saved there (`apps/client/src/game/mailbox.ts`). Mail and news times are Kod time: Unix time less 1760000000 (`KOD_TIME_BASE`). The original client's base is older and wrong for this server; don't copy it.
- **Trying the stat change and guilds on our server:** `create object StatsResetToken`, `send object <player id> NewHold what object <token id>`, then `send object <player id> SendStatChange` opens the stat sheet. `send object <player id> SendCreateGuild` and `SendBuyGuildHall` open Create New Guild and Rent Guild Hall; a guild costs 5000 shillings (`create object Shillings number int 30000`, then `NewHold`). The guild window needs a guild (`guild` sends `UC_REQ_GUILDINFO`).
- **The interface's bitmaps** come from the asset build as `ui/*` (the client's and the merintr, mailnews modules' resources, `.bmp`, `.ico`, `.cur`); cyan (index 254) is transparent where the original draws with `OBB_TRANSPARENT` (`keyed.ts`). The treatments around the map, inventory and bars are CSS overlays of their pieces (`styles.css .treat-*`, `kit.tsx TREATMENT_PIECES`). In the Classic interface (`GameView classic`, the `classic-ui` class) the layout is the original's (`graphics.c`, `intrface.h`): the stone edge round the client area (`kit.tsx EdgeFrame`), the toolbar row over the view (`Toolbar.tsx ClassicToolbar`: Help, Drop, Get, Rest/Stand, mail, then the latency meter, the room's enchantments right-aligned), the view's 2 px border and `clientd3d` corners (`viewtreat_*`, the `_hilight` set and the gold border while the game has the keyboard, plain and dark brown while the chat line has it: `chat-focused`), and the chat's log and line in one box with the edit treatment (`.chat-box`, `display: contents` in the other layouts). Menus and dialogs keep our stone windows.
- **The profanity filter** (`packages/world/src/profanity.ts`, `apps/client/src/game/profanity.ts`): terms from `ui/profane.dat` (XOR 5), or the player's edited list in `localStorage`. `GameSession.textFilter` runs on every chat line before its markup is parsed, as `srvrstr.c` does. Test with a harmless term like "heck".
- **Language:** `GameSession.setLanguage` picks the `.rsb` language for shown strings. Matching on format strings (chat tabs, damage numbers) must use English (`englishResource`), and the redbook token always looks up language 0.
- **The desktop command line** (`apps/desktop/src/commandLine.ts`): `/U:name /W:pass /Q` (or `-U` and so on; Git Bash turns a leading "/" into a path, so use "-" or `MSYS_NO_PATHCONV=1` there). The launch options reach the page once, through `DesktopConfig.launch`.
- **Chess** (`packages/world/src/chess.ts`, `ui/ChessWindow.tsx`): keep the rules byte-for-byte `cmove.c`'s, since original clients play against ours. To try it: `create object Chess`, put it in the room with `NewHold` (as for storage boxes), and activate it from two characters; script the second with a `GameSession` and `buildMinigameState`. The mover's own state isn't echoed back, so the window keeps its board after a move.
- **The admin console** (`ui/AdminConsole.tsx`) opens with Shift+4 for admin characters only (the module comes from the server). Its commands are the maintenance port's, run as you, so they change the live world. The player-facing guide is [docs/admin-console.md](docs/admin-console.md); keep it in step when the console changes.
- **Trying shops and rooms quickly:** `node tools/maint/maint.ts "send object <player id> TeleportTo RID int 303"` moves a logged-in character on our server (303 smithy, 332 vault, 333 bank, 330 Outskirts).
- **Movement is client-authoritative but checked:** keep `PlayerMover` byte-for-byte faithful to `move.c` (units, step sizes, thresholds). The server only rejects off-map destinations, and other players' original clients see our moves.
- **Uniform arrays** in Three.js `ShaderMaterial`s must be flat typed arrays (or `Vector` objects), not nested JS arrays.
- **Graphics** (ours):
  - Textures are always filtered, as the D3D client draws them, but without its mipmaps (they softened distant walls; its Graphics Options window, Enable MipMaps and Anti Aliasing, is left out). An RGBA copy of each texture is sampled (`packages/render/src/colorTexture.ts`; transparent texels take their neighbours' colour, so filtering leaves no fringes); the 8-bit index textures stay, as `RoomView.firstHit` and `ObjectsView.pickAll` read them (`setSmoothTextures(false)` draws them crisp, as the room viewer does). The hands (`screenOverlays.ts`) and the sun and moon (`SkyOverlaysView.setSmooth`) are filtered too; the interface's bitmaps stay crisp, as the original draws them.
  - **Enhanced Lighting** (`settings.enhanced`, on by default everywhere; in the Bind Editor's Options under Modern Interface, and the phone's Configuration) turns on all of these; off is the original's look. With it off, GameScene renders straight to the screen; on, through `PostFx` (glow and vignette):
    - Soft highlights (`lighting.ts softHighlight`): a colour that would clip rolls off towards white, keeping its hue; nothing changes below 0.8 or for pixels no light adds to.
    - Flickering flames (`objectLighting.ts flicker`, warm lights only).
    - Light stops at walls (`lightOcclusion.ts`: per-triangle bits in `aMask0`/`aMask1`, worked out once per still light in `RoomView`; moving lights, projectiles and the targeting light skip it). Walls within 192 fine units of the light don't block it (wall torches, niches). Rooms were lit for an engine without occlusion, and some put their torches' lights behind the walls: the Museum's hall is darker with it than in Classic.
    - Glowing flames (`postFx.ts`): a half-size glow pass (`lighting.ts glowPass`, shared by every room and sprite material) draws the room black and only light-giving objects' bright pixels and projectiles, blurred and added. Signs (highlight lights) and players carrying a light don't glow.
    - Shaded corners (`roomAo.ts`): a floor/ceiling corner map baked per room (a few ms a frame, so the desert's half second doesn't stall: `RoomView.bakeCorners`), and walls darkened near the floor and ceiling in front of them (`aSurface`). Only the sector light is darkened, not the light maps.
    - Shadows under figures (`ObjectsView.shadows`): players, monsters, NPCs and gettable items, not hanging or flying things.
    - A vignette (`postFx.ts`).
  - **Highlight lights** (`LIGHT_FLAG_HIGHLIGHT` with `LIGHT_FLAG_DYNAMIC`: signs, `sign.kod`, and the targeting light) are a tenth of a full light's size with no falloff on floors (`d3dlighting.c D3DLightingXYCalc`). Drawn full size, the signs washed whole rooms out (the Museum, RID 308).
- **The Android app** (`apps/android`, [ADR 0003](docs/adr/0003-android.md)):
  - The page is `https://localhost/`, served from the APK by Capacitor. `/assets/*` never reaches Capacitor's server: `ShardsWebViewClient` fetches it from the selected server, so the client asks for files exactly as in the browser.
  - `AssetCache` follows the desktop's rules:
    - the APK's copy when the server's hash matches (release builds bundle `dist/assets` as `assets/assets/`);
    - then `filesDir/asset-cache/<name>.<hash>`;
    - then the server, checked against the hash.
  - The full download runs only on an unmetered network and never for the local dev stack. The cache and the download are per process: Android can create the activity twice.
  - The phone layout is `touch-ui` on `.game` (the `touchControls` setting, Auto: a coarse pointer, so phone browsers too; no longer in the Bind Editor, but `localStorage` `shards.settings` can force `"on"` for testing in a desktop browser). `ui/TouchControls.tsx` has the HUD bars, the joystick and the buttons. On a phone the ☰ menu's Configuration is `OptionsDialogs.tsx TouchConfigDialog` (Look Speed, `touchLookScale`; Dynamic Lighting, Enhanced Lighting, Damage Numbers, Attack On Target), not the Bind Editor.
  - Touch on the view is `gameScene.ts`'s pointer handlers: drag looks, tap targets or gets, double tap activates, long press examines. They `preventDefault` the pointerdown, so no emulated mouse events follow, and the canvas has `touch-action: none` (without it the browser cancels a drag).
  - Dialogs with `wide` (`kit.tsx Window`: the character creator, Adjust your character) get up to 50% wider on a phone (`--w` stretches `--dx`; the text keeps its size), as far as the screen allows. Anything in them drawn square needs CSS for it (`.mk-face .face`).
  - The game is landscape (`sensorLandscape`); before it (login, character select, the creator) the phone may turn upright for typing (`Game.tsx` → `host.ts allowPortrait` → `MainActivity.allowPortrait`).
  - Text that a phone's wider font wraps further than the template allows goes in a `kit.tsx FlowPage` (`FlowText` pushes what follows down, `Fixed` keeps a stretch of the template as it is). The window grows for it when the screen has room (`--grow`; place what's below with `at(r, "y")`), and the page scrolls when it hasn't. The creator's pages and Adjust your character use it.
  - The chat is put away with opacity, not `display: none`, so focusing the chat line (any chat key) can bring it out.
  - Android's back button goes through `host.ts onBackButton`: `GameView` closes the top window (`kit.tsx closeTopWindow`), then the panels, then asks before logging off. With no handler, the app closes.
  - The viewport is `user-scalable=no`, and `.game.touch-ui` clips its content. The off-screen drawer once made the browser zoom the page out.
  - **Releases:**
    - The APK is in every release, built by the `android` job in `.github/workflows/desktop.yml` and signed with the release key: `~/.meridian-shards/android-release.*` locally, the `ANDROID_KEYSTORE_*` secrets in CI. It's never in git. Losing it means players must uninstall to update. `deploy/README.md` section 7.
    - The version is the desktop's (`apps/desktop/package.json`).
    - Release builds look for a newer release's APK on GitHub and offer it on the login screen (`host.ts newerApk`). Debug builds don't.
  - Release builds aren't debuggable: no DevTools through `adb forward`. Use a debug build, or `adb logcat -s ShardsAssets`.
  - **The background:** Android freezes a background app within seconds, and blakserv drops a game connection silent for 30 seconds.
    - `ConnectionService` (a foreground service with a notification) keeps the app pinging for 5 minutes after the player leaves it in the game, then the page logs off (`host.ts onAndroidAway`).
    - `adb shell dumpsys activity processes` shows `isFrozen`, and `adb logcat | grep am_freeze` when it happened.
  - `ShardsPlugin` is registered before `super.onCreate` and does its work in `load()`, which runs before the page loads. A JavaScript interface added later only appears after a reload.
  - Debug builds allow cleartext to localhost (`src/debug`) and mixed content (the dev stack's `ws://` from the `https://localhost` page). Release builds allow neither.
  - Vite listens on `127.0.0.1` because `adb reverse` connects to IPv4. With Vite on `::1` only, the app's proxy gets "unexpected end of stream".
  - `cap run android` fails on Windows (it runs `./gradlew` through cmd.exe); `npm run android` replaces it.
  - The app's Origin is `https://localhost`, so the VM's `GATEWAY_ORIGINS` must list it before the app (debug or release) can log in there.
  - To drive the app from a script: `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>` (the pid from `adb shell cat /proc/net/unix`), then the Chrome DevTools Protocol on `localhost:9223`. Debug builds only.
- On Windows, never `spawn` with `shell: true` when the command path has spaces (Node's own path does). Use the shell only for `.cmd` shims such as `npx`.
