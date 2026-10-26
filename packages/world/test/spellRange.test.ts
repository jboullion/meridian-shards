// UC_SPELL_RANGE (spellRange.ts): read in our units, songs kept until they end, and a preview
// only for the spell we point at, asked of the server no more than every few seconds.

import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter, UC } from "@shards/protocol";
import { SPELL_RANGE, SpellRanges, readSpellRange } from "../src/spellRange.ts";
import { fixture, userCommand } from "../../protocol/test/fixture.ts";

const UC_SPELL_RANGE = userCommand(UC.SPELL_RANGE, "packages/world/src/spellRange.ts");

const bytes = (kind: number, source: number, spell: number, radius: number, inner: number, color: number) =>
  new ByteReader(new ByteWriter().u8(kind).u32(source).u32(spell).u16(radius).u16(inner).u16(color).finish());

describe("UC_SPELL_RANGE", () => {
  it("reads the server's radii (64 a square) in ours (1024 a square)", () => {
    const r = fixture(UC_SPELL_RANGE, readSpellRange, bytes(SPELL_RANGE.PREVIEW, 6130, 5085, 20 * 64, 8 * 64, 0x7e40));
    expect(r).toEqual({ kind: SPELL_RANGE.PREVIEW, source: 6130, spell: 5085, radius: 20 * 1024, inner: 8 * 1024, color: 0x7e40 });
  });

  it("keeps a song's ring until it ends", () => {
    const ranges = new SpellRanges();
    ranges.handle(fixture(UC_SPELL_RANGE, readSpellRange, bytes(SPELL_RANGE.ON, 6130, 5241, 896, 0, 31)));
    expect([...ranges.songs.keys()]).toEqual([5241]);
    ranges.handle(fixture(UC_SPELL_RANGE, readSpellRange, bytes(SPELL_RANGE.OFF, 6130, 5241, 0, 0, 31)));
    expect(ranges.songs.size).toBe(0);
  });

  it("shows a preview only while we point at its spell, and asks again only after a while", () => {
    const ranges = new SpellRanges();
    expect(ranges.point(5194, 0)).toBe(true);
    expect(ranges.point(5194, 1000)).toBe(false);
    ranges.handle(fixture(UC_SPELL_RANGE, readSpellRange, bytes(SPELL_RANGE.PREVIEW, 6130, 5194, 576, 0, 992)));
    expect(ranges.preview?.radius).toBe(9 * 1024);
    ranges.point(null, 1500);
    expect(ranges.preview).toBeNull();
    expect(ranges.point(5194, 4000)).toBe(true);
  });
});
