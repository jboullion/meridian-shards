// Ours (Enhanced lighting, "Lights stop at walls"): which room surfaces a light can see.
// The D3D client's light maps light every surface within reach, through walls and on
// their far sides (d3dlighting.c D3DRenderLMapPost*Add, both sides of each wall:
// d3drender.c D3DGeometryBuildNew), so a torch in one room lights the next. Here a
// triangle is lit only when it faces the light and the light can see some of it, past
// the room's walls: a wall with nothing on one side, or whose opening (between the higher
// floor and the lower ceiling of its two sectors) the ray passes above or below.
//
// Triangles are the room geometry's (roomGeometry.ts Batch: client fine units, wound
// counter-clockwise around the side they're seen from).

import { ceilingHeightAt, floorHeightAt, type Room } from "@shards/formats";
import type { Batch } from "./roomGeometry.ts";

export interface LightPoint {
  /** client fine units */
  x: number;
  y: number;
  z: number;
  /** how far it reaches (DLIGHT_SCALE / 2) */
  reach: number;
}

/** How far samples are moved off their surface towards the light, so they don't cross their own wall */
const NUDGE = 4;
/**
 * Lights are often set on a wall's line, just behind its face or in a niche (wall torches,
 * the Museum's DynamicLights): walls this close to the light don't block it (a fifth of a
 * square: the niches' sides are about a tenth out; walls between rooms are thicker), so a
 * torch still lights the wall it hangs on.
 */
const LIGHT_SLACK = 192;
/** A surface faces a light up to this far behind its plane */
const FACING_SLACK = 64;
/** Samples: the centroid, and each corner this far towards it */
const CORNER_PULL = 0.25;

/** Indices of the walls inside the square of half-side `reach` around (x, y). */
export function wallsNear(room: Room, x: number, y: number, reach: number): number[] {
  const out: number[] = [];
  room.walls.forEach((w, i) => {
    if (Math.max(w.x0, w.x1) < x - reach || Math.min(w.x0, w.x1) > x + reach) return;
    if (Math.max(w.y0, w.y1) < y - reach || Math.min(w.y0, w.y1) > y + reach) return;
    out.push(i);
  });
  return out;
}

/**
 * Whether the straight line from a to b (client fine units) passes no wall that blocks it.
 * `walls` limits the walls tested (wallsNear); all of them by default. Walls crossed within
 * `slack` of a don't count.
 */
export function lineOfSight(
  room: Room,
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  walls?: number[],
  slack = 0,
): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const minT = Math.max(1e-6, slack / (Math.hypot(dx, dy) || 1));
  const test = (i: number): boolean => {
    const w = room.walls[i];
    const ex = w.x1 - w.x0,
      ey = w.y1 - w.y0;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) return true; // parallel
    const fx = w.x0 - a.x,
      fy = w.y0 - a.y;
    const t = (fx * ey - fy * ex) / den; // along a -> b
    const u = (fx * dy - fy * dx) / den; // along the wall
    if (t <= minT || t >= 1 - 1e-6 || u < 0 || u > 1) return true;
    const s1 = w.posSector ? room.sectors[w.posSector - 1] : null;
    const s2 = w.negSector ? room.sectors[w.negSector - 1] : null;
    if (!s1 || !s2) return false;
    const cx = a.x + t * dx,
      cy = a.y + t * dy,
      cz = a.z + t * (b.z - a.z);
    const floor = Math.max(floorHeightAt(s1, cx, cy), floorHeightAt(s2, cx, cy));
    const ceiling = Math.min(ceilingHeightAt(s1, cx, cy), ceilingHeightAt(s2, cx, cy));
    return cz >= floor && cz <= ceiling;
  };
  if (walls) {
    for (const i of walls) if (!test(i)) return false;
  } else {
    for (let i = 0; i < room.walls.length; i++) if (!test(i)) return false;
  }
  return true;
}

/**
 * Which of a batch's triangles the light can light: 1 where it faces the light, is within
 * reach, and the light sees one of its samples. One entry per triangle.
 */
export function triangleVisibility(room: Room, batch: Batch, light: LightPoint, walls = wallsNear(room, light.x, light.y, light.reach)): Uint8Array {
  const p = batch.positions;
  const count = Math.floor(p.length / 9);
  const out = new Uint8Array(count);
  const r = light.reach;
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const ax = p[o], ay = p[o + 1], az = p[o + 2];
    const bx = p[o + 3], by = p[o + 4], bz = p[o + 5];
    const cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
    // Out of reach: the light map adds nothing there anyway
    if (Math.min(ax, bx, cx) > light.x + r || Math.max(ax, bx, cx) < light.x - r) continue;
    if (Math.min(ay, by, cy) > light.y + r || Math.max(ay, by, cy) < light.y - r) continue;
    if (Math.min(az, bz, cz) > light.z + r || Math.max(az, bz, cz) < light.z - r) continue;
    // The side it's seen from (pushTri winds it counter-clockwise around that side)
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    const mx = (ax + bx + cx) / 3,
      my = (ay + by + cy) / 3,
      mz = (az + bz + cz) / 3;
    if (nx * (light.x - mx) + ny * (light.y - my) + nz * (light.z - mz) < -FACING_SLACK) continue;
    const samples = [
      [mx, my, mz],
      [ax + (mx - ax) * CORNER_PULL, ay + (my - ay) * CORNER_PULL, az + (mz - az) * CORNER_PULL],
      [bx + (mx - bx) * CORNER_PULL, by + (my - by) * CORNER_PULL, bz + (mz - bz) * CORNER_PULL],
      [cx + (mx - cx) * CORNER_PULL, cy + (my - cy) * CORNER_PULL, cz + (mz - cz) * CORNER_PULL],
    ];
    for (const [sx, sy, sz] of samples) {
      if (lineOfSight(room, light, { x: sx + nx * NUDGE, y: sy + ny * NUDGE, z: sz + nz * NUDGE }, walls, LIGHT_SLACK)) {
        out[t] = 1;
        break;
      }
    }
  }
  return out;
}
