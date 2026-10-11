import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { Lightning, Puddles, type PuddleRoom } from "../src/index.ts";

const SQ = 1024;
/** A flat square 60 squares across, paved; a raised step east of x = 40 */
const yard: PuddleRoom = {
  spot: (x, y) => (x < 0 || y < 0 || x > 60 * SQ || y > 60 * SQ ? null : { floor: x > 40 * SQ ? 256 : 0, ground: "paved" }),
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
    p.setRoom("tosinn.roo", { spot: () => null, light: () => [1, 1, 1] });
    p.update(16, { x: 30 * SQ, y: 30 * SQ }, 1, true);
    expect(p.count).toBe(0);
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
