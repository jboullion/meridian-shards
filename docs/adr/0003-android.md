# ADR 0003: The Android app (Capacitor)

- **Status:** proposed, 2026-10-08. An investigation; nothing is built yet.

## Context

The desktop app ([ADR 0002](0002-desktop-shell.md)) ships for Windows, macOS and Linux. We want Android next: it is the cheapest way to get Meridian onto phones.

Electron doesn't run on Android, so the desktop shell can't come along. The client is a plain web app, though:
- Vite + React, with Three.js on WebGL2;
- a WebSocket to the gateway;
- the protocol and file formats in `packages/*`, with no Node APIs.

Android's System WebView is Chromium, the engine we test in. Most of the client should run as it is.

### What already works on Android

- The renderer: WebGL2 and the palette lighting shader.
- Sound: `.ogg` through `decodeAudioData`, which Chromium on Android supports.
- The game connection, `wss://<server>/ws`.
- The client depends on its host through one seam, `apps/client/src/host.ts`: `window.shardsDesktop`, the socket URL, the server list and the asset download progress.

### What doesn't work yet

1. **Input is mouse and keyboard only.**
   - `gameScene.ts` listens for mousedown, dblclick, contextmenu, mousemove and keydown/keyup on the canvas and window, and uses pointer lock.
   - Movement comes from `held()` in `GameScene.frame`. It yields digital forward / strafe / turn / run values of -1, 0 or 1, the way `move.c` works.
   - There's no touch handling.
2. **The layout assumes a big screen.**
   - The interface column is 264 px wide and the chat row 168 px tall (`styles.css`). The only narrow-screen rule is `@media (max-width: 760px)`.
   - A landscape phone is about 360–412 CSS px tall, which leaves almost no 3D view.
3. **Game files.**
   - `dist/assets` is 418 MB: `.bgf` 202 MB, `.ogg` 165 MB, `.roo` 33 MB, the rest under 20 MB.
   - On the desktop the main process serves `/assets/*` from the install, then the hash-checked disk cache, then the server (`apps/desktop/src/assetCache.ts`).
   - Capacitor's built-in local server ignores `?v=<hash>` and can't fall back to the server.
4. **Desktop-only pieces have no Android version:**
   - the title bar and window controls;
   - `backgroundThrottling: false`;
   - the confirmation before closing mid-game;
   - electron-updater;
   - the server list (`apps/desktop/src/settings.ts`).
5. **The Android lifecycle.**
   - In the background the WebView pauses timers, and the connection may drop.
   - The back button needs handling.
   - We also need: landscape lock, immersive fullscreen, keeping the screen on, the soft keyboard over the chat line, and display cutouts.

## Decisions

1. **Capacitor, as `apps/android`. Not a PWA/TWA, and not React Native.**
   - Capacitor wraps `apps/client/dist` in the System WebView, as Electron wraps it on the desktop.
   - We get a native project for the pieces a web page can't do: serving the asset cache, fullscreen, keeping the screen on, the back button.
   - A PWA or Trusted Web Activity can't bundle 418 MB of files or intercept `/assets/`. It would also depend on the VM for every install.
   - React Native would mean a second renderer.
   - Settings in `capacitor.config.ts`:
     - `appId: net.meridianshards.client`, the same as the desktop;
     - `webDir: ../client/dist`;
     - `android.scheme: https`.
   - That makes the page's origin `https://localhost`, which the VM's `GATEWAY_ORIGINS` lists next to `app://shards`.
   - Native settings in `MainActivity` and the manifest:
     - immersive fullscreen;
     - `FLAG_KEEP_SCREEN_ON`;
     - `sensorLandscape`;
     - `setMediaPlaybackRequiresUserGesture(false)`, our `autoplayPolicy`.
   - Plugins: `@capacitor/app` (the back button, pause and resume) and `@capacitor/keyboard` (how the page resizes for the soft keyboard).

