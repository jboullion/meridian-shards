// Object sprites: the base bitmap plus its overlays (heads, arms, legs, equipment)
// composited into one 8-bit palette-index image, with each part's xlat applied.
// Ports clientd3d/draw.c GetObjectPdib (frame by view angle) and the overlay placement
// of d3drender.c D3DRenderObjectsDraw / D3DRenderOverlaysDraw.
//
// Coordinates follow the D3D code: a bitmap pixel is 16 / shrink fine units; the base
// is centred on the object horizontally, shifted by its xoffset (raw, unscaled, like
// the C code), and rests on the ground shifted down by yoffset * 4. Overlays hang
// from hotspots measured in base-bitmap pixels from the top-left.

import { TRANSPARENT_INDEX, type Bgf, type BgfBitmap } from "@shards/formats";
import type { XlatTable } from "./xlat.ts";

/** Hotspot draw layers (clientd3d/object3d.h), back to front by the D3D z-bias. */
const LAYER = { UNDERUNDER: 1, UNDER: 3, UNDEROVER: 6, BASE: 10, HELM: 10.5, OVERUNDER: 11, OVER: 13, OVEROVER: 15 } as const;
const HS_HELM = 2;

export interface SpritePart {
  bgf: Bgf;
  /** 0-based group (animation state) */
  group: number;
  translation: number;
  /** hotspot number this part hangs from (0 for the base) */
  hotspot: number;
}

export interface SpriteInput {
  base: SpritePart;
  overlays: SpritePart[];
  /** (object angle - angle from viewer to object) & 4095 */
  viewAngle: number;
  /** Second xlat applied on top of each part's own (DRAWFX_DOUBLETRANS/SECONDTRANS) */
  secondTranslation?: number;
  /** DRAWFX_SECONDTRANS: ignore per-part xlats */
  secondOnly?: boolean;
  /** false: overlays only, still placed by the base's hotspots (drawbmp.c DrawObject draw_obj) */
  drawBase?: boolean;
}

export interface Composite {
  width: number;
  height: number;
  /** palette indices, row-major, 254 = transparent */
  pixels: Uint8Array;
  /** Placement in fine units relative to the object's ground point: screen-left edge and top edge. */
  left: number;
  top: number;
  /** Size in fine units */
  widthFine: number;
  heightFine: number;
  /** The base bitmap's top (for name labels and light sources) */
  baseTop: number;
}

/** draw.c GetObjectPdib: the bitmap of `group` seen from `angle`, or null. */
export function frameFor(bgf: Bgf, angle: number, group: number): BgfBitmap | null {
  const g = bgf.groups[group];
  if (!g || g.length === 0) return null;
  const interval = Math.floor(4096 / g.length) + 1;
  const a = (angle + Math.floor(interval / 2)) % 4096;
  const num = Math.floor(a / interval);
  const index = g[num];
  if (index === undefined || index < 0) return null;
  return bgf.bitmaps[index] ?? null;
}

/** Hotspot lookup (object3d.c FindHotspotPdib): point and over/under depth. */
function findHotspot(b: BgfBitmap, hotspot: number): { x: number; y: number; over: boolean; helm: boolean } | null {
  for (const h of b.hotspots) {
    if (Math.abs(h.number) === hotspot) return { x: h.x, y: h.y, over: h.number > 0, helm: h.number === HS_HELM };
  }
  return null;
}

interface Placed {
  bmp: BgfBitmap;
  /** top-left in base pixels */
  x: number;
  y: number;
  /** base pixels per part pixel */
  scale: number;
  layer: number;
  xlat: Uint8Array;
}

