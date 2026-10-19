// Loads the original game files from /assets (dist/assets, built by `npm run assets`).
// Names are lower-case, as the asset build writes them. Each file is fetched once and
// cached by name; the manifest hash busts the browser cache when a file changes.

import { parseBgf, parsePaletteBin, parseRoo, parseRsb, type Bgf, type Palette, type Room, type RsbBundle } from "@shards/formats";
import { EMPTY_CATALOG, type AmbientExits, type QuestCatalog } from "@shards/world";
import type { WindowTexture } from "@shards/render";

interface Manifest {
  /** When the asset build ran: a new value means the server has new files */
  generated: string;
  rsbHash: string;
  files: Record<string, { size: number; hash: string }>;
}

/** A spell's entry in spelltimes.json (tools/assets/spellTimes.ts) */
export interface SpellTimes {
  postCast: number;
  mana: number;
  reagents?: { name: string; plural?: string; amount: number }[];
}

/** A login screen background (login/backgrounds.json): a place, and its pictures by layout */
export interface LoginBackground {
  id: string;
  title: string;
  tags: string[];
  time: string;
  /** Asset names by layout: "modern" (the desktop's), "mobile" (the phone's) */
  files: Partial<Record<"modern" | "mobile", string>>;
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

  /**
   * Reads the manifest again and forgets the files whose hash changed, so they're fetched anew:
   * a room edited or deployed while we play. Returns the names that changed. A new rsc0000.rsb
   * still needs a page reload (the redbook token and every resource name depend on it).
   */
  async refresh(): Promise<string[]> {
    const res = await fetch(this.base + "manifest.json", { cache: "no-store" });
    if (!res.ok || !this.manifest) return [];
    const next = (await res.json()) as Manifest;
    const changed = Object.keys(next.files).filter((k) => next.files[k]!.hash !== this.manifest!.files[k]?.hash);
    for (const k of changed) {
      this.bytes.delete(k);
      this.bgfs.delete(k);
    }
    if (next.rsbHash !== this.manifest.rsbHash) console.warn("rsc0000.rsb changed on the server: reload the page to use it");
    this.manifest = next;
    return changed;
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

  /** Ours (docs/adr/0009-quests.md 6): the quest catalogue (quests.json from the asset build, tools/quests); empty without one */
  async questCatalog(): Promise<QuestCatalog> {
    if (!this.has("quests.json")) return EMPTY_CATALOG;
    return JSON.parse(new TextDecoder().decode(await this.download("quests.json"))) as QuestCatalog;
  }

  /** Every room by number, with its name and file (rooms.json from the asset build), for the admin console; empty without one */
  async roomList(): Promise<{ rid: number; name: string; roo: string }[]> {
    if (!this.has("rooms.json")) return [];
    return JSON.parse(new TextDecoder().decode(await this.download("rooms.json"))) as { rid: number; name: string; roo: string }[];
  }

  /**
   * Ours: the login screen's backgrounds (login/backgrounds.json from the asset build, made by the
   * screenshot tour): each with its pictures by layout ("modern" for the desktop, "mobile" for
   * the phone). Empty without one.
   */
  async loginBackgrounds(): Promise<LoginBackground[]> {
    if (!this.has("login/backgrounds.json")) return [];
    return JSON.parse(new TextDecoder().decode(await this.download("login/backgrounds.json"))) as LoginBackground[];
  }

  /** Floor textures that are water even on a dry floor (watertextures.json from the asset build); empty without one */
  async waterTextures(): Promise<Set<number>> {
    if (!this.has("watertextures.json")) return new Set();
    return new Set(JSON.parse(new TextDecoder().decode(await this.download("watertextures.json"))) as number[]);
  }

  /** Ours (docs/adr/0018-seasons-water-windows.md): foliage wall textures, which change with the seasons (foliage.json); empty without one */
  async foliageTextures(): Promise<Set<number>> {
    if (!this.has("foliage.json")) return new Set();
    const raw = JSON.parse(new TextDecoder().decode(await this.download("foliage.json"))) as { textures: Record<string, string> };
    return new Set(Object.keys(raw.textures).map(Number));
  }

  /** Ours: wall textures' windows, whose glass glows at night (windows.json); empty without one */
  async windowTextures(): Promise<Map<number, WindowTexture>> {
    if (!this.has("windows.json")) return new Map();
    const raw = JSON.parse(new TextDecoder().decode(await this.download("windows.json"))) as { textures: Record<string, WindowTexture> };
    return new Map(Object.entries(raw.textures).map(([id, w]) => [Number(id), w]));
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

  /** itemtypes.json: picture file (lower case) -> what kind of item it is, for sorting; empty without one */
  async itemTypes(): Promise<Record<string, string>> {
    if (!this.has("itemtypes.json")) return {};
    return JSON.parse(new TextDecoder().decode(await this.download("itemtypes.json"))) as Record<string, string>;
  }

  /**
   * Spell name (lower case) -> its post-cast delay, mana and reagents (spelltimes.json from the asset
   * build; reagents missing in builds before Study mode); empty without one.
   */
  async spellTimes(): Promise<Record<string, SpellTimes>> {
    if (!this.has("spelltimes.json")) return {};
    return JSON.parse(new TextDecoder().decode(await this.download("spelltimes.json"))) as Record<string, SpellTimes>;
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
