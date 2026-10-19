import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseRoo, setWallHeights, type Room, type Sector, type Sidedef, type Wall } from "@shards/formats";
import { MOOD_CYCLES, MOODS, NEUTRAL_MOOD, STORM_OVERLAYS, blendMoods, kelvinRgb, moodAt, resolveMood, withStorm } from "../src/moods.ts";
import { GameClock, skyDirection, sunAt, sunAngleAt, sunHeightAt } from "../src/sunPath.ts";
import { bakeSunMap, roomHasOpenSky, sunMapAt } from "../src/sunShadow.ts";

describe("moods", () => {
  test("inherit fills in from the parent, over the neutral mood", () => {
    const m = resolveMood("outdoor_morning");
    expect(m.hazeDensity).toBe(MOODS.outdoor_morning.hazeDensity);
    expect(m.ambientColor).toEqual(MOODS.outdoor_day.ambientColor);
    expect(m.bloom).toBe(NEUTRAL_MOOD.bloom);
    expect(resolveMood("no such mood")).toEqual(NEUTRAL_MOOD);
  });

  test("a cycle gives its keys' moods at their hours and smoothsteps between", () => {
    const day = resolveMood("outdoor_day"),
      dusk = resolveMood("outdoor_dusk");
    expect(moodAt(MOOD_CYCLES.outdoor, 12)).toEqual(day);
    expect(moodAt(MOOD_CYCLES.outdoor, 18.5)).toEqual(dusk);
    const mid = moodAt(MOOD_CYCLES.outdoor, 17.5);
    expect(mid.sunStrength).toBeCloseTo((day.sunStrength + dusk.sunStrength) / 2, 5);
    // A quarter of the way, smoothstep is under a quarter
    const q = moodAt(MOOD_CYCLES.outdoor, 17);
    expect((q.saturation - day.saturation) / (dusk.saturation - day.saturation)).toBeCloseTo(0.15625, 4);
  });

  test("the cycle wraps over midnight", () => {
    const night = resolveMood("outdoor_night");
    expect(moodAt(MOOD_CYCLES.outdoor, 23)).toEqual(night);
    expect(moodAt(MOOD_CYCLES.outdoor, 2)).toEqual(night);
    expect(moodAt(MOOD_CYCLES.outdoor, 26)).toEqual(night);
    const inside = moodAt(MOOD_CYCLES.interior, 22);
    expect(inside.ambientColor[0]).toBeGreaterThan(resolveMood("interior_night").ambientColor[0] - 1e-9);
    expect(moodAt(MOOD_CYCLES.underground, 13)).toEqual(resolveMood("underground"));
  });

  test("a storm multiplies, adds, and blends in by its amount", () => {
    const day = resolveMood("outdoor_day");
    expect(withStorm(day, STORM_OVERLAYS.rain, 0)).toBe(day);
    const wet = withStorm(day, STORM_OVERLAYS.rain, 1);
    expect(wet.sunStrength).toBeCloseTo(day.sunStrength * 0.15);
    expect(wet.hazeColor[2]).toBeCloseTo(day.hazeColor[2] * 0.9);
    expect(wet.hazeStart).toBe(0);
    const half = withStorm(day, STORM_OVERLAYS.rain, 0.5);
    expect(half.hazeDensity).toBeCloseTo(day.hazeDensity * 2);
    expect(withStorm(day, { exposure: { add: 0.5 } }, 1).exposure).toBeCloseTo(day.exposure + 0.5);
    expect(blendMoods(day, wet, 1)).toBe(wet);
  });

  test("black bodies run from orange to blue", () => {
    const warm = kelvinRgb(2900),
      cool = kelvinRgb(8000);
    expect(warm[0]).toBe(1);
    expect(warm[2]).toBeLessThan(0.6);
    expect(cool[2]).toBe(1);
    expect(cool[0]).toBeLessThan(1);
  });
});

describe("the sun's path", () => {
  test("whole hours give what sun.kod sends", () => {
    for (let h = 0; h < 24; h++) {
      expect(sunAngleAt(h)).toBe(((h + 19) % 24) * 130);
      expect(sunHeightAt(h)).toBe(Math.max(-200, 420 - 7 * (h - 13) * (h - 13)));
    }
  });

  test("it rises in the east, stands highest at 13 and moves smoothly between hours", () => {
    expect(sunAt(13).height).toBe(420);
    const morning = sunAt(7).dir;
    expect(morning[0]).toBeGreaterThan(0.5); // east
    expect(morning[2]).toBeGreaterThan(0);
    const a = sunAt(13.4).height,
      b = sunAt(13.5).height;
    expect(Math.abs(a - b)).toBeLessThan(5);
    expect(sunAt(3).dir[2]).toBeLessThan(0);
    const d = skyDirection(1024, 0);
    expect(d[1]).toBeCloseTo(1); // client angle 1024: south (y)
  });

  test("the clock times hours from the server's changes", () => {
    const c = new GameClock();
    expect(c.hourNow(10, 0)).toBeCloseTo(10.5);
    expect(c.hourNow(11, 100_000)).toBe(11);
    expect(c.hourNow(11, 250_000)).toBeCloseTo(11.6);
    expect(c.hourNow(12, 400_000)).toBe(12);
    expect(c.hourLength).toBe(300_000);
    expect(c.hourNow(12, 10_000_000)).toBeCloseTo(12.999);
    // A jump starts the hour over without retiming it
    expect(c.hourNow(18, 10_000_100)).toBe(18);
    expect(c.hourLength).toBe(300_000);
  });
});

