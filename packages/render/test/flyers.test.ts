import { describe, expect, test } from "vitest";
import { Flyers, type ParticleRoom } from "../src/index.ts";

const SQ = 1024;
/** A flat field 100 squares across: open sky, or a cave with its ceiling 3 squares up */
const field = (cave: boolean): ParticleRoom => ({
  floor: (x, y) => (x < 0 || y < 0 || x > 100 * SQ || y > 100 * SQ ? -1 : 0),
  ceiling: () => (cave ? 3 * SQ : 20 * SQ),
  roofed: () => cave,
});
const viewer = { x: 50 * SQ, y: 50 * SQ, z: 0 };

function run(f: Flyers, room: ParticleRoom, opts: { flocks: number; bats: number; cave: boolean }, seconds: number): void {
  for (let t = 0; t < seconds * 1000; t += 33) f.update(33, viewer, 0, room, opts);
}

describe("birds and bats (ours)", () => {
  test("flocks come over by day, high above", () => {
    const f = new Flyers();
    // Flocks come and go, so look while one is over us (the sky can be empty between them)
    let seen = 0;
    for (let t = 0; t < 90000 && !seen; t += 33) {
      f.update(33, viewer, 0, field(false), { flocks: 2, bats: 0, cave: false });
      if (t > 5000) seen = f.count.birds;
    }
    expect(seen).toBeGreaterThan(0);
    expect(f.count.bats).toBe(0);
    const pos = f.group.children[0] as unknown as { geometry: { getAttribute(n: string): { array: Float32Array } } };
    const ys = pos.geometry.getAttribute("position").array.filter((_, i) => i % 3 === 1).slice(0, f.count.birds);
    for (const y of ys) expect(y).toBeGreaterThan(7);
    f.dispose();
  });

  test("bats fly about head height in a cave, about the player", () => {
    const f = new Flyers();
    run(f, field(true), { flocks: 0, bats: 6, cave: true }, 20);
    expect(f.count.bats).toBe(6);
    const inside = f as unknown as { bats: { flyer: { x: number; y: number; z: number } }[] };
    for (const b of inside.bats) {
      expect(b.flyer.z).toBeGreaterThan(0.7 * SQ);
      expect(b.flyer.z).toBeLessThan(1.35 * SQ);
      expect(Math.hypot(b.flyer.x - viewer.x, b.flyer.y - viewer.y)).toBeLessThan(16 * SQ);
    }
    f.dispose();
  });

  test("in a cramped crypt they keep under its low ceiling", () => {
    const f = new Flyers();
    const crypt: ParticleRoom = { ...field(true), ceiling: () => 1.1 * SQ };
    run(f, crypt, { flocks: 0, bats: 6, cave: true }, 20);
    expect(f.count.bats).toBe(6);
    const inside = f as unknown as { bats: { flyer: { z: number } }[] };
    for (const b of inside.bats) expect(b.flyer.z).toBeLessThanOrEqual(0.9 * SQ + 1);
    f.dispose();
  });

  test("none when there are to be none, and none after a clear", () => {
    const f = new Flyers();
    run(f, field(false), { flocks: 0, bats: 0, cave: false }, 30);
    expect(f.count).toEqual({ birds: 0, bats: 0 });
    run(f, field(true), { flocks: 0, bats: 4, cave: true }, 10);
    f.clear();
    expect(f.count).toEqual({ birds: 0, bats: 0 });
    f.dispose();
  });
});
