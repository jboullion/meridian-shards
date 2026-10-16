import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseBgf, parsePaletteBin, type Bgf } from "@shards/formats";
import { XLAT, XlatTable } from "../src/xlat.ts";
import { compositeSprite, frameFor } from "../src/sprites.ts";
import { compositeToRgba, paletteToRgba } from "../src/colorTexture.ts";
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
    const [body, la, ra, legs, head, eyes] = await Promise.all(["bta.bgf", "bla.bgf", "bra.bgf", "bfa.bgf", "phax.bgf", "peax.bgf"].map(load));
    const parts = [
      { bgf: la, group: 0, translation: 236, hotspot: 31 },
      { bgf: ra, group: 0, translation: 236, hotspot: 21 },
      { bgf: legs, group: 0, translation: 159, hotspot: 41 },
      { bgf: head, group: 0, translation: 3, hotspot: 1 },
    ];
    const c = compositeSprite(
      {
        base: { bgf: body, group: 0, translation: 236, hotspot: 0 },
        // the eyes hang on the head: a player's face (player.kod SendOverlays)
        overlays: [...parts, { bgf: eyes, group: 0, translation: 0, hotspot: 11 }],
        viewAngle: 0,
      },
      xl,
    )!;
    expect(c).not.toBeNull();
    const base = frameFor(body, 0, 0)!;
    // the head sits above the body and the legs below, so the composite is taller
    expect(c.height).toBeGreaterThan(base.height);
    expect(c.pixels.some((p) => p !== 254)).toBe(true);
    // world size: base-bitmap pixels are 16 / shrink fine units; the image is `resolution` times finer
    expect(c.heightFine).toBeCloseTo((c.height * 16) / body.shrink / c.resolution);
    // the face (a shrink 7 head, shrink 14 eyes) is finer than the body (shrink 4): drawn at 4x
    // (at most MAX_DETAIL) so it keeps its pixels
    expect(c.resolution).toBe(4);
    // without features it's no face: nothing is made finer (lamps, signs and props neither)
    const plain = compositeSprite({ base: { bgf: body, group: 0, translation: 236, hotspot: 0 }, overlays: parts, viewAngle: 0 }, xl)!;
    expect(plain.resolution).toBe(1);
  });

  test("a face keeps its features' detail (charface.c: head + shrink 14 eyes, nose, mouth)", async () => {
    const pal = parsePaletteBin(read("palette.bin"));
    const xl = new XlatTable(pal.rgb, null);
    const load = async (n: string) => parseBgf(read(n));
    const [head, eyes, nose, mouth] = await Promise.all(["phax.bgf", "peax.bgf", "pnax.bgf", "pmax.bgf"].map(load));
    const c = compositeSprite(
      {
        base: { bgf: head, group: 0, translation: 0, hotspot: 0 },
        overlays: [
          { bgf: mouth, group: 0, translation: 0, hotspot: 12 },
          { bgf: eyes, group: 0, translation: 0, hotspot: 11 },
          { bgf: nose, group: 0, translation: 0, hotspot: 14 },
        ],
        viewAngle: 0,
      },
      xl,
    )!;
    expect(head.shrink).toBe(7);
    expect(eyes.shrink).toBe(14);
    expect(c.resolution).toBe(2);
    // every eye pixel lands on its own image pixel: the eyes' rows appear unchanged in the image
    const e = frameFor(eyes, 0, 0)!;
    const ex = c.originX + (frameFor(head, 0, 0)!.hotspots.find((h) => Math.abs(h.number) === 11)!.x + e.xOffset) * 2;
    const ey = c.originY + (frameFor(head, 0, 0)!.hotspots.find((h) => Math.abs(h.number) === 11)!.y + e.yOffset) * 2;
    let same = 0,
      solid = 0;
    for (let y = 0; y < e.height; y++)
      for (let x = 0; x < e.width; x++) {
        const v = e.pixels[y * e.width + x];
        if (v === 254) continue;
        solid++;
        if (c.pixels[(ey + y) * c.width + ex + x] === v) same++;
      }
    expect(solid).toBeGreaterThan(0);
    expect(same / solid).toBeGreaterThan(0.9); // the nose and mouth cover a little of it
  });

  test("the filtered copy magnifies each part smoothly, not in blocks (compositeToRgba)", async () => {
    const pal = parsePaletteBin(read("palette.bin"));
    const xl = new XlatTable(pal.rgb, null);
    const [body, head, nose] = await Promise.all(["bta.bgf", "phax.bgf", "pnax.bgf"].map(async (n) => parseBgf(read(n))));
    const c = compositeSprite(
      {
        base: { bgf: body, group: 0, translation: 0, hotspot: 0 },
        overlays: [
          { bgf: head, group: 0, translation: 0, hotspot: 1 },
          { bgf: nose, group: 0, translation: 0, hotspot: 14 },
        ],
        viewAngle: 0,
      },
      xl,
    )!;
    expect(c.resolution).toBe(4);
    const rgba = compositeToRgba(c, pal.rgb, 3);
    // in the index image every body pixel is a block of `r` x `r`; the filtered copy blends within them
    const r = c.resolution;
    const base = c.layers.find((l) => l.bmp === frameFor(body, 0, 0))!;
    let blocks = 0,
      blended = 0;
    for (let y = base.y; y + r - 1 < base.y + base.bmp.height * r; y += r)
      for (let x = base.x; x + r - 1 < base.x + base.bmp.width * r; x += r) {
        const at = (xx: number, yy: number) => (yy * c.width + xx) * 4;
        const q = [at(x, y), at(x + r - 1, y), at(x, y + r - 1), at(x + r - 1, y + r - 1)];
        if (q.some((i) => rgba[i + 3] === 0)) continue;
        blocks++;
        if (q.some((i) => rgba[i] !== rgba[q[0]] || rgba[i + 1] !== rgba[q[0] + 1] || rgba[i + 2] !== rgba[q[0] + 2])) blended++;
      }
    expect(blocks).toBeGreaterThan(100);
    expect(blended / blocks).toBeGreaterThan(0.5);
  });

  test("at resolution 1 the filtered copy is the plain palette copy", async () => {
    const pal = parsePaletteBin(read("palette.bin"));
    const xl = new XlatTable(pal.rgb, null);
    const body = await parseBgf(read("bta.bgf"));
    const c = compositeSprite({ base: { bgf: body, group: 0, translation: 0, hotspot: 0 }, overlays: [], viewAngle: 0 }, xl)!;
    expect(c.resolution).toBe(1);
    expect(compositeToRgba(c, pal.rgb, 3)).toEqual(paletteToRgba(c.pixels, c.width, c.height, pal.rgb, 3));
  });
});
