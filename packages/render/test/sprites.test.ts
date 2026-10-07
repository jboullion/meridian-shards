import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseBgf, parsePaletteBin, type Bgf } from "@shards/formats";
import { XLAT, XlatTable } from "../src/xlat.ts";
import { compositeSprite, frameFor } from "../src/sprites.ts";
import { lightIndex, objectBrightness, dlightScale, lightColor } from "../src/objectLighting.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "manifest.json"));
const read = (n: string) => new Uint8Array(readFileSync(join(ASSETS, n)));

function grayPalette(): Uint8Array {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) p.set([i, i, i], i * 3);
  return p;
}

describe("xlat", () => {
  const x = new XlatTable(grayPalette(), null);
  test("identity and ramp swaps", () => {
    expect(x.get(XLAT.IDENTITY)[0x9a]).toBe(0x9a);
    // GRAYTORED: the 0xD0 ramp becomes the 0x10 ramp, others untouched
    expect(x.get(XLAT.GRAYTORED)[0xd5]).toBe(0x15);
    expect(x.get(XLAT.GRAYTORED)[0x95]).toBe(0x95);
  });
  test("guild colours swap red and blue ramps", () => {
    // 0x87 + i*11 + j: red -> ramps[i], blue -> ramps[j]; ramps = 10,20,30,40,50,70,90,A0,C0,D0,E0
    const t = x.get(XLAT.GUILDCOLOR_BASE + 9 * 11 + 2); // 236: red -> grey, blue -> 0x30 skin
    expect(t[0x13]).toBe(0xd3);
    expect(t[0x93]).toBe(0x33);
  });
  test("compose applies xlat0 then xlat1", () => {
    const c = x.compose(XLAT.GRAYTORED, XLAT.GRAYTOSKIN1);
    expect(c[0xd5]).toBe(0x15); // grey -> red; red isn't touched by the second
  });
});

describe("frame selection (draw.c GetObjectPdib)", () => {
  const bgf = (n: number): Bgf => ({
    name: "t", version: 10, shrink: 1, groups: [Array.from({ length: n }, (_, i) => i)],
    bitmaps: Array.from({ length: n }, () => ({ width: 1, height: 1, xOffset: 0, yOffset: 0, hotspots: [], pixels: new Uint8Array(1) })),
  });
  test("one frame for every angle; eight frames by octant", () => {
    const one = bgf(1);
    expect(frameFor(one, 2000, 0)).toBe(one.bitmaps[0]);
    const eight = bgf(8);
    expect(frameFor(eight, 0, 0)).toBe(eight.bitmaps[0]);
    expect(frameFor(eight, 4095, 0)).toBe(eight.bitmaps[0]); // wraps around the front
    expect(frameFor(eight, 2048, 0)).toBe(eight.bitmaps[4]); // back
    expect(frameFor(eight, 0, 3)).toBeNull(); // missing group
  });
});

describe("object lighting", () => {
  test("GetLightPaletteIndex at FINENESS", () => {
    expect(lightIndex(192, 5, 213)).toBe(63);
    expect(lightIndex(65, 5, 213)).toBe(20 + 32);
  });
  test("nearest light adds its colour", () => {
    const l = { x: 0, y: 0, z: 0, scale: dlightScale(30), ...lightColor(32518) };
    const [r, , b] = objectBrightness({ x: 2000, y: 0, z: 0 }, 20, 5, 213, [l]);
    expect(r).toBeGreaterThan(b);
    expect(r).toBeLessThanOrEqual(239 / 255);
  });
});

describe.skipIf(!have)("player sprite composite (real files)", () => {
  test("body + head + arms + legs composite with skin xlat", async () => {
    const pal = parsePaletteBin(read("palette.bin"));
    const xl = new XlatTable(pal.rgb, existsSync(join(ASSETS, "lightpal.bin")) ? read("lightpal.bin") : null);
    const load = async (n: string) => parseBgf(read(n));
    const [body, la, ra, legs, head] = await Promise.all(["bta.bgf", "bla.bgf", "bra.bgf", "bfa.bgf", "phax.bgf"].map(load));
    const c = compositeSprite(
      {
        base: { bgf: body, group: 0, translation: 236, hotspot: 0 },
        overlays: [
          { bgf: la, group: 0, translation: 236, hotspot: 31 },
          { bgf: ra, group: 0, translation: 236, hotspot: 21 },
          { bgf: legs, group: 0, translation: 159, hotspot: 41 },
          { bgf: head, group: 0, translation: 3, hotspot: 1 },
        ],
        viewAngle: 0,
      },
      xl,
    )!;
    expect(c).not.toBeNull();
    const base = frameFor(body, 0, 0)!;
    // the head sits above the body and the legs below, so the composite is taller
    expect(c.height).toBeGreaterThan(base.height);
    expect(c.pixels.some((p) => p !== 254)).toBe(true);
    // world size: bitmap pixels are 16 / shrink fine units
    expect(c.heightFine).toBeCloseTo((c.height * 16) / body.shrink);
  });
});
