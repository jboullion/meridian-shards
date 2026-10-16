// Where the client runs: a plain browser tab, the desktop app (apps/desktop), whose
// preload exposes `window.shardsDesktop`, or the Android app (apps/android), whose
// ShardsHost exposes `window.shardsAndroid`. In the browser everything is same-origin
// (/assets and /ws on the page's host). In the apps the page is app://shards or
// https://localhost, the native side serves /assets from the chosen server, and the game
// socket goes straight to that server's /ws. Both apps give the page a DesktopBridge, so
// `desktop` below means "an app with a server list", whichever platform it is.

import { apkOf, detectPlatform, installerOf, parseRelease, webBundleOf, type Platform, type Release } from "./updates.ts";

// Vite's (vite.config.ts; env.d.ts), declared here too because the desktop app type-checks this file
declare const __APP_VERSION__: string;

export interface DesktopServer {
  name: string;
  /** e.g. https://35-206-75-121.sslip.io: the game socket is <origin>/ws, the files <origin>/assets/ */
  origin: string;
}

export interface DesktopUpdate {
  /** The version that's downloaded and installs on restart */
  version: string;
  /**
   * The desktop's (electron-updater): downloading (0..1 `progress`), ready to install on restart,
   * or failed (unsigned macOS builds can't update themselves: the installer is downloaded instead).
   * Absent from older apps, which only said when it was ready.
   */
  state?: "downloading" | "ready" | "error";
  progress?: number | null;
  /**
   * The Android app (ours; updates.ts): `web`, the page by itself, downloaded and ready (restart);
   * `apk`, a new app to download and install (state and progress as it goes).
   */
  android?: {
    kind: "web" | "apk";
    state: "ready" | "available" | "downloading" | "downloaded" | "permission" | "installing" | "error";
    /** 0..1 while downloading, when the size is known */
    progress?: number | null;
  };
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
  // ---- updates (shell 1 and later; WebUpdates, ApkUpdates)
  /** The app's shell version (apps/android/shell.json) */
  shell?(): number;
  /** Downloads a release's page bundle; the outcome comes to window.shardsAndroidWebUpdate */
  downloadWebUpdate?(url: string, version: string, sha256: string): void;
  /** Reloads the page from the downloaded bundle; false if there's none */
  applyWebUpdate?(): boolean;
  /** The page runs: an updated page is kept (else the next start goes back to the app's own) */
  confirmWebBundle?(): void;
  /** Downloads a release's APK, then opens the installer; progress comes to window.shardsAndroidApk */
  downloadApk?(url: string, version: string): void;
  /** Opens the installer on the downloaded APK again; false if there's none */
  installApk?(version: string): boolean;
}

/** What the native side says about a page bundle download (WebUpdates.download) */
interface WebUpdateReport {
  state: "ready" | "error";
  version: string;
  message?: string;
}

