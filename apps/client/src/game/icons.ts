// Object pictures for the interface (inventory, spells, enchantments, shop lists, the
// self portrait): drawbmp.c DrawObject. The base bitmap and its overlays are composited
// at view angle 0 (the front) with their xlats, like the 3D sprites, and handed to the
// page as a data URL. The page stretches it to fit its square with nearest filtering,
// as DrawObject stretches to fit the inventory box.

import { TRANSPARENT_INDEX, type Bgf } from "@shards/formats";
import { ANIMATE, type Animation, type ObjectInfo } from "@shards/protocol";
import { XlatTable, compositeSprite, type SpritePart } from "@shards/render";
import type { AssetStore } from "../assets.ts";

/** A bitmap group from an animation as sent (1-based) -> 0-based, as animate.c starts it. */
function groupOf(a: Animation): number {
  if (a.type === ANIMATE.CYCLE || a.type === ANIMATE.ONCE) return (a.groupLow ?? 1) - 1;
  return (a.group ?? 1) - 1;
}

export type Drawable = Pick<ObjectInfo, "iconRes" | "animation" | "overlays" | "translation">;

/** A .bgf on its own (stat and enchantment icons): group 0, no overlays. */
export const bareIcon = (resource: number): Drawable => ({
  iconRes: resource, animation: { type: ANIMATE.NONE, group: 1 }, overlays: [], translation: 0,
});

export interface IconOptions {
  /** View angle (0 = the front) */
  angle?: number;
  /** Base group instead of the animation's (DrawStretchedObjectDefault draws group 0) */
  group?: number;
  /** false: overlays only (the self portrait's face) */
  drawBase?: boolean;
  /** Only overlays on hotspots in [lo, hi] (DrawStretchedOverlayRange) */
  hotspots?: [number, number];
}

/** Faces hang from hotspots 1..20; anything with 7+ overlays is a player (userarea.c). */
const FACE: [number, number] = [1, 20];
const MIN_PLAYER_OVERLAYS = 7;

export class IconRenderer {
  private rgb: Uint8Array | null = null;
  private xlats: XlatTable | null = null;
  private readonly ready: Promise<void>;
  private readonly cache = new Map<string, Promise<string | null>>();
  private readonly assets: AssetStore;
  private readonly resource: (id: number) => string | undefined;

  constructor(assets: AssetStore, resource: (id: number) => string | undefined) {
    this.assets = assets;
    this.resource = resource;
    this.ready = Promise.all([assets.palette(), assets.lightPalettes()]).then(([pal, light]) => {
      this.rgb = pal.rgb;
      this.xlats = new XlatTable(pal.rgb, light);
    });
  }

  private bgf(resource: number): Promise<Bgf | null> {
    const name = resource ? this.resource(resource) : undefined;
    return name ? this.assets.bgf(name).catch(() => null) : Promise.resolve(null);
  }

  /** An object as the inventory draws it: base + overlays, front view, its xlats. */
  /** Identifies a picture: same key, same pixels. */
  key(o: Drawable, opts: IconOptions = {}): string {
    return [
      o.iconRes, groupOf(o.animation), o.translation, opts.angle ?? 0, opts.group ?? "", opts.drawBase ?? true,
      opts.hotspots?.join("-") ?? "",
      ...o.overlays.map((v) => `${v.iconRes}:${groupOf(v.animation)}:${v.hotspot}:${v.translation}`),
    ].join(",");
  }

  object(o: Drawable, opts: IconOptions = {}): Promise<string | null> {
    const key = this.key(o, opts);
    let p = this.cache.get(key);
    if (!p) {
      p = this.render(o, opts);
      this.cache.set(key, p);
    }
    return p;
  }

  /** The user area picture (userarea.c UserAreaRedraw): a player's face, else the whole object. */
  portrait(o: Drawable): Promise<string | null> {
    return o.overlays.length >= MIN_PLAYER_OVERLAYS
      ? this.object(o, { group: 0, drawBase: false, hotspots: FACE })
      : this.object(o, { group: 0 });
  }

  /** A bare .bgf picture (stat and enchantment icons), group 0. */
  icon(resource: number): Promise<string | null> {
    return this.object(bareIcon(resource));
  }

  private async render(o: Drawable, opts: IconOptions): Promise<string | null> {
    await this.ready;
    const range = opts.hotspots;
    const list = range ? o.overlays.filter((v) => Math.abs(v.hotspot) >= range[0] && Math.abs(v.hotspot) <= range[1]) : o.overlays;
    const [base, ...overlays] = await Promise.all([this.bgf(o.iconRes), ...list.map((v) => this.bgf(v.iconRes))]);
    if (!base || !this.xlats || !this.rgb) return null;
    const parts: SpritePart[] = [];
    list.forEach((v, i) => {
      const b = overlays[i];
      if (b) parts.push({ bgf: b, group: groupOf(v.animation), translation: v.translation, hotspot: v.hotspot });
    });
    const group = opts.group ?? groupOf(o.animation);
    const c = compositeSprite(
      {
        base: { bgf: base, group, translation: o.translation, hotspot: 0 },
        overlays: parts,
        viewAngle: opts.angle ?? 0,
        drawBase: opts.drawBase,
      },
      this.xlats,
    );
    if (!c) return null;
    const canvas = document.createElement("canvas");
    canvas.width = c.width;
    canvas.height = c.height;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < c.pixels.length; i++) {
      const v = c.pixels[i];
      if (v === TRANSPARENT_INDEX) continue;
      img.data[i * 4] = this.rgb[v * 3];
      img.data[i * 4 + 1] = this.rgb[v * 3 + 1];
      img.data[i * 4 + 2] = this.rgb[v * 3 + 2];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }
}
