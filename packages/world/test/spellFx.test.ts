import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter } from "@shards/protocol";
import { SPELL_FX, readSpellFx } from "../src/spellFx.ts";

describe("UC_SPELL_FX", () => {
  it("reads a spell effect (room.kod SendSpellFx)", () => {
    // a Vampiric Drain: from a rat (0x1234) back to its caster (0x99), LIGHT_BLOOD, normal size
    const w = new ByteWriter().u8(SPELL_FX.DRAIN).u32(0x99).u32(0x1234).u16(0x3c00).u8(2);
    expect(readSpellFx(new ByteReader(w.finish()))).toEqual({ kind: SPELL_FX.DRAIN, source: 0x99, target: 0x1234, color: 0x3c00, size: 2 });
  });

  it("reads 0 for no source or target", () => {
    const w = new ByteWriter().u8(SPELL_FX.ROOM_FLASH).u32(0).u32(0).u16(0x3dff).u8(2);
    expect(readSpellFx(new ByteReader(w.finish()))).toMatchObject({ source: 0, target: 0 });
  });
});
