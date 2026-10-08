// Meridian Shards for the desktop: the browser client (apps/client) in an Electron window.
//
// The page is app://shards/, a privileged scheme served from here:
//   /assets/*   the game files, from the selected server's /assets/ through the disk
//               cache (assetCache.ts), so they always match that server's build
//   /*          the client build (apps/client/dist; resources/client when packaged)
// The game socket goes from the page to <server>/ws (apps/client/src/host.ts), the same
// gateway the browser uses, so the Origin the gateway sees is app://shards.
//
// With SHARDS_DEV_URL (npm run desktop) the window loads the Vite dev server instead and
// everything is same-origin, as in the browser.
//
// The game files come with the installer (resources/assets); only files the server has
// changed since are downloaded (assetCache.ts).
//
// What the window fixes compared to a browser tab: no reload/close shortcuts (no
// application menu), no background throttling (timers keep running when minimized), sound
// without a click first, a confirmation before closing mid-game, F11 / Alt+Enter
// fullscreen, and the window remembered between runs. Files the server has changed since
// the installer was built download in the background (assetCache.ts downloadAll), with the
// progress on the login and character screens, so the game never waits on the network.

import { BrowserWindow, Menu, app, dialog, ipcMain, protocol, screen, shell, type MenuItemConstructorOptions } from "electron";
import electronUpdater from "electron-updater";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { DesktopAssetProgress, DesktopConfig, DesktopLaunch, DesktopUpdate } from "../../client/src/host.ts";
import { AssetCache, type DownloadRun } from "./assetCache.ts";
import { parseCommandLine, serverFromCommandLine } from "./commandLine.ts";
import { log } from "./log.ts";
import { saveWindowState, selectServer, selectedServer, servers, windowState } from "./settings.ts";

const DEV_URL = process.env.SHARDS_DEV_URL;
const DEVTOOLS = !!DEV_URL || process.argv.includes("--devtools");
const SCHEME = "app";
const HOST = "shards";
const APP_URL = `${SCHEME}://${HOST}/`;

// The original's command line (/H /P /U /W /Q): after the executable, and in development
// after the app's path too
const commandLine = parseCommandLine(process.argv.slice(app.isPackaged ? 1 : 2));
/** /H and /P choose the server for this run, without changing the saved choice */
let launchServer = DEV_URL ? null : serverFromCommandLine(commandLine, servers());
/** /U, /W and /Q go to the first page only */
let launch: DesktopLaunch | null =
  commandLine.username || commandLine.password || commandLine.quickstart
    ? { username: commandLine.username, password: commandLine.password, quickstart: commandLine.quickstart }
    : null;

/** The server the page's files and socket come from */
const currentServer = () => launchServer ?? selectedServer();

// Before `ready`: a standard, secure scheme gets an origin of its own (localStorage,
// workers, fetch, module scripts) like an https site.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

const clientDir = app.isPackaged ? join(process.resourcesPath, "client") : resolve(app.getAppPath(), "..", "client", "dist");

const CLIENT_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

// The page loads only from itself; the game socket may go to any server in the list.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' ws: wss:",
].join("; ");

async function serveClient(pathname: string): Promise<Response> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return new Response("bad path", { status: 400 });
  }
  let file = resolve(clientDir, rel || "index.html");
  if (file !== clientDir && !file.startsWith(clientDir + sep)) return new Response("not found", { status: 404 });
  // A single-page app: routes without a file extension get index.html
  if (!extname(file)) file = join(clientDir, "index.html");
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    const ext = extname(file).toLowerCase();
    const headers: Record<string, string> = { "content-type": CLIENT_MIME[ext] ?? "application/octet-stream" };
    if (ext === ".html") headers["content-security-policy"] = CSP;
    return new Response(await readFile(file), { headers });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

// The asset build packaged with the app (electron-builder.yml extraResources); unpackaged, the repo's own
const bundledAssets = app.isPackaged ? join(process.resourcesPath, "assets") : resolve(app.getAppPath(), "..", "..", "dist", "assets");
const assets = new AssetCache(join(app.getPath("userData"), "asset-cache"), existsSync(join(bundledAssets, "manifest.json")) ? bundledAssets : null);
let win: BrowserWindow | null = null;
/** The session phase the page reported (apps/client/src/game/Game.tsx). */
let phase = "offline";
let closeConfirmed = false;
let update: DesktopUpdate | null = null;
let download: (DownloadRun & { origin: string; finished: boolean }) | null = null;
let assetProgress: DesktopAssetProgress | null = null;

