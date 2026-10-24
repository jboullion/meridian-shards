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
import { outlineTier, outlineWidth } from "./magicOutline.ts";

/** Hotspot draw layers (clientd3d/object3d.h), back to front by the D3D z-bias. BEHIND, OVERBODY, OVERFIGURE and OVERFACE are ours. */
const LAYER = { BEHIND: 0.5, UNDERUNDER: 1, UNDER: 3, UNDEROVER: 6, BASE: 10, OVERFIGURE: 10.25, HELM: 10.5, OVERUNDER: 11, OVER: 13, OVERBODY: 13.5, OVERFACE: 14, OVEROVER: 15 } as const;
const HS_HELM = 2;

/**
 * Ours: a part whose frames carry a hotspot with this number is drawn over the figure, under a
 * helm, wherever it hangs. Facial hair needs it: it hangs from the head, which hangs under the
 * body (so the collar covers the neck), but a beard reaches down over the collar. The classic
 * client ignores the hotspot (nothing hangs from it). shards-server tools/iconforge hair.py
 * writes it into every frame of a beard. On a head drawn by itself (portraits, the character
 * creator) it hangs from the base, and goes over the head's own parts (OVERFACE), as it does
 * when the head hangs under a body and they're all UNDEROVER.
 */
export const HS_OVER_FIGURE = 127;
const overFigure = (b: BgfBitmap) => b.hotspots.some((h) => h.number === HS_OVER_FIGURE);

/**
 * Ours (docs/adr/0022-guilds.md decision 22, the guild cloak): a part whose frame carries one of
 * these is drawn behind the whole figure (a cape seen from the front or the side) or over the
 * body and what hangs over it (seen from the back, where the legs hang over the body), under a
 * beard and a face's parts, wherever it hangs. The classic client ignores them,
 * so there a cape hangs under the body in every view. shards-server tools/iconforge cloak.ts
 * writes them into each frame.
 */
export const HS_OVER_BODY = 125;
export const HS_BEHIND_FIGURE = 126;
const markedLayer = (b: BgfBitmap): number | null =>
  b.hotspots.some((h) => h.number === HS_BEHIND_FIGURE) ? LAYER.BEHIND : b.hotspots.some((h) => h.number === HS_OVER_BODY) ? LAYER.OVERBODY : null;
/** Whether a part sets its own depth round the figure (a cape): a face-only picture leaves it out */
export const marksFigureDepth = (bgf: Bgf): boolean => bgf.bitmaps.some((b) => markedLayer(b) !== null);

export interface SpritePart {
  bgf: Bgf;
  /** 0-based group (animation state) */
  group: number;
  translation: number;
  /** hotspot number this part hangs from (0 for the base) */
  hotspot: number;
  /** Ours (the magic item revamp, phase 4): a ring round this part (magicOutline.ts outlineCode), 0 for none */
  outline?: number;
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
  /**
   * Ours: keep the picture on the base's grid and give a face's finer detail as `face`, a small
   * image of its own (the views of the world, which make pictures all the time). Without it the
   * whole picture is made as fine as the face (portraits and icons, made once).
   */
  faceApart?: boolean;
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
  /** Where the base bitmap's top-left pixel sits in the image (screen overlays place by it) */
  originX: number;
  originY: number;
  /** Image pixels per base-bitmap pixel (see MAX_DETAIL) */
  resolution: number;
  /** The parts as drawn, back to front, for the filtered copy (colorTexture.ts compositeToRgba) */
  layers: CompositeLayer[];
  /** Ours (phase 4): the rings round outlined parts (CompositeImage.outline) */
  outline: Uint8Array | null;
  /** With `faceApart`: the face, finer than the rest, to draw over its box (null without one) */
  face: CompositeDetail | null;
}

/** Palette-index pixels made of parts, some maybe finer than the base (colorTexture.ts compositeToRgba) */
export interface CompositeImage {
  width: number;
  height: number;
  /** palette indices, row-major, 254 = transparent */
  pixels: Uint8Array;
  /** Image pixels per base-bitmap pixel */
  resolution: number;
  layers: CompositeLayer[];
  /**
   * Ours (the magic item revamp, phase 4): the rings round outlined parts (a wielded magic weapon),
   * one outline code per pixel (magicOutline.ts), 0 elsewhere; null when nothing is outlined.
   * Drawn over the picture, unlit and glowing (objectsView.ts).
   */
  outline: Uint8Array | null;
}

/**
 * A face drawn finer than its figure: everything the figure has in the face's box (the head,
 * its features, a helm, a raised arm over it), made `resolution` times finer than the base.
 */
export interface CompositeDetail extends CompositeImage {
  /** The box in the composite's pixels: left, top, width and height */
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
}

