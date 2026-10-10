import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { leafAt, parseRoo, type Room } from "@shards/formats";
import { bakeAo, surfaceInfo } from "../src/roomAo.ts";
import { paletteToRgba } from "../src/colorTexture.ts";
import { lineOfSight, triangleVisibility } from "../src/lightOcclusion.ts";
import { LIGHT_FLAG, flicker, highlightScale, isFireColor, isHighlightLight, lightColor } from "../src/objectLighting.ts";
import type { Batch } from "../src/roomGeometry.ts";

describe("smooth textures (colorTexture.ts)", () => {
  // index i is (i, 2i, 3i) mod 256, opaque; 254 transparent
  const palette = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) palette.set([i, (2 * i) & 255, (3 * i) & 255, i === 254 ? 0 : 255], i * 4);

  test("254 is transparent, opaque texels keep their palette colour", () => {
    const rgba = paletteToRgba(new Uint8Array([10, 254, 20]), 3, 1, palette);
    expect([...rgba.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect(rgba[7]).toBe(0);
    expect([...rgba.slice(8, 12)]).toEqual([20, 40, 60, 255]);
  });

  test("transparent texels take their neighbours' colour", () => {
    const rgba = paletteToRgba(new Uint8Array([10, 254, 20]), 3, 1, palette);
    expect([...rgba.slice(4, 8)]).toEqual([15, 30, 45, 0]);
    // further away, a few texels deep
    const far = paletteToRgba(new Uint8Array([40, 254, 254, 254]), 4, 1, palette);
    expect([...far.slice(12, 16)]).toEqual([40, 80, 120, 0]);
  });
});

describe("lights stop at walls (lightOcclusion.ts)", () => {
  // Two rooms side by side along x: sector 1 (0..3000, ceiling 1024) and sector 2 (3000..6000,
  // ceiling 512), joined by an opening at x = 3000; a one-sided wall at x = 1000 in sector 1.
  const sector = (ceilingHeight: number) => ({ floorHeight: 0, ceilingHeight, slopedFloor: null, slopedCeiling: null });
  const wall = (x0: number, y0: number, x1: number, y1: number, posSector: number, negSector: number) => ({ x0, y0, x1, y1, posSector, negSector });
  const room = {
    sectors: [sector(1024), sector(512)],
    walls: [wall(1000, 0, 1000, 2000, 1, 0), wall(3000, 0, 3000, 2000, 1, 2)],
  } as unknown as Room;

  test("a wall with nothing on one side blocks", () => {
    expect(lineOfSight(room, { x: 500, y: 1000, z: 300 }, { x: 1500, y: 1000, z: 300 })).toBe(false);
  });

  test("an opening lets light through below its lintel, not above", () => {
    expect(lineOfSight(room, { x: 2500, y: 1000, z: 300 }, { x: 3500, y: 1000, z: 300 })).toBe(true);
    expect(lineOfSight(room, { x: 2500, y: 1000, z: 800 }, { x: 3500, y: 1000, z: 800 })).toBe(false);
  });

  test("a floor triangle beyond the wall isn't lit; one in the room is", () => {
    // Two floor triangles, wound counter-clockwise seen from above (z up)
    const tri = (x: number): number[] => [x, 900, 0, x + 200, 900, 0, x, 1100, 0];
    const up = (p: number[]) => [p[0], p[1], p[2], p[6], p[7], p[8], p[3], p[4], p[5]];
    const t1 = up(tri(1200)), t2 = up(tri(400));
    // The facing test uses the winding: make sure ours faces up
    const n = (p: number[]) => (p[3] - p[0]) * (p[7] - p[1]) - (p[4] - p[1]) * (p[6] - p[0]);
    const floor = (p: number[]) => (n(p) > 0 ? p : up(p));
    const batch = { positions: [...floor(t1), ...floor(t2)] } as unknown as Batch;
    const vis = triangleVisibility(room, batch, { x: 1500, y: 1000, z: 300, reach: 3000 });
    expect([...vis]).toEqual([1, 0]);
    // Nothing is lit from below the floor (it faces away)
    expect([...triangleVisibility(room, batch, { x: 1500, y: 1000, z: -300, reach: 3000 })]).toEqual([0, 0]);
    // A light just behind the wall's face (a wall torch) still lights the room in front
    expect([...triangleVisibility(room, batch, { x: 970, y: 1000, z: 300, reach: 3000 })]).toEqual([1, 1]);
  });
});

describe("light flicker and the targeting light", () => {
  test("flames flicker between 0.85 and 1, the same each time", () => {
    for (let t = 0; t < 5000; t += 37) {
      const f = flicker(1234, t);
      expect(f).toBeGreaterThanOrEqual(0.85);
      expect(f).toBeLessThanOrEqual(1);
      expect(flicker(1234, t)).toBe(f);
    }
    expect(flicker(1, 1000)).not.toBe(flicker(2, 1000));
  });

  test("fire colours flicker, magic and white lights don't", () => {
    const fire = lightColor(0x7f06); // LIGHT_FIRE
    expect(isFireColor(fire.r, fire.g, fire.b)).toBe(true);
    expect(isFireColor(255, 255, 255)).toBe(false);
    expect(isFireColor(0, 0, 255)).toBe(false);
  });

  test("the targeting light is a tenth of a full light (LIGHT_FLAG_HIGHLIGHT)", () => {
    expect(highlightScale(255)).toBe(1800);
  });

  test("signs' dynamic highlight lights are highlights; a static one keeps its full size", () => {
    expect(isHighlightLight(LIGHT_FLAG.ON | LIGHT_FLAG.DYNAMIC | LIGHT_FLAG.HIGHLIGHT)).toBe(true); // sign.kod
    expect(isHighlightLight(LIGHT_FLAG.ON | LIGHT_FLAG.HIGHLIGHT)).toBe(false);
    expect(isHighlightLight(LIGHT_FLAG.ON | LIGHT_FLAG.DYNAMIC)).toBe(false);
  });
});

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const haveMuseum = existsSync(join(ASSETS, "razamuseum.roo"));

describe.skipIf(!haveMuseum)("shaded corners (roomAo.ts, the Museum)", () => {
  const room = parseRoo(new Uint8Array(readFileSync(join(ASSETS, "razamuseum.roo"))));
  test("floors darken by the walls, not in the open, and it bakes quickly", () => {
    const t0 = performance.now();
    const ao = bakeAo(room);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
    let dark = 0,
      open = 0;
    for (let i = 0; i < ao.width * ao.height; i++) {
      if (ao.data[i * 2] > 100) dark++;
      else if (ao.data[i * 2] === 0) open++;
    }
    expect(dark).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(dark);
  });
  test("a wall knows the floor and ceiling in front of it", () => {
    // Somewhere inside: straight down is floor, straight up ceiling
    const w = room.walls.find((w) => w.posSector && !w.negSector)!;
    const nx = -(w.y1 - w.y0), ny = w.x1 - w.x0;
    const l = Math.hypot(nx, ny);
    const mx = (w.x0 + w.x1) / 2, my = (w.y0 + w.y1) / 2;
    // Whichever side of the wall has the room
    const side = leafAt(room, mx + (nx / l) * 32, my + (ny / l) * 32)?.sector ? 1 : -1;
    const [kind, floor, ceiling] = surfaceInfo(room, mx, my, [(side * nx) / l, (side * ny) / l, 0]);
    expect(kind).toBe(0);
    expect(ceiling).toBeGreaterThan(floor);
    expect(surfaceInfo(room, mx, my, [0, 0, 1])[0]).toBe(1);
    expect(surfaceInfo(room, mx, my, [0, 0, -1])[0]).toBe(2);
  });
});
