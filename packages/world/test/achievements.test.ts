import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter, UC } from "@shards/protocol";
import { achievementsCommand, readAchievements } from "../src/achievements.ts";
import { fixture, userCommand } from "../../protocol/test/fixture.ts";

const UC_ACHIEVEMENTS = userCommand(UC.ACHIEVEMENTS, "packages/world/src/achievements.ts");

describe("UC_ACHIEVEMENTS", () => {
  it("reads the whole list (Achievements.SendAll)", () => {
    const w = new ByteWriter().u8(1).u32(32_700_000).u16(2).u16(21).u32(32_600_000).u16(80).u32(32_500_000);
    expect(fixture(UC_ACHIEVEMENTS, readAchievements, new ByteReader(w.finish()))).toEqual({
      type: "all",
      now: 32_700_000,
      earned: [{ id: 21, when: 32_600_000 }, { id: 80, when: 32_500_000 }],
    });
  });

  it("reads an empty list", () => {
    const w = new ByteWriter().u8(1).u32(5).u16(0);
    expect(fixture(UC_ACHIEVEMENTS, readAchievements, new ByteReader(w.finish()))).toEqual({ type: "all", now: 5, earned: [] });
  });

  it("reads one just earned (Achievements.SendUnlock)", () => {
    const w = new ByteWriter().u8(2).u16(82).u32(123);
    expect(fixture(UC_ACHIEVEMENTS, readAchievements, new ByteReader(w.finish()))).toEqual({ type: "unlock", id: 82, when: 123 });
  });

  it("ignores a kind it doesn't know", () => {
    expect(fixture(UC_ACHIEVEMENTS, readAchievements, new ByteReader(new ByteWriter().u8(9).finish()))).toBeNull();
    expect(achievementsCommand()).toBe("achievements");
  });
});
