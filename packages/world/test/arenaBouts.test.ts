import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter } from "@shards/protocol";
import { arenaCommand, BOUT_STATE, floorTaken, readArena } from "../src/arenaBouts.ts";

const names: Record<number, string> = { 21: "Draven", 22: "a battle mage of Qor", 23: "Kessa", 24: "a brawler", 30: "Blooded" };
const resource = (id: number) => names[id] ?? null;

describe("UC_ARENA", () => {
  it("reads a status as arenabouts.kod SendStatus writes it", () => {
    const w = new ByteWriter()
      .u8(1) // status
      .u8(2) // the Arena of Death
      .u8(3) // we're fighting
      .u8(0) // place
      .u8(1) // in line
      .u8(3) // the floor: fighting
      .u16(145)
      .u8(1) // a match of players is set up
      .u32(0x10000077) // who's fighting (with the server's flag bits)
      .u8(2);
    w.u32(0x10000101).u32(21).u32(22).u8(2).u16(80).u16(120);
    w.u32(0).u32(23).u32(24).u8(5).u16(0).u16(90);
    for (const n of [3, 1, 2, 2]) w.u16(n);
    for (const n of [0, 2, 0, 1]) w.u16(n);
    w.u32(30).u8(1).u8(0);
    const s = readArena(new ByteReader(w.finish()), resource);
    expect(s).toMatchObject({ arena: 2, state: BOUT_STATE.FIGHTING, queueLength: 1, floor: 3, secondsLeft: 145, flags: 1, boutPlayer: 0x77, title: "Blooded", rank: 1, ended: 0 });
    expect(s!.opponents).toEqual([
      { id: 0x101, name: "Draven", kindName: "a battle mage of Qor", kind: 2, hp: 80, maxHp: 120 },
      { id: 0, name: "Kessa", kindName: "a brawler", kind: 5, hp: 0, maxHp: 90 },
    ]);
    expect(s!.records).toEqual([
      { wins: 3, losses: 1, streak: 2, best: 2 },
      { wins: 0, losses: 2, streak: 0, best: 1 },
    ]);
    expect(floorTaken(s)).toBe(true);
  });

  it("reads an idle arena, and makes the commands", () => {
    const w = new ByteWriter().u8(1).u8(1).u8(1).u8(2).u8(2).u8(0).u16(0).u8(0).u32(0).u8(0);
    for (let i = 0; i < 8; i++) w.u16(0);
    w.u32(0).u8(0).u8(0);
    const s = readArena(new ByteReader(w.finish()), resource);
    expect(s).toMatchObject({ arena: 1, state: BOUT_STATE.QUEUED, place: 2, floor: 0, opponents: [], title: "" });
    expect(floorTaken(s)).toBe(false);
    expect(arenaCommand("join")).toBe("arena join");
    expect(arenaCommand({ pvp: "champion" })).toBe("arena pvp champion");
  });
});
