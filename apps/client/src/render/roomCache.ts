// Rooms ready to show: the one you're in, and the ones its exits lead to (roomlinks.json from
// the asset build), loaded ahead one at a time while the browser is idle. Walking through a
// door or off the edge of the map then shows the next room at once, instead of after its
// textures download and its geometry is built. Rooms that aren't the current one or next
// to it are dropped when you move on.
//
// The cache owns the RoomViews: the scene adds and removes their groups but never disposes them.

import type * as THREE from "three";
import type { AssetStore } from "../assets.ts";
import { loadRoomView, type LoadedRoom } from "./roomLoader.ts";

/** requestIdleCallback where there is one (not Safari), else a short timeout. */
const whenIdle = (fn: () => void) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 50);

export class RoomCache {
  private readonly assets: AssetStore;
  private readonly palette: THREE.Texture;
  private readonly links: Promise<Record<string, string[]>>;
  private readonly loads = new Map<string, Promise<LoadedRoom>>();
  /** The current room and its neighbours */
  private keep = new Set<string>();
  private queue: string[] = [];
  private pumping = false;
  private disposed = false;

  constructor(assets: AssetStore, palette: THREE.Texture) {
    this.assets = assets;
    this.palette = palette;
    this.links = assets.roomLinks().catch(() => ({}));
  }

  /** A room, loading it if it isn't loaded or loading yet. */
  get(roo: string): Promise<LoadedRoom> {
    const key = roo.toLowerCase();
    let p = this.loads.get(key);
    if (!p) {
      const load = loadRoomView(this.assets, key, this.palette);
      this.loads.set(key, load);
      // Dropped while it loaded: nobody will show it. A failed load can be tried again.
      load.then(
        (l) => this.drop(key, load, l),
        () => {
          if (this.loads.get(key) === load) this.loads.delete(key);
        },
      );
      p = load;
    }
    return p;
  }

  /** `roo` is the current room now: keep it and its neighbours, drop the rest, and load the neighbours ahead. */
  async enter(roo: string): Promise<void> {
    const key = roo.toLowerCase();
    this.keep = new Set([key]);
    const near = ((await this.links)[key] ?? []).filter((n) => this.assets.has(n));
    if (this.disposed || !this.keep.has(key)) return; // moved on meanwhile
    this.keep = new Set([key, ...near]);
    for (const [k, p] of this.loads) if (!this.keep.has(k)) void p.then((l) => this.drop(k, p, l), () => {});
    this.queue = near.filter((n) => !this.loads.has(n));
    this.pump();
  }

  /** Loads the queued neighbours one at a time, each when the page is idle. */
  private pump(): void {
    if (this.pumping || this.disposed) return;
    const next = this.queue.shift();
    if (!next) return;
    this.pumping = true;
    whenIdle(() => {
      const done = () => {
        this.pumping = false;
        this.pump();
      };
      if (this.disposed || !this.keep.has(next)) return done();
      this.get(next).then(done, done);
    });
  }

  /** Disposes a loaded room unless it's still wanted (or already gone). */
  private drop(key: string, p: Promise<LoadedRoom>, l: LoadedRoom): void {
    if ((this.keep.has(key) && !this.disposed) || this.loads.get(key) !== p) return;
    this.loads.delete(key);
    l.view.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    for (const [k, p] of this.loads) void p.then((l) => this.drop(k, p, l), () => {});
  }
}
