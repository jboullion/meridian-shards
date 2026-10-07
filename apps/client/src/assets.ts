// Loads the original game files from /assets (dist/assets, built by `npm run assets`).
// Names are lower-case, as the asset build writes them. Each file is fetched once and
// cached by name; the manifest hash busts the browser cache when a file changes.

import { parseBgf, parsePaletteBin, parseRoo, parseRsb, type Bgf, type Palette, type Room, type RsbBundle } from "@shards/formats";

interface Manifest {
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
    if (!res.ok) throw new Error("No dist/assets/manifest.json. Run `npm run assets` first.");
    this.manifest = await res.json();
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

  fetchBytes(name: string): Promise<Uint8Array> {
    const key = name.toLowerCase();
    let p = this.bytes.get(key);
    if (!p) {
      const entry = this.manifest?.files[key];
      if (!entry) return Promise.reject(new Error(`asset not found: ${key}`));
      p = fetch(`${this.base}${key}?v=${entry.hash}`).then(async (r) => {
        if (!r.ok) throw new Error(`${key}: HTTP ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      });
      this.bytes.set(key, p);
    }
    return p;
  }

  /** A .bgf by file name; null when the file doesn't exist (the client draws nothing then). */
  bgf(name: string): Promise<Bgf | null> {
    const key = name.toLowerCase();
    let p = this.bgfs.get(key);
    if (!p) {
      p = this.has(key) ? this.fetchBytes(key).then((b) => parseBgf(b)) : Promise.resolve(null);
      this.bgfs.set(key, p);
    }
    return p;
  }

  async room(name: string): Promise<Room> {
    return parseRoo(await this.fetchBytes(name));
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
