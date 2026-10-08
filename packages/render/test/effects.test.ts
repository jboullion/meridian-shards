import { describe, expect, test } from "vitest";
import { fixedSin, flashStep, lightIndex } from "../src/objectLighting.ts";
import { WeatherParticles, type ParticleRoom } from "../src/particles.ts";

describe("flashing objects (animate.c OF_FLASHING)", () => {
  test("the light swings by up to half the light levels over a second", () => {
    expect(fixedSin(32, 0)).toBe(0);
    expect(fixedSin(32, 1024)).toBe(32); // a quarter turn: SIN = 1.0
    expect(fixedSin(32, 3072)).toBe(-32);
    let t = 0;
    let adjust = 0;
    for (let i = 0; i < 5; i++) [t, adjust] = flashStep(t, 50);
    expect(t).toBe(250);
    expect(adjust).toBe(32);
    // dt is capped at 50 ms a step
    expect(flashStep(0, 500)[0]).toBe(50);
  });

  test("the adjustment moves the light index, within the palette's 64 levels", () => {
    expect(lightIndex(100, 0, 0, 1024, 10)).toBe(lightIndex(100, 0, 0) + 10);
    expect(lightIndex(100, 0, 0, 1024, -100)).toBe(0);
    expect(lightIndex(255, 30, 255, 1024, 40)).toBe(63);
  });
});

describe("weather (d3dparticle.c)", () => {
  const open: ParticleRoom = { floor: () => 0, ceiling: () => 4096, roofed: () => false };
  const indoors: ParticleRoom = { floor: () => 0, ceiling: () => 4096, roofed: () => true };
  const live = (w: WeatherParticles) => (w.group.children[0] as unknown as { geometry: { drawRange: { count: number } } }).geometry.drawRange.count;

  test("rain falls outdoors and never under a roof", () => {
    const outside = new WeatherParticles(null);
    outside.update({ x: 0, y: 0, z: 768 }, { sand: false, rain: true, snow: false, fireworks: false }, 400, open);
    expect(live(outside)).toBeGreaterThan(100);
    const inside = new WeatherParticles(null);
    inside.update({ x: 0, y: 0, z: 768 }, { sand: false, rain: true, snow: false, fireworks: false }, 400, indoors);
    expect(live(inside)).toBe(0);
  });

  test("density 0 makes no particles, and nothing draws when the weather is clear", () => {
    const w = new WeatherParticles(null);
    w.setDensity(0);
    w.update({ x: 0, y: 0, z: 768 }, { sand: true, rain: true, snow: true, fireworks: true }, 400, open);
    expect(live(w)).toBe(0);
    const clear = new WeatherParticles(null);
    clear.update({ x: 0, y: 0, z: 768 }, { sand: false, rain: false, snow: false, fireworks: false }, 400, open);
    expect(live(clear)).toBe(0);
  });
});
