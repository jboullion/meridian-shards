// The edge fill of paletteToRgba (colorTexture.ts bleed) visits only the texels beside the last
// pass's; it must give exactly what the whole-image passes gave.

import { describe, expect, it } from "vitest";
import { TRANSPARENT_INDEX } from "@shards/formats";
import { paletteToRgba, sharedPaletteToRgba } from "../src/colorTexture.ts";

/** The whole-image passes, as colorTexture.ts had them before 2026-10-16 */
function reference(pixels: Uint8Array, width: number, height: number, palette: Uint8Array): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(n * 4);
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = pixels[i]!;
    if (p === TRANSPARENT_INDEX) continue;
    out.set([palette[p * 4]!, palette[p * 4 + 1]!, palette[p * 4 + 2]!, 255], i * 4);
    filled[i] = 1;
  }
  for (let pass = 0; pass < 4; pass++) {
    const next: number[] = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || xx >= width || yy < 0 || yy >= height || (dx === 0 && dy === 0)) continue;
            const j = yy * width + xx;
            if (!filled[j]) continue;
            r += out[j * 4]!;
            g += out[j * 4 + 1]!;
            b += out[j * 4 + 2]!;
            count++;
          }
        if (!count) continue;
        out[i * 4] = Math.round(r / count);
        out[i * 4 + 1] = Math.round(g / count);
        out[i * 4 + 2] = Math.round(b / count);
        next.push(i);
      }
    if (!next.length) break;
    for (const i of next) filled[i] = 1;
  }
  return out;
}

/** A seeded random image: blobs of colour on transparency */
function image(width: number, height: number, seed: number): Uint8Array {
  let s = seed;
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const px = new Uint8Array(width * height).fill(TRANSPARENT_INDEX);
  for (let k = 0; k < 6; k++) {
    const cx = rand() * width, cy = rand() * height, rad = 2 + rand() * Math.min(width, height) * 0.3;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) if (Math.hypot(x - cx, y - cy) < rad && rand() < 0.9) px[y * width + x] = Math.floor(rand() * 254);
  }
  return px;
}

const palette = new Uint8Array(256 * 4).map((_, i) => (i * 37) % 256);

describe("the edge fill", () => {
  it("gives what the whole-image passes gave", () => {
    for (const [w, h, seed] of [[1, 1, 1], [7, 3, 2], [40, 60, 3], [64, 100, 4], [33, 17, 5], [16, 16, 6]] as const) {
      const px = image(w, h, seed);
      expect(paletteToRgba(px, w, h, palette)).toEqual(reference(px, w, h, palette));
    }
    // all transparent, and none
    expect(paletteToRgba(new Uint8Array(12).fill(TRANSPARENT_INDEX), 4, 3, palette)).toEqual(new Uint8Array(48));
    const full = new Uint8Array(12).fill(5);
    expect(paletteToRgba(full, 4, 3, palette)).toEqual(reference(full, 4, 3, palette));
  });

  it("is quick on a big image with a small figure", () => {
    const w = 256, h = 400;
    const px = image(w, h, 9);
    const t0 = performance.now();
    paletteToRgba(px, w, h, palette);
    const ours = performance.now() - t0;
    const t1 = performance.now();
    reference(px, w, h, palette);
    const before = performance.now() - t1;
    expect(ours).toBeLessThan(before);
  });
});

describe("sharedPaletteToRgba", () => {
  it("gives the same copy for the same pixels and palette, and a new one for another palette", () => {
    const palette = new Uint8Array(1024).map((_, i) => i & 255);
    const px = new Uint8Array(64).map((_, i) => (i % 7 === 0 ? TRANSPARENT_INDEX : i));
    const a = sharedPaletteToRgba(px, 8, 8, palette);
    expect(a).toEqual(paletteToRgba(px, 8, 8, palette));
    expect(sharedPaletteToRgba(px, 8, 8, palette)).toBe(a);
    const other = palette.slice();
    const b = sharedPaletteToRgba(px, 8, 8, other);
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });
});
