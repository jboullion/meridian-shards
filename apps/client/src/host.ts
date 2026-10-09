// Where the client runs: a plain browser tab, the desktop app (apps/desktop), whose
// preload exposes `window.shardsDesktop`, or the Android app (apps/android), whose
// ShardsHost exposes `window.shardsAndroid`. In the browser everything is same-origin
// (/assets and /ws on the page's host). In the apps the page is app://shards or
// https://localhost, the native side serves /assets from the chosen server, and the game
// socket goes straight to that server's /ws. Both apps give the page a DesktopBridge, so
// `desktop` below means "an app with a server list", whichever platform it is.

export interface DesktopServer {
  name: string;
  /** e.g. https://35-206-75-121.sslip.io: the game socket is <origin>/ws, the files <origin>/assets/ */
  origin: string;
}

export interface DesktopUpdate {
  /** The version that's downloaded and installs on restart */
  version: string;
}

/** The desktop app downloading every game file into its cache (on first run, and after server updates). */
export interface DesktopAssetProgress {
  /** checking: reading the manifest and the cache; error: some files failed (they load when needed) */
  state: "checking" | "downloading" | "done" | "error";
  /** Bytes on disk so far, counting files that were already cached */
  doneBytes: number;
  totalBytes: number;
  /** Files downloaded by this run (0: everything was already there) */
  fetched: number;
  failed: number;
}

/** The window, for the title bar's maximize / restore button */
export interface DesktopWindowState {
  maximized: boolean;
  fullscreen: boolean;
}

/** The original client's command line (/U, /W, /Q; config.c ConfigOverride), for this start only */
export interface DesktopLaunch {
  username?: string;
  password?: string;
  /** /Q: log on at once and, with one character, enter the game (charpick.c ChooseCharacter) */
  quickstart: boolean;
}

export interface DesktopConfig {
  version: string;
  /** Set on the window's first page only (a reload, such as switching servers, doesn't get it) */
  launch?: DesktopLaunch | null;
  /** Running against the Vite dev server (npm run desktop) */
  dev: boolean;
  platform: string;
  servers: DesktopServer[];
  /** The selected server's origin */
  server: string;
}

export interface DesktopBridge extends DesktopConfig {
  /** Remembers the choice and reloads the page, so the files come from the new server. */
  selectServer(origin: string): void;
  /** The session phase, so closing the window mid-game can ask first. */
  setPhase(phase: string): void;
  toggleFullscreen(): void;
  onUpdate(fn: (u: DesktopUpdate) => void): () => void;
  /** Progress of the game file download; called at once with the latest state if there is one. */
  onAssets(fn: (p: DesktopAssetProgress) => void): () => void;
  installUpdate(): void;
  /** The title bar's buttons (the window has no frame of its own); close asks first mid-game */
  windowControl(action: "minimize" | "maximize" | "close"): void;
  /** Called at once with the current state */
  onWindowState(fn: (s: DesktopWindowState) => void): () => void;
}

/** apps/android ShardsHost.java (a WebView JavaScript interface: synchronous, strings only) */
interface AndroidHost {
  /** DesktopConfig as JSON */
  config(): string;
  /** Remembers the choice; false if it isn't one of the servers */
  selectServer(origin: string): boolean;
  setPhase(phase: string): void;
  /** Starts the game file download (AssetCache.downloadAll), once per server per page load */
  downloadAssets(): void;
  /** Its latest progress (DesktopAssetProgress) as JSON, "" before any; later ones come to window.shardsAndroidAssets */
  assetProgress(): string;
  /** Lets the phone turn upright (before the game) or keeps it landscape */
  allowPortrait(allow: boolean): void;
}

/** The releases the apps come from (apps/desktop/electron-builder.yml publish); the APK is one of each release's files */
const LATEST_RELEASE = "https://api.github.com/repos/jboullion/meridian-shards/releases/latest";

/** Whether version a (x.y.z) is newer than b. */
export function newerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number),
    pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** The latest release's APK if it's newer than `current`; null otherwise, or when GitHub can't be asked. */
