// Where the client runs: a plain browser tab, or the desktop app (apps/desktop), whose
// preload exposes `window.shardsDesktop`. In the browser everything is same-origin
// (/assets and /ws on the page's host). On the desktop the page is app://shards, the main
// process serves /assets from the chosen server (with a disk cache), and the game socket
// goes straight to that server's /ws.

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

export interface DesktopConfig {
  version: string;
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
}

export const desktop: DesktopBridge | undefined = (globalThis as { shardsDesktop?: DesktopBridge }).shardsDesktop;

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
