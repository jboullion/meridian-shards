import { describe, expect, test } from "vitest";
import { GroundCover, type GroundRoom, type GroundSpot } from "../src/index.ts";

const SQ = 1024;
/** A meadow (grass) east of x = 20 squares, a road of rock to the west */
const meadow: GroundRoom = {
  spot: (x, y): GroundSpot | null =>
    x < 0 || y < 0 || x > 60 * SQ || y > 60 * SQ ? null : { floor: 0, kind: x > 20 * SQ ? "grass" : "rocky", color: [0.3, 0.5, 0.2], town: false },
  light: () => [1, 1, 1],
};
/** Two made-up rocks: a pebble for grass, a stone for rocky ground */
const rocks = [
  { pixels: new Uint8Array(16 * 8).fill(5), width: 16, height: 8, shrink: 4, kinds: ["grass" as const] },
  { pixels: new Uint8Array(32 * 32).fill(9), width: 32, height: 32, shrink: 2, kinds: ["rocky" as const] },
];
const palette = new Uint8Array(768).fill(128);
const inside = (g: GroundCover) => g as unknown as { cells: Map<number, { x: number; y: number; art: string } | null> };

describe("ground detail (ours)", () => {
  test("tufts on grass, rocks for each ground, within reach of the player", () => {
    const g = new GroundCover();
    g.setRockArt(rocks, palette);
    g.setRoom("a6.roo", meadow);
    g.update(16, { x: 21 * SQ, y: 30 * SQ });
    expect(g.count).toBeGreaterThan(100);
    const pieces = [...inside(g).cells.values()].filter((p) => p !== null) as unknown as { x: number; art: string; variant: number; size: number }[];
    const grass = pieces.filter((p) => p.x > 20 * SQ),
      rock = pieces.filter((p) => p.x < 20 * SQ);
    expect(grass.every((p) => ["tuft", "flower"].includes(p.art) || (p.art === "rock" && p.variant === 0))).toBe(true);
    expect(rock.length).toBeGreaterThan(0);
    expect(rock.every((p) => p.art === "rock" && p.variant === 1)).toBe(true);
    // Never bigger than the rock is as an object (32 pixels at shrink 2: 256 fine units)
    for (const p of rock) expect(p.size).toBeLessThanOrEqual(256);
    // Drawn only within reach (the cells round about are worked out, not all drawn)
    const layers = g as unknown as { tufts: { pos: Float32Array; n: number } };
    for (let i = 0; i < layers.tufts.n; i++) expect(Math.hypot(layers.tufts.pos[i * 3] - 21, layers.tufts.pos[i * 3 + 2] - 30)).toBeLessThanOrEqual(20);
    g.dispose();
  });

  test("the same tufts in the same places every time (by the room and the spot)", () => {
    const where = (room: string) => {
      const g = new GroundCover();
      g.setRoom(room, meadow);
      g.update(16, { x: 30 * SQ, y: 30 * SQ });
      const out = [...inside(g).cells.entries()].filter(([, p]) => p).map(([k, p]) => `${k}:${p!.art}`).sort();
      g.dispose();
      return out;
    };
    expect(where("a6.roo")).toEqual(where("a6.roo"));
    expect(where("a6.roo")).not.toEqual(where("b6.roo"));
  });

  test("nothing where the room says there's nothing (paving, indoors, water)", () => {
    const g = new GroundCover();
    g.setRoom("tos.roo", { spot: () => null, light: () => [1, 1, 1] });
    g.update(16, { x: 30 * SQ, y: 30 * SQ });
    expect(g.count).toBe(0);
    g.dispose();
  });
});
