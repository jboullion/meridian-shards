// Ours (Enhanced lighting, "Shaded corners"): ambient occlusion baked from the room's
// shape. Floors darken where a wall rises beside them, and ceilings where one comes down,
// fading over AO_RADIUS; the shader (lighting.ts cornerLight) darkens walls near their
// floor and ceiling from each vertex's surfaceInfo. Only the sector light is darkened,
// not the light maps: torches still light corners.

import { ceilingHeightAt, floorHeightAt, leafAt, type Room, type Sector } from "@shards/formats";
import { lineOfSight } from "./lightOcclusion.ts";

/** How far from a wall the floor and ceiling darken (fine units: a little over a third of a square) */
export const AO_RADIUS = 384;
/** Fine units per texel of the corner map */
const TEXEL = 128;
/** The corner map is at most this many texels on a side */
const MAX_SIZE = 1024;
/** A step this high or more darkens fully; lower ones less */
const FULL_STEP = 256;

export interface AoMap {
  /** Two bytes a texel, row by row: floor and ceiling occlusion, 0..255 */
  data: Uint8Array;
  width: number;
  height: number;
  /** Client fine units at texel (0, 0)'s corner, and per texel */
  x0: number;
  y0: number;
  texel: number;
}

/** The floor and ceiling occlusion of every texel over the room. */
export function bakeAo(room: Room): AoMap {
  const steps = bakeAoSteps(room);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * bakeAo a row at a time: it yields after each row of texels, so a big room (the desert's
 * take half a second) can be baked a few milliseconds a frame.
 */
export function* bakeAoSteps(room: Room): Generator<void, AoMap> {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const w of room.walls) {
    minX = Math.min(minX, w.x0, w.x1);
    maxX = Math.max(maxX, w.x0, w.x1);
    minY = Math.min(minY, w.y0, w.y1);
    maxY = Math.max(maxY, w.y0, w.y1);
  }
  if (!Number.isFinite(minX)) return { data: new Uint8Array(2), width: 1, height: 1, x0: 0, y0: 0, texel: TEXEL };
  const texel = Math.max(TEXEL, Math.ceil(Math.max(maxX - minX, maxY - minY) / MAX_SIZE));
  const width = Math.ceil((maxX - minX) / texel) + 1;
  const height = Math.ceil((maxY - minY) / texel) + 1;
  const data = new Uint8Array(width * height * 2);

  // Walls by cell of AO_RADIUS, each in every cell within AO_RADIUS of it
  const cells = new Map<number, number[]>();
  const cellOf = (v: number, min: number) => Math.floor((v - min) / AO_RADIUS);
  const cellCols = Math.ceil((maxX - minX) / AO_RADIUS) + 2;
  room.walls.forEach((w, i) => {
    for (let cy = cellOf(Math.min(w.y0, w.y1) - AO_RADIUS, minY); cy <= cellOf(Math.max(w.y0, w.y1) + AO_RADIUS, minY); cy++)
      for (let cx = cellOf(Math.min(w.x0, w.x1) - AO_RADIUS, minX); cx <= cellOf(Math.max(w.x0, w.x1) + AO_RADIUS, minX); cx++) {
        const k = cy * cellCols + cx;
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
  });

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const px = minX + (tx + 0.5) * texel,
        py = minY + (ty + 0.5) * texel;
      const nearby = cells.get(cellOf(py, minY) * cellCols + cellOf(px, minX));
      if (!nearby) continue;
      const leaf = leafAt(room, px, py);
      if (!leaf?.sector) continue;
      const here = leaf.sector;
      const s = room.sectors[here - 1];
      const floor = floorHeightAt(s, px, py),
        ceiling = ceilingHeightAt(s, px, py);
      let floorLit = 1,
        ceilingLit = 1;
      for (const i of nearby) {
        const w = room.walls[i];
        // The nearest point of the wall
        const ex = w.x1 - w.x0,
          ey = w.y1 - w.y0;
        const len2 = ex * ex + ey * ey;
        if (!len2) continue;
        const u = Math.max(0, Math.min(1, ((px - w.x0) * ex + (py - w.y0) * ey) / len2));
        const qx = w.x0 + u * ex,
          qy = w.y0 + u * ey;
        const d = Math.hypot(px - qx, py - qy);
        if (d >= AO_RADIUS) continue;
        // Only walls of this sector's edge: the other side is what rises or comes down
        let other: Sector | null;
        if (w.posSector === here) other = w.negSector ? room.sectors[w.negSector - 1] : null;
        else if (w.negSector === here) other = w.posSector ? room.sectors[w.posSector - 1] : null;
        else continue;
        const rise = other ? floorHeightAt(other, qx, qy) - floor : FULL_STEP;
        const drop = other ? ceiling - ceilingHeightAt(other, qx, qy) : FULL_STEP;
        if (rise <= 16 && drop <= 16) continue;
        // Not round a corner: the wall must be in sight (the wall itself is met at the very end, which lineOfSight allows)
        if (!lineOfSight(room, { x: px, y: py, z: floor + 8 }, { x: qx, y: qy, z: floor + 8 }, nearby)) continue;
        const near = (1 - d / AO_RADIUS) ** 2;
        if (rise > 16) floorLit *= 1 - near * Math.min(1, rise / FULL_STEP);
        if (drop > 16) ceilingLit *= 1 - near * Math.min(1, drop / FULL_STEP);
      }
      const o = (ty * width + tx) * 2;
      data[o] = Math.round((1 - floorLit) * 255);
      data[o + 1] = Math.round((1 - ceilingLit) * 255);
    }
    yield;
  }
  return { data, width, height, x0: minX, y0: minY, texel };
}

/**
 * For a vertex of a room surface: what it is (0 wall, 1 floor, 2 ceiling) from its face
 * normal (client space), and the floor and ceiling heights in front of it (for walls).
 */
export function surfaceInfo(room: Room, x: number, y: number, normal: [number, number, number]): [number, number, number] {
  const kind = normal[2] > 0.5 ? 1 : normal[2] < -0.5 ? 2 : 0;
  if (kind) return [kind, 0, 0];
  // A little in front of the wall
  const fx = x + normal[0] * 16,
    fy = y + normal[1] * 16;
  const leaf = leafAt(room, fx, fy);
  if (!leaf?.sector) return [0, -1e6, 1e6];
  const s = room.sectors[leaf.sector - 1];
  return [0, floorHeightAt(s, fx, fy), ceilingHeightAt(s, fx, fy)];
}
