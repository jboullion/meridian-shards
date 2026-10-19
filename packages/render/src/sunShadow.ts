// Ours (Enhanced Lighting's sun, docs/adr/0017-lighting-moods.md): where the sun reaches the floor
// under open sky. Each texel of a map over the room shoots a ray toward the sun and marches it
// through the room. It's in shade if the ray meets a wall as it's drawn (RoomView hands in the
// room's wall triangles, leaving out mostly see-through textures: railings, grates), passes
// below a floor, or rises through a roof (the ceiling of a sector that has one). Sky sectors'
// ceilings don't stop it: open sky is open. Baked a row at a time, once a game hour, over a grid
// the room makes once.

import { floorHeightAt, ceilingHeightAt, leafAt, type Room, type Sector } from "@shards/formats";

/** Fine units per texel (an eighth of a square, as the corner map) */
const TEXEL = 128;
/** At most this many texels on a side */
const MAX_SIZE = 1024;
/** Fine units per cell of the coarse grid of walls and heights (more in rooms too big for it) */
const MIN_CELL = 256;
/** At most this many cells on a side */
const MAX_CELLS = 384;
/** Fine units per step along a ray */
const STEP = 96;
/** How far a ray looks, along the ground (fine units: 24 squares) */
const REACH = 24 * 1024;
/** A ray starts this far above the floor */
const LIFT = 24;
/** Below this elevation (sin) the sun is too low to bake: all in shade */
const MIN_SIN = 0.04;

export interface SunMap {
  /** A byte a texel, row by row: 255 in the sun, 0 in shade */
  data: Uint8Array;
  width: number;
  height: number;
  /** Client fine units at texel (0, 0)'s corner, and per texel */
  x0: number;
  y0: number;
  texel: number;
}

/** The room's walls and heights by cell (heightGridSteps): what a ray might meet there */
export interface SunHeightGrid {
  /** The highest thing that could stop a ray in each cell */
  top: Float32Array;
  /** The wall triangles reaching into each cell (indices; none: undefined), and the triangles (9 numbers each) */
  walls: (number[] | undefined)[];
  tris: Float32Array;
  cols: number;
  rows: number;
  /** Fine units per cell */
  cell: number;
  highest: number;
  minX: number;
  minY: number;
}

const isSky = (s: Sector) => s.ceilingType === 0;

/** The room's extent in fine units, from its walls */
function extent(room: Room) {
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
  return { minX, minY, maxX, maxY };
}

/** Whether any sector of the room is under open sky (only those rooms get a sun map) */
export function roomHasOpenSky(room: Room): boolean {
  return room.sectors.some(isSky);
}

/**
 * The walls as triangles (9 numbers each: three corners, client fine units), from the parts a
 * wall has drawn (a texture on either side): roomGeometry.ts draws the same parts, but for
 * textures that don't tile up the wall, which RoomView's own triangles get right.
 */
export function wallCasters(room: Room): Float32Array {
  const out: number[] = [];
  for (const w of room.walls) {
    const sides = [w.posSidedef, w.negSidedef].filter((n) => n > 0).map((n) => room.sidedefs[n - 1]);
    const part = (has: boolean, lo0: number, hi0: number, lo1: number, hi1: number) => {
      if (!has || (hi0 <= lo0 && hi1 <= lo1)) return;
      out.push(w.x0, w.y0, lo0, w.x1, w.y1, lo1, w.x1, w.y1, hi1);
      out.push(w.x0, w.y0, lo0, w.x1, w.y1, hi1, w.x0, w.y0, hi0);
    };
    part(sides.some((d) => d.belowType), w.z0, w.z1, w.zz0, w.zz1);
    part(sides.some((d) => d.normalType), w.z1, w.z2, w.zz1, w.zz2);
    part(sides.some((d) => d.aboveType), w.z2, w.z3, w.zz2, w.zz3);
  }
  return new Float32Array(out);
}

const run = <T>(steps: Generator<void, T>): T => {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
};

/**
 * The room by cells: the walls in each, and the highest thing in each that could stop a ray
 * (drawn walls, floors, roofs). A ray above its cell's height passes without looking closer.
 * The same for every sun; it yields after each row of cells.
 */
