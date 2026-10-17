// The .bgf writer and the palette quantizer used by the admin sprite editor.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  type Bgf,
  encodeBgf,
  HAIR_RAMP,
  matte,
  PaletteMatcher,
  parseBgf,
  rgbaToHairRamp,
  rgbaToIndices,
  TRANSPARENT_INDEX,
} from "../src/index.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "manifest.json"));
const read = (name: string) => new Uint8Array(readFileSync(join(ASSETS, name)));

// A palette of greys (i, i, i), with a pure red at 30.
const greys = new Uint8Array(768);
for (let i = 0; i < 256; i++) greys.set([i, i, i], i * 3);
greys.set([255, 0, 0], 30 * 3);

const content = (b: Bgf) => ({
  name: b.name,
  shrink: b.shrink,
  groups: b.groups,
  bitmaps: b.bitmaps.map((x) => ({ ...x, pixels: Array.from(x.pixels) })),
});

describe("encodeBgf", () => {
  test("round-trips a made-up sprite", async () => {
    const bgf: Bgf = {
      name: "test",
      version: 10,
      shrink: 14,
      bitmaps: [
        { width: 2, height: 3, xOffset: -4, yOffset: 7, hotspots: [{ number: -2, x: 1, y: -1 }], pixels: new Uint8Array([1, 2, 3, 254, 5, 6]) },
        { width: 1, height: 1, xOffset: 0, yOffset: 0, hotspots: [], pixels: new Uint8Array([0xd4]) },
      ],
      groups: [[0, 1, -1], [1]],
    };
    expect(content(await parseBgf(await encodeBgf(bgf)))).toEqual(content(bgf));
  });

  test("refuses a bitmap whose pixels don't fit its size", async () => {
    const bad: Bgf = { name: "", version: 10, shrink: 1, groups: [], bitmaps: [{ width: 2, height: 2, xOffset: 0, yOffset: 0, hotspots: [], pixels: new Uint8Array(3) }] };
    await expect(encodeBgf(bad)).rejects.toThrow(/2x2/);
  });

  test.skipIf(!have).each(["ptsa.bgf", "pbda.bgf", "phax.bgf", "bunnyg.bgf"])("round-trips %s", async (name) => {
    const original = await parseBgf(read(name));
    expect(content(await parseBgf(await encodeBgf(original)))).toEqual(content(original));
  });
});

describe("quantize", () => {
  test("nearest colour, and only allowed ones", () => {
    expect(new PaletteMatcher(greys).nearest(250, 10, 10)).toBe(30);
    expect(new PaletteMatcher(greys).nearest(100, 100, 100)).toBe(100);
    const m = new PaletteMatcher(greys, HAIR_RAMP);
    expect(HAIR_RAMP).toContain(m.nearest(250, 10, 10));
    expect(m.nearest(0, 0, 0)).toBe(0);
  });

  test("never picks the transparent index", () => {
    expect(new PaletteMatcher(greys).nearest(254, 254, 254)).not.toBe(TRANSPARENT_INDEX);
  });

  test("see-through pixels become 254", () => {
    const rgba = new Uint8Array([100, 100, 100, 255, 100, 100, 100, 10]);
    expect(Array.from(rgbaToIndices(rgba, greys))).toEqual([100, TRANSPARENT_INDEX]);
  });

  test("hair ramp keeps brightness order and stays on the ramp", () => {
    const rgba = new Uint8Array([20, 0, 0, 255, 120, 60, 0, 255, 250, 200, 120, 255, 0, 0, 0, 0]);
    const out = Array.from(rgbaToHairRamp(rgba, greys));
    expect(out[3]).toBe(TRANSPARENT_INDEX);
    for (const v of out.slice(0, 3)) expect(HAIR_RAMP).toContain(v);
    // greys palette: a lighter pixel maps to a higher grey value
    expect(greys[out[2] * 3]).toBeGreaterThanOrEqual(greys[out[1] * 3]);
  });

  test("matte keys out a flat background", () => {
    const w = 8,
      h = 8,
      rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([255, 0, 255, 255], i * 4);
    rgba.set([10, 200, 10, 255], (4 * w + 4) * 4);
    const out = matte(rgba, w, h);
    expect(out[3]).toBe(0);
    expect(out[(4 * w + 4) * 4 + 3]).toBe(255);
  });
});
