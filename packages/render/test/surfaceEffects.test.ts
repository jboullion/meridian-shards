import { describe, expect, test } from "vitest";
import { seasonTint } from "../src/surfaceEffects.ts";
import { openingOutline, windowGain, windowMask } from "../src/windowMask.ts";

describe("the seasons' tint", () => {
  const leaf: [number, number, number] = [0.25, 0.5, 0.15];
  const brick: [number, number, number] = [0.6, 0.3, 0.25];

  test("summer is the original", () => {
    expect(seasonTint(leaf, 1, 100, 200, false)).toEqual(leaf.map((v) => expect.closeTo(v, 5)));
  });

  test("only greens change", () => {
    for (const s of [0, 2, 3]) seasonTint(brick, s, 100, 200, false).forEach((v, i) => expect(v).toBeCloseTo(brick[i], 5));
  });

  test("fall turns leaves warm, winter turns them grey, spring greener", () => {
    const fall = seasonTint(leaf, 2, 100, 200, false);
    expect(fall[0]).toBeGreaterThan(fall[1] * 0.9);
    const winter = seasonTint(leaf, 3, 100, 200, false);
    expect(Math.max(...winter) - Math.min(...winter)).toBeLessThan(leaf[1] - leaf[2]);
    const spring = seasonTint(leaf, 0, 100, 200, false);
    expect(spring[1]).toBeGreaterThan(leaf[1]);
  });

  test("strength 0 changes nothing", () => {
    seasonTint(leaf, 2, 100, 200, false, 0).forEach((v, i) => expect(v).toBeCloseTo(leaf[i], 5));
  });
});

describe("windows' glass", () => {
  test("a rectangle fills its box, the transposed way round", () => {
    // The picture is 10 wide and 6 tall: stored, 6 wide (columns are its rows) and 10 tall
    const mask = windowMask([{ shape: "rect", x: [1, 6], y: [0, 4] }], 6, 10);
    const at = (px: number, py: number) => mask[px * 6 + py];
    expect(at(3, 2)).toBe(255);
    expect(at(8, 2)).toBe(0);
    expect(at(3, 5)).toBe(0);
  });

  test("an arch is open below its spring and rounded above", () => {
    const pts = openingOutline({ shape: "round", x: [0, 20], y: [0, 40], spring: 10 });
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(0, 0);
    const pointed = openingOutline({ shape: "pointed", x: [0, 20], y: [0, 40], spring: 15 });
    expect(Math.min(...pointed.map((p) => p[1]))).toBeCloseTo(0, 0);
    const circle = openingOutline({ shape: "circle", x: [0, 10], y: [0, 10] });
    for (const [x, y] of circle) expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(5, 5);
  });

  test("dark glass glows more, between 1 and 4 times, by the texture's own gain", () => {
    const mask = new Uint8Array([255, 255, 0, 0]);
    const palette = new Uint8Array(768);
    palette.set([20, 20, 20], 3);
    palette.set([250, 250, 250], 6);
    expect(windowGain(mask, new Uint8Array([1, 1, 2, 2]), palette)).toBe(4);
    expect(windowGain(mask, new Uint8Array([2, 2, 1, 1]), palette)).toBe(1);
    expect(windowGain(mask, new Uint8Array([2, 2, 1, 1]), palette, 2)).toBe(2);
    expect(windowGain(new Uint8Array(4), new Uint8Array(4), palette)).toBe(0);
  });
});
