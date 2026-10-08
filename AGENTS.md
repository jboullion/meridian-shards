# AGENTS.md

Guidance for AI coding agents (and humans who like the detail) working in this repo.

## What this is

**Meridian Shards** is a faithful browser port of the Meridian 59 client. It talks to **our own** server, which runs the unmodified Server 104 `blakserv` through a WebSocket-to-TCP gateway. It's the third experiment beside the UE remaster (`E:\2026_Experiments\meridian-unreal`) and the Roblox spin-off "Fantasy Blocks".

- Decisions: [docs/adr/0001-direction.md](docs/adr/0001-direction.md), the desktop app in [docs/adr/0002-desktop-shell.md](docs/adr/0002-desktop-shell.md), and the proposed Android app in [docs/adr/0003-android.md](docs/adr/0003-android.md)
- Milestones and progress: [docs/roadmap.md](docs/roadmap.md)
- Protocol notes: [docs/research/protocol.md](docs/research/protocol.md)
- What the original has that we don't yet: [docs/missing-features.md](docs/missing-features.md). Add to it whenever something is skipped.

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
| `apps/client/` | The browser client (Vite + React): login, character select and the game view (`/`); the room viewer is at `/?viewer` or `/?rid=301`. In `src/game/`: `gameScene.ts` (3D view and input), `audio.ts` (sound, after `audio.c`), `icons.ts` (item pictures), `settings.ts` (every option and key binding, the two key presets), and `ui/` (the interface column, minimap and dialogs, `OptionsDialogs.tsx` for the ☰ menu's Preferences, Configuration and Actions windows, and `kit.tsx`, the dialog kit every menu is drawn with: stone frames, lists, buttons, stat bars, laid out in dialog units from the original `.rc` templates). |
| `apps/desktop/` | The desktop app (Electron) around the browser client. `src/main.ts` serves the page as `app://shards/`: the client build, and the game files from the chosen server through a disk cache (`assetCache.ts`). Also the preload (`window.shardsDesktop`), the server list and window state (`settings.ts`), and `electron-builder.yml` (installers, the update feed). `apps/client/src/host.ts` is the client's side of it. |
| `apps/android/` | The Android app (Capacitor) around the browser client ([ADR 0003](docs/adr/0003-android.md)). `capacitor.config.ts`, and the native project in `android/`, where `app/src/main/java/net/meridianshards/client/` holds our code: `ShardsPlugin` (sets the page up before it loads), `ShardsHost` (`window.shardsAndroid`: the server list and choice) and `ShardsWebViewClient` (answers `/assets/*` from the selected server). `apps/client/src/host.ts` turns `shardsAndroid` into the same bridge the desktop has. |
| `tools/android/` | `run.ts`: builds the Android app and runs it on a phone or the emulator (`npm run android`). |
| `tools/assets/` | `build-assets.ts`: copies the original files into `dist/assets` (git-ignored) with a manifest, plus the client's interface bitmaps as `ui/*.bmp` and `roomlinks.json` (which rooms connect, from the Kod exits). `fetch-assets.ts`: copies a server's game files into `dist/assets`, for packaging without a server build. |
| `tools/dev/` | `dev.ts`: the one-command dev stack. |
| `tools/gateway/` | WebSocket-to-TCP bridge in front of blakserv (`ws`). |
| `tools/headless/` | Headless protocol client for spikes and soak tests. |
| `tools/maint/` | Sends commands to blakserv's maintenance port (localhost:9998). |
| `tools/deploy/` | `stage.ts` gathers the Docker build context in `deploy/.stage` (git-ignored: game data and art); `push.ts` ships it to the VM over ssh and restarts the stack; `release.ts` releases the desktop app (`npm run release -- <x.y.z>`). |
| `deploy/` | The hosted stack: `docker-compose.yml`, the blakserv Linux image, the gateway image, the Caddyfile, the download page (`web/site/download/`), and the run book (`deploy/README.md`). |
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
npm run check               # typecheck + lint + tests
npm run desktop             # the dev stack plus the desktop app on Vite (F12 for DevTools)
npm run desktop:start       # the desktop app as it ships (app://shards), unpackaged
npm run desktop:build       # an unpacked build in apps/desktop/dist/win-unpacked
npm run desktop:dist        # installers + latest*.yml for this OS, with dist/assets inside
npm run desktop:release     # the same, uploaded to a draft GitHub release (CI does this on a v* tag)
npm run release -- 0.2.0     # bump, commit, tag and push; CI builds all three OSes and publishes v0.2.0
npm run android             # build the client and the debug APK, install it on the phone or emulator, adb reverse 5173, launch
npm run android -- --no-build --device emulator-5554   # reinstall and relaunch only, on one of several devices
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
  - **Actions** has Who (ignoring players), groups (`BP_SAY_GROUP`), hotkey and command aliases, and a guild placeholder. Emotes and moods are a TODO.
  - Settings saved by older versions are migrated in `migrate()`; bump `SETTINGS_VERSION` when a saved field changes meaning.
- **Controls**, the modern preset:
  - Click the view to capture the mouse (or C, Mouselook Toggle); Esc releases it.
  - WASD or arrows to move (left/right arrows turn), Shift to run (or walk, with Always Run), Space to open a door.
  - Left click targets players and monsters only (Select Target, `gameuser.c UserAttack`); E attacks; `]` `[` `\` Esc pick the next, previous, yourself or no target; R looks at the target. Only the target gets the halo; hovering just changes the cursor.
  - Right click looks (Examine, in both presets): the description dialog (`ui/LookDialogs.tsx`, `dialog.c`), with the buttons the original gives it (Get/Use close by, Drop/Use/Unuse in the inventory). Right click on the inventory, the spell list or your portrait looks too.
  - Picking up: drag an item from the view onto the inventory, the dialog's Get, or F (Pick Up) / typing `get`, which takes what's close by (a list when there are several). Double click activates. Typing `buy` or `offer` deals with the nearest shopkeeper.
  - Several objects under the cursor: a list asks which one (`lookdlg.c DisplayLookList`), for looking, targeting, activating and getting. R (Look) or typed `look` lists everything in view.
  - Containers (storage boxes in rented rooms): Inside in the description, a double click, or dragging the box to the inventory shows what's in it, to take out with amounts; typed `put` stores inventory items in one close by.
  - To try containers on our server: `node tools/maint/maint.ts "create object StorageBox"`, then `"send object <room id> NewHold what object <box id> new_row int <r> new_col int <c>"` (the room is the player's `poOwner` in `show object <player id>`), and `"send object <box id> Delete"` afterwards.
  - T, Y, B and ; start a tell, yell, broadcast or emote; Enter chats.
  - PgUp/PgDn/Home to look up, down and straight, End to turn around, +/- to zoom the map, I for the inventory tab.
  - The original preset follows `merintr.c interface_key_table` (Alt+arrows strafe, typing starts a chat line). Restore Defaults goes back to the modern preset.
  - In dev, `window.shards` has `gameScene`, `session` and `audio` (`audio.log` lists what played). `gameScene.frame(dt, t)` lets a script drive movement while the Browser pane is hidden (its rAF is throttled).
- **Two-player tests on our server:** the test accounts are `shardbot` and `shardpal` (password = name). If `shardpal` is missing on a fresh server: `node tools/maint/maint.ts "create account user shardpal shardpal none"`, then `"create user <account id>"`, then log in once with `npm run headless -- --user shardpal --pass shardpal` to create its character. Script the second player with a `GameSession` in Node (Node 24 has `WebSocket`), and put both in one room with `TeleportTo`.
- **Trading with players** (`offer.c`): the receiver answers an offer with a counteroffer (`BP_REQ_COUNTEROFFER`, possibly empty); only then may the offerer accept (`BP_ACCEPT_OFFER`). The server cancels an accept that comes before the counteroffer (`user.kod UserAcceptOffer`).
- **Object ids:** number items (shillings) carry a tag in the id's top 4 bits. Send plain id fields without it (`objId`, as `protocol.c GetObjId` does) and object-list fields with it plus the amount. Look ids up through `WorldState`'s maps, which ignore the tag like the client's `CompareIdObject`.
- **Testing combat on our server:** `send object <id> SetHealth amount int 1` and `send object <id> Killed` on the maintenance port force a death; the Underworld's "rip in space" brings you back. Never do this on a server with real players.
- **The first-person hands** are sized like the D3D client's 800 × 600 back buffer: a bitmap pixel is 1.75/800 of the view's width and 2.25/600 of its height (`screenOverlays.ts`).
- **Hosting:** blakserv runs on Linux from `deploy/blakserv/Dockerfile`; keep `deploy/blakserv/blakserv.cfg` in step with `server/config/blakserv.cfg`. The game data in the image comes from our Windows build, so rebuild with `serveruild.cmd` and restage after Kod changes. Vite's bundles go to `/assets-client/` because `/assets/` is the game files.
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
- **Settings** live in `localStorage`. Hot reloading `settings.ts` makes a second copy of its listeners, so reload the page after editing it.
- **Chat tabs** (ours; the original has one text window): `packages/world/src/chatChannel.ts` puts each line in Chat (everything `BP_SAID`), Combat or Server. Server messages have no kind, so Combat is matched on the message's *format string*, before names are filled in; add words there when a fight message lands in Server. `appendChatLine` caps each channel at 300 lines.
- **Damage numbers** (ours) come from the attacker's hit message (`battler_attacker_hit` / `_mob` in `battler.kod`), matched by its format string and read from its parameters (`packages/world/src/combatHit.ts`). The message names the target but doesn't give its id, so `GameScene.showDamage` uses the target when the name matches, else the nearest object with that name.
- **Saves renumber objects.** blakserv's garbage collection (every save, or `save game` on the maintenance port) compacts object ids. Clients get `BP_WAIT`, then `BP_INVALIDATE_DATA`, and must ask for everything again (`GameSession` does). Maintenance commands that name an object id are only good until the next save: `show object` it again first.
- **The sun and moon** are background overlays (`packages/render/src/skyOverlays.ts`), sent at logon and every game hour. Kod's negative heights arrive as WORDs above 32767 and aren't drawn (below the horizon). To see one in daylight, check `window.shards.session.world.bgOverlays`.
- **The message of the day:** blakserv reads `motd.txt` from the run folder at startup or on `node tools/maint/maint.ts "reload motd"`, and *moves* it into `memmap\`, so the run folder copy disappears; that's normal. Without one it sends `[MessageOfTheDay] Default` ("<Default>"), which the client hides. To change it, edit `server/config/motd.txt`, run `server\setup-run.cmd`, then `reload motd`.
- **Trying shops and rooms quickly:** `node tools/maint/maint.ts "send object <player id> TeleportTo RID int 303"` moves a logged-in character on our server (303 smithy, 332 vault, 333 bank, 330 Outskirts).
- **Movement is client-authoritative but checked:** keep `PlayerMover` byte-for-byte faithful to `move.c` (units, step sizes, thresholds). The server only rejects off-map destinations, and other players' original clients see our moves.
- **Uniform arrays** in Three.js `ShaderMaterial`s must be flat typed arrays (or `Vector` objects), not nested JS arrays.
- **The Android app** (`apps/android`, [ADR 0003](docs/adr/0003-android.md)):
  - The page is `https://localhost/`, served from the APK by Capacitor. `/assets/*` never reaches Capacitor's server: `ShardsWebViewClient` fetches it from the selected server, so the client asks for files exactly as in the browser. For now nothing is cached on the device (ADR 0003 phase 2).
  - `ShardsPlugin` is registered before `super.onCreate` and does its work in `load()`, which runs before the page loads. A JavaScript interface added later only appears after a reload.
  - Debug builds allow cleartext to localhost (`src/debug`) and mixed content (the dev stack's `ws://` from the `https://localhost` page). Release builds allow neither.
  - Vite listens on `127.0.0.1` because `adb reverse` connects to IPv4. With Vite on `::1` only, the app's proxy gets "unexpected end of stream".
  - `cap run android` fails on Windows (it runs `./gradlew` through cmd.exe); `npm run android` replaces it.
  - The app's Origin is `https://localhost`, so the VM's `GATEWAY_ORIGINS` must list it before the app (debug or release) can log in there.
  - To drive the app from a script: `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>` (the pid from `adb shell cat /proc/net/unix`), then the Chrome DevTools Protocol on `localhost:9223`. Debug builds only.
- On Windows, never `spawn` with `shell: true` when the command path has spaces (Node's own path does). Use the shell only for `.cmd` shims such as `npx`.
