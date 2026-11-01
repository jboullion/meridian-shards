# ADR 0032: The browser client as an installable app (PWA)

- **Status:** proposed, 2026-11-01. Step 1 is built; it stays proposed until the user has installed it from Chrome and played in it.
- Builds on: the desktop app ([ADR 0002](0002-desktop-shell.md)), the Android app ([ADR 0003](0003-android.md)), our domain behind Cloudflare ([ADR 0004](0004-own-domain.md)).

## Context

The browser client at https://m59-shards.com/play/ is the quickest way into the game: no download, nothing to install. Its weak points are the ones that led to the desktop app ([ADR 0002](0002-desktop-shell.md)):
- it's one tab among others: Ctrl+W closes it mid-game, and it has no icon or window of its own;
- every room's files come from the VM on the first visit, with only the browser's HTTP cache in between.

Chrome and Edge can install a site as an app (Safari on macOS and iOS has its own Add to Dock / Add to Home Screen):
- a manifest gives its name, icons and start page;
- the browser puts it in the Start menu or Dock, and opens it in a window without the address bar and tabs;
- with `display_override: ["window-controls-overlay"]` the page draws its own title bar up to the system's window buttons, as the desktop app does.

A service worker on the same origin can also answer the page's requests, `/assets/` included, from Cache Storage. That is the web's version of the desktop's `assetCache.ts`. It is the later step 2 of this ADR, not step 1.

## Decisions