/**
 * Downloads the selected server's files that aren't cached yet. Runs once per server per page
 * load: a reload after a server update (Game.tsx checks the manifest before logging in)
 * fetches just the changed files.
 */
function downloadAssets(): void {
  if (DEV_URL) return;
  const origin = currentServer();
  if (download && download.origin === origin && !download.finished) return;
  if (download) download.cancelled = true;
  const run = { cancelled: false, origin, finished: false };
  download = run;
  assetProgress = null;
  void assets
    .downloadAll(origin, run, (p) => {
      assetProgress = p;
      win?.webContents.send("shards:assets", p);
    })
    .catch((e: Error) => log(`assets: download failed: ${e.message}`))
    .finally(() => (run.finished = true));
}

function config(): DesktopConfig {
  const list = servers();
  // A server named by /H that isn't in the list is in it for this run
  if (launchServer && !list.some((s) => s.origin === launchServer)) list.push({ name: new URL(launchServer).host, origin: launchServer });
  const first = launch;
  launch = null;
  return {
    version: app.getVersion(),
    dev: !!DEV_URL,
    platform: process.platform,
    // In development the page's own origin (Vite) is the only server: its /assets and /ws
    servers: DEV_URL ? [{ name: "Local (dev)", origin: new URL(DEV_URL).origin }] : list,
    server: DEV_URL ? new URL(DEV_URL).origin : currentServer(),
    launch: first,
  };
}

/** The saved window bounds when they're still on a screen, else 1280 x 800 on the primary one. */
function initialBounds(): { x?: number; y?: number; width: number; height: number } {
  const saved = windowState();
  if (saved && saved.x !== undefined && saved.y !== undefined) {
    const visible = screen.getAllDisplays().some(({ workArea: a }) => {
      const w = Math.min(saved.x! + saved.width, a.x + a.width) - Math.max(saved.x!, a.x);
      const h = Math.min(saved.y! + saved.height, a.y + a.height) - Math.max(saved.y!, a.y);
      return w >= 100 && h >= 100;
    });
    if (visible) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  }
  const area = screen.getPrimaryDisplay().workAreaSize;
  return { width: Math.min(1280, area.width), height: Math.min(800, area.height) };
}

