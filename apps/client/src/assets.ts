// Loads the original game files from /assets (dist/assets, built by `npm run assets`).
// Names are lower-case, as the asset build writes them. Each file is fetched once and
// cached by name; the manifest hash busts the browser cache when a file changes.

import { parseBgf, parsePaletteBin, parseRoo, parseRsb, type Bgf, type Palette, type Room, type RsbBundle } from "@shards/formats";
import type { AmbientExits } from "@shards/world";

interface Manifest {
  /** When the asset build ran: a new value means the server has new files */
  generated: string;
  rsbHash: string;
  files: Record<string, { size: number; hash: string }>;
}

export class AssetStore {
  private manifest: Manifest | null = null;
  private bytes = new Map<string, Promise<Uint8Array>>();
  private bgfs = new Map<string, Promise<Bgf | null>>();
  private readonly base: string;

  constructor(base = "/assets/") {
    this.base = base;
  }

  async init(): Promise<void> {
    const res = await fetch(this.base + "manifest.json");
    if (res.status === 404) throw new Error("No dist/assets/manifest.json. Run `npm run assets` first.");
    if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
    this.manifest = await res.json();
  }

  /**
   * Whether the server's files changed since this page loaded (it was updated meanwhile).
   * The page must then reload: rsc0000.rsb and the rooms have to match the server's.
   */
  async changedOnServer(): Promise<boolean> {
    if (!this.manifest) return false;
    const res = await fetch(this.base + "manifest.json", { cache: "no-store" });
    if (!res.ok) return false;
    return ((await res.json()) as Manifest).generated !== this.manifest.generated;
  }

  has(name: string): boolean {
    return !!this.manifest?.files[name.toLowerCase()];
  }

  /** URL of an asset for the page to load directly (interface bitmaps: "ui/bkgnd.bmp"). */
  url(name: string): string {
    const key = name.toLowerCase();
    const entry = this.manifest?.files[key];
    return entry ? `${this.base}${key}?v=${entry.hash}` : `${this.base}${key}`;
  }

  /** A file's bytes, fetched once and kept. */
  fetchBytes(name: string): Promise<Uint8Array> {
    const key = name.toLowerCase();
    let p = this.bytes.get(key);
    if (!p) {
      p = this.download(key);
      this.bytes.set(key, p);
    }
    return p;
  }

  /** A file's bytes without keeping them, for files the caller parses and keeps itself. */
  private download(key: string): Promise<Uint8Array> {
    const entry = this.manifest?.files[key];
    if (!entry) return Promise.reject(new Error(`asset not found: ${key}`));
    return fetch(`${this.base}${key}?v=${entry.hash}`).then(async (r) => {
      if (!r.ok) throw new Error(`${key}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
  }

  /** A .bgf by file name; null when the file doesn't exist (the client draws nothing then). */
  bgf(name: string): Promise<Bgf | null> {
    const key = name.toLowerCase();
    let p = this.bgfs.get(key);
    if (!p) {
      p = this.has(key) ? this.download(key).then((b) => parseBgf(b)) : Promise.resolve(null);
      this.bgfs.set(key, p);
    }
    return p;
  }

  async room(name: string): Promise<Room> {
    return parseRoo(await this.download(name.toLowerCase()));
  }

  /** Room file -> the room files its exits lead to (roomlinks.json from the asset build); empty without one. */
  async roomLinks(): Promise<Record<string, string[]>> {
    if (!this.has("roomlinks.json")) return {};
    return JSON.parse(new TextDecoder().decode(await this.download("roomlinks.json"))) as Record<string, string[]>;
  }

  /** Room file -> its door squares and the sides that lead out (roomexits.json from the asset build); empty without one. */
  async roomExits(): Promise<Record<string, AmbientExits>> {
    if (!this.has("roomexits.json")) return {};
    return JSON.parse(new TextDecoder().decode(await this.download("roomexits.json"))) as Record<string, AmbientExits>;
  }

  /** Room file -> its terrain (roomterrain.json from the asset build, the TERRAIN_* names); empty without one */
  async roomTerrain(): Promise<Record<string, string[]>> {
    if (!this.has("roomterrain.json")) return {};
    return JSON.parse(new TextDecoder().decode(await this.download("roomterrain.json"))) as Record<string, string[]>;
  }

  /** Floor textures that are water even on a dry floor (watertextures.json from the asset build); empty without one */
  async waterTextures(): Promise<Set<number>> {
    if (!this.has("watertextures.json")) return new Set();
    return new Set(JSON.parse(new TextDecoder().decode(await this.download("watertextures.json"))) as number[]);
  }

  /** Floor texture -> what it is (grass, earth or rocky), its average colour, and whether it's cobbled (floortextures.json from the asset build); empty without one */
  async floorTextures(): Promise<Map<number, { kind: "grass" | "earth" | "rocky"; color: [number, number, number]; cobbled: boolean }>> {
    if (!this.has("floortextures.json")) return new Map();
    const raw = JSON.parse(new TextDecoder().decode(await this.download("floortextures.json"))) as Record<string, ["grass" | "earth" | "rocky", number, number, number, number?]>;
    return new Map(Object.entries(raw).map(([t, [kind, r, g, b, cobbled]]) => [Number(t), { kind, color: [r / 255, g / 255, b / 255], cobbled: cobbled === 1 }]));
  }

  /** A room's nav grid as the asset build made it (nav/<room>.nav, navGrid.ts encodeNavGrid), or null without one */
  async navGrid(roomFile: string): Promise<Uint8Array | null> {
    const name = `nav/${roomFile.toLowerCase().replace(/\.roo$/, "")}.nav`;
    return this.has(name) ? this.download(name) : null;
  }

  /** Picture file -> where its item is worn (itemslots.json from the asset build); empty without one. */
  async itemSlots(): Promise<Record<string, string>> {
    if (!this.has("itemslots.json")) return {};
    return JSON.parse(new TextDecoder().decode(await this.download("itemslots.json"))) as Record<string, string>;
  }

  /** Spell name (lower case) -> its post-cast delay and mana (spelltimes.json from the asset build); empty without one. */
  async spellTimes(): Promise<Record<string, { postCast: number; mana: number }>> {
    if (!this.has("spelltimes.json")) return {};
    return JSON.parse(new TextDecoder().decode(await this.download("spelltimes.json"))) as Record<string, { postCast: number; mana: number }>;
  }

  async palette(): Promise<Palette> {
    return parsePaletteBin(await this.fetchBytes("palette.bin"));
  }

  /** clientd3d light_palettes (65 x 256), or null if the asset build couldn't make them. */
  async lightPalettes(): Promise<Uint8Array | null> {
    return this.has("lightpal.bin") ? this.fetchBytes("lightpal.bin") : null;
  }

  async rsb(): Promise<RsbBundle> {
    return parseRsb(await this.fetchBytes("rsc0000.rsb"));
  }
}
