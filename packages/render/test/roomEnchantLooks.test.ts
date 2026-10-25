// The room enchantments' looks (roomEnchantLooks.ts): known by their icons, fading in and out,
// faint on the mood's grade, and nothing at all with none on the room.

import { describe, expect, it } from "vitest";
import { RoomEnchantLooks } from "../src/roomEnchantLooks.ts";
import type { ColourGrade } from "../src/postFx.ts";

const BASE: ColourGrade = { exposure: 1, saturation: 1, contrast: 1, shadowGain: [1, 1, 1], highlightGain: [1, 1, 1] };

describe("RoomEnchantLooks", () => {
  it("knows the room enchantments by their icons, whatever the case", () => {
    const kinds = RoomEnchantLooks.kinds(["IHEAT.BGF", "isilence.bgf", "iumbrela.bgf", undefined]);
    expect([...kinds].sort()).toEqual(["heat", "silence"]);
  });

  it("fades a look in and out", () => {
    const looks = new RoomEnchantLooks();
    looks.update(new Set(["heat"]), 750);
    expect(looks.weight("heat")).toBeCloseTo(0.5);
    looks.update(new Set(["heat"]), 1000);
    expect(looks.weight("heat")).toBe(1);
    looks.update(new Set(), 1000);
    expect(looks.weight("heat")).toBeCloseTo(0.5);
    looks.update(new Set(), 1000);
    expect(looks.weight("heat")).toBe(0);
    expect(looks.active).toBe(false);
  });

  it("leaves the grade as it is with nothing on the room, and shifts it faintly with a look", () => {
    const looks = new RoomEnchantLooks();
    expect(looks.grade(BASE)).toBe(BASE);
    looks.update(new Set(["heat"]), 0, true);
    const g = looks.grade(BASE);
    // warmer: more red than blue in the highlights
    expect(g.highlightGain[0]).toBeGreaterThan(g.highlightGain[2]);
    for (const v of [...g.shadowGain, ...g.highlightGain, g.exposure, g.saturation]) expect(Math.abs(v - 1)).toBeLessThan(0.25);
    // the mood's own grade is kept under it
    expect(BASE.highlightGain).toEqual([1, 1, 1]);
  });
});
