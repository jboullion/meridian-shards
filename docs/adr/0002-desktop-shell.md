# ADR 0002: The desktop app (Electron)

- **Status:** accepted, 2026-10-07

## Context

The browser client works, but a browser tab gets in a game's way:
- Ctrl+R/F5 reload it and Ctrl+W closes it mid-game.
- Background tabs are throttled (hence `pingWorker.ts`).
- Sound waits for a click.
- There's no installed-game feel.

We want a downloadable client for Windows, macOS and Linux that keeps the web stack, while the hosted web build stays for quick testing. Both should work against our local stack and the VM.

## Decisions

1. **Electron, not Tauri.**
   - Tauri draws with the system web view: Chromium (WebView2) only on Windows, WKWebView on macOS and WebKitGTK on Linux. They differ exactly where we're fragile: pointer lock, `.ogg` decoding through `decodeAudioData`, WebGL2 and key handling.
   - Electron is the same Chromium we test in, on every platform.
   - It gives us `backgroundThrottling: false`, `autoplayPolicy`, no application menu (so no reload or close shortcuts) and window control.
   - Its main process is TypeScript on Node like our tools, so no Rust toolchain.
   - The cost is about 110 MB per installer, against roughly 10 MB for Tauri. Players download hundreds of MB of game files anyway.
2. **The page is `app://shards/`,** a privileged scheme served by the main process (`apps/desktop/src/main.ts`):
   - the client build at `/`;
   - the game files at `/assets/*`.

   The client code is unchanged: it still asks for `/assets/<name>?v=<hash>` and still talks WebSocket to the gateway. `apps/client/src/host.ts` holds the only differences:
   - the socket URL;
   - the login dialog's Server field (the original `IDD_LOGIN` had one);
   - dev-only pages.
3. **The game files ship with the installer, and the server's manifest decides** (`apps/desktop/src/assetCache.ts`).
   - The installer carries the asset build (`dist/assets`, 418 MB), so a fresh install downloads nothing.
   - At each launch the main process fetches the server's `manifest.json` and serves each file from the install when its hash matches, else from `userData/asset-cache/<name>.<hash>`, else from the server's `/assets/`.
   - Files always match the server's `rsc0000.rsb` and rooms (the redbook token and room checksums depend on that). After a server update only the changed files download, in the background, with a progress bar on the login and character screens.
   - Every download is checked against the asset build's hash (SHA-1, 16 hex digits). After a complete pass, cached versions the server no longer lists are deleted.
   - Downloads use `net.fetch` with `cache: "no-store"`. Letting Chromium's HTTP cache keep a second copy slowed them to about 8 files a second.
   - The installer is 477 MB, but the bulk download never touches the small VM.
   - Before logging in, the client checks the manifest again. If the server was updated since the page loaded, it reloads (web and desktop).
4. **The game connection stays WSS through Caddy and the gateway.**
   - The login is unsalted MD5, so it needs TLS, and the gateway keeps its per-IP limits and logging.
   - The Origin is `app://shards`, so the VM's `GATEWAY_ORIGINS` lists it.
   - A raw TCP connection from the main process (`GameSession`'s `createSocket` hook) stays possible but isn't used.
5. **Packaging with electron-builder:**
   - NSIS for Windows, a universal dmg plus zip for macOS, AppImage plus deb for Linux.
   - The main process and preload are bundled by Vite (electron-updater included), so the app ships no `node_modules`.
   - Electron's fuses turn off run-as-node, `NODE_OPTIONS` and `--inspect`, and check the asar's integrity.
6. **Releases on GitHub:** installers and the update feeds (`latest*.yml`) are assets of a GitHub release of this (public) repo.
   - `.github/workflows/desktop.yml` builds all three OSes on a `v*` tag and uploads them to a draft release. It gets the game files from the VM's `/assets/` (`tools/assets/fetch-assets.ts`), cached by manifest.
   - Publishing the release ships it. electron-updater's github provider downloads only the changed blocks of the installer.
   - GitHub doesn't charge for release bandwidth, so installs and updates cost the VM nothing. A small download page lists the latest release. It was served by Caddy at `/download/` until 2026-10-08; now it's on GitHub Pages, and the VM redirects there.
7. **Signing is deferred.**
   - Unsigned Windows builds get a SmartScreen warning.
   - Unsigned macOS builds need right-click → Open, and macOS can't auto-update them.
   - Before going public: Azure Trusted Signing for Windows, and an Apple Developer account for notarization.

## Consequences

- One client codebase. Every web change ships to the desktop with the next build, and the browser build keeps working as before.
- Switching servers reloads the page, because the files come from the server.
- Desktop players never wait on the network for a room. Browser players still load each room's files from the VM on first visit (the room cache loads the neighbours ahead).
- macOS and Linux builds need those systems: `.github/workflows/desktop.yml` builds all three.
