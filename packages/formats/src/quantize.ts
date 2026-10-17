// RGBA images to game palette indices, for importing art into .bgf sprites. A port of
// shards-server tools/iconforge (pixelize.py to_palette and matte, hair.py to_ramp):
// nearest colour in CIELAB, no dithering, 1-bit alpha.

import { TRANSPARENT_INDEX } from "./bgf.ts";

/** Hair and facial hair may only use black and the grey ramp D0..DF: the hair colour
 *  translations recolour that ramp (clientd3d/xlat.c CalcRampXlat). */
export const HAIR_RAMP: readonly number[] = [0, ...Array.from({ length: 16 }, (_, i) => 0xd0 + i)];

/** Alpha below this is transparent. */
export const ALPHA_CUT = 128;

/** sRGB 0..255 -> CIELAB. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    c /= 255;
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  };
  const R = lin(r),
    G = lin(g),
    B = lin(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x),
    fy = f(y),
    fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Matches colours to a palette, optionally restricted to some indices. Index 254 is never a match. */
export class PaletteMatcher {
  private readonly pool: number[];
  private readonly lab: Float32Array;
  private readonly cache = new Map<number, number>();

  /** rgb: 256 x [r, g, b] (Palette.rgb). */
  constructor(rgb: Uint8Array, allowed?: Iterable<number>) {
    const allow = allowed ? new Set(allowed) : null;
    this.pool = [];
    for (let i = 0; i < 256; i++) if (i !== TRANSPARENT_INDEX && (!allow || allow.has(i))) this.pool.push(i);
    if (!this.pool.length) throw new Error("no palette colours allowed");
    this.lab = new Float32Array(this.pool.length * 3);
    this.pool.forEach((idx, k) => this.lab.set(rgbToLab(rgb[idx * 3], rgb[idx * 3 + 1], rgb[idx * 3 + 2]), k * 3));
  }

  nearest(r: number, g: number, b: number): number {
    const key = (r << 16) | (g << 8) | b;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const [L, A, B] = rgbToLab(r, g, b);
    let best = 0,
      bestD = Infinity;
    for (let k = 0; k < this.pool.length; k++) {
      const dl = this.lab[k * 3] - L,
        da = this.lab[k * 3 + 1] - A,
        db = this.lab[k * 3 + 2] - B;
      const d = dl * dl + da * da + db * db;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    this.cache.set(key, this.pool[best]);
    return this.pool[best];
  }
}

/** RGBA (width * height * 4) -> palette indices; alpha below the cutoff becomes 254. */
export function rgbaToIndices(
  rgba: Uint8Array | Uint8ClampedArray,
  palette: Uint8Array,
  opts: { allowed?: Iterable<number>; alphaCut?: number } = {},
): Uint8Array {
  const cut = opts.alphaCut ?? ALPHA_CUT;
  const match = new PaletteMatcher(palette, opts.allowed);
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = rgba[o + 3] < cut ? TRANSPARENT_INDEX : match.nearest(rgba[o], rgba[o + 1], rgba[o + 2]);
  }
  return out;
}

/** RGBA -> the hair ramp by brightness (hair.py to_ramp): the solid pixels' luminance is
 *  stretched over the ramp so any coloured picture becomes recolourable hair. */
export function rgbaToHairRamp(rgba: Uint8Array | Uint8ClampedArray, palette: Uint8Array, alphaCut = ALPHA_CUT): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n).fill(TRANSPARENT_INDEX);
  const lum = new Float32Array(n);
  const solid: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
    if (rgba[o + 3] >= alphaCut) solid.push(lum[i]);
  }
  if (!solid.length) return out;
  solid.sort((a, b) => a - b);
  const lo = solid[Math.floor((solid.length - 1) * 0.02)],
    hi = solid[Math.floor((solid.length - 1) * 0.98)];
  const ramp = HAIR_RAMP.slice(1);
  const greys = ramp.map((i) => palette[i * 3]);
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] < alphaCut) continue;
    const v = Math.min(1, Math.max(0, (lum[i] - lo) / Math.max(1, hi - lo))) * (225 - 30) + 30;
    if (v < 26) {
      out[i] = 0;
      continue;
    }
    let best = 0;
    for (let k = 1; k < greys.length; k++) if (Math.abs(v - greys[k]) < Math.abs(v - greys[best])) best = k;
    out[i] = ramp[best];
  }
  return out;
}

/** The median colour of the four corners: the flat background of a picture (pixelize.py background_key). */
export function backgroundKey(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const k = Math.max(4, Math.floor(Math.min(width, height) / 32));
  const ch: number[][] = [[], [], []];
  const take = (x0: number, y0: number) => {
    for (let y = y0; y < y0 + k && y < height; y++)
      for (let x = x0; x < x0 + k && x < width; x++) for (let c = 0; c < 3; c++) ch[c].push(rgba[(y * width + x) * 4 + c]);
  };
  take(0, 0);
  take(Math.max(0, width - k), 0);
  take(0, Math.max(0, height - k));
  take(Math.max(0, width - k), Math.max(0, height - k));
  const median = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
  return [median(ch[0]), median(ch[1]), median(ch[2])];
}

/** Copy of an RGBA image with the background removed (pixelize.py matte): keeps the picture's
 *  own alpha when it has any, otherwise keys out `key` (default: backgroundKey) with a soft edge. */
export function matte(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  key?: [number, number, number],
  tolerance = 60,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  let seeThrough = 0;
  for (let i = 3; i < out.length; i += 4) if (out[i] < 250) seeThrough++;
  if (seeThrough > out.length / 4 / 100) return out;
  const [kr, kg, kb] = key ?? backgroundKey(rgba, width, height);
  for (let i = 0; i < out.length; i += 4) {
    const d = Math.hypot(out[i] - kr, out[i + 1] - kg, out[i + 2] - kb);
    out[i + 3] = Math.min(1, Math.max(0, (d - tolerance) / tolerance)) * 255;
  }
  return out;
}