export function* heightGridSteps(room: Room, tris: Float32Array = wallCasters(room)): Generator<void, SunHeightGrid> {
  const { minX, minY, maxX, maxY } = extent(room);
  const empty = { top: new Float32Array(1), walls: [], tris, cols: 1, rows: 1, cell: MIN_CELL, highest: -Infinity, minX: 0, minY: 0 };
  if (!Number.isFinite(minX)) return empty;
  const CELL = Math.max(MIN_CELL, Math.ceil(Math.max(maxX - minX, maxY - minY) / MAX_CELLS));
  const cols = Math.ceil((maxX - minX) / CELL) + 1;
  const rows = Math.ceil((maxY - minY) / CELL) + 1;
  const top = new Float32Array(cols * rows).fill(-Infinity);
  const walls: (number[] | undefined)[] = new Array(cols * rows);
  const raise = (i: number, h: number) => {
    if (h > top[i]) top[i] = h;
  };
  for (let ti = 0; ti < tris.length / 9; ti++) {
    if (ti % 256 === 255) yield;
    const o = ti * 9;
    const x0 = Math.min(tris[o], tris[o + 3], tris[o + 6]),
      x1 = Math.max(tris[o], tris[o + 3], tris[o + 6]);
    const y0 = Math.min(tris[o + 1], tris[o + 4], tris[o + 7]),
      y1 = Math.max(tris[o + 1], tris[o + 4], tris[o + 7]);
    const high = Math.max(tris[o + 2], tris[o + 5], tris[o + 8]);
    for (let cy = Math.max(0, Math.floor((y0 - minY) / CELL)); cy <= Math.min(rows - 1, Math.floor((y1 - minY) / CELL)); cy++)
      for (let cx = Math.max(0, Math.floor((x0 - minX) / CELL)); cx <= Math.min(cols - 1, Math.floor((x1 - minX) / CELL)); cx++) {
        const i = cy * cols + cx;
        (walls[i] ??= []).push(ti);
        raise(i, high);
      }
  }
  yield;
  // Floors and roofs: what's at each cell's middle and corners
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++)
      for (const [fx, fy] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const x = minX + (cx + fx) * CELL,
          y = minY + (cy + fy) * CELL;
        const leaf = leafAt(room, x, y);
        if (!leaf?.sector) continue;
        const s = room.sectors[leaf.sector - 1];
        raise(cy * cols + cx, isSky(s) ? floorHeightAt(s, x, y) : ceilingHeightAt(s, x, y));
      }
    yield;
  }
  let highest = -Infinity;
  for (const h of top) if (Number.isFinite(h) && h > highest) highest = h;
  return { top, walls, tris, cols, rows, cell: CELL, highest, minX, minY };
}

/** Whether the step from (px, py, pz) to (qx, qy, qz) passes through wall triangle `ti` (Moller-Trumbore) */
function hitsWall(t: Float32Array, ti: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number): boolean {
  const o = ti * 9;
  const ax = t[o],
    ay = t[o + 1],
    az = t[o + 2];
  const e1x = t[o + 3] - ax,
    e1y = t[o + 4] - ay,
    e1z = t[o + 5] - az;
  const e2x = t[o + 6] - ax,
    e2y = t[o + 7] - ay,
    e2z = t[o + 8] - az;
  const dx = qx - px,
    dy = qy - py,
    dz = qz - pz;
  const hx = dy * e2z - dz * e2y,
    hy = dz * e2x - dx * e2z,
    hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-9) return false;
  const f = 1 / det;
  const sx = px - ax,
    sy = py - ay,
    sz = pz - az;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return false;
  const kx = sy * e1z - sz * e1y,
    ky = sz * e1x - sx * e1z,
    kz = sx * e1y - sy * e1x;
  const v = f * (dx * kx + dy * ky + dz * kz);
  if (v < 0 || u + v > 1) return false;
  const along = f * (e2x * kx + e2y * ky + e2z * kz);
  return along >= 0 && along <= 1;
}

/** The sun map for the sun in `dir` (client axes, x east, y south, z up; unit length). */
export function bakeSunMap(room: Room, dir: readonly [number, number, number], grid?: SunHeightGrid): SunMap {
  return run(bakeSunMapSteps(room, dir, grid ?? run(heightGridSteps(room))));
}

