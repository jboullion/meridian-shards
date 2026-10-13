import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseRoo } from "@shards/formats";
import { PET_KINDS, PET_TIERS, Pets, cleanPetName, petArt, petForKarma, petUnlocked, readPetChoice, type PetOwner } from "../src/index.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "razainn.roo"));

describe("pet kinds and choices", () => {
  test("every kind needs one of the tiers, and its colours at least as much", () => {
    for (const k of Object.values(PET_KINDS)) {
      expect(PET_TIERS).toContain(k.health);
      for (const c of k.colours) expect(c.health).toBeGreaterThanOrEqual(k.health);
    }
  });

  test("unlocked by maximum health, a tier every 10 from the baby spider's 20 to the shadowbeast's 150", () => {
    expect(petUnlocked("babySpider", 0, 20)).toBe(true);
    expect(petUnlocked("rat", 0, 29)).toBe(false);
    expect(petUnlocked("rat", 0, 30)).toBe(true);
    expect(petUnlocked("shadowbeast", 0, 149)).toBe(false);
    expect(petUnlocked("shadowbeast", 0, 150)).toBe(true);
    expect(new Set(Object.values(PET_KINDS).map((k) => k.health))).toEqual(new Set(PET_TIERS));
    expect("bunny" in PET_KINDS).toBe(false);
    expect(petUnlocked("dragon", 0, 999)).toBe(false);
    expect(petUnlocked("rat", 5, 999)).toBe(false);
  });

  test("the fey: good at karma 0 and above, dark below; the dragonfly's wings are art too", () => {
    expect(petForKarma("fey", 40)).toBe("goodFey");
    expect(petForKarma("fey", 0)).toBe("goodFey");
    expect(petForKarma("fey", null)).toBe("goodFey");
    expect(petForKarma("fey", -1)).toBe("evilFey");
    expect(petArt()).toContain("dflywing.bgf");
  });

  test("names: 16 Latin-1 characters, tidied; unknown kinds aren't pets", () => {
    expect(cleanPetName("  Mr   Whiskers  ")).toBe("Mr Whiskers");
    expect(cleanPetName("a".repeat(30))).toHaveLength(16);
    expect(cleanPetName("Ünïcødé🐀")).toBe("Ünïcødé");
    expect(readPetChoice({ kind: "rat", colour: 0, name: "Squeak" })).toEqual({ kind: "rat", colour: 0, name: "Squeak" });
    expect(readPetChoice({ kind: "rat", colour: 9 })).toEqual({ kind: "rat", colour: 0, name: "" });
    expect(readPetChoice({ kind: "dragon" })).toBeNull();
    // Kinds taken out come back as one still here
    expect(readPetChoice({ kind: "bunny", colour: 0, name: "Thumper" })).toEqual({ kind: "rat", colour: 0, name: "Thumper" });
    expect(readPetChoice({ kind: "greyBunny", colour: 3 })).toEqual({ kind: "rat", colour: 0, name: "" });
    expect(readPetChoice(null)).toBeNull();
    expect(readPetChoice({ kind: "constructor" })).toBeNull();
  });
});

describe.skipIf(!have)("pets following their owners", () => {
  const room = () => parseRoo(new Uint8Array(readFileSync(join(ASSETS, "razainn.roo"))));
  const sq = (row: number, col: number) => ({ x: (col - 0.5) * 1024, y: (row - 0.5) * 1024 });
  const owner = (at: { x: number; y: number }, speed = 0): PetOwner => ({ id: 7, name: "Alice", ...at, angle: 0, speed, pet: { kind: "rat", colour: 0, name: "Squeak" } });
  const run = (pets: Pets, o: PetOwner | null, ms: number, now: { t: number }) => {
    for (let t = 0; t < ms; t += 16) pets.update(16, o ? [o] : [], (now.t += 16));
  };

  test("appears beside its owner, keeps up when they walk, comes back when they're moved far, and goes with them", () => {
    const pets = new Pets(room());
    const now = { t: 1_000_000 };
    const start = sq(8, 8);
    run(pets, owner(start), 600, now);
    const [p] = pets.objects();
    expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeLessThan(1.5 * 1024);
    expect(pets.named()).toEqual([{ obj: p, name: "Squeak" }]);
    // Walking three squares east: the pet keeps up
    let at = start;
    for (let k = 0; k < 30; k++) {
      at = { x: at.x + 100, y: at.y };
      run(pets, owner(at, 25), 40, now);
    }
    run(pets, owner(at), 1500, now);
    expect(Math.hypot(p.x - at.x, p.y - at.y)).toBeLessThan(2 * 1024);
    // Teleported far: it fades out and comes back beside them
    const far = sq(8, 2);
    run(pets, owner(far), 2000, now);
    const [q] = pets.objects();
    expect(Math.hypot(q.x - far.x, q.y - far.y)).toBeLessThan(1.5 * 1024);
    // The owner gone: the pet fades with them
    run(pets, null, 1000, now);
    expect(pets.objects()).toEqual([]);
  });

  test("a new choice replaces the pet", () => {
    const pets = new Pets(room());
    const now = { t: 0 };
    run(pets, owner(sq(8, 8)), 500, now);
    run(pets, { ...owner(sq(8, 8)), pet: { kind: "babySpider", colour: 0, name: "" } }, 1000, now);
    expect(pets.objects()).toHaveLength(1);
    expect(pets.named()).toEqual([]);
  });
});
