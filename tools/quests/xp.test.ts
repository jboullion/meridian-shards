import { describe, expect, it } from "vitest";
import { bandOf } from "./bands.ts";
import { xpBetween, xpForPoints, xpToNext } from "./xp.ts";

describe("quest XP", () => {
  it("costs (h+1)^2 for the point past h, as System.CalculateXPTable does", () => {
    expect(xpToNext(20)).toBe(441);
    expect(xpBetween(20, 22)).toBe(441 + 484);
    expect(xpBetween(20, 30)).toBe(6585);
  });

  it("scales xpPoints with the quest's band minimum", () => {
    expect(xpForPoints(0.75, 20)).toBe(331);
    expect(xpForPoints(1, 50)).toBe(2601);
  });

  it("puts a monster's band below its level", () => {
    expect(bandOf(30)).toEqual([20, 29]);
    expect(bandOf(90)).toEqual([60, 89]);
  });
});
