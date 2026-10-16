// Smooth textures, as the D3D client draws them: it turns each bitmap into an RGBA texture
// and samples it filtered (d3ddriver.c gD3DDriverProfile.minFilter/magFilter). The original
// adds mipmaps (config.mipMaps); we leave them out, as they soften distant walls. Ours keeps
// the 8-bit index textures for picking and for crisp pixels, and makes these copies beside them.

import * as THREE from "three";
import { TRANSPARENT_INDEX, type BgfBitmap } from "@shards/formats";
import type { CompositeImage } from "./sprites.ts";

/** How many times transparent texels take their neighbours' colour (enough for the filter's reach) */
const BLEED_PASSES = 4;

/**
 * An RGBA copy of palette-index pixels: index 254 is transparent (alpha 0). Transparent
 * texels next to opaque ones take the average of those colours, a few texels deep, so
 * filtering blends into the picture's own colours rather than the palette's
 * cyan or black. `stride`: bytes per palette entry (4 for the palette texture, 3 for RGB).
 */
export function paletteToRgba(pixels: Uint8Array, width: number, height: number, palette: Uint8Array, stride = 4): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(n * 4);
  // one write a texel, from the palette as packed RGBA
  const words = new Uint32Array(out.buffer);
  const lut = packedPalette(palette, stride);
  let holes = false;
  for (let i = 0; i < n; i++) {
    const p = pixels[i];
    if (p === TRANSPARENT_INDEX) holes = true;
    else words[i] = lut[p];
  }
  // nothing to bleed into: most walls and floors
  if (!holes) return out;
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) filled[i] = pixels[i] === TRANSPARENT_INDEX ? 0 : 1;
  bleed(out, filled, width, height);
  return out;
}

/**
 * Ours: how many bytes of room textures' RGBA copies are kept for other rooms. Rooms next to
 * each other share many textures (a town's walls, its grass), and the copies of a room you
 * leave are made again when you come back; the least recently used go first. The 100 textures
 * most rooms use are about 21 MB; every room texture in the game would be 430 MB (2026-10-16).
 */
const SHARED_RGBA_BYTES = 64 * 1024 * 1024;
const shared = new Map<Uint8Array, { palette: Uint8Array; stride: number; rgba: Uint8Array }>();
let sharedBytes = 0;

/**
 * paletteToRgba, kept by the index pixels it was made from (a texture's bitmap, the same
 * array in every room that uses it: AssetStore keeps each .bgf once). Never change the copy.
 */
export function sharedPaletteToRgba(pixels: Uint8Array, width: number, height: number, palette: Uint8Array, stride = 4): Uint8Array {
  const hit = shared.get(pixels);
  if (hit && hit.palette === palette && hit.stride === stride) {
    // used again: to the back of the queue
    shared.delete(pixels);
    shared.set(pixels, hit);
    return hit.rgba;
  }
  if (hit) {
    shared.delete(pixels);
    sharedBytes -= hit.rgba.length;
  }
  const rgba = paletteToRgba(pixels, width, height, palette, stride);
  shared.set(pixels, { palette, stride, rgba });
  sharedBytes += rgba.length;
  for (const [k, v] of shared) {
    if (sharedBytes <= SHARED_RGBA_BYTES || k === pixels) break;
    shared.delete(k);
    sharedBytes -= v.rgba.length;
  }
  return rgba;
}

/** The byte order of a Uint32Array over RGBA bytes on this machine */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const PACKED = new WeakMap<Uint8Array, Map<number, Uint32Array>>();

/** Each palette entry as one opaque RGBA word, by palette and bytes per entry */
function packedPalette(palette: Uint8Array, stride: number): Uint32Array {
  let byStride = PACKED.get(palette);
  if (!byStride) PACKED.set(palette, (byStride = new Map()));
  let lut = byStride.get(stride);
  if (!lut) {
    lut = new Uint32Array(256);
    for (let p = 0; p < 256 && p * stride + 2 < palette.length; p++) {
      const r = palette[p * stride],
        g = palette[p * stride + 1],
        b = palette[p * stride + 2];
      lut[p] = LITTLE_ENDIAN ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
    }
    byStride.set(stride, lut);
  }
  return lut;
}

/**
 * Transparent texels next to `filled` ones take their average colour, BLEED_PASSES deep. Each
 * pass reads only texels filled before it. Only texels beside the last pass's can change, so
 * each pass visits those alone, not the whole image (sprites.ts's finer composites made the
 * whole-image passes cost about 50 ms a figure: 2026-10-16).
 */
function bleed(out: Uint8Array, filled: Uint8Array, width: number, height: number): void {
  const n = width * height;
  // The pass a texel was last listed for, so each is listed once a pass
  const listed = new Int32Array(n).fill(-1);
  /** The unfilled texels beside `from` (the texels the last pass filled), for pass `pass` */
  const around = (from: Iterable<number>, pass: number): number[] => {
    const out: number[] = [];
    for (const i of from) {
      const x = i % width,
        y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
          const j = yy * width + xx;
          if (filled[j] || listed[j] === pass) continue;
          listed[j] = pass;
          out.push(j);
        }
      }
    }
    return out;
  };
  // The first pass's texels: unfilled ones beside a filled one. Found from the unfilled side, so
  // an opaque texture (most walls and floors) costs one scan: going round every filled texel
  // took 200 ms entering a big town (2026-10-16).
  let candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    if (filled[i]) continue;
    const x = i % width,
      y = (i - x) / width;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
        if (filled[yy * width + xx]) {
          near = true;
          break;
        }
      }
    }
    if (near) {
      listed[i] = 0;
      candidates.push(i);
    }
  }
  for (let pass = 0; pass < BLEED_PASSES && candidates.length; pass++) {
    const next: number[] = [];
    for (const i of candidates) {
      const x = i % width,
        y = (i - x) / width;
      let r = 0,
        g = 0,
        b = 0,
        count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
          const j = yy * width + xx;
          if (!filled[j]) continue;
          r += out[j * 4];
          g += out[j * 4 + 1];
          b += out[j * 4 + 2];
          count++;
        }
      }
      if (!count) continue;
      out[i * 4] = Math.round(r / count);
      out[i * 4 + 1] = Math.round(g / count);
      out[i * 4 + 2] = Math.round(b / count);
      next.push(i);
    }
    if (!next.length) break;
    for (const i of next) filled[i] = 1;
    candidates = around(next, pass + 1);
  }
}