2. **The game files: a native port of `assetCache.ts`, not a JavaScript cache.**
   - `ShardsWebViewClient` extends Capacitor's `BridgeWebViewClient` (`bridge.setWebViewClient`). Its `shouldInterceptRequest` answers `https://localhost/assets/<name>?v=<hash>` from the first place that has the file:
     1. the APK's bundled copy (`assets/game/`), when the manifest hash matches;
     2. `filesDir/asset-cache/<name>.<hash>`;
     3. the server's `/assets/`. The download is checked against the SHA-1 (16 hex digits) before it's kept, and `manifest.json` is always fetched fresh.
   - A `downloadAll` with progress runs at launch, exposed by a small Capacitor plugin. The page shows it in `AssetDownload.tsx`.
   - Why not a JavaScript cache (Cache Storage):
     - The page stays unchanged: same-origin `/assets/`, exactly as on the desktop.
     - Caddy needs no CORS headers.
     - Storage isn't evicted.
     - The bundled files mean a fresh install costs the VM nothing (ADR 0002).
   - The sideloaded APK is about 430 MB; the desktop installer is 477 MB. `.ogg` and `.bgf` are `noCompress`.
   - For the Play Store, the bundled files move to an install-time Play Asset Delivery pack. Those are still read through `AssetManager`.

3. **One host seam.**
   - `host.ts` grows from "desktop or browser" into a host with a `platform`. On Android a small plugin (or JavaScript shim) gives the same bridge:
     - `servers` / `server` / `selectServer`: kept in `localStorage`, with the desktop's defaults; choosing a server reloads the page.
     - `onAssets`: the native download's progress.
     - `onUpdate` / `installUpdate`: GitHub's latest release against our version; it opens the APK's link, because a sideloaded app can't update itself silently.
     - `setPhase`: decides what the back button does.
     - No window controls, and `TitleBar` is hidden.
   - `gameSocketUrl()` and `devPagesEnabled` work as they are.

4. **Touch controls and a phone layout, aimed at phones in landscape.** They're client code, so the mobile web build gets them too.
   - They turn on with `matchMedia("(pointer: coarse)")`, plus an Auto / On / Off option in `settings.ts` (bump `SETTINGS_VERSION`).
   - **Input:**
     - A touch input source in `GameScene` feeds the same forward / strafe / turn / run values as `held()`.
     - A virtual joystick on the left maps to digital directions; pushing past about 80% runs. `PlayerMover` stays faithful to `move.c`.
     - Dragging on the view turns and pitches, the same path as pointer-lock mousemove.
     - Tap = Select Target, long press = Examine (the right click), double tap = activate.
     - Dragging an item from the view to the inventory uses `GameView`'s pointer events; check that they fire for touch.
   - **Buttons:**
     - Attack, Open / Go (Space), Pick Up (F), Look (R), next target;
     - Chat, Map, Inventory and ☰;
     - a hotbar for the F1–F12 hotkey aliases and spells.
   - **Layout** (as decided after the Phase 0 test):
     - the view fills the screen;
     - health, mana and vigor stay on the view as small bars; nothing else does;
     - the interface column (portrait, stats, minimap, inventory, spells) becomes a drawer that slides out;
     - chat slides out too and takes the whole screen while it's open;
     - `kit.tsx` dialogs scale to the height;
     - padding respects `env(safe-area-inset-*)`;
     - touch targets are bigger.
   - **Render Scale:** an option that caps `renderer.setPixelRatio`, because phones have a device pixel ratio of 2.5–3.5.

5. **Lifecycle.**
   - On resume, if the socket closed, back to the login screen with "Disconnected".
   - The back button:
     - closes the top dialog;
     - otherwise leaves the chat line;
     - otherwise asks "Log off and quit?", like the desktop's close.