function setMenu(): void {
  if (process.platform !== "darwin") {
    // No menu means no Ctrl+R / F5 reload, Ctrl+W close or zoom keys
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS needs an app menu for Quit and the clipboard; still no Reload or Close Window
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    { role: "editMenu" },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "togglefullscreen" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const isOwnPage = (url: string) => {
  try {
    const u = new URL(url);
    return DEV_URL ? u.origin === new URL(DEV_URL).origin : u.protocol === `${SCHEME}:` && u.host === HOST;
  } catch {
    return false;
  }
};

const openExternal = (url: string) => {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
};

function createWindow(): void {
  const saved = windowState();
  const w = new BrowserWindow({
    ...initialBounds(),
    minWidth: 800,
    minHeight: 600,
    title: "Meridian Shards",
    backgroundColor: "#000000",
    show: false,
    // Our own title bar (apps/client/src/game/TitleBar.tsx) instead of the system's: no
    // frame on Windows and Linux; macOS keeps its traffic lights over ours
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 10, y: 9 } } : { frame: false }),
    // The shard in the taskbar too, the same as the installer and shortcuts use (and not
    // Electron's own when run from npm run desktop); macOS takes the app bundle's
    icon: process.platform === "darwin" ? undefined : join(app.getAppPath(), "build", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep the game's timers and rendering going while minimized or behind other windows
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
      spellcheck: false,
      devTools: DEVTOOLS,
    },
  });
  win = w;
  if (saved?.maximized) w.maximize();
  if (saved?.fullscreen) w.setFullScreen(true);
  w.once("ready-to-show", () => w.show());
  void w.webContents.setVisualZoomLevelLimits(1, 1);

  w.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11" || (input.alt && input.key === "Enter")) {
      e.preventDefault();
      w.setFullScreen(!w.isFullScreen());
    } else if (input.key === "F12" && DEVTOOLS) {
      e.preventDefault();
      w.webContents.toggleDevTools();
    }
  });

  // Links leave for the system browser; the page itself never navigates away
  w.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (isOwnPage(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  // The page draws maximize or restore, and hides its buttons in fullscreen
  const sendWindowState = () => w.webContents.send("shards:window-state", { maximized: w.isMaximized(), fullscreen: w.isFullScreen() });
  for (const ev of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"] as const) w.on(ev as "maximize", sendWindowState);
  w.webContents.on("did-finish-load", () => {
    sendWindowState();
    if (update) w.webContents.send("shards:update", update);
    if (assetProgress) w.webContents.send("shards:assets", assetProgress);
    downloadAssets();
  });
  w.webContents.on("render-process-gone", (_e, d) => log(`renderer gone: ${d.reason} (${d.exitCode})`));
  w.webContents.on("console-message", (e) => {
    if (e.level === "error" || e.level === "warning") log(`page ${e.level}: ${e.message}`);
  });

  w.on("close", (e) => {
    if (phase === "game" && !closeConfirmed) {
      e.preventDefault();
      void dialog
        .showMessageBox(w, {
          type: "question",
          title: "Meridian Shards",
          message: "Log off and quit Meridian Shards?",
          buttons: ["Log off and quit", "Cancel"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response !== 0) return;
          closeConfirmed = true;
          w.close();
        });
      return;
    }
    const b = w.getNormalBounds();
    saveWindowState({ ...b, maximized: w.isMaximized(), fullscreen: w.isFullScreen() });
  });
  w.on("closed", () => {
    win = null;
  });

  void w.loadURL(DEV_URL ?? APP_URL);
}

function setupIpc(): void {
  ipcMain.on("shards:config", (e) => {
    e.returnValue = config();
  });
  ipcMain.on("shards:phase", (_e, p: unknown) => {
    phase = String(p);
  });
  ipcMain.on("shards:fullscreen", () => win?.setFullScreen(!win.isFullScreen()));
  // The title bar's buttons. Close goes through the window's close handler, which asks first mid-game.
  ipcMain.on("shards:window", (_e, action: unknown) => {
    if (!win) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") {
      if (win.isFullScreen()) win.setFullScreen(false);
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === "close") win.close();
  });
  ipcMain.on("shards:select-server", (_e, origin: unknown) => {
    if (DEV_URL || typeof origin !== "string" || origin === currentServer()) return;
    if (!selectServer(origin)) return;
    launchServer = null;
    log(`server: ${origin}`);
    // The page's files (manifest, rsc0000.rsb, rooms) come from the server: start over
    win?.webContents.reload();
  });
  ipcMain.on("shards:install-update", () => {
    if (!update) return;
    closeConfirmed = true;
    electronUpdater.autoUpdater.quitAndInstall();
  });
}

/**
 * Installed builds update themselves from the feed in electron-builder.yml (publish), which
 * the installer records in resources/app-update.yml; unpacked test builds have none.
 */
function setupUpdates(): void {
  if (!app.isPackaged || DEV_URL || !existsSync(join(process.resourcesPath, "app-update.yml"))) return;
  const { autoUpdater } = electronUpdater;
  // First lines only: electron-updater's errors carry whole HTTP responses
  const line = (m: unknown) => log(`update: ${String(m).split("\n")[0]}`);
  autoUpdater.logger = { info: line, warn: line, error: () => {}, debug: () => {} };
  autoUpdater.on("update-downloaded", (info) => {
    update = { version: info.version };
    win?.webContents.send("shards:update", update);
  });
  autoUpdater.checkForUpdates().catch((e: Error) => log(`update check failed: ${e.message.split("\n")[0]}`));
}

app.on("window-all-closed", () => app.quit());

// One game at a time: two would share one profile (its storage and the asset cache). The
// original allowed several clients; a second start here brings the running one forward.
const firstInstance = !!DEV_URL || app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// Windows groups taskbar buttons by this id: the same as the installer's shortcuts
// (electron-builder.yml appId), so the running game sits under the pinned shortcut, with its icon
if (process.platform === "win32") app.setAppUserModelId("net.meridianshards.client");

void app.whenReady().then(() => {
  if (!firstInstance) return;
  log(`Meridian Shards ${app.getVersion()} (Electron ${process.versions.electron}), ${DEV_URL ? `dev: ${DEV_URL}` : `server: ${currentServer()}`}`);
  const { host, port, username, password, quickstart } = commandLine;
  if (host || port || username || password || quickstart)
    log(`command line: ${[host && `/H:${host}`, port && `/P:${port}`, username && `/U:${username}`, password && "/W:...", quickstart && "/Q"].filter(Boolean).join(" ")}`);
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url);
    if (url.host !== HOST) return new Response("not found", { status: 404 });
    if (url.pathname.startsWith("/assets/")) return assets.handle(currentServer(), url.pathname.slice("/assets/".length), url.searchParams.get("v"));
    return serveClient(url.pathname);
  });
  setMenu();
  setupIpc();
  createWindow();
  setupUpdates();
});