/**
 * The RGBA copy of a sprite composite for filtered drawing. The D3D client draws each part
 * as its own filtered quad, so a body keeps its soft look beside a finer face. A composite
 * made finer than its base (Composite.resolution) would turn each body pixel into a hard
 * block under the filter, so each part is magnified bilinearly here, back to front, with
 * the same half-coverage cut-off the sprite shader uses. A face drawn apart (Composite.face) is
 * made the same way.
 */
export function compositeToRgba(c: CompositeImage, palette: Uint8Array, stride = 4): Uint8Array {
  if (c.resolution === 1) return paletteToRgba(c.pixels, c.width, c.height, palette, stride);
  const { width, height } = c;
  const out = new Uint8Array(width * height * 4);
  const filled = new Uint8Array(width * height);
  for (const l of c.layers) {
    const { bmp, k } = l;
    const bw = bmp.width,
      bh = bmp.height;
    const src = partRgba(bmp, l.xlat, palette, stride);
    const w = Math.round(bw * k),
      h = Math.round(bh * k);
    // only the part of the layer inside the image (a face's box cuts the body's layers off)
    const ya = Math.max(0, -l.y),
      yb = Math.min(h, height - l.y),
      xa = Math.max(0, -l.x),
      xb = Math.min(w, width - l.x);
    if (xb <= xa || yb <= ya) continue;
    // where each column samples the part: its two texels (byte offsets) and the weight between
    const n = xb - xa;
    const cx0 = new Int32Array(n),
      cx1 = new Int32Array(n),
      ctx = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const fx = Math.min(bw - 1, Math.max(0, (xa + i + 0.5) / k - 0.5));
      const x0 = Math.floor(fx);
      cx0[i] = x0 * 4;
      cx1[i] = Math.min(bw - 1, x0 + 1) * 4;
      ctx[i] = fx - x0;
    }
    for (let y = ya; y < yb; y++) {
      const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / k - 0.5));
      const y0 = Math.floor(fy),
        ty = fy - y0;
      const r0 = y0 * bw * 4,
        r1 = Math.min(bh - 1, y0 + 1) * bw * 4;
      const row = (l.y + y) * width + l.x + xa;
      for (let i = 0; i < n; i++) {
        const tx = ctx[i];
        const a = r0 + cx0[i],
          b = r0 + cx1[i],
          cc = r1 + cx0[i],
          d = r1 + cx1[i];
        const w00 = (1 - tx) * (1 - ty),
          w10 = tx * (1 - ty),
          w01 = (1 - tx) * ty,
          w11 = tx * ty;
        if (src[a + 3] * w00 + src[b + 3] * w10 + src[cc + 3] * w01 + src[d + 3] * w11 < 128) continue;
        const p = row + i,
          o = p * 4;
        // + 0.5 and truncate: Math.round for these non-negative sums
        out[o] = (src[a] * w00 + src[b] * w10 + src[cc] * w01 + src[d] * w11 + 0.5) | 0;
        out[o + 1] = (src[a + 1] * w00 + src[b + 1] * w10 + src[cc + 1] * w01 + src[d + 1] * w11 + 0.5) | 0;
        out[o + 2] = (src[a + 2] * w00 + src[b + 2] * w10 + src[cc + 2] * w01 + src[d + 2] * w11 + 0.5) | 0;
        out[o + 3] = 255;
        filled[p] = 1;
      }
    }
  }
  bleed(out, filled, width, height);
  return out;
}

/**
 * Each part's own RGBA copy, by palette, bytes per entry, bitmap and xlat. A figure's frames
 * come back as it walks and turns, so a new composite mostly reuses its parts' copies
 * (XlatTable.compose shares its tables for that).
 */
const PARTS = new WeakMap<Uint8Array, Map<number, WeakMap<BgfBitmap, Map<Uint8Array, Uint8Array>>>>();

function partRgba(bmp: BgfBitmap, xlat: Uint8Array, palette: Uint8Array, stride: number): Uint8Array {
  let byStride = PARTS.get(palette);
  if (!byStride) PARTS.set(palette, (byStride = new Map()));
  let byBmp = byStride.get(stride);
  if (!byBmp) byStride.set(stride, (byBmp = new WeakMap()));
  let byXlat = byBmp.get(bmp);
  if (!byXlat) byBmp.set(bmp, (byXlat = new Map()));
  let rgba = byXlat.get(xlat);
  if (!rgba) {
    const idx = bmp.pixels.map((v) => (v === TRANSPARENT_INDEX ? v : xlat[v]));
    rgba = paletteToRgba(idx, bmp.width, bmp.height, palette, stride);
    byXlat.set(xlat, rgba);
  }
  return rgba;
}

/**
 * The filtered RGBA texture for `rgba` (paletteToRgba). `repeat` for the room's tiled
 * textures; sprites clamp to their edges.
 */
export function colorTexture(rgba: Uint8Array, width: number, height: number, repeat: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
