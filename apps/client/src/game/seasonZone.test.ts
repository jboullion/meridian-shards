import { describe, expect, it } from "vitest";
import { hasSeasons } from "./seasonZone.ts";

describe("which rooms have seasons", () => {
  it("the mainland does", () => {
    expect(hasSeasons("raza.roo", ["CITY", "FOREST", "LAKE", "ROAD"])).toBe(true);
    expect(hasSeasons("tos.roo", ["CITY", "FOUNTAIN", "ROAD"])).toBe(true);
    expect(hasSeasons("marion.roo", undefined)).toBe(true);
  });

  it("the island, the desert, the lava and the ice cave don't", () => {
    expect(hasSeasons("ka1.roo", ["BEACH", "JUNGLE", "MOUNTAIN"])).toBe(false);
    expect(hasSeasons("kocatan.roo", undefined)).toBe(false);
    expect(hasSeasons("desertdunes.roo", undefined)).toBe(false);
    expect(hasSeasons("waylayoasis.roo", ["BADLANDS"])).toBe(false);
    expect(hasSeasons("uworld.roo", ["LAVA", "MYSTICAL"])).toBe(false);
    expect(hasSeasons("icecave1.roo", ["CAVES", "LAIR", "TUNDRA"])).toBe(false);
  });
});
