// Ours: where people can walk in a room, for the ambient townsfolk (ambient/). The original
// client never walks anything itself, and blakserv has no path finding to port (roofile.c is
// BSP only), so this is our own: a grid of half squares over the room, a cell walkable when it
// stands on a dry floor with headroom, clear of walls a person can't pass, and linked to its eight
// neighbours when no such wall lies between them. A* finds a path over it, and the path is pulled
// tight so walkers go straight where they can.
//
// Walls block the way move.c IntersectNode decides (a high step, a low ceiling, or a wall not
// WF_PASSABLE), judged once per wall and side here, so a query is a few segment tests against
// the walls bucketed near it instead of a walk down the BSP tree.

import { FINENESS, SF, WF, ceilingHeightAt, floorHeightAt, leafAt, type Room, type Wall } from "@shards/formats";

/**
 * Cell size in fine units: half a square. Cell centres are on the squares' corners and centres
 * (multiples of half a square), so a corridor or door a square wide has a row of cells down its
 * middle.
 */
export const NAV_CELL = FINENESS / 2;
/** How far a cell's centre keeps from a blocking wall, and a path from one (fine units): about
 * move.c's half a player's width, so a player could walk every path too */
const CELL_CLEARANCE = 280;
const PATH_CLEARANCE = 260;
/** From a point off the grid's centres (a door) to the cell next to it: just no wall between */
const REACH_CLEARANCE = 64;
/** move.c MAX_STEP_HEIGHT and game.c player.height */
const MAX_STEP_HEIGHT = 24 * 16;
const PLAYER_HEIGHT = (3 * FINENESS) / 4;
const BUCKET = FINENESS;

/** Neighbour offsets, by link bit: E, SE, S, SW, W, NW, N, NE */
const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

interface Blocker {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Plane through the wall (a x + b y + c > 0 on its positive side) */
  a: number;
  b: number;
  c: number;
  /** Whether it stops someone coming from the positive or negative side */
  fromPos: boolean;
  fromNeg: boolean;
}

export interface NavGrid {
  cols: number;
  rows: number;
  /** 1 where a person can stand */
  walk: Uint8Array;
  /** Bit d set: the way to neighbour DIRS[d] is open */
  links: Uint8Array;
  /** Connected area each walkable cell belongs to (0 for none); larger areas first */
  area: Uint16Array;
  /** 1 where something stands in the way for now (set by the user: real objects that block) */
  closed: Uint8Array;
  /** Walls that stop walkers, bucketed by square */
  readonly blockers: Blocker[];
  readonly buckets: Map<number, number[]>;
  readonly bucketCols: number;
}

export interface NavPoint {
  x: number;
  y: number;
}

const depthOf = (room: Room, sector: number) => (sector ? room.sectors[sector - 1].flags & SF.DEPTH_MASK : 0);

/** Whether a wall stops a person coming from one side: move.c IntersectNode's test, at that side's floor */
function blocksFrom(room: Room, w: Wall, pos: boolean): boolean {
  const sdNum = pos ? w.posSidedef : w.negSidedef;
  const own = pos ? w.posSector : w.negSector;
  const other = pos ? w.negSector : w.posSector;
  // Into the void, or out of it
  if (!own || !other) return true;
  if (!sdNum) return false;
  const sd = room.sidedefs[sdNum - 1];
  const ownSector = room.sectors[own - 1];
  const mx = (w.x0 + w.x1) / 2,
    my = (w.y0 + w.y1) / 2;
  const z = floorHeightAt(ownSector, mx, my);
  const belowHeight = depthOf(room, other) ? (FINENESS / 5) * depthOf(room, other) : 0;
  const stepTop = Math.max(w.z1, w.zz1);
  const lowCeiling = Math.min(w.z2, w.zz2);
  const passable =
    (!sd.belowType || stepTop - belowHeight - z <= MAX_STEP_HEIGHT) && (!sd.aboveType || lowCeiling - z >= PLAYER_HEIGHT) && (sd.flags & WF.PASSABLE) !== 0;
  return !passable;
}

