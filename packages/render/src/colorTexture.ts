// Smooth textures, as the D3D client draws them: it turns each bitmap into an RGBA texture
// and samples it filtered (d3ddriver.c gD3DDriverProfile.minFilter/magFilter). The original
// adds mipmaps (config.mipMaps); we leave them out, as they soften distant walls. Ours keeps
// the 8-bit index textures for picking and for crisp pixels, and makes these copies beside them.

import * as THREE from "three";
import { TRANSPARENT_INDEX } from "@shards/formats";
import type { Composite } from "./sprites.ts";

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
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = pixels[i];
    if (p === TRANSPARENT_INDEX) continue;
    out[i * 4] = palette[p * stride];
    out[i * 4 + 1] = palette[p * stride + 1];
    out[i * 4 + 2] = palette[p * stride + 2];
    out[i * 4 + 3] = 255;
    filled[i] = 1;
  }
  bleed(out, filled, width, height);
  return out;
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
  /** The unfilled texels beside `from` (all filled texels at first), for pass `pass` */
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
  const start: number[] = [];
  for (let i = 0; i < n; i++) if (filled[i]) start.push(i);
  let candidates = around(start, 0);
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
 * the same half-coverage cut-off the sprite shader uses.
 */
export function compositeToRgba(c: Composite, palette: Uint8Array, stride = 4): Uint8Array {
  if (c.resolution === 1) return paletteToRgba(c.pixels, c.width, c.height, palette, stride);
  const { width, height } = c;
  const out = new Uint8Array(width * height * 4);
  const filled = new Uint8Array(width * height);
  for (const l of c.layers) {
    const { bmp, xlat, k } = l;
    const bw = bmp.width,
      bh = bmp.height;
    const idx = bmp.pixels.map((v) => (v === TRANSPARENT_INDEX ? v : xlat[v]));
    const src = paletteToRgba(idx, bw, bh, palette, stride);
    const w = Math.round(bw * k),
      h = Math.round(bh * k);
    for (let y = 0; y < h; y++) {
      const dy = l.y + y;
      if (dy < 0 || dy >= height) continue;
      const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / k - 0.5));
      const y0 = Math.floor(fy),
        y1 = Math.min(bh - 1, y0 + 1),
        ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const dx = l.x + x;
        if (dx < 0 || dx >= width) continue;
        const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / k - 0.5));
        const x0 = Math.floor(fx),
          x1 = Math.min(bw - 1, x0 + 1),
          tx = fx - x0;
        const a = (y0 * bw + x0) * 4,
          b = (y0 * bw + x1) * 4,
          cc = (y1 * bw + x0) * 4,
          d = (y1 * bw + x1) * 4;
        const w00 = (1 - tx) * (1 - ty),
          w10 = tx * (1 - ty),
          w01 = (1 - tx) * ty,
          w11 = tx * ty;
        if (src[a + 3] * w00 + src[b + 3] * w10 + src[cc + 3] * w01 + src[d + 3] * w11 < 128) continue;
        const o = (dy * width + dx) * 4;
        for (let ch = 0; ch < 3; ch++)
          out[o + ch] = Math.round(src[a + ch] * w00 + src[b + ch] * w10 + src[cc + ch] * w01 + src[d + ch] * w11);
        out[o + 3] = 255;
        filled[dy * width + dx] = 1;
      }
    }
  }
  bleed(out, filled, width, height);
  return out;
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
