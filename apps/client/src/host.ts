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
}

/** The Android app's side of DesktopBridge: no window to control, and no updates or downloads yet (ADR 0003 phases 2 and 4). */
function androidBridge(a: AndroidHost): DesktopBridge {
  const config = JSON.parse(a.config()) as DesktopConfig;
  const none = () => () => {};
  return {
    ...config,
    selectServer: (origin) => {
      // The page's files (manifest, rsc0000.rsb, rooms) come from the server: start over
      if (origin !== config.server && a.selectServer(origin)) location.reload();
    },
    setPhase: (phase) => a.setPhase(phase),
    toggleFullscreen: () => {},
    onUpdate: none,
    onAssets: none,
    installUpdate: () => {},
    windowControl: () => {},
    onWindowState: (fn) => {
      fn({ maximized: false, fullscreen: true });
      return () => {};
    },
  };
}

const androidHost = (globalThis as { shardsAndroid?: AndroidHost }).shardsAndroid;

export const desktop: DesktopBridge | undefined =
  (globalThis as { shardsDesktop?: DesktopBridge }).shardsDesktop ?? (androidHost ? androidBridge(androidHost) : undefined);

/** The Android app: no window frame or title bar of its own to draw. */
export const isAndroid = desktop?.platform === "android";

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