export interface CompositeLayer {
  bmp: BgfBitmap;
  xlat: Uint8Array;
  /** top-left in image pixels */
  x: number;
  y: number;
  /** image pixels per part pixel */
  k: number;
}

/**
 * Overlays can be finer than their base (a head at shrink 7 carries eyes, nose and mouth at
 * shrink 14). The C client stretches each part straight to the screen, so that detail shows;
 * one image on the base's grid would drop every other row of it. A face is made this many
 * times finer than the base, at most, so the finest part keeps its pixels.
 *
 * Only a face is made finer: the head and its features, on a figure that has features
 * (FACE_HOTSPOTS). Elsewhere the extra detail barely shows. In the world it's an image of its
 * own over the face's box (`faceApart`): a whole figure made four times finer cost about 19 ms
 * at every step a townsperson took, and Raza's streets stuttered (2026-10-16).
 */
const MAX_DETAIL = 4;

/** blakston.khd HS_EYES, HS_MOUTH, HS_TOUPEE, HS_NOSE: the parts only a head has */
const FACE_HOTSPOTS = new Set([11, 12, 13, 14]);
/** blakston.khd HS_HEAD: the head, finer than the body on players and townsfolk */
const HS_HEAD = 1;

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
  /** The hotspot it hangs from (0 for the base): a face's parts set the image's fineness (MAX_DETAIL) */
  hotspot: number;
  /** Ours: its ring's outline code (SpritePart.outline), 0 for none */
  outline?: number;
}

export function compositeSprite(input: SpriteInput, xlats: XlatTable): Composite | null {
  const { base } = input;
  const bmp = frameFor(base.bgf, input.viewAngle, base.group);
  if (!bmp) return null;
  const s = base.bgf.shrink;
  const second = input.secondTranslation ?? 0;
  const xlatFor = (t: number) => (input.secondOnly ? xlats.compose(0, second) : xlats.compose(t, second));

  const drawBase = input.drawBase ?? true;
  const placed: Placed[] = drawBase ? [{ bmp, x: 0, y: 0, scale: 1, layer: LAYER.BASE, xlat: xlatFor(base.translation), hotspot: 0, outline: base.outline ?? 0 }] : [];

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
    const layer = markedLayer(ob) ?? (overFigure(ob) ? LAYER.OVERFACE : hs.helm ? LAYER.HELM : hs.over ? LAYER.OVER : LAYER.UNDER);
    placed.push({ bmp: ob, x, y, scale: s / part.bgf.shrink, layer, xlat: xlatFor(part.translation), hotspot: part.hotspot, outline: part.outline ?? 0 });
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
      const layer = overFigure(ob)
        ? LAYER.OVERFIGURE
        : hs2.over
        ? parent.over
          ? LAYER.OVEROVER
          : LAYER.UNDEROVER
        : parent.over
          ? LAYER.OVERUNDER
          : LAYER.UNDERUNDER;
      placed.push({ bmp: ob, x, y, scale: s / part.bgf.shrink, layer, xlat: xlatFor(part.translation), hotspot: part.hotspot, outline: part.outline ?? 0 });
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
    // Ours: room round an outlined part for its ring (magicOutline.ts outlineWidth)
    const pad = outlineWidth(p.outline ?? 0);
    minX = Math.min(minX, Math.floor(p.x) - pad);
    minY = Math.min(minY, Math.floor(p.y) - pad);
    maxX = Math.max(maxX, Math.ceil(p.x + p.bmp.width * p.scale) + pad);
    maxY = Math.max(maxY, Math.ceil(p.y + p.bmp.height * p.scale) + pad);
  }
  // image pixels per base pixel: enough that a face's parts (the head and its features, on a
  // figure with features) aren't drawn smaller than their own pixels; nothing else counts
  const facial = (p: Placed) => p.hotspot === HS_HEAD || FACE_HOTSPOTS.has(p.hotspot);
  let res = 1;
  if (placed.some((p) => FACE_HOTSPOTS.has(p.hotspot)))
    for (const p of placed) if (facial(p)) res = Math.max(res, Math.ceil(1 / p.scale - 1e-6));
  res = Math.min(res, MAX_DETAIL);
  placed.sort((a, b) => a.layer - b.layer);
  const apart = input.faceApart === true;
  const whole = raster(placed, apart ? 1 : res, minX, minY, maxX - minX, maxY - minY);

  let face: CompositeDetail | null = null;
  if (apart && res > 1) {
    // the face's box in base pixels, within the picture
    let fx0 = Infinity,
      fy0 = Infinity,
      fx1 = -Infinity,
      fy1 = -Infinity;
    for (const p of placed) {
      if (!facial(p)) continue;
      fx0 = Math.min(fx0, Math.floor(p.x));
      fy0 = Math.min(fy0, Math.floor(p.y));
      fx1 = Math.max(fx1, Math.ceil(p.x + p.bmp.width * p.scale));
      fy1 = Math.max(fy1, Math.ceil(p.y + p.bmp.height * p.scale));
    }
    fx0 = Math.max(fx0, minX);
    fy0 = Math.max(fy0, minY);
    fx1 = Math.min(fx1, maxX);
    fy1 = Math.min(fy1, maxY);
    if (fx1 > fx0 && fy1 > fy0)
      face = { ...raster(placed, res, fx0, fy0, fx1 - fx0, fy1 - fy0), boxX: fx0 - minX, boxY: fy0 - minY, boxW: fx1 - fx0, boxH: fy1 - fy0 };
  }

  const px = 16 / s; // fine units per base pixel
  const baseLeft = -8 * (bmp.width / s) - bmp.xOffset;
  const baseTop = 16 * (bmp.height / s) - bmp.yOffset * 4;
  return {
    ...whole,
    left: baseLeft + minX * px,
    top: baseTop - minY * px,
    widthFine: (maxX - minX) * px,
    heightFine: (maxY - minY) * px,
    baseTop,
    originX: -minX * whole.resolution,
    originY: -minY * whole.resolution,
    face,
  };
}

