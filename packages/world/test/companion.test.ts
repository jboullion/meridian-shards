import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter } from "@shards/protocol";
import { buildLookCommand, companionStateLabel, readCompanion } from "../src/companion.ts";

const names: Record<number, string> = { 11: "Aldric", 12: "Duke soldier", 13: "The Tos Inn" };
const resource = (id: number) => names[id] ?? null;

describe("UC_COMPANION", () => {
  it("reads a status as companionbook.kod SendStatus writes it", () => {
    const w = new ByteWriter()
      .u8(1) // status
      .u8(1) // active
      .u8(0) // flags
      .u32(0x10001234) // its object (with the server's flag bits)
      .u32(11)
      .u32(12)
      .u8(1) // kind
      .u16(25)
      .u16(35)
      .u32(320)
      .u8(2)
      .u32(300)
      .u32(1000)
      .u8(3) // stance
      .u32(13)
      .u32(0)
      .u32(1250)
      .u16(2)
      .u16(40)
      .u16(1800);
    for (const n of [1, 4, 2, 1, 0, 3, 7, 2, 0, 1]) w.u8(n);
    w.u8(3).u8(7).u8(6).u8(12);
    const e = readCompanion(new ByteReader(w.finish()), resource);
    expect(e?.type).toBe("status");
    if (e?.type !== "status") return;
    const s = e.status;
    expect(s).toMatchObject({ state: 1, id: 0x1234, name: "Aldric", kindName: "Duke soldier", hp: 25, maxHp: 35, bond: 320, tier: 2, stance: 3, room: "The Tos Inn", fee: 1250, packCount: 2, bulkMax: 1800 });
    expect(s.look).toEqual({ gender: 1, hair: 4, eyes: 2, nose: 1, mouth: 0, beard: 3, hairColour: 7, skin: 2, colour1: 0, colour2: 1 });
    expect(s.palette).toEqual([7, 6, 12]);
    expect(companionStateLabel(s)).toBe("With you");
    expect(buildLookCommand(s.look)).toBe("companion look 1 4 2 1 0 3 7 2 0 1");
  });

  it("reads no companion, and health changes", () => {
    expect(readCompanion(new ByteReader(new ByteWriter().u8(1).u8(0).finish()), resource)).toEqual({ type: "none" });
    expect(readCompanion(new ByteReader(new ByteWriter().u8(2).u16(10).u16(35).finish()), resource)).toEqual({ type: "health", hp: 10, maxHp: 35 });
  });
});
