// The sprite editor's picture model: a .bgf as frames of palette indices, and the pixel
// operations the tools use. Pure, so the tools and undo stay simple.

import { HAIR_RAMP, TRANSPARENT_INDEX, type Bgf } from "@shards/formats";

export interface Hotspot {
  number: number;
  x: number;
  y: number;
}

export interface Frame {
  w: number;
  h: number;
  xoff: number;
  yoff: number;
  hotspots: Hotspot[];
  /** w * h palette indices, row-major; 254 is transparent */
  px: Uint8Array;
}

export interface Sprite {
  /** File name, e.g. ptsa.bgf */
  file: string;
  /** The name stored inside the file */
  name: string;
  version: number;
  shrink: number;
  frames: Frame[];
  groups: number[][];
}

export type Kind = "hair" | "beard" | "other";

/** Hair (pt*) and facial hair (pbd*) sit on a head and use only the hair ramp */
export const kindOf = (file: string): Kind => (file.startsWith("pbd") ? "beard" : /^pt[a-z]{2}\.bgf$/.test(file) ? "hair" : "other");

/** The hotspot a hair or beard hangs from on the head (blakston.khd HS_TOUPEE, HS_MOUTH) */
export const HANG = { hair: 13, beard: 12 } as const;

export const HAIR_COLOURS = new Set([...HAIR_RAMP, TRANSPARENT_INDEX]);

export function fromBgf(file: string, b: Bgf): Sprite {
  return {
    file,
    name: b.name,
    version: b.version,
    shrink: b.shrink,
    frames: b.bitmaps.map((m) => ({ w: m.width, h: m.height, xoff: m.xOffset, yoff: m.yOffset, hotspots: m.hotspots.map((h) => ({ ...h })), px: m.pixels.slice() })),
    groups: b.groups.map((g) => [...g]),
  };
}

export function toBgf(s: Sprite): Bgf {
  return {
    name: s.name,
    version: s.version,
    shrink: s.shrink,
    bitmaps: s.frames.map((f) => ({ width: f.w, height: f.h, xOffset: f.xoff, yOffset: f.yoff, hotspots: f.hotspots.map((h) => ({ ...h })), pixels: f.px })),
    groups: s.groups.map((g) => [...g]),
  };
}

export const cloneFrame = (f: Frame): Frame => ({ ...f, hotspots: f.hotspots.map((h) => ({ ...h })), px: f.px.slice() });
export const cloneSprite = (s: Sprite): Sprite => ({ ...s, frames: s.frames.map(cloneFrame), groups: s.groups.map((g) => [...g]) });

export const blankFrame = (w: number, h: number, xoff = 0, yoff = 0): Frame => ({ w, h, xoff, yoff, hotspots: [], px: new Uint8Array(w * h).fill(TRANSPARENT_INDEX) });

/** The colours a sprite uses, transparent included */
export function coloursUsed(s: Sprite): Set<number> {
  const used = new Set<number>([TRANSPARENT_INDEX]);
  for (const f of s.frames) for (const v of f.px) used.add(v);
  return used;
}

/** Colours outside `allowed`, and how many pixels have them */
export function strayColours(s: Sprite, allowed: Set<number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of s.frames) for (const v of f.px) if (!allowed.has(v)) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

/** Which views (0..7 per group) show each frame: "g0: 0 1 2" */
export function viewsOf(s: Sprite, frame: number): string {
  const parts: string[] = [];
  s.groups.forEach((g, gi) => {
    const views = g.flatMap((v, i) => (v === frame ? [i] : []));
    if (views.length) parts.push(s.groups.length > 1 ? `g${gi}: ${views.join(" ")}` : `views ${views.join(" ")}`);
  });
  return parts.join(", ") || "unused";
}

// ---------------------------------------------------------------- pixel operations

export const inside = (f: Frame, x: number, y: number) => x >= 0 && y >= 0 && x < f.w && y < f.h;

/** Bresenham's line from a to b, inclusive */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const out: [number, number][] = [];
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (filled || x === ax || x === bx || y === ay || y === by) out.push([x, y]);
  return out;
}

export function plot(f: Frame, pts: [number, number][], colour: number): void {
  for (const [x, y] of pts) if (inside(f, x, y)) f.px[y * f.w + x] = colour;
}

/** 4-way flood fill of the area of `x, y`'s colour */
export function floodFill(f: Frame, x: number, y: number, colour: number): void {
  if (!inside(f, x, y)) return;
  const from = f.px[y * f.w + x];
  if (from === colour) return;
  const stack = [y * f.w + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (f.px[i] !== from) continue;
    f.px[i] = colour;
    const cx = i % f.w,
      cy = (i - cx) / f.w;
    if (cx > 0) stack.push(i - 1);
    if (cx < f.w - 1) stack.push(i + 1);
    if (cy > 0) stack.push(i - f.w);
    if (cy < f.h - 1) stack.push(i + f.w);
  }
}

