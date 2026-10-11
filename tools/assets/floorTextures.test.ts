import { describe, expect, it } from "vitest";
import { averageColor, classifyFloor, isCobbled } from "./floorTextures.ts";

describe("floor textures by colour", () => {
  it("tells grass, earth and rock from paving, wood and water (real textures' averages)", () => {
    expect(classifyFloor(48, 76, 37)).toBe("grass"); // grd02301
    expect(classifyFloor(76, 85, 53)).toBe("grass"); // grd02305
    expect(classifyFloor(174, 115, 74)).toBe("earth"); // grd09081, the desert
    expect(classifyFloor(161, 145, 133)).toBe("rocky"); // grd02123, mountains
    expect(classifyFloor(149, 150, 149)).toBeNull(); // grd02126, paving
    expect(classifyFloor(34, 14, 7)).toBeNull(); // grd04610, dark wood
    expect(classifyFloor(136, 79, 26)).toBeNull(); // grd02402, red-brown planks
    expect(classifyFloor(94, 154, 215)).toBeNull(); // grd08911, water
    expect(classifyFloor(72, 80, 70)).toBe("rocky"); // grd01605, a cave's grey-green: pebbles
  });

  it("averages through the palette, skipping see-through pixels", () => {
    const palette = new Uint8Array(768);
    palette.set([10, 20, 30], 3);
    palette.set([30, 40, 50], 6);
    expect(averageColor(Uint8Array.from([1, 2, 254, 254]), palette)).toEqual([20, 30, 40]);
  });

  it("tells cobbles (dark mortar, strong contrast) from even ground", () => {
    const palette = new Uint8Array(768);
    palette.set([20, 20, 20], 3); // mortar
    palette.set([150, 145, 130], 6); // stone
    palette.set([140, 135, 120], 9); // ground, a shade darker
    // Stones with a dark line through every fifth pixel
    expect(isCobbled(Uint8Array.from({ length: 400 }, (_, k) => (k % 5 === 0 ? 1 : 2)), palette)).toBe(true);
    // Even ground: two close shades
    expect(isCobbled(Uint8Array.from({ length: 400 }, (_, k) => (k % 2 ? 2 : 3)), palette)).toBe(false);
  });
});