export function compositeSprite(input: SpriteInput, xlats: XlatTable): Composite | null {
  const { base } = input;
  const bmp = frameFor(base.bgf, input.viewAngle, base.group);
  if (!bmp) return null;
  const s = base.bgf.shrink;
  const second = input.secondTranslation ?? 0;
  const xlatFor = (t: number) => (input.secondOnly ? xlats.compose(0, second) : xlats.compose(t, second));

  const drawBase = input.drawBase ?? true;
  const placed: Placed[] = drawBase ? [{ bmp, x: 0, y: 0, scale: 1, layer: LAYER.BASE, xlat: xlatFor(base.translation) }] : [];

  // Overlays on the base, then overlays on overlays (d3drender.c D3DRenderOverlaysDraw).
  const firstLevel: { part: SpritePart; bmp: BgfBitmap; x: number; y: number; over: boolean }[] = [];
  for (const part of input.overlays) {
    const ob = frameFor(part.bgf, input.viewAngle, part.group);
    if (!ob) continue;
    const hs = findHotspot(bmp, part.hotspot);
    if (!hs) continue;
    // overlay offsets are scaled by the base's shrink in the C code
    const x = hs.x + ob.xOffset;
    const y = hs.y + ob.yOffset;
    const layer = hs.helm ? LAYER.HELM : hs.over ? LAYER.OVER : LAYER.UNDER;
    placed.push({ bmp: ob, x, y, scale: s / part.bgf.shrink, layer, xlat: xlatFor(part.translation) });
    firstLevel.push({ part, bmp: ob, x: hs.x, y: hs.y, over: hs.over });
  }
  for (const part of input.overlays) {
    const ob = frameFor(part.bgf, input.viewAngle, part.group);
    if (!ob || findHotspot(bmp, part.hotspot)) continue;
    for (const parent of firstLevel) {
      const hs2 = findHotspot(parent.bmp, part.hotspot);
      if (!hs2) continue;
      const ps = s / parent.part.bgf.shrink;
      // base hotspot + parent offsets (base shrink) + parent hotspot and our offsets (parent's shrink)
      const x = parent.x + parent.bmp.xOffset + (hs2.x + ob.xOffset) * ps;
      const y = parent.y + parent.bmp.yOffset + (hs2.y + ob.yOffset) * ps;
      const layer = hs2.over
        ? parent.over
          ? LAYER.OVEROVER
          : LAYER.UNDEROVER
        : parent.over
          ? LAYER.OVERUNDER
          : LAYER.UNDERUNDER;
      placed.push({ bmp: ob, x, y, scale: s / part.bgf.shrink, layer, xlat: xlatFor(part.translation) });
      break;
    }
  }

  // Bounds in base pixels (ComputeObjectBoundingBox: the base counts only when drawn)
  if (!placed.length) return null;
  let minX = drawBase ? 0 : Infinity,
    minY = drawBase ? 0 : Infinity,
    maxX = drawBase ? bmp.width : -Infinity,
    maxY = drawBase ? bmp.height : -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, Math.floor(p.x));
    minY = Math.min(minY, Math.floor(p.y));
    maxX = Math.max(maxX, Math.ceil(p.x + p.bmp.width * p.scale));
    maxY = Math.max(maxY, Math.ceil(p.y + p.bmp.height * p.scale));
  }
  const width = maxX - minX,
    height = maxY - minY;
  const pixels = new Uint8Array(width * height).fill(TRANSPARENT_INDEX);
  placed.sort((a, b) => a.layer - b.layer);
  for (const p of placed) {
    const w = Math.round(p.bmp.width * p.scale),
      h = Math.round(p.bmp.height * p.scale);
    const ox = Math.round(p.x) - minX,
      oy = Math.round(p.y) - minY;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(p.bmp.height - 1, Math.floor(y / p.scale));
      const dy = oy + y;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < w; x++) {
        const src = p.bmp.pixels[sy * p.bmp.width + Math.min(p.bmp.width - 1, Math.floor(x / p.scale))];
        if (src === TRANSPARENT_INDEX) continue;
        const dx = ox + x;
        if (dx < 0 || dx >= width) continue;
        pixels[dy * width + dx] = p.xlat[src];
      }
    }
  }

  const px = 16 / s; // fine units per base pixel
  const baseLeft = -8 * (bmp.width / s) - bmp.xOffset;
  const baseTop = 16 * (bmp.height / s) - bmp.yOffset * 4;
  return {
    width,
    height,
    pixels,
    left: baseLeft + minX * px,
    top: baseTop - minY * px,
    widthFine: width * px,
    heightFine: height * px,
    baseTop,
  };
}
