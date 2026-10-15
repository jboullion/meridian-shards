// The desktop app's own settings, in userData (%APPDATA%\Meridian Shards on Windows):
//   settings.json  the chosen server and the window's size, position and state
//   servers.json   optional extra servers, [{ "name": "...", "origin": "https://..." }], or reached
//                  straight over TCP: [{ "name": "...", "tcp": "host:port", "resources": "<asset build>" }]
// Game settings (keys, sound) stay in the page's localStorage, as in the browser.

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DesktopServer } from "../../client/src/host.ts";
import { log } from "./log.ts";

/** Our hosted server; the update feed lives on it too (deploy/README.md). */
export const VM_ORIGIN = "https://35-206-75-121.sslip.io";

const DEFAULT_SERVERS: DesktopServer[] = [
  { name: "Shards VM", origin: VM_ORIGIN },
  // deploy/ run locally (docker compose with HTTP_PORT=8080)
  { name: "Local (Docker)", origin: "http://localhost:8080" },
  // npm run dev: Vite serves /assets and proxies /ws to the gateway
  { name: "Local (dev)", origin: "http://localhost:5173" },
  // Our local 101 server (server\build.cmd), straight over TCP with the app's own files
  { name: "Local 101 (direct)", origin: "tcp://127.0.0.1:5959", tcp: "127.0.0.1:5959" },
];

/** "host:port" for a server reached over TCP, else null */
export function normalizeTcp(target: string): string | null {
  const m = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(target.trim());
  return m && Number(m[2]) > 0 && Number(m[2]) < 65536 ? `${m[1]}:${Number(m[2])}` : null;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
}

interface Settings {
  server?: string;
  window?: WindowState;
}

const file = (name: string) => join(app.getPath("userData"), name);

function readJson<T>(name: string): T | undefined {
  try {
    return existsSync(file(name)) ? (JSON.parse(readFileSync(file(name), "utf8")) as T) : undefined;
  } catch (e) {
    log(`${name}: ${(e as Error).message}`);
    return undefined;
  }
}

/** "https://host:port" for an http(s) URL, else null. */
export function normalizeOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}

let settings: Settings | undefined;

function current(): Settings {
  settings ??= readJson<Settings>("settings.json") ?? {};
  return settings;
}

function save(): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(file("settings.json"), JSON.stringify(current(), null, 2));
  } catch (e) {
    log(`settings.json: ${(e as Error).message}`);
  }
}

/** The built-in servers plus any in servers.json. */
export function servers(): DesktopServer[] {
  const extra = readJson<unknown>("servers.json");
  const list = [...DEFAULT_SERVERS];
  if (Array.isArray(extra))
    for (const s of extra as Partial<DesktopServer>[]) {
      const tcp = typeof s?.tcp === "string" ? normalizeTcp(s.tcp) : null;
      if (tcp) {
        const origin = `tcp://${tcp}`;
        const resources = typeof s.resources === "string" && s.resources ? s.resources : undefined;
        if (!list.some((l) => l.origin === origin)) list.push({ name: String(s.name ?? tcp), origin, tcp, resources });
        continue;
      }
      const origin = typeof s?.origin === "string" ? normalizeOrigin(s.origin) : null;
      if (origin && !list.some((l) => l.origin === origin)) list.push({ name: String(s.name ?? origin), origin });
    }
  return list;
}

export function selectedServer(): string {
  const list = servers();
  const s = current().server;
  return list.find((l) => l.origin === s)?.origin ?? list[0].origin;
}

export function selectServer(origin: string): boolean {
  if (!servers().some((s) => s.origin === origin)) return false;
  current().server = origin;
  save();
  return true;
}

export function windowState(): WindowState | undefined {
  return current().window;
}

export function saveWindowState(w: WindowState): void {
  current().window = w;
  save();
}