export function flipX(f: Frame): void {
  for (let y = 0; y < f.h; y++) f.px.subarray(y * f.w, (y + 1) * f.w).reverse();
  for (const h of f.hotspots) h.x = f.w - 1 - h.x;
}

/** The pixels of a rectangle, as a small frame */
export function cut(f: Frame, x: number, y: number, w: number, h: number): Frame {
  const out = blankFrame(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inside(f, x + i, y + j)) out.px[j * w + i] = f.px[(y + j) * f.w + x + i];
  return out;
}

/** Draws `src` onto `f` at x, y; transparent pixels of `src` leave `f` as it is unless `opaque` */
export function paste(f: Frame, src: Frame, x: number, y: number, opaque = false): void {
  for (let j = 0; j < src.h; j++)
    for (let i = 0; i < src.w; i++) {
      const v = src.px[j * src.w + i];
      if ((opaque || v !== TRANSPARENT_INDEX) && inside(f, x + i, y + j)) f.px[(y + j) * f.w + x + i] = v;
    }
}

/** A new size; `ax`, `ay` (0, 0.5, 1) say which edge stays put. The offset follows so the picture
 *  stays where it was in the game, and hotspots move with the pixels. */
export function resize(f: Frame, w: number, h: number, ax: number, ay: number): Frame {
  const dx = Math.round((w - f.w) * ax),
    dy = Math.round((h - f.h) * ay);
  const out = blankFrame(w, h, f.xoff - dx, f.yoff - dy);
  paste(out, f, dx, dy, true);
  out.hotspots = f.hotspots.map((hs) => ({ ...hs, x: hs.x + dx, y: hs.y + dy }));
  return out;
}

/** The box around the solid pixels, or null when there are none */
export function solidBox(f: Frame): { x: number; y: number; w: number; h: number } | null {
  let x0 = f.w,
    y0 = f.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++)
      if (f.px[y * f.w + x] !== TRANSPARENT_INDEX) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------------------------------------------------------------- frames and groups

/** Removes frame `i`, renumbering the groups (views that showed it show nothing) */
export function deleteFrame(s: Sprite, i: number): void {
  s.frames.splice(i, 1);
  s.groups = s.groups.map((g) => g.map((v) => (v === i ? -1 : v > i ? v - 1 : v)));
}

/** Swaps frames i and j, groups following */
export function swapFrames(s: Sprite, i: number, j: number): void {
  [s.frames[i], s.frames[j]] = [s.frames[j]!, s.frames[i]!];
  s.groups = s.groups.map((g) => g.map((v) => (v === i ? j : v === j ? i : v)));
}

export function parseGroup(text: string, frames: number): number[] {
  const g = text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => Number(t));
  if (!g.every((v) => Number.isInteger(v) && v >= -1 && v < frames)) throw new Error(`frame numbers 0 to ${frames - 1}, or -1 for none`);
  return g;
}

// ---------------------------------------------------------------- new sprites

export type Preset = "hair" | "beard" | "generic";

/** The groups hair.py writes: hair has 6 views (no 4, 5: the back), beards 5 (no back three) */
export const PRESET_GROUPS: Record<"hair" | "beard", number[]> = { hair: [0, 1, 2, 3, 3, 3, 4, 5], beard: [0, 1, 2, -1, -1, -1, 3, 4] };

/** A new sprite. Hair and beards copy a reference style's frame sizes and offsets (so they sit on
 *  the head), with or without its pixels. */
export function newSprite(file: string, preset: Preset, opts: { reference?: Sprite | null; keepPixels?: boolean; w?: number; h?: number; shrink?: number }): Sprite {
  const name = file.replace(/\.bgf$/, "");
  if (preset === "generic" || !opts.reference) {
    const w = opts.w ?? 32,
      h = opts.h ?? 32;
    return { file, name, version: 10, shrink: opts.shrink ?? (preset === "generic" ? 4 : 14), frames: [blankFrame(w, h, -Math.floor(w / 2), -h)], groups: [preset === "generic" ? [0] : PRESET_GROUPS[preset]] };
  }
  const ref = opts.reference;
  return {
    file,
    name,
    version: 10,
    shrink: ref.shrink,
    frames: ref.frames.map((f) => (opts.keepPixels ? cloneFrame(f) : { ...blankFrame(f.w, f.h, f.xoff, f.yoff), hotspots: f.hotspots.map((h) => ({ ...h })) })),
    groups: ref.groups.map((g) => [...g]),
  };
}
