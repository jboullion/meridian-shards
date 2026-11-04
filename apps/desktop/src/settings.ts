// The desktop app's own settings, in userData (%APPDATA%\Meridian Shards on Windows):
//   settings.json  the window's size, position and state
// There's one server, ours (the command line's /H can point a run elsewhere, for testing).
// Game settings (keys, sound) stay in the page's localStorage, as in the browser.

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DesktopServer } from "../../client/src/host.ts";
import { log } from "./log.ts";

/** Our hosted server; the update feed lives on it too (deploy/README.md). */
export const VM_ORIGIN = "https://m59-shards.com";

const SERVERS: DesktopServer[] = [{ name: "Meridian Shards", origin: VM_ORIGIN }];

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
}

interface Settings {
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

/** Ours, the only one. */
export function servers(): DesktopServer[] {
  return [...SERVERS];
}

export function selectedServer(): string {
  return VM_ORIGIN;
}

export function windowState(): WindowState | undefined {
  return current().window;
}

export function saveWindowState(w: WindowState): void {
  current().window = w;
  save();
}
