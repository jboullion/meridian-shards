import { describe, expect, test } from "vitest";
import { ByteReader, ByteWriter } from "@shards/protocol";
import { readSpellRefusal } from "../src/spellRefusal.ts";

const lookup = (id: number) => ({ 9: "bless" })[id];
const params = () => new ByteReader(new ByteWriter().u32(9).finish());

describe("spell refusals (spellRefusal.ts)", () => {
  test("out of reagents, with the spell's name", () => {
    expect(readSpellRefusal("You don't have the reagents to cast %s!", params(), lookup)).toEqual({ reason: "reagents", spell: "bless" });
  });

  test("out of mana", () => {
    expect(readSpellRefusal("You don't have enough mana to cast %s!", params(), lookup)).toEqual({ reason: "mana", spell: "bless" });
  });

  test("resting has no parameter", () => {
    expect(readSpellRefusal("You can't cast spells while resting!", new ByteReader(new Uint8Array(0)), lookup)).toEqual({ reason: "resting", spell: "" });
  });

  test("other messages aren't refusals", () => {
    for (const f of ["You feel more skilled in %s.", "%sYour %s %s %s%s.", "You don't have enough %s."]) expect(readSpellRefusal(f, params(), lookup), f).toBeNull();
  });
});
