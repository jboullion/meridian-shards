import { describe, expect, test } from "vitest";
import { Nature, type NatureRoom } from "../src/index.ts";

const SQ = 1024;
/** A meadow 60 squares across at floor height 0, with a lake over its western third */
const meadow: NatureRoom = {
  floor: (x, y) => (x < 0 || y < 0 || x > 60 * SQ || y > 60 * SQ ? -1 : 0),
  roofed: () => false,
  water: (x) => (x < 20 * SQ ? 0 : null),
};
const viewer = { x: 22 * SQ, y: 30 * SQ, z: 0 };
const none = { butterflies: 0, fireflies: 0, leaves: 0, fish: false };

function run(n: Nature, opts: typeof none, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds * 1000; t += 33) {
    n.update(33, viewer, 0, meadow, opts);
    each?.();
  }
}

const inside = (n: Nature) =>
  n as unknown as {
    butterflies: { s: { x: number; z: number } }[];
    fireflies: { s: { z: number; emissive: boolean } }[];
    leaves: { s: { z: number }; lying: number }[];
    fish: { s: { x: number; z: number } }[];
  };

describe("butterflies, fireflies, leaves and fish (ours)", () => {
  test("butterflies flutter low over dry ground", () => {
    const n = new Nature();
    n.setRoom(meadow, { maxX: 60 * SQ, maxY: 60 * SQ });
    run(n, { ...none, butterflies: 6 }, 20, () => {
      for (const b of inside(n).butterflies) {
        expect(b.s.z).toBeGreaterThan(0);
        expect(b.s.z).toBeLessThan(1.5 * SQ);
      }
    });
    expect(n.count.butterflies).toBe(6);
    n.dispose();
  });

  test("fireflies shine (the glow pass) and stay near the ground", () => {
    const n = new Nature();
    n.setRoom(meadow, { maxX: 60 * SQ, maxY: 60 * SQ });
    run(n, { ...none, fireflies: 20 }, 15);
    expect(n.count.fireflies).toBe(20);
    for (const f of inside(n).fireflies) {
      expect(f.s.emissive).toBe(true);
      expect(f.s.z).toBeLessThanOrEqual(2.5 * SQ);
    }
    n.dispose();
  });

  test("leaves fall, land and go", () => {
    const n = new Nature();
    n.setRoom(meadow, { maxX: 60 * SQ, maxY: 60 * SQ });
    let landed = 0;
    run(n, { ...none, leaves: 6 }, 40, () => {
      landed = Math.max(landed, inside(n).leaves.filter((l) => l.lying > 0).length);
    });
    expect(landed).toBeGreaterThan(0);
    for (const l of inside(n).leaves) expect(l.s.z).toBeGreaterThanOrEqual(0);
    n.dispose();
  });

  test("fish leap only out of the water, once it's been found", () => {
    const n = new Nature();
    n.setRoom(meadow, { maxX: 60 * SQ, maxY: 60 * SQ });
    let jumps = 0;
    run(n, { ...none, fish: true }, 60, () => {
      for (const f of inside(n).fish) {
        expect(f.s.x).toBeLessThan(21 * SQ);
        jumps++;
      }
    });
    expect(n.count.water).toBeGreaterThan(0);
    expect(jumps).toBeGreaterThan(0);
    n.dispose();
  });

  test("no fish without water to leap from", () => {
    const n = new Nature();
    const dry: NatureRoom = { ...meadow, water: () => null };
    n.setRoom(dry, { maxX: 60 * SQ, maxY: 60 * SQ });
    for (let t = 0; t < 60000; t += 33) n.update(33, viewer, 0, dry, { ...none, fish: true });
    expect(n.count.fish).toBe(0);
    n.dispose();
  });
});
