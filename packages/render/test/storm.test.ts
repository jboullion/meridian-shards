import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { Lightning, Puddles, type PuddleRoom } from "../src/index.ts";

const SQ = 1024;
/** A flat square 60 squares across, paved; a raised step east of x = 40 */
const yard: PuddleRoom = {
  spot: (x, y) => (x < 0 || y < 0 || x > 60 * SQ || y > 60 * SQ ? null : { floor: x > 40 * SQ ? 256 : 0, ground: "paved" }),
  water: () => null,
  light: () => [1, 1, 1],
};
/** A lake: water west of x = 30 squares, a bank east of it */
const lake: PuddleRoom = {
  spot: (x, y) => (x >= 30 * SQ && x <= 60 * SQ && y >= 0 && y <= 60 * SQ ? { floor: 0, ground: "earth" } : null),
  water: (x, y) => (x >= 0 && x < 30 * SQ && y >= 0 && y <= 60 * SQ ? -64 : null),
  light: () => [1, 1, 1],
};
const inside = (p: Puddles) => p as unknown as { puddles: { x: number; y: number; z: number; rx: number }[] };

describe("the storm (ours)", () => {
  test("puddles in the rain, the same ones each time, on level ground only", () => {
    const where = () => {
      const p = new Puddles();
      p.setRoom("tos.roo", yard);
      p.update(16, { x: 30 * SQ, y: 30 * SQ }, 1, true);
      const out = inside(p).puddles.map((q) => `${q.x},${q.y}`);
      expect(p.count).toBeGreaterThan(20);
      // None straddles the step
      for (const q of inside(p).puddles) expect(Math.abs(q.x - 40 * SQ)).toBeGreaterThan(q.rx);
      p.dispose();
      return out;
    };
    expect(where()).toEqual(where());
  });

  test("dry ground has none; indoors has none", () => {
    const p = new Puddles();
    p.setRoom("tos.roo", yard);
    p.update(16, { x: 30 * SQ, y: 30 * SQ }, 0, false);
    expect(p.count).toBe(0);
    p.setRoom("tosinn.roo", { spot: () => null, water: () => null, light: () => [1, 1, 1] });
    p.update(16, { x: 30 * SQ, y: 30 * SQ }, 1, true);
    expect(p.count).toBe(0);
    p.dispose();
  });

  test("the rain's rings on open water: whole squares of it, only while it rains", () => {
    const p = new Puddles();
    p.setRoom("lake.roo", lake);
    p.update(16, { x: 30 * SQ, y: 30 * SQ }, 0, false);
    expect(p.ringSquares).toBe(0);
    for (let t = 0; t < 3000; t += 16) p.update(16, { x: 30 * SQ, y: 30 * SQ }, 0.5, true);
    expect(p.ringSquares).toBeGreaterThan(50);
    const squares = (p as unknown as { water: { x: number; z: number }[] }).water;
    // On the water only, never across the shore, at its surface
    for (const q of squares) {
      expect(q.x + SQ / 2).toBeLessThanOrEqual(30 * SQ);
      expect(q.z).toBe(-64);
    }
    // The rings fade out once the rain stops
    for (let t = 0; t < 20000; t += 16) p.update(16, { x: 30 * SQ, y: 30 * SQ }, 0.5, false);
    expect(p.ringSquares).toBe(0);
    p.dispose();
  });

  test("lightning strikes now and then in a storm, never without one", () => {
    const eye = new THREE.Vector3(10, 2, 10);
    const calm = new Lightning();
    for (let t = 0; t < 60000; t += 33) calm.update(33, false, eye);
    expect(calm.flash).toBe(0);
    const storm = new Lightning();
    let flashes = 0;
    for (let t = 0; t < 60000; t += 33) {
      storm.update(33, true, eye);
      if (storm.flash === 1) flashes++;
    }
    expect(flashes).toBeGreaterThan(0);
    calm.dispose();
    storm.dispose();
  });
});
