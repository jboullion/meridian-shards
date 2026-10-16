// Rooms ready to show: the one you're in, and the ones its exits lead to (roomlinks.json from
// the asset build), loaded ahead one at a time while the browser is idle. Walking through a
// door or off the edge of the map then shows the next room at once, instead of after its
// textures download and its geometry is built. Rooms that aren't the current one or next
// to it are dropped when you move on.
//
// Ours: each neighbour is also made ready to show while the page is idle (`prepare`, given by the
// scene): its textures' smoothed copies and shaded corners made and sent to the graphics card,
// which otherwise took the first frame in a big town 70-90 ms (2026-10-16).
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
  /** Makes a loaded neighbour ready to show, a little at a time (the scene's: it has the renderer) */
  private readonly prepare: ((l: LoadedRoom) => Promise<void>) | null;
  /** Rooms prepare() has made ready (a room loaded again is a new LoadedRoom) */
  private readonly prepared = new WeakSet<LoadedRoom>();

  constructor(assets: AssetStore, palette: THREE.Texture, prepare?: (l: LoadedRoom) => Promise<void>) {
    this.assets = assets;
    this.palette = palette;
    this.prepare = prepare ?? null;
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
    // every neighbour: one loaded already (the room you just left) may not be made ready yet
    this.queue = [...near];
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
      this.get(next)
        .then(
          async (l) => {
            if (this.disposed || !this.keep.has(next) || !this.prepare || this.prepared.has(l)) return;
            try {
              await this.prepare(l);
              this.prepared.add(l);
            } catch (e) {
              console.warn(`room ${next}: not made ready ahead: ${(e as Error).message}`);
            }
          },
          () => {}, // a failed load is tried again when it's wanted
        )
        .then(done, done);
    });
  }

  /**
   * Forgets a room whose file changed, so the next `get` loads it again. Its view is disposed once
   * loaded, unless it's `shown`: the scene still draws that one, and disposes it after the swap.
   */
  invalidate(roo: string, shown: LoadedRoom | null): void {
    const key = roo.toLowerCase();
    const p = this.loads.get(key);
    if (!p) return;
    this.loads.delete(key);
    void p.then((l) => l !== shown && l.view.dispose(), () => {});
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
