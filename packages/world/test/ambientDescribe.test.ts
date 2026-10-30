import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseRoo } from "@shards/formats";
import { AMBIENT_ROOMS, AmbientLife, personName, seededRandom, type AmbientExits } from "../src/index.ts";
import { navGridOf } from "./navFixture.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "tos.roo")) && existsSync(join(ASSETS, "roomexits.json"));

describe("names for the crowd", () => {
  test("titles by role", () => {
    const r = seededRandom(5);
    expect(personName(r, "guard", false)).toMatch(/^Guard \w+$/);
    expect(personName(r, "knight", false)).toMatch(/^Sir /);
    expect(personName(r, "lady", true)).toMatch(/^Lady /);
    expect(personName(r, "folk", true)).toMatch(/^\S+ \S+$/);
  });
});

describe.skipIf(!have)("the inspect window's facts (AmbientLife.describe)", () => {
  test("everyone in Tos has a name, a role, something to do and a mood; some are going somewhere known", () => {
    const room = parseRoo(new Uint8Array(readFileSync(join(ASSETS, "tos.roo"))));
    const exits = JSON.parse(readFileSync(join(ASSETS, "roomexits.json"), "utf8")) as Record<string, AmbientExits>;
    const life = new AmbientLife(room, AMBIENT_ROOMS["tos.roo"], exits["tos.roo"], 42, navGridOf(room));
    const frame = { player: null, scale: 1, hour: 14 };
    for (let t = 0; t < 60_000; t += 100) life.update(100, frame);
    const people = life.objects().map((o) => life.describe(o.id)!);
    expect(people.length).toBeGreaterThan(5);
    for (const p of people) {
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.role).toBeTruthy();
      expect(p.doing).toBeTruthy();
      expect(p.mood).toBeTruthy();
    }
    expect(people.some((p) => p.role === "Guard")).toBe(true);
    expect(people.some((p) => p.to !== null || p.from !== null || p.errand !== null)).toBe(true);
    expect(life.has(people[0].object.id)).toBe(true);
    expect(life.describe(-5)).toBeNull();
  });
});