/** bakeSunMap a little at a time, over the room's grid: it yields every 128 texels and each row. */
export function* bakeSunMapSteps(room: Room, dir: readonly [number, number, number], grid: SunHeightGrid): Generator<void, SunMap> {
  const { minX, minY, maxX, maxY } = extent(room);
  if (!Number.isFinite(minX)) return { data: new Uint8Array(1), width: 1, height: 1, x0: 0, y0: 0, texel: TEXEL };
  const texel = Math.max(TEXEL, Math.ceil(Math.max(maxX - minX, maxY - minY) / MAX_SIZE));
  const width = Math.ceil((maxX - minX) / texel) + 1;
  const height = Math.ceil((maxY - minY) / texel) + 1;
  const data = new Uint8Array(width * height);
  const map: SunMap = { data, width, height, x0: minX, y0: minY, texel };
  if (dir[2] < MIN_SIN) return map;
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const px = minX + (tx + 0.5) * texel,
        py = minY + (ty + 0.5) * texel;
      const leaf = leafAt(room, px, py);
      if (!leaf?.sector) continue;
      const start = room.sectors[leaf.sector - 1];
      if (!isSky(start)) continue;
      if (sunRay(room, grid, px, py, start, dir) === null) data[ty * width + tx] = 255;
      if (tx % 128 === 127) yield;
    }
    yield;
  }
  return map;
}

/** How sunlit (0..1) the floor is at (x, y), from the map; 1 outside it */
export function sunMapAt(map: SunMap, x: number, y: number): number {
  const tx = Math.floor((x - map.x0) / map.texel),
    ty = Math.floor((y - map.y0) / map.texel);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 1;
  return map.data[ty * map.width + tx] / 255;
}

/**
 * Whether a ray from the floor at (px, py), in the sky sector `start`, reaches the sun in `dir`:
 * null if it does, else what stops it ("wall <index>", "floor", "roof").
 */
export function sunRay(room: Room, grid: SunHeightGrid, px: number, py: number, start: Sector, dir: readonly [number, number, number]): string | null {
  const horiz = Math.hypot(dir[0], dir[1]);
  // Per step along the ground: x, y and z
  const sx = horiz > 1e-6 ? (dir[0] / horiz) * STEP : 0,
    sy = horiz > 1e-6 ? (dir[1] / horiz) * STEP : 0;
  const sz = horiz > 1e-6 ? (dir[2] / horiz) * STEP : Infinity;
  const maxSteps = Math.ceil(REACH / STEP);
  let x = px,
    y = py,
    z = floorHeightAt(start, px, py) + LIFT;
  const CELL = grid.cell;
  let cell = Math.floor((py - grid.minY) / CELL) * grid.cols + Math.floor((px - grid.minX) / CELL);
  for (let k = 0; k < maxSteps && z <= grid.highest; k++) {
    const nx = x + sx,
      ny = y + sy,
      nz = z + sz;
    const cx = Math.floor((nx - grid.minX) / CELL),
      cy = Math.floor((ny - grid.minY) / CELL);
    // Out past the room's box: nothing more to stop it
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) break;
    const last = cell;
    cell = cy * grid.cols + cx;
    // Above everything in both cells the step touches (the sun is up: z rises)
    if (z > grid.top[cell] && z > grid.top[last]) {
      x = nx;
      y = ny;
      z = nz;
      continue;
    }
    for (const wi of grid.walls[cell] ?? []) if (hitsWall(grid.tris, wi, x, y, z, nx, ny, nz)) return `wall ${wi}`;
    if (last !== cell) for (const wi of grid.walls[last] ?? []) if (hitsWall(grid.tris, wi, x, y, z, nx, ny, nz)) return `wall ${wi}`;
    const at = leafAt(room, nx, ny);
    const s = at?.sector ? room.sectors[at.sector - 1] : null;
    // Below a floor, or rising through a roof from under it
    if (s && nz < floorHeightAt(s, nx, ny)) return "floor";
    if (s && !isSky(s)) {
      const c = ceilingHeightAt(s, nx, ny);
      if (z <= c && nz > c) return "roof";
    }
    x = nx;
    y = ny;
    z = nz;
  }
  return null;
}