async function newerApk(current: string): Promise<{ version: string; url: string } | null> {
  try {
    const res = await fetch(LATEST_RELEASE, { cache: "no-store" });
    if (!res.ok) return null;
    const release = (await res.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const version = release.tag_name?.replace(/^v/, "") ?? "";
    const apk = release.assets?.find((f) => f.name.endsWith(".apk"));
    return apk && newerVersion(version, current) ? { version, url: apk.browser_download_url } : null;
  } catch {
    return null;
  }
}

/**
 * The Android app's side of DesktopBridge: no window to control. A sideloaded app can't update
 * itself, so an update is a newer release's APK, opened in the phone's browser to install.
 */
function androidBridge(a: AndroidHost): DesktopBridge {
  const config = JSON.parse(a.config()) as DesktopConfig;
  let update: { version: string; url: string } | null = null;
  const updateListeners = new Set<(u: DesktopUpdate) => void>();
  // Not for development builds: their version is whatever the desktop's is
  if (!config.dev)
    void newerApk(config.version).then((found) => {
      if (!found) return;
      update = found;
      for (const fn of updateListeners) fn({ version: found.version });
    });
  const latest = a.assetProgress();
  let assets: DesktopAssetProgress | null = latest ? (JSON.parse(latest) as DesktopAssetProgress) : null;
  const assetListeners = new Set<(p: DesktopAssetProgress) => void>();
  (globalThis as { shardsAndroidAssets?: (p: DesktopAssetProgress) => void }).shardsAndroidAssets = (p) => {
    assets = p;
    for (const fn of assetListeners) fn(p);
  };
  try {
    a.downloadAssets();
  } catch (e) {
    // A Java exception surfaces here; the game still loads its files as it needs them
    console.error("game file download didn't start:", e);
  }
  return {
    ...config,
    selectServer: (origin) => {
      // The page's files (manifest, rsc0000.rsb, rooms) come from the server: start over
      if (origin !== config.server && a.selectServer(origin)) location.reload();
    },
    setPhase: (phase) => a.setPhase(phase),
    toggleFullscreen: () => {},
    onUpdate: (fn) => {
      updateListeners.add(fn);
      if (update) fn({ version: update.version });
      return () => {
        updateListeners.delete(fn);
      };
    },
    onAssets: (fn) => {
      assetListeners.add(fn);
      if (assets) fn(assets);
      return () => {
        assetListeners.delete(fn);
      };
    },
    // Capacitor hands a link off its own origin to the system (the browser downloads the APK)
    installUpdate: () => {
      if (update) location.assign(update.url);
    },
    windowControl: () => {},
    onWindowState: (fn) => {
      fn({ maximized: false, fullscreen: true });
      return () => {};
    },
  };
}

/** Capacitor's App plugin, as its native bridge puts it on the page (no npm import needed) */
interface CapacitorApp {
  addListener(event: "backButton", fn: () => void): unknown;
  exitApp(): void;
}

const capacitorApp = (globalThis as { Capacitor?: { Plugins?: { App?: CapacitorApp } } }).Capacitor?.Plugins?.App;

/** Back button handlers, newest last; each says whether it took the press */
const backHandlers: (() => boolean)[] = [];

/**
 * Android's back button: the newest handler that takes it (closing a window, putting the chat
 * away, asking before logging off); when none does, the app closes. Returns the unsubscribe.
 */
export function onBackButton(fn: () => boolean): () => void {
  backHandlers.push(fn);
  return () => {
    const i = backHandlers.lastIndexOf(fn);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

let awayHandler: (() => void) | null = null;

/**
 * The Android app kept the connection while the player was in another app, for as long as it
 * allows (ConnectionService.java), and now the player is to be logged off. Returns the unsubscribe.
 */
export function onAndroidAway(fn: () => void): () => void {
  awayHandler = fn;
  return () => {
    if (awayHandler === fn) awayHandler = null;
  };
}

(globalThis as { shardsAndroidAway?: () => void }).shardsAndroidAway = () => awayHandler?.();

/** Closes the Android app (after logging off); nothing elsewhere. */
export function exitApp(): void {
  capacitorApp?.exitApp();
}

capacitorApp?.addListener("backButton", () => {
  for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return;
  capacitorApp.exitApp();
});

const androidHost = (globalThis as { shardsAndroid?: AndroidHost }).shardsAndroid;

export const desktop: DesktopBridge | undefined =
  (globalThis as { shardsDesktop?: DesktopBridge }).shardsDesktop ?? (androidHost ? androidBridge(androidHost) : undefined);

/** The Android app: no window frame or title bar of its own to draw. */
export const isAndroid = desktop?.platform === "android";

/** The Android app may turn upright while this is on (the screens before the game, for typing); nothing elsewhere. */
export function allowPortrait(allow: boolean): void {
  try {
    androidHost?.allowPortrait(allow);
  } catch {
    // stays landscape
  }
}

/** Developer pages (the room viewer): always in the browser, only in development on the desktop. */
export const devPagesEnabled = !desktop || desktop.dev;

/** The selected server's display name on the desktop. */
export function serverName(): string {
  if (!desktop) return location.host;
  return desktop.servers.find((s) => s.origin === desktop.server)?.name ?? desktop.server;
}

/** The gateway's WebSocket URL. */
export function gameSocketUrl(): string {
  const base = desktop ? new URL(desktop.server) : new URL(location.href);
  return `${base.protocol === "https:" ? "wss" : "ws"}://${base.host}/ws`;
}