/**
 * The parts drawn into an image `res` times finer than the base, covering `w` x `h` base
 * pixels from (`x0`, `y0`); `placed` back to front. Parts reaching outside are cut off.
 */
function raster(placed: Placed[], res: number, x0: number, y0: number, w: number, h: number): CompositeImage {
  const width = w * res,
    height = h * res;
  const pixels = new Uint8Array(width * height).fill(TRANSPARENT_INDEX);
  const layers: CompositeLayer[] = [];
  // Ours (phase 4): which pixels each outlined part covers, for its ring after
  const rings: { code: number; covered: Uint8Array; part: number }[] = [];
  // which part drew each pixel last (1-based), so a ring stays off parts drawn over its own
  const owner = new Uint16Array(width * height);
  for (let n = 0; n < placed.length; n++) {
    const p = placed[n];
    const code = p.outline ?? 0;
    const covered = code ? new Uint8Array(width * height) : null;
    if (covered) rings.push({ code, covered, part: n + 1 });
    const k = p.scale * res; // image pixels per part pixel
    const pw = Math.round(p.bmp.width * k),
      ph = Math.round(p.bmp.height * k);
    const ox = Math.round((p.x - x0) * res),
      oy = Math.round((p.y - y0) * res);
    if (ox >= width || oy >= height || ox + pw <= 0 || oy + ph <= 0) continue;
    layers.push({ bmp: p.bmp, xlat: p.xlat, x: ox, y: oy, k });
    const ya = Math.max(0, -oy),
      yb = Math.min(ph, height - oy),
      xa = Math.max(0, -ox),
      xb = Math.min(pw, width - ox);
    for (let y = ya; y < yb; y++) {
      const sy = Math.min(p.bmp.height - 1, Math.floor(y / k));
      const row = (oy + y) * width + ox;
      for (let x = xa; x < xb; x++) {
        const src = p.bmp.pixels[sy * p.bmp.width + Math.min(p.bmp.width - 1, Math.floor(x / k))];
        if (src !== TRANSPARENT_INDEX) {
          pixels[row + x] = p.xlat[src];
          owner[row + x] = n + 1;
          if (covered) covered[row + x] = 1;
        }
      }
    }
  }
  return { width, height, pixels, resolution: res, layers, outline: rings.length ? ringMask(rings, owner, width, height, res) : null };
}

/**
 * Ours (the magic item revamp, phase 4): the rings round outlined parts: every pixel within the
 * ring's width (magicOutline.ts outlineWidth, in base pixels) of a part's own, but not on it,
 * takes the part's outline code; where two rings meet, the higher tier's. A ring stays off the
 * parts drawn over its own (`owner`, raster's), so a hand over a hilt keeps its look.
 */
function ringMask(rings: { code: number; covered: Uint8Array; part: number }[], owner: Uint16Array, width: number, height: number, res: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (const { code, covered, part } of rings) {
    const w = outlineWidth(code) * res;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!covered[y * width + x]) continue;
        const y0 = Math.max(0, y - w),
          y1 = Math.min(height - 1, y + w),
          x0 = Math.max(0, x - w),
          x1 = Math.min(width - 1, x + w);
        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) {
            const i = ny * width + nx;
            if (covered[i] || owner[i] > part) continue;
            // a round-cornered ring: skip the square's far corners
            if (w > 1 && Math.abs(nx - x) === w && Math.abs(ny - y) === w) continue;
            if (outlineTier(code) >= outlineTier(out[i])) out[i] = code;
          }
        }
      }
    }
  }
  return out;
}
