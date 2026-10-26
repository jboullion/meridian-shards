import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter, UC } from "@shards/protocol";
import { SPELL_FX, SPELL_FX_LOOK, readSpellFx } from "../src/spellFx.ts";
import { fixture, userCommand } from "../../protocol/test/fixture.ts";

const UC_SPELL_FX = userCommand(UC.SPELL_FX, "packages/world/src/spellFx.ts");

describe("UC_SPELL_FX", () => {
  it("reads a spell effect (room.kod SendSpellFx)", () => {
    // a Vampiric Drain: from a rat (0x1234) back to its caster (0x99), LIGHT_BLOOD, normal size
    const w = new ByteWriter().u8(SPELL_FX.DRAIN).u32(0x99).u32(0x1234).u16(0x3c00).u8(2);
    expect(fixture(UC_SPELL_FX, readSpellFx, new ByteReader(w.finish()))).toEqual({ kind: SPELL_FX.DRAIN, source: 0x99, target: 0x1234, color: 0x3c00, size: 2, look: 0 });
  });

  it("reads the look (its particles' shape) when the server sends one", () => {
    const w = new ByteWriter().u8(SPELL_FX.IMPACT).u32(0x99).u32(0x1234).u16(0x331f).u8(2).u8(SPELL_FX_LOOK.ICE);
    expect(fixture(UC_SPELL_FX, readSpellFx, new ByteReader(w.finish())).look).toBe(SPELL_FX_LOOK.ICE);
  });

  it("reads 0 for no source or target", () => {
    const w = new ByteWriter().u8(SPELL_FX.ROOM_FLASH).u32(0).u32(0).u16(0x3dff).u8(2);
    expect(fixture(UC_SPELL_FX, readSpellFx, new ByteReader(w.finish()))).toMatchObject({ source: 0, target: 0 });
  });
});