/** Distance from a point to a segment, squared */
function pointSegment2(px: number, py: number, b: Blocker): number {
  const dx = b.x1 - b.x0,
    dy = b.y1 - b.y0;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - b.x0) * dx + (py - b.y0) * dy) / len2));
  const ex = b.x0 + t * dx - px,
    ey = b.y0 + t * dy - py;
  return ex * ex + ey * ey;
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, b: Blocker): boolean {
  const d = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = d(b.x0, b.y0, b.x1, b.y1, ax, ay),
    d2 = d(b.x0, b.y0, b.x1, b.y1, bx, by);
  const d3 = d(ax, ay, bx, by, b.x0, b.y0),
    d4 = d(ax, ay, bx, by, b.x1, b.y1);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Distance between two segments, squared (0 when they cross) */
function segmentSegment2(ax: number, ay: number, bx: number, by: number, b: Blocker): number {
  if (segmentsCross(ax, ay, bx, by, b)) return 0;
  const s: Blocker = { ...b, x0: ax, y0: ay, x1: bx, y1: by };
  return Math.min(pointSegment2(ax, ay, b), pointSegment2(bx, by, b), pointSegment2(b.x0, b.y0, s), pointSegment2(b.x1, b.y1, s));
}

function blockersNear(g: Pick<NavGrid, "buckets" | "bucketCols">, x0: number, y0: number, x1: number, y1: number, pad: number, out: Set<number>): void {
  const bx0 = Math.floor((Math.min(x0, x1) - pad) / BUCKET),
    bx1 = Math.floor((Math.max(x0, x1) + pad) / BUCKET);
  const by0 = Math.floor((Math.min(y0, y1) - pad) / BUCKET),
    by1 = Math.floor((Math.max(y0, y1) + pad) / BUCKET);
  for (let by = by0; by <= by1; by++)
    for (let bx = bx0; bx <= bx1; bx++) {
      const list = g.buckets.get(by * g.bucketCols + bx);
      if (list) for (const i of list) out.add(i);
    }
}

/**
 * Whether a person can walk straight from a to b: no wall that stops them in between (judged
 * from the side they come from), and none closer than `clearance`.
 */
export function walkable(g: NavGrid, ax: number, ay: number, bx: number, by: number, clearance = PATH_CLEARANCE): boolean {
  const near = new Set<number>();
  blockersNear(g, ax, ay, bx, by, clearance, near);
  const c2 = clearance * clearance;
  for (const i of near) {
    const b = g.blockers[i];
    const side = b.a * ax + b.b * ay + b.c;
    // A wall that only stops people from the other side (a drop down) lets us through
    if (segmentsCross(ax, ay, bx, by, b)) {
      if (side > 0 ? b.fromPos : b.fromNeg) return false;
      continue;
    }
    const blocks = side > 0 ? b.fromPos : b.fromNeg;
    if (blocks && segmentSegment2(ax, ay, bx, by, b) < c2) return false;
  }
  return true;
}

/** Whether a cell can be walked now */
export function isOpen(g: NavGrid, cell: number): boolean {
  return cell >= 0 && g.walk[cell] === 1 && g.closed[cell] === 0;
}

/** Cell centre in fine units */
export function cellCentre(g: NavGrid, cell: number): NavPoint {
  return { x: (cell % g.cols) * NAV_CELL, y: Math.floor(cell / g.cols) * NAV_CELL };
}

/** The cell a point falls in, or -1 off the grid */
export function cellAt(g: NavGrid, x: number, y: number): number {
  const c = Math.floor(x / NAV_CELL + 0.5),
    r = Math.floor(y / NAV_CELL + 0.5);
  return c < 0 || r < 0 || c >= g.cols || r >= g.rows ? -1 : r * g.cols + c;
}

/**
 * Build the grid a few rows at a time: each `next()` does some work, and the last returns the
 * grid. `buildNavGrid` runs it to the end at once.
 */
/**
 * A room's grid with no cells walkable yet, and its blocking walls indexed: enough for
 * `walkable` (ambient critters, which go straight and need no paths)
 */
export function navWalls(room: Room): NavGrid {
  const cols = Math.max(1, Math.ceil(room.thingsBox.maxX / NAV_CELL) + 1);
  const rows = Math.max(1, Math.ceil(room.thingsBox.maxY / NAV_CELL) + 1);
  const blockers: Blocker[] = [];
  for (const w of room.walls) {
    const fromPos = blocksFrom(room, w, true),
      fromNeg = blocksFrom(room, w, false);
    if (!fromPos && !fromNeg) continue;
    blockers.push({ x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, a: w.separator.a, b: w.separator.b, c: w.separator.c, fromPos, fromNeg });
  }
  const bucketCols = Math.ceil(room.thingsBox.maxX / BUCKET) + 2;
  const buckets = new Map<number, number[]>();
  const pad = CELL_CLEARANCE;
  blockers.forEach((b, i) => {
    for (let by = Math.floor((Math.min(b.y0, b.y1) - pad) / BUCKET); by <= Math.floor((Math.max(b.y0, b.y1) + pad) / BUCKET); by++)
      for (let bx = Math.floor((Math.min(b.x0, b.x1) - pad) / BUCKET); bx <= Math.floor((Math.max(b.x0, b.x1) + pad) / BUCKET); bx++) {
        const key = by * bucketCols + bx;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(i);
      }
  });
  const n = cols * rows;
  return { cols, rows, walk: new Uint8Array(n), links: new Uint8Array(n), area: new Uint16Array(n), closed: new Uint8Array(n), blockers, buckets, bucketCols };
}

/**
 * @param waterTextures floor textures that are water though their sector has no depth (Raza's
 *   pool): no one walks there either
 */
export function* navGridBuilder(room: Room, rowsPerStep = 8, waterTextures: ReadonlySet<number> = new Set()): Generator<void, NavGrid> {
  const g = navWalls(room);
  const { cols, rows, blockers } = g;
  /** The floor height at each cell's centre */
  const floors = new Float32Array(cols * rows);

  // Cells: on a dry floor with headroom, clear of walls
  const near = new Set<number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const { x, y } = cellCentre(g, i);
      const leaf = leafAt(room, x, y);
      if (!leaf?.sector) continue;
      const s = room.sectors[leaf.sector - 1];
      if (s.flags & SF.DEPTH_MASK || waterTextures.has(s.floorType)) continue;
      const floor = floorHeightAt(s, x, y);
      if (ceilingHeightAt(s, x, y) - floor < PLAYER_HEIGHT) continue;
      near.clear();
      blockersNear(g, x, y, x, y, CELL_CLEARANCE, near);
      let clear = true;
      for (const bi of near)
        if (pointSegment2(x, y, blockers[bi]) < CELL_CLEARANCE * CELL_CLEARANCE) {
          clear = false;
          break;
        }
      if (!clear) continue;
      g.walk[i] = 1;
      floors[i] = floor;
    }
    if (r % rowsPerStep === rowsPerStep - 1) yield;
  }

  // Links, each way checked once (E, SE, S, SW) and mirrored
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!g.walk[i]) continue;
      const a = cellCentre(g, i);
      for (let d = 0; d < 4; d++) {
        const [dc, dr] = DIRS[d];
        const nc = c + dc,
          nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (!g.walk[j] || Math.abs(floors[i] - floors[j]) > MAX_STEP_HEIGHT) continue;
        const b = cellCentre(g, j);
        const there = walkable(g, a.x, a.y, b.x, b.y);
        const back = walkable(g, b.x, b.y, a.x, a.y);
        if (there) g.links[i] |= 1 << d;
        if (back) g.links[j] |= 1 << (d + 4);
      }
    }
    if (r % rowsPerStep === rowsPerStep - 1) yield;
  }
  yield;
  // No cutting corners: a diagonal needs both sides open
  for (let i = 0; i < cols * rows; i++) {
    const l = g.links[i];
    if (!l) continue;
    let out = l;
    for (const d of [1, 3, 5, 7]) if (l & (1 << d) && (!(l & (1 << (d - 1))) || !(l & (1 << ((d + 1) & 7))))) out &= ~(1 << d);
    g.links[i] = out;
  }
  yield;
  labelAreas(g);
  return g;
}

