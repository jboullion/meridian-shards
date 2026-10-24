import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter } from "@shards/protocol";
import { DAILY_STATE, HALL_STATE, boardAcceptCommand, hallStateText, rankNumeral, readFallenHalls, type FallenHall } from "../src/fallenHalls.ts";

/** fallenhalls.kod SendHalls, one hall */
function hall(w: ByteWriter, rid: number, rank: number, hp: number, name: string, door: string, state: number, by: string, quest: number, daily: number, secs: number): ByteWriter {
  return w.u32(rid).u8(rank).u16(hp).string(name).string(door).u8(state).string(by).u32(quest).u8(daily).u32(secs);
}

describe("UC_FALLEN_HALLS", () => {
  it("reads the reset and every hall (SendHalls)", () => {
    const w = new ByteWriter().u32(4321).u8(2);
    hall(w, 703, 1, 80, "The Den of Shadows", "the Lake of Jala's Song", HALL_STATE.CLEARED, "The Testers", 320, DAILY_STATE.DONE, 86000);
    hall(w, 719, 8, 100, "The Wetland Fortress", "the Marsh", HALL_STATE.HELD, "", 327, DAILY_STATE.OFFERED, 0);
    const s = readFallenHalls(new ByteReader(w.finish()));
    expect(s.resetSeconds).toBe(4321);
    expect(s.halls).toEqual([
      { rid: 703, rank: 1, minHealth: 80, name: "The Den of Shadows", door: "the Lake of Jala's Song", state: 3, clearedBy: "The Testers", dailyQuest: 320, dailyState: 3, dailySeconds: 86000 },
      { rid: 719, rank: 8, minHealth: 100, name: "The Wetland Fortress", door: "the Marsh", state: 1, clearedBy: "", dailyQuest: 327, dailyState: 1, dailySeconds: 0 },
    ]);
  });

  it("names ranks and states, and builds the commands", () => {
    expect([1, 4, 8].map(rankNumeral)).toEqual(["I", "IV", "VIII"]);
    const h = (state: number, clearedBy = ""): FallenHall => ({ rid: 1, rank: 1, minHealth: 80, name: "", door: "", state, clearedBy, dailyQuest: 0, dailyState: 0, dailySeconds: 0 });
    expect(hallStateText(h(HALL_STATE.READY))).toBe("Held by the Order");
    expect(hallStateText(h(HALL_STATE.HELD))).toBe("Held by the Order");
    expect(hallStateText(h(HALL_STATE.SANCTUM))).toBe("Its sanctum is open");
    expect(hallStateText(h(HALL_STATE.CLEARED, "The Testers"))).toBe("Cleared by The Testers");
    expect(hallStateText(h(HALL_STATE.CLEARED))).toBe("Cleared");
    expect(boardAcceptCommand(320)).toBe("quest board-accept 320");
  });
});
