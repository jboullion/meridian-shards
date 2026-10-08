import { describe, expect, test } from "vitest";
import { ByteReader, ByteWriter } from "@shards/protocol";
import { readDamageDealt } from "../src/combatHit.ts";

const HIT_MOB = "%sYour %s %s %s%s for ~k~B%i~B%s damage.";
const HIT_PLAYER = "%sYour %s %s %s%q for ~k~B%i~B%s damage.";
const RESOURCES: Record<number, string> = { 1: "~b", 2: "mace", 3: "wounds", 4: "the ", 5: "giant rat" };
const lookup = (id: number) => RESOURCES[id];

describe("damage numbers (combatHit.ts)", () => {
  test("a monster hit: its name resource and the damage", () => {
    const r = new ByteReader(new ByteWriter().u32(1).u32(2).u32(3).u32(4).u32(5).i32(7).u32(1).finish());
    expect(readDamageDealt(HIT_MOB, r, lookup)).toEqual({ name: "giant rat", damage: 7 });
  });

  test("a player hit: the name comes as a string", () => {
    const r = new ByteReader(new ByteWriter().u32(1).u32(2).u32(3).u32(4).string("Psychochild").i32(12).u32(1).finish());
    expect(readDamageDealt(HIT_PLAYER, r, lookup)).toEqual({ name: "Psychochild", damage: 12 });
  });

  test("other messages aren't hits", () => {
    const r = new ByteReader(new ByteWriter().u32(1).u32(2).u32(3).u32(4).u32(5).finish());
    for (const f of [
      "%sYour %s %s %s%s.", // slay
      "%sYour attack %s %s%s.", // miss
      "%sYour %s %s %s%s, failing to cause any real harm.",
      "%s%s%s's %s %s you for ~r~B%i~B%s damage.", // we were hit
    ])
      expect(readDamageDealt(f, r, lookup), f).toBeNull();
  });

  test("a short message doesn't throw", () => {
    const r = new ByteReader(new ByteWriter().u32(1).u32(2).finish());
    expect(readDamageDealt(HIT_MOB, r, lookup)).toBeNull();
  });
});
