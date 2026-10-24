import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter } from "@shards/protocol";
import {
  CAPSTONE_STATE, DAILY_STATE, HALL_STATE, boardAcceptCommand, capstoneText, hallStateText, rankNumeral, readFallenHalls, trophyAgeText, type FallenHall,
} from "../src/fallenHalls.ts";

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

  it("reads the capstone and the trophies after the halls (AppendTrophies)", () => {
    const w = new ByteWriter().u32(60).u8(1);
    hall(w, 713, 7, 100, "The Slaughtered Command", "Marion", HALL_STATE.CLEARED, "The Testers", 326, DAILY_STATE.DONE, 10);
    w.u8(CAPSTONE_STATE.OPEN).u8(2);
    w.u8(7).string("Marshal Corvane").string("the Hall of the Slaughtered Command").u8(1).u32(90000).u8(2).string("Shardbot").string("Shardpal");
    w.u8(41).string("Queen Venya'cyr in the Inner Sanctum").string("the Inner Sanctum").u8(0).u32(0).u8(0);
    const s = readFallenHalls(new ByteReader(w.finish()));
    expect(s.halls).toHaveLength(1);
    expect(s.capstone).toBe(CAPSTONE_STATE.OPEN);
    expect(s.trophies).toEqual([
      { id: 7, name: "Marshal Corvane", where: "the Hall of the Slaughtered Command", held: true, ageSeconds: 90000, names: ["Shardbot", "Shardpal"] },
      { id: 41, name: "Queen Venya'cyr in the Inner Sanctum", where: "the Inner Sanctum", held: false, ageSeconds: 0, names: [] },
    ]);
  });

  it("reads an older server's halls with no trophies", () => {
    const s = readFallenHalls(new ByteReader(new ByteWriter().u32(60).u8(0).finish()));
    expect(s.trophies).toEqual([]);
    expect(s.capstone).toBe(CAPSTONE_STATE.SEALED);
  });

  it("words trophy ages and the capstone", () => {
    expect([0, 86399, 86400, 3 * 86400].map(trophyAgeText)).toEqual(["today", "today", "yesterday", "3 days ago"]);
    expect(capstoneText(CAPSTONE_STATE.SEALED)).toBe("Its seal holds.");
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