6. **Releases: a signed APK on GitHub releases first; the Play Store later.**
   - `.github/workflows/android.yml` (or a job in `desktop.yml`) runs on a `v*` tag:
     1. Java 21 (the Android SDK is already on GitHub's runners);
     2. `tools/assets/fetch-assets.ts`;
     3. `npx cap sync android` and `./gradlew assembleRelease`;
     4. sign, and upload to the same draft release as the desktop builds.
   - `versionCode` = major × 10000 + minor × 100 + patch.
   - The download page gets an Android link.
   - One release keystore for good: updates must carry the same signature. It lives in GitHub secrets, never in git.
   - **Play Store, later:**
     - an AAB with Play App Signing;
     - the install-time asset pack;
     - a target API level that meets Play's current requirement;
     - a $25 developer account. New personal accounts must run a closed test with 12 testers for 14 days before going public.

## Plan

0. **A spike without code.** *Done 2026-10-08.*
   - The VM's web build, opened in Chrome on an Android phone.
   - **Result:** it runs well. The renderer is good enough on phones, so the plan goes ahead.
   - The space is very cramped, which led to the layout above.
   - Not measured yet: `renderer.render` time and memory on a mid-range phone (USB debugging, `chrome://inspect`). Do that before choosing the Render Scale default.
1. **The shell.** *Done 2026-10-08.*
   - Capacitor 8.5 in `apps/android`; the native code is Java (the template's), not Kotlin.
   - Native settings:
     - `ShardsPlugin`: sound without a tap, the bridge and the WebView client;
     - `MainActivity`: the screen stays on;
     - `sensorLandscape`;
     - the system bars hidden through Capacitor's SystemBars.
   - The host seam (`host.ts` `androidBridge`), and `ShardsWebViewClient` passing `/assets/*` through to the server, no cache yet.
   - The local stack is `http://localhost:5173` on the device through `adb reverse`, not `10.0.2.2`: one address for the emulator and a USB phone. Cleartext and mixed content are allowed in debug builds only.
   - In the emulator (API 37, WebView 145) the app logs in to the local stack and draws the Underworld: room, sprites, hands, stats, minimap, inventory, chat. The debug APK is 4.3 MB.
   - `npm run android` builds, installs and launches (`tools/android/run.ts`).
   - Gradle runs on a separate JDK 21: Android Studio 2026.2 bundles JDK 25, which the template's Gradle 8.14 can't run on.
2. **The game files.** *Done 2026-10-08.*
   - `AssetCache.java` ports `assetCache.ts`: the APK's copy when the hash matches, then `filesDir/asset-cache`, then the server, with every download checked against its hash.
   - Release builds carry `dist/assets` as the APK's `assets/assets/` (Gradle adds `dist/` as an asset folder, no copy). Debug builds don't, unless built with `npm run android -- --bundle`. The bundled debug APK is 383 MB.
   - The full download (`downloadAll`) runs only on an unmetered network, never for the local dev stack. On mobile data, files load and are cached as the game needs them.
   - The cache and the download are per process, because Android may create the activity more than once (it did, on update). A new page joins a running download.
   - After a complete pass the prune also drops cached copies of files the APK has, and `.tmp` files over 10 minutes old (left by a killed process).
   - Measured in the emulator:
     - from the VM, the last 258 MB came down in 55 s, with all 4,788 hashes checked;
     - with the bundled build, the Inn's 194 requests all came from the APK and nothing was downloaded.
3. **Touch controls and the phone layout.** *Done 2026-10-08 in the emulator; a real phone next.*
   - Touch Controls (Auto/On/Off) in the Bind Editor's Options. On Auto it's on for a coarse pointer, so it also applies to phone browsers.
   - The view fills the screen under the title bar:
     - health, mana and vigor at the top left, with the last chat lines under them;
     - Map, Chat and Items at the top right;
     - the joystick at the bottom left;
     - Attack, Open, Get, Look and Next around the right thumb.
   - Touch on the view (`gameScene.ts`):
     - drag to turn and look up or down;
     - tap to target, or to pick up something close by;
     - double tap to activate;
     - long press to examine.
   - The interface column is a drawer from the right, closed by tapping the view. It holds only the five tabs and their list, which takes the full height and scrolls. The portrait, the bars, the enchantments and the map are hidden from it, because they're elsewhere:
     - the bars are on the view;
     - our enchantments are icons under the bars, and the room's are under the top-right buttons; a tap or a long press shows an enchantment's description;
     - the map is the Map button's. The chat covers the screen while it's out, and stays in place but unseen while it's away, so anything that focuses the chat line (Enter, T, the hotkeys) brings it out.
   - Android's back button closes the top window, then the chat, drawer or map, then asks "Log off and quit?".
   - Found along the way:
     - the canvas needs `touch-action: none`, or the browser takes a drag over after a few moves;
     - the drawer parked off screen made the browser zoom the page out, so the layout clips and the viewport has `user-scalable=no`.
   - A minute in the background kept the connection.
   - Not yet:
     - a hotbar for the F1–F12 hotkey aliases and favourite spells (spells cast from the drawer's Spells tab for now);
     - the toolbar (Help, Drop, Get, Rest, Mail), which the phone layout hides; Mail is in ☰, and Rest is typed;
     - a Render Scale option, if a real phone needs one.
4. **The update notice, CI and the signed APK on GitHub releases.** *Built 2026-10-08; the first release is next.*
   - The release key is RSA 4096 (PKCS12, alias `meridian-shards`, 100 years), made with the JDK's `keytool`. It lives in `~/.meridian-shards` with its password file, and in the repository's secrets for CI. `app/build.gradle` signs release builds from `SHARDS_KEYSTORE*` (CI) or that properties file.
   - The `android` job in `.github/workflows/desktop.yml` runs beside the desktop builds:
     - JDK 21, the same cached game files from the VM, `npm run android:sync`, `gradlew assembleRelease`;
     - uploads `Meridian-Shards-<version>.apk` to the draft;
     - `publish` and `npm run release` require the APK.
   - The version is the desktop's; versionCode = major × 10000 + minor × 100 + patch.
   - The update notice: release builds ask GitHub for the latest release. If it's newer and has an APK, the login screen says "Version x is out. Download it", which opens the APK in the browser.
   - The download page has an Android card, picked first on Android, whose browsers also say Linux.
   - A local release build (`npm run android -- --release`): 379 MB, versionCode 200. On first launch all 4,785 files came from the APK and nothing from the VM.
   - The login dialog didn't fit 411 px with the big heading above it, so screens under 520 px tall drop the heading.
5. **Later: the Play Store.**

To install, asking first as AGENTS.md says:
- **Android Studio**, with its JDK and SDK: about 1 GB, plus 3–5 GB of SDK and emulator images.
- **npm packages:** `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/app` and `@capacitor/keyboard` (a few MB, the latest stable versions).

## Open questions

- ~~Does `bridge.setWebViewClient` work as expected in the current Capacitor?~~ Yes (phases 1 and 2).
- **On a real phone:**
  - how the joystick, the button sizes and the drag speed feel;
  - frame time and memory, which decide whether to add a Render Scale (the emulator's GPU says nothing);
  - whether the login dialog should stay whole above the soft keyboard (now it shrinks and its top goes off screen while typing).
- **Does pointer lock work in the Android WebView** for players with a mouse (tablets, Chromebooks)?
- **Memory and frame time on a mid-range phone.** Phase 0 showed it runs well, but nothing was measured. Room-cache size, texture memory and the Render Scale default follow from those numbers.
- **Should the sound files be optional?** They're 165 MB of the 418 MB. An APK without them, downloading on first use, would be about 270 MB.

## Verification

- `npm run check` passes: the host seam and touch input are client code.
- In the emulator and on a real phone, against the local stack and then the VM:
  - log in;
  - walk through a door (`BP_REQ_GO`);
  - target and attack;
  - open a description;
  - pick up and drop;
  - chat with the soft keyboard;
  - buy from a shopkeeper;
  - leave the app in the background for a minute and come back;
  - press back mid-game.
- `chrome://inspect` shows no console errors. The asset log shows which files came from the APK, the cache and the server.

## Consequences

- Still one client codebase. The touch layout also serves phones in a mobile browser.
- One more native project (Kotlin and Gradle) to keep building, with Android Studio for development.
- A sideloaded APK doesn't update itself. Players follow the update notice until the app is on the Play Store.