/**
 * A street of open sky (x < 4096, its edge walls 4096 high) beside a building with a roof 2048
 * high (x > 4096), 8 squares deep. `tall`: the street side of the building has an above wall up
 * to the street's 4096, so it stands that high.
 */
function streetAndBuilding(tall = false): Room {
  const sector = (ceilingType: number, ceilingHeight: number): Sector => ({
    serverId: 0, floorType: 1, ceilingType, tx: 0, ty: 0, floorHeight: 0, ceilingHeight, light: 200, flags: 0,
    animateSpeed: 0, slopedFloor: null, slopedCeiling: null,
  });
  const side = (normalType: number, aboveType: number): Sidedef => ({ serverId: 0, normalType, aboveType, belowType: 0, flags: 0, animateSpeed: 0 });
  const sectors = [sector(0, 4096), sector(5, 2048)];
  const wall = (x0: number, y0: number, x1: number, y1: number, pos: number, neg: number, posSidedef: number, negSidedef: number) => {
    const w = { x0, y0, x1, y1, posSector: pos, negSector: neg, posSidedef, negSidedef } as unknown as Wall;
    setWallHeights(w, sectors);
    return w;
  };
  return {
    version: 0, security: 0, securityOk: true, width: 0, height: 0, rows: 8, cols: 16,
    sectors,
    sidedefs: [side(9, 0), side(0, 0), side(0, 9)],
    walls: [
      wall(0, 0, 16384, 0, 1, 0, 1, 0),
      wall(0, 8192, 16384, 8192, 1, 0, 1, 0),
      wall(0, 0, 0, 8192, 1, 0, 1, 0),
      wall(16384, 0, 16384, 8192, 2, 0, 1, 0),
      wall(4096, 0, 4096, 8192, 1, 2, tall ? 3 : 2, 2),
    ],
    nodes: [
      { type: "internal", bbox: [0, 0, 16384, 8192], a: -1, b: 0, c: 4096, pos: 2, neg: 3, walls: [4] },
      { type: "leaf", bbox: [0, 0, 4096, 8192], sector: 1, points: [] },
      { type: "leaf", bbox: [4096, 0, 16384, 8192], sector: 2, points: [] },
    ],
    thingsBox: { maxX: 16384, maxY: 8192 },
  };
}

describe("sun shadows", () => {
  test("a building shades the street on its side of the sun, as far as its height casts", () => {
    const room = streetAndBuilding();
    expect(roomHasOpenSky(room)).toBe(true);
    // The sun in the east (over the building), 45 degrees up: a 2048 roof shades 2048 of street
    const s = Math.SQRT1_2;
    const map = bakeSunMap(room, [s, 0, s]);
    expect(sunMapAt(map, 3800, 4096)).toBe(0);
    expect(sunMapAt(map, 2300, 4096)).toBe(0);
    expect(sunMapAt(map, 1800, 4096)).toBe(1);
    expect(sunMapAt(map, 500, 4096)).toBe(1);
    // Under the roof: no sun map (it isn't sky)
    expect(sunMapAt(map, 8000, 4096)).toBe(0);
    // The sun in the west: the street is all in the sun
    const west = bakeSunMap(room, [-s, 0, s]);
    expect(sunMapAt(west, 3900, 4096)).toBe(1);
    // Standing as high as the street's walls, it shades it all
    expect(sunMapAt(bakeSunMap(streetAndBuilding(true), [s, 0, s]), 500, 4096)).toBe(0);
    // A sun barely up: all in shade
    expect(sunMapAt(bakeSunMap(room, [1, 0, 0.01]), 500, 4096)).toBe(0);
  });

  const ASSETS = join(import.meta.dirname, "../../../dist/assets");
  test.skipIf(!existsSync(join(ASSETS, "raza.roo")))("Raza bakes, with sun and shade", () => {
    const room = parseRoo(new Uint8Array(readFileSync(join(ASSETS, "raza.roo"))));
    const map = bakeSunMap(room, sunAt(15).dir);
    const lit = map.data.filter((v) => v > 0).length;
    const shade = map.data.length - lit;
    expect(lit).toBeGreaterThan(1000);
    expect(shade).toBeGreaterThan(1000);
  });
});