/** What it says about an APK download (ApkUpdates) */
interface ApkReport {
  state: "downloading" | "downloaded" | "permission" | "installing" | "error";
  version: string;
  done: number;
  total: number;
  message?: string;
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

/** The latest release, or null when GitHub can't be asked. */
async function latestRelease(feed: string): Promise<Release | null> {
  try {
    const res = await fetch(feed, { cache: "no-store" });
    return res.ok ? parseRelease(await res.json()) : null;
  } catch {
    return null;
  }
}

/**
 * A development build's update feed, for trying the updates out (localStorage
 * `shards.updateFeed`: a URL answering like GitHub's latest release); none by default.
 */
function devUpdateFeed(): string | null {
  try {
    return localStorage.getItem("shards.updateFeed");
  } catch {
    return null;
  }
}

/** How long the page has to run before an updated page counts as working (WebUpdates.confirm), ms */
const CONFIRM_AFTER_MS = 3000;

/**
 * The Android app's side of DesktopBridge: no window to control. Updates (updates.ts): when the
 * latest release's page bundle suits this app's shell, it's downloaded quietly and the login
 * screen offers to restart into it; otherwise the release's APK is downloaded on request and
 * Android's installer opens on it. An app without the update calls (before shell 1) has the
 * phone's browser download the APK.
 */
function androidBridge(a: AndroidHost): DesktopBridge {
  const config = JSON.parse(a.config()) as DesktopConfig;
  // The page's own version: an updated page is newer than the APK it runs in
  config.version = __APP_VERSION__;
  let update: DesktopUpdate | null = null;
  let apkUrl: string | null = null;
  const updateListeners = new Set<(u: DesktopUpdate) => void>();
  const announce = (u: DesktopUpdate) => {
    update = u;
    for (const fn of updateListeners) fn(u);
  };
  const offerApk = (version: string) => apkUrl && announce({ version, android: { kind: "apk", state: "available" } });
  const g = globalThis as { shardsAndroidWebUpdate?: (r: WebUpdateReport) => void; shardsAndroidApk?: (r: ApkReport) => void };
  g.shardsAndroidWebUpdate = (r) => {
    if (r.state === "ready") announce({ version: r.version, android: { kind: "web", state: "ready" } });
    else {
      // The bundle didn't come through: the APK still will
      console.warn("page update:", r.message);
      offerApk(r.version);
    }
  };
  g.shardsAndroidApk = (r) =>
    announce({ version: r.version, android: { kind: "apk", state: r.state, progress: r.total > 0 ? Math.min(1, r.done / r.total) : null } });
  // Not for development builds (their version is whatever the desktop's is), unless a feed is set to try it
  const feed = config.dev ? devUpdateFeed() : LATEST_RELEASE;
  if (feed)
    void latestRelease(feed).then((release) => {
      if (!release || !newerVersion(release.version, config.version)) return;
      apkUrl = apkOf(release)?.browser_download_url ?? null;
      const web = webBundleOf(release);
      const shell = a.shell?.() ?? 0;
      if (web && a.downloadWebUpdate && web.shell <= shell) {
        // Said at once, so the login screen knows an update is coming while it downloads
        announce({ version: release.version, android: { kind: "web", state: "downloading", progress: null } });
        a.downloadWebUpdate(web.url, release.version, web.sha256);
      } else offerApk(release.version);
    });
  // An updated page that gets this far works: keep it
  setTimeout(() => a.confirmWebBundle?.(), CONFIRM_AFTER_MS);
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
      if (update) fn(update);
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
    installUpdate: () => {
      const u = update?.android;
      if (!update || !u) return;
      if (u.kind === "web") {
        if (u.state !== "ready") return;
        if (!a.applyWebUpdate?.()) location.reload();
        return;
      }
      if (u.state === "downloaded" || u.state === "permission" || u.state === "installing") {
        a.installApk?.(update.version);
        return;
      }
      if (u.state === "downloading" || !apkUrl) return;
      if (a.downloadApk) {
        announce({ version: update.version, android: { kind: "apk", state: "downloading", progress: 0 } });
        a.downloadApk(apkUrl, update.version);
      }
      // Capacitor hands a link off its own origin to the system: the browser downloads the APK
      else location.assign(apkUrl);
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

/**
 * Developer pages (the room viewer, ?viewer and ?rid=): only in development (Vite's dev server:
 * npm run dev, npm run desktop). No build players get (the hosted browser client, the installers,
 * the APK) has them or links to them.
 */
// (Vite's import.meta.env, read through a cast: this file is also type-checked without Vite's types)
export const devPagesEnabled = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true && (!desktop || !!desktop.dev);

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

/** The arena's feed's WebSocket URL (docs/adr/0007-arena.md; the friends relay's once), beside the gateway's */
export function socialSocketUrl(): string {
  return gameSocketUrl().replace(/\/ws$/, "/social");
}

/**
 * A newer version players must update to before they can log in (ours): the apps' from the
 * latest GitHub release; the browser's when the server serves a newer page than this one.
 */
export interface RequiredUpdate {
  /** The version that's out; null in the browser, which only knows the page changed */
  version: string | null;
  /** The installer for this system (the desktop) or the APK (Android), for when the app can't update itself */
  download: string | null;
  /** The browser: a reload gets it */
  reload: boolean;
}

/** How long one answer is kept (GitHub allows 60 unauthenticated requests an hour per address), ms */
const REQUIRED_CHECK_MS = 10 * 60_000;
let requiredCheck: { at: number; result: Promise<RequiredUpdate | null> } | null = null;

/**
 * Whether this client must update before playing; asked when the login screen shows and on
 * logging in. Null when it's current, in development (unless `shards.updateFeed` names a feed to
 * try), or when the answer can't be had: nobody is locked out because GitHub didn't answer.
 */
export function requiredUpdate(): Promise<RequiredUpdate | null> {
  if (requiredCheck && performance.now() - requiredCheck.at < REQUIRED_CHECK_MS) return requiredCheck.result;
  const result = (async (): Promise<RequiredUpdate | null> => {
    if (desktop) {
      const feed = desktop.dev ? devUpdateFeed() : LATEST_RELEASE;
      const release = feed ? await latestRelease(feed) : null;
      if (!release || !newerVersion(release.version, desktop.version)) return null;
      const platform: Platform | null = isAndroid ? "android" : detectPlatform(navigator.userAgent);
      const file = platform ? installerOf(release, platform) : null;
      return { version: release.version, download: file?.browser_download_url ?? null, reload: false };
    }
    if (devPagesEnabled) return null;
    // The browser: the page the server serves now, against the one running (Vite names its entry by content hash)
    try {
      const ours = document.querySelector<HTMLScriptElement>("script[type=module][src]")?.getAttribute("src");
      const res = await fetch(location.pathname, { cache: "no-store" });
      if (!ours || !res.ok) return null;
      const served = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(await res.text())?.[1];
      return served && served !== ours ? { version: null, download: null, reload: true } : null;
    } catch {
      return null;
    }
  })();
  requiredCheck = { at: performance.now(), result };
  return result;
}

/** Where the browser's Download button goes (TitleBar.tsx) */
export interface DownloadLink {
  url: string;
  /** The system the installer is for; null for the download page */
  platform: Platform | null;
  /** The installer's size in bytes, when known */
  size: number | null;
}

/** The website's download page, beside the game on our server (deploy/web/Caddyfile) */
const DOWNLOAD_PAGE = "/download/";
let download: Promise<DownloadLink> | null = null;

/**
 * In a browser: the latest release's installer for this system (as the download page picks it),
 * else the download page: on an iPhone, an unknown system, or when GitHub can't be asked. Asked
 * once per page load (GitHub allows 60 unauthenticated requests an hour per address).
 */
export function browserDownload(): Promise<DownloadLink> {
  download ??= (async () => {
    const page: DownloadLink = { url: DOWNLOAD_PAGE, platform: null, size: null };
    const platform = detectPlatform(navigator.userAgent);
    if (!platform) return page;
    const release = await latestRelease(LATEST_RELEASE);
    const file = release && installerOf(release, platform);
    return file ? { url: file.browser_download_url, platform, size: file.size ?? null } : page;
  })();
  return download;
}
