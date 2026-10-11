// Floor textures that are water, for ambient life (ours): most water is a sector with depth, but
// some is only painted on (Raza's pool is a dry floor with a water texture), so fish wouldn't leap
// from it and rats would walk across it. A texture used under real water more often than not, and
// often enough to tell, is taken for water wherever it's used.
// Output: watertextures.json, the texture numbers (Sector.floorType), sorted.

import type { Room } from "../../packages/formats/src/index.ts";

/** Under water at least this many times, and more often than on dry floors */
const MIN_WET = 8;

export function findWaterTextures(rooms: Iterable<Room>): number[] {
  const wet = new Map<number, number>(),
    dry = new Map<number, number>();
  for (const room of rooms)
    for (const s of room.sectors) {
      if (!s.floorType) continue;
      const m = s.flags & 3 ? wet : dry; // SF_DEPTH_MASK
      m.set(s.floorType, (m.get(s.floorType) ?? 0) + 1);
    }
  return [...wet.entries()]
    .filter(([t, n]) => n >= MIN_WET && n > (dry.get(t) ?? 0))
    .map(([t]) => t)
    .sort((a, b) => a - b);
}