export function buildNavGrid(room: Room, waterTextures?: ReadonlySet<number>): NavGrid {
  const it = navGridBuilder(room, 1 << 30, waterTextures);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * A built grid as bytes, so the asset build can make it once for everyone (nav/<room>.nav):
 * "NAVG", the format version, the room file's checksum (Room.security), columns and rows (u16),
 * then the walkable cells (a bit each) and each cell's links (a byte each). The walls are indexed
 * again from the room when it's read.
 */
export const NAV_FORMAT = 2;
const NAV_MAGIC = [0x4e, 0x41, 0x56, 0x47];

export function encodeNavGrid(g: NavGrid, room: Room): Uint8Array {
  const n = g.cols * g.rows;
  const out = new Uint8Array(16 + Math.ceil(n / 8) + n);
  const dv = new DataView(out.buffer);
  out.set(NAV_MAGIC, 0);
  dv.setUint32(4, NAV_FORMAT, true);
  dv.setUint32(8, room.security >>> 0, true);
  dv.setUint16(12, g.cols, true);
  dv.setUint16(14, g.rows, true);
  for (let i = 0; i < n; i++) if (g.walk[i]) out[16 + (i >> 3)] |= 1 << (i & 7);
  out.set(g.links, 16 + Math.ceil(n / 8));
  return out;
}

/**
 * A grid from `encodeNavGrid`'s bytes, or null when they're for another room, another version of
 * this one (its checksum differs) or an older format: then build it instead.
 */
export function decodeNavGrid(bytes: Uint8Array, room: Room): NavGrid | null {
  if (bytes.length < 16 || NAV_MAGIC.some((m, k) => bytes[k] !== m)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(4, true) !== NAV_FORMAT || dv.getUint32(8, true) !== room.security >>> 0) return null;
  const g = navWalls(room);
  const n = g.cols * g.rows;
  if (dv.getUint16(12, true) !== g.cols || dv.getUint16(14, true) !== g.rows || bytes.length !== 16 + Math.ceil(n / 8) + n) return null;
  for (let i = 0; i < n; i++) g.walk[i] = (bytes[16 + (i >> 3)] >> (i & 7)) & 1;
  g.links.set(bytes.subarray(16 + Math.ceil(n / 8)));
  labelAreas(g);
  return g;
}

/** Connected areas (two-way links only), numbered largest first */
function labelAreas(g: NavGrid): void {
  const label = new Int32Array(g.cols * g.rows).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < label.length; s++) {
    if (!g.walk[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      for (let d = 0; d < 8; d++) {
        if (!(g.links[i] & (1 << d))) continue;
        const j = i + DIRS[d][1] * g.cols + DIRS[d][0];
        if (label[j] < 0 && g.links[j] & (1 << ((d + 4) & 7))) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  const order = sizes.map((n, id) => ({ n, id })).sort((a, b) => b.n - a.n);
  const rank = new Map(order.map((o, k) => [o.id, k + 1]));
  for (let i = 0; i < label.length; i++) g.area[i] = label[i] >= 0 ? Math.min(65535, rank.get(label[i])!) : 0;
}

/**
 * The walkable cell nearest a point (within `maxCells`), in the given area (0: any), that can be
 * reached from the point in a straight line, no wall between (or, with `reachable` false, the
 * nearest whatever is between); -1 if none
 */
export function nearestCell(g: NavGrid, x: number, y: number, maxCells = 4, area = 0, reachable = true): number {
  const c0 = Math.floor(x / NAV_CELL + 0.5),
    r0 = Math.floor(y / NAV_CELL + 0.5);
  const found: { i: number; d: number }[] = [];
  for (let r = r0 - maxCells; r <= r0 + maxCells; r++)
    for (let c = c0 - maxCells; c <= c0 + maxCells; c++) {
      if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
      const i = r * g.cols + c;
      if (!isOpen(g, i) || (area && g.area[i] !== area)) continue;
      const p = cellCentre(g, i);
      found.push({ i, d: Math.hypot(p.x - x, p.y - y) });
    }
  found.sort((a, b) => a.d - b.d);
  if (!reachable) return found[0]?.i ?? -1;
  for (const f of found) {
    const p = cellCentre(g, f.i);
    if (f.d < 1 || walkable(g, x, y, p.x, p.y, REACH_CLEARANCE)) return f.i;
  }
  return -1;
}

/** A random walkable cell in an area (0: any), or -1 */
export function randomCell(g: NavGrid, rand: () => number, area = 0, tries = 200): number {
  const n = g.cols * g.rows;
  for (let k = 0; k < tries; k++) {
    const i = Math.floor(rand() * n);
    if (isOpen(g, i) && (!area || g.area[i] === area)) return i;
  }
  return -1;
}

/** A* over the grid from one cell to another: the cells on the way (both ends included), or null */
export function findCells(g: NavGrid, from: number, to: number, maxVisits = 40000): number[] | null {
  if (!isOpen(g, from) || !isOpen(g, to)) return null;
  if (from === to) return [from];
  const n = g.cols * g.rows;
  const cost = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tc = to % g.cols,
    tr = Math.floor(to / g.cols);
  const h = (i: number) => {
    const dx = Math.abs((i % g.cols) - tc),
      dy = Math.abs(Math.floor(i / g.cols) - tr);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  // Binary heap of [f, cell]
  const heap: number[] = [];
  const push = (f: number, i: number) => {
    heap.push(f, i);
    let k = heap.length / 2 - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[2 * p] <= heap[2 * k]) break;
      [heap[2 * p], heap[2 * k]] = [heap[2 * k], heap[2 * p]];
      [heap[2 * p + 1], heap[2 * k + 1]] = [heap[2 * k + 1], heap[2 * p + 1]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[1];
    const lastF = heap[heap.length - 2],
      lastI = heap[heap.length - 1];
    heap.length -= 2;
    if (heap.length) {
      heap[0] = lastF;
      heap[1] = lastI;
      let k = 0;
      const size = heap.length / 2;
      for (;;) {
        const l = 2 * k + 1,
          r = l + 1;
        let m = k;
        if (l < size && heap[2 * l] < heap[2 * m]) m = l;
        if (r < size && heap[2 * r] < heap[2 * m]) m = r;
        if (m === k) break;
        [heap[2 * m], heap[2 * k]] = [heap[2 * k], heap[2 * m]];
        [heap[2 * m + 1], heap[2 * k + 1]] = [heap[2 * k + 1], heap[2 * m + 1]];
        k = m;
      }
    }
    return top;
  };
  cost[from] = 0;
  push(h(from), from);
  let visits = 0;
  while (heap.length) {
    const i = pop();
    if (closed[i]) continue;
    if (i === to) break;
    closed[i] = 1;
    if (++visits > maxVisits) return null;
    const l = g.links[i];
    for (let d = 0; d < 8; d++) {
      if (!(l & (1 << d))) continue;
      const j = i + DIRS[d][1] * g.cols + DIRS[d][0];
      if (closed[j] || g.closed[j]) continue;
      const c = cost[i] + (d & 1 ? Math.SQRT2 : 1);
      if (c < cost[j]) {
        cost[j] = c;
        prev[j] = i;
        push(c + h(j), j);
      }
    }
  }
  if (prev[to] < 0) return null;
  const out = [to];
  for (let i = prev[to]; i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

/** Whether every cell along a straight line is walkable and the line clears the walls */
function lineClear(g: NavGrid, a: NavPoint, b: NavPoint): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (NAV_CELL / 3));
  for (let k = 1; k < steps; k++) {
    const i = cellAt(g, a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
    if (!isOpen(g, i)) return false;
  }
  return walkable(g, a.x, a.y, b.x, b.y);
}

/**
 * A path between two points (fine units), as the points to walk through after `from`, or null
 * when there's none. The grid's path is pulled tight: corners are kept only where a straight
 * line won't do.
 */
export function findPath(g: NavGrid, from: NavPoint, to: NavPoint): NavPoint[] | null {
  const a = nearestCell(g, from.x, from.y);
  const area = a >= 0 ? g.area[a] : 0;
  const b = nearestCell(g, to.x, to.y, 4, area);
  const cells = findCells(g, a, b);
  if (!cells) return null;
  const pts = [from, ...cells.slice(1, -1).map((i) => cellCentre(g, i)), cells.length > 1 ? cellCentre(g, b) : from];
  if (Math.hypot(to.x - pts[pts.length - 1].x, to.y - pts[pts.length - 1].y) > 1 && lineClear(g, pts[pts.length - 1], to)) pts.push(to);
  const out: NavPoint[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    // Look ahead a few dozen points at most: a long path costs no more than that
    let j = Math.min(pts.length - 1, i + 40);
    while (j > i + 1 && !lineClear(g, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