1. **The hosted client is installable: a web app manifest, a service worker, and an Install link.**
   - `apps/client/pwa/plugin.ts` (a Vite plugin) writes both at the root of the client's base, so their scope is the client:
     - `/play/manifest.webmanifest` and `/play/sw.js` on our server (`tools/deploy/stage.ts` builds with `--base /play/`);
     - `/manifest.webmanifest` and `/sw.js` on Vite's dev server.
     It adds the manifest's `<link>` to `index.html`. The build writes both unhashed, and the icons hashed under `assets-client/`.
   - **The manifest:**
     - name "Meridian Shards"; `id`, `scope` and `start_url` the client's base (`/play/`);
     - `display: standalone`, with `display_override: ["window-controls-overlay"]`;
     - `background_color` `#0c0a08` (the page's `--bg`); `theme_color` `#cccccc`, the title bar's grey, so the system's window buttons and title match our bar;
     - icons 192 and 512, plain (the emblem, transparent) and maskable (the emblem on full-bleed stone, 70% of the side, inside the 80% circle every mask keeps). `tools/icons/make-icons.ts` makes them.
   - **Only a plain browser registers the worker and offers to install** (`apps/client/src/webApp.ts`). Not:
     - the desktop app (`app://shards`) or the Android app (`https://localhost`): they have their own windows and caches;
     - the itch.io build (`hostedServer` set): it runs in itch.io's iframe, where nothing can be installed.
     A manifest `<link>` is in their pages too; they ignore it.
   - **The Install link** is in the login screen's footnote (beside Room viewer and the version). It shows while Chrome or Edge offers to install (`beforeinstallprompt`, whose banner we keep back), and opens the browser's install dialog. It's hidden when the page already runs installed. Safari and Firefox have no such event; there, installing is the browser's own menu (Share > Add to Dock, and so on).

2. **Step 1's service worker caches nothing, so it's safe to ship.** `apps/client/pwa/sw.js`:
   - **Pages (navigations) always come from the network**, with navigation preload so the worker's start costs nothing. With no network at all it answers a small "You're not connected to the internet" page with Try again, in place of the browser's own error. A slow or failing server still answers as it does now.
   - **Every other request goes by untouched.** The install step routes them straight to the network where the browser can (Chrome's static routing, `addRoutes`, not navigate → network). Where it can't, the fetch handler returns without answering.
   - `skipWaiting()` and `clients.claim()`: a new worker takes over at once. With no cache, there's no old copy of the page to keep consistent.
   - It's registered after the page's `load`, with `updateViaCache: "none"`.
   - Chrome no longer requires a service worker to install. It's here for the offline page, for browsers that still want one, and to have step 2's place ready.

3. **Kill switches, in case a bad worker ships.**
   - **`KILL_SWITCH = true` in `sw.js`, and ship.** Browsers fetch the worker's script at every visit (Caddy serves it no-cache; `updateViaCache: "none"`). At each player's next page load the new worker installs, unregisters itself and reloads its pages, which then run without one.
   - **`SERVICE_WORKER = false` in `webApp.ts`, and ship.** The page unregisters any worker instead of registering one. This depends on the bad worker still letting the page load; the first switch doesn't.
   - **Deleting `sw.js` does not work.** Browsers keep a worker whose script answers 404. Caddy answers 404 for it rather than `index.html`, but that only makes the update fail cleanly.
   - **For one player:** DevTools > Application > Service workers > Unregister, or Application > Storage > Clear site data, or `chrome://serviceworker-internals`.

4. **Installed, the page behaves more like the desktop app** (`webApp.ts`). "Installed" means `display-mode` `standalone` or `window-controls-overlay`, or iOS's `navigator.standalone`.
   - `navigator.storage.persist()`: the browser is asked to keep the site's storage (it matters from step 2 on).
   - **Closing the window mid-game asks first**, through `beforeunload`, while the session's phase is `game` (`Game.tsx`, beside the desktop's `setPhase`). A browser tab doesn't ask, as before.
   - **The window controls overlay:** while it's on (`navigator.windowControlsOverlay.visible`; the player can switch it from the window), our `TitleBar` is the window's title bar, as on the desktop:
     - `Framed` shows it on the login, character and loading screens too;
     - it drags the window (`-webkit-app-region: drag`; its buttons and links don't);
     - it takes `env(titlebar-area-height)` and keeps clear of the system's buttons through `env(titlebar-area-x)` and `env(titlebar-area-width)`, whichever side they're on (right on Windows and Linux, left on macOS).
     The ☰ menu, the room's name, the latency meter, Download and Full screen stay as in a tab. Without the overlay, the system draws a plain title bar in the theme colour above the page.

5. **Caddy** (`deploy/web/Caddyfile`, under `handle_path /play/*`):
   - `manifest.webmanifest` and `sw.js` are served `Cache-Control: no-cache`, like `index.html`. Browsers must see a changed worker at the next visit. Cloudflare doesn't cache `no-cache` responses with its default rules; a cache rule on `/play/*` would have to leave these two out.
   - `manifest.webmanifest` gets `Content-Type: application/manifest+json` (Go doesn't know the extension).
   - `sw.js` is never answered with `index.html` (the single-page fallback): with no file it's a 404.

6. **The apps stay.**
   - **Android ([ADR 0003](0003-android.md)):** the app's foreground service keeps the game connection alive in the background, which a web page can't: Android freezes a backgrounded browser or installed web app within seconds, and blakserv drops a game connection silent for 30 seconds.
   - **The desktop app ([ADR 0002](0002-desktop-shell.md)):** it ships the game files with the installer and runs with background throttling off. We look again at whether it's needed once players have used the installed web app for a while, with step 2 built.
7. **Step 2 waits on a measurement of the browser's own cache** (added 2026-11-01). *Switched off the same day (`cacheStats.ts` `CACHE_STATS = false`): nothing is counted or sent until it's turned on again; the gateway's endpoint stays, unused.*
   - Without a worker cache, files and updates already work well: each file is `/assets/<name>?v=<hash>` and cached for good, `manifest.json` is never cached, so an update downloads only the changed files, and Cloudflare serves a file the browser lost. Step 2 would change where the files are kept, not how they update. It's only worth its risk if browsers lose files that players load again.
   - `apps/client/src/cacheStats.ts` counts, from the page's Resource Timing entries, which game files came from the browser's cache (`transferSize` 0, or less than the body: a 304). localStorage `shards.assetsSeen` remembers the name and hash of every file this browser loaded, so a file loaded again on a later page tells eviction apart from a first visit to a room.
   - When the page is hidden or closed it sends what it counted since its last report (`navigator.sendBeacon`, `POST /api/stats/cache`): counts and bytes, whether the browser had loaded files before, installed or tab, the browser's family, phone or not. No account, character or address.
   - The gateway (`tools/gateway/cacheStats.ts`) checks each report, limits them to 20 a minute per address and the allowed origins (`GATEWAY_ORIGINS`), and adds them to per-day totals by kind, kept 90 days in its state volume (`CACHE_STATS`, `/srv/gateway/state/cache-stats.json`). Caddy routes `/api/stats/*` to it; Vite does the same in development.
   - Only in a plain browser on our server: the desktop and Android apps have their own caches, and the itch.io page loads the files from another site, whose entries give no sizes.
   - `npm run console:cache` (`tools/console/cache-stats.ts`, `--days`, `--local`) reads the totals from the VM. Its `kept` is the number that decides: of the files a returning browser loaded again, the share still cached. Near 1 (say 0.95 or more), step 2 isn't needed. Low, or low for one kind (Safari, phones, tabs rather than the app), step 2 starts with that case: a worker that keeps only the files the game loads, with no full download.
   - Images the browser still holds in memory across a reload may have no timing entry, so some cached loads aren't counted. The files that matter, the rooms, objects and sounds that `AssetStore` fetches, always have one.

## Plan

1. **Installable (this step).** *Built 2026-11-01.*
   - The manifest, the worker, the Install link, the installed-mode behaviour and Caddy, as above.
   - Tried against `npm run dev` in Playwright's Chromium (Chrome 155):
     - DevTools' `Page.getAppManifest` reports no errors, and `Page.getInstallabilityErrors` none; the worker is active and controls the page;
     - the Install link shows on the login screen, and is hidden when the page runs standalone (`matchMedia` stubbed: Chrome can't emulate `display-mode`);
     - `PWA.install` and `PWA.launch` install it and open it;
     - logged in as `shardbot` under the worker: the character screen, then Mercenary Alley drawn;
     - standalone and in the game, closing the page brings up `beforeunload`, and dismissing it keeps the game;
     - with the overlay stubbed visible, the login screen gets the title bar, draggable.
   - A production build with `--base /play/`, served by Caddy with this Caddyfile (`caddy:2` in Docker): `/play/manifest.webmanifest` and `/play/sw.js` no-cache with the right types, icons immutable, and `sw.js` missing is a 404.
   - **Not tried:** Playwright's Chromium opens the launched app in a tab, so the real window, the overlay's `env(titlebar-area-*)` insets and the system's close button need the user's Chrome or Edge.
   - **The cache measurement** (decision 7), *built 2026-11-01*: tried in the browser against `npm run dev` (a first page: 55 files, none cached, not returning; after a reload: 14 files, 12 cached, all 12 seen before still cached; a second `pagehide` sends nothing new), and the endpoint on a gateway of its own (204 for a report, 403 for another origin, 413 over 4 KB, 429 past the limit, the day's totals saved).
2. **The game files in Cache Storage (only if decision 7's numbers call for it).** Port `apps/desktop/src/assetCache.ts` into the worker for `/assets/`:
   - `manifest.json` always from the network;
   - each `<name>?v=<hash>` from a Cache Storage cache keyed by name and hash, else downloaded, checked against its hash (SHA-1, 16 hex digits) and kept;
   - cached versions the manifest no longer lists are pruned after a complete pass;
   - optionally a full download with progress, through the same `onAssets` the apps feed `AssetDownload.tsx`;
   - measure what Chrome allows before relying on it (`navigator.storage.estimate()`; a persisted origin is not evicted).
   The worker's scope is `/play/`, but a worker answers every request its pages make, so `/assets/` (outside the scope) is covered. Static routing then sends only navigations and `/assets/` through the worker.
3. **Then decide about the desktop app**, after players have used the installed web app (step 1, then step 2) for a while.

## Open questions

- Does the overlay's title bar line up with Windows' and macOS's buttons, height included? `.title-bar.overlay` uses `max(32px, env(titlebar-area-height))`.
- ~~Should the browser's Download button stay in the installed app?~~ Removed from the browser's title bar altogether (2026-11-01): a browser installs the game itself, and the apps are on the download page.
- **The installed app's title bar can't be ours alone.** With the overlay, Chrome and Edge keep their own controls beside the system's buttons: the overlay's on/off arrow, the three-dot app menu, the extensions button, and page icons such as the password key. No manifest setting or API removes them for a web app; `display_override: borderless` is for Isolated Web Apps only. Full screen hides them, and the system's buttons too. Only the desktop app's frameless window shows nothing but our bar.
- In full screen the bar takes the whole width (`webApp.ts useTitleBarOverlay` is off there): before, it kept the overlay's padding in full screen, so it stopped short where the system's buttons had been.
- Is background throttling a problem in an installed window that's minimized or covered? `pingWorker.ts` keeps the connection's pings going in a background tab today.

## Consequences

- One more way to play, from the same build: the hosted client is also an app in Chrome and Edge, and nothing changes for players who don't install it.
- A service worker is now part of every hosted page. Its kill switch has to be remembered (decision 3), and the worker's file must be shipped no-cache.
- Step 2 can bring the desktop app's file cache to the web without the page changing.
