// The spell effects' limits (spellEffects.ts): they mustn't grow without bound, however many
// spells land at once, and they must cost nothing while idle.

import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import { SpellEffects } from "../src/spellEffects.ts";
import type { LightSource } from "../src/objectLighting.ts";

const at = { x: 10240, y: 10240, z: 600 };
const FIRE = 0x7f06;

/** The point cloud's position buffer, for its upload flags */
function positions(fx: SpellEffects): THREE.BufferAttribute {
  const points = fx.group.children.find((c) => (c as THREE.Points).isPoints) as THREE.Points;
  return points.geometry.getAttribute("position") as THREE.BufferAttribute;
}

describe("SpellEffects", () => {
  it("never holds more than its cap of sparks, and thins bursts as it fills", () => {
    const fx = new SpellEffects();
    for (let i = 0; i < 200; i++) fx.impact(at, FIRE, 3);
    expect(fx.sparkCount).toBeLessThanOrEqual(1024);
    expect(fx.sparkCount).toBeGreaterThan(900);
    // They die away in time, and the cloud empties
    for (let i = 0; i < 120; i++) fx.update(16);
    expect(fx.sparkCount).toBe(0);
    expect(fx.active).toBe(false);
  });

  it("halves its bursts on a budget of a half", () => {
    const full = new SpellEffects();
    const half = new SpellEffects();
    half.budget = 0.5;
    full.impact(at, FIRE, 2);
    half.impact(at, FIRE, 2);
    // the core spark is always there; the rest halve
    expect(half.sparkCount - 1).toBe(Math.round((full.sparkCount - 1) / 2));
  });

  it("shares one light among hits close together, keeps at most four, and lights nothing far off", () => {
    const fx = new SpellEffects();
    for (let i = 0; i < 5; i++) fx.impact({ ...at, x: at.x + i * 100 }, FIRE);
    expect(fx.flashCount).toBe(1);
    for (let i = 0; i < 10; i++) fx.impact({ ...at, x: at.x + i * 3000 }, FIRE);
    expect(fx.flashCount).toBe(4);
    const far = new SpellEffects();
    far.impact(at, FIRE, 2, { x: at.x + 20 * 1024, y: at.y, z: 0 });
    expect(far.flashCount).toBe(0);
    const lights: LightSource[] = [{ x: 0, y: 0, z: 0, scale: 1, r: 1, g: 1, b: 1 }];
    fx.addLights(lights);
    expect(lights).toHaveLength(5);
    expect(lights[4].scale).toBe(1);
  });

  it("uploads only the live sparks, and nothing once it's empty", () => {
    const fx = new SpellEffects();
    fx.impact(at, FIRE, 2);
    fx.update(16);
    const a = positions(fx);
    expect(a.updateRanges).toEqual([{ start: 0, count: fx.sparkCount * 3 }]);
    for (let i = 0; i < 120; i++) fx.update(16);
    const version = a.version;
    fx.update(16);
    fx.update(16);
    expect(a.version).toBe(version);
  });

  it("reuses its rings", () => {
    const fx = new SpellEffects();
    fx.pulse(at, FIRE, "buff");
    const meshes = fx.group.children.length;
    for (let i = 0; i < 60; i++) fx.update(16);
    fx.pulse(at, FIRE, "heal");
    expect(fx.group.children.length).toBe(meshes);
  });
});
