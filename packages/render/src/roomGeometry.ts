// Room geometry exactly as the original D3D client builds it
// (clientd3d/d3drender.c D3DGeometryBuildNew, D3DRenderWallExtract,
// D3DRenderFloorExtract, D3DRenderCeilingExtract).
//
// Output is renderer-agnostic: triangles batched per grid texture, in client fine
// coordinates (x east, y south, z up; 1024 per square). Texture coordinates (s, t)
// address the bitmap as stored in the .bgf (grid textures are stored transposed and
// the client's s/t already account for that), so u = s, v = t.
//
// Per vertex we also keep what the lighting needs (see lighting.ts):
//   light     the sector light byte (0..255) of the side being drawn
//   shade     a 2D surface normal (unit, client x/y) for sun shading, and whether it applies
//
// Triangles are wound counter-clockwise around the direction they face, in client
// coordinates (x east, y south, z up). Walls are one-sided per side, like the client
// (each side is its own quad with its own texture), floors face up, ceilings down.

import { FINENESS, WF, BT, SF, type Room, type Sector, type Wall, type Sidedef } from "@shards/formats";

export interface TextureInfo {
  width: number;
  height: number;
  shrink: number;
}

/** Texture animation of a batch (clientd3d/roomanim.c, bspload.c RoomSetup*Animation). */
export type TextureAnimation =
  | { kind: "cycle"; periodMs: number }
  | {
      kind: "scroll";
      /** ms per step */
      periodMs: number;
      /** step direction in the client's scroll offsets (roomanim.c RoomAnimateSingle) */
      dx: number;
      dy: number;
      surface: "wall" | "floor" | "ceiling";
      /** walls: the sidedef's WF_BACKWARDS flag flips the direction */
      backwards: boolean;
    };

export interface Batch {
  /** textureId plus animation, e.g. "1234" or "1234|scroll:wall:96:1:0:0" */
  key: string;
  textureId: number;
  animation: TextureAnimation | null;
  /**
   * The bitmap group to show, when the server picked one (BP_WALL_ANIMATE,
   * BP_SECTOR_ANIMATE: roomanim.c shows group % the texture's group count); null for
   * the first bitmap, or the batch's own animation.
   */
  group: number | null;
  /** x, y, z per vertex (client fine units) */
  positions: number[];
  /** s, t per vertex */
  uvs: number[];
  /** sector light 0..255 per vertex */
  lights: number[];
  /** nx, ny, shaded(0/1) per vertex */
  shade: number[];
  /** Wall batches can contain see-through texels (WF_TRANSPARENT / no-vtile). Informational. */
  transparent: boolean;
}

export interface RoomGeometry {
  batches: Map<string, Batch>;
  /** Sectors whose ceiling is open sky (ceiling texture 0). */
  skySectors: Set<number>;
}

const WallType = { Normal: 1, Below: 2, Above: 4 } as const;
type WallType = (typeof WallType)[keyof typeof WallType];

/** PETER_FUDGE in d3dtypes.h: vertical texture scale correction. */
const PETER_FUDGE = 16;

export function buildRoomGeometry(room: Room, textureInfo: (id: number) => TextureInfo | null): RoomGeometry {
  const batches = new Map<string, Batch>();
  const skySectors = new Set<number>();
  const batch = (id: number, animation: TextureAnimation | null = null, group: number | null = null): Batch => {
    const key = group !== null ? `${id}|g${group}` : animation ? `${id}|${Object.values(animation).join(":")}` : String(id);
    let b = batches.get(key);
    if (!b) batches.set(key, (b = { key, textureId: id, animation: group !== null ? null : animation, group, positions: [], uvs: [], lights: [], shade: [], transparent: false }));
    return b;
  };

  for (const node of room.nodes) {
    if (node.type === "internal") {
      for (const wi of node.walls) {
        const w = room.walls[wi];
        for (const type of [WallType.Normal, WallType.Below, WallType.Above]) {
          // The C test has an operator-precedence quirk: ((has && z0 differs) || z1 differs).
          // Each side is then only drawn if its own sidedef has that bitmap, so in effect:
          // draw when the section has height at either end.
          if (!sectionHasHeight(w, type)) continue;
          for (const side of [1, -1] as const) addWall(room, w, type, side, textureInfo, batch);
        }
      }
    } else {
      if (!node.sector || node.points.length < 3) continue;
      const s = room.sectors[node.sector - 1];
      addFlat(node.points, s, false, textureInfo, batch);
      if (s.ceilingType) addFlat(node.points, s, true, textureInfo, batch);
      else skySectors.add(node.sector);
    }
  }
  return { batches, skySectors };
}

function sectionHasHeight(w: Wall, type: WallType): boolean {
  const s16 = (v: number) => (v << 16) >> 16; // the (short) casts
  switch (type) {
    case WallType.Normal:
      return s16(w.z2) !== s16(w.z1) || s16(w.zz2) !== s16(w.zz1);
    case WallType.Below:
      return s16(w.z1) !== s16(w.z0) || s16(w.zz1) !== s16(w.zz0);
    case WallType.Above:
      return s16(w.z3) !== s16(w.z2) || s16(w.zz3) !== s16(w.zz2);
  }
}

// Scroll speeds (bsp.h, roomanim.h): 1 slow, 2 medium, 3 fast; 0 none.
const WALL_SCROLL_PERIOD = [0, 96, 32, 8];
const SECTOR_SCROLL_PERIOD = [0, 12, 6, 2];
// Directions N, NE, E, SE, S, SW, W, NW -> (dx, dy) per step (roomanim.c RoomAnimateSingle).
const SCROLL_DIR: [number, number][] = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];

function wallAnimation(sd: Sidedef): TextureAnimation | null {
  if (sd.animateSpeed) return { kind: "cycle", periodMs: Math.floor(10000 / sd.animateSpeed) };
  const speed = (sd.flags & 0xc00) >> 10;
  if (!speed) return null;
  const [dx, dy] = SCROLL_DIR[(sd.flags & 0x7000) >> 12];
  return { kind: "scroll", periodMs: WALL_SCROLL_PERIOD[speed], dx, dy, surface: "wall", backwards: (sd.flags & WF.BACKWARDS) !== 0 };
}

function sectorAnimation(s: Sector, ceiling: boolean): TextureAnimation | null {
  if (s.animateSpeed) return { kind: "cycle", periodMs: Math.floor(10000 / s.animateSpeed) };
  const speed = (s.flags & 0xc) >> 2;
  if (!speed || !(s.flags & (ceiling ? SF.SCROLL_CEILING : SF.SCROLL_FLOOR))) return null;
  const [dx, dy] = SCROLL_DIR[(s.flags & 0x70) >> 4];
  return { kind: "scroll", periodMs: SECTOR_SCROLL_PERIOD[speed], dx, dy, surface: ceiling ? "ceiling" : "floor", backwards: false };
}

function textureOf(sd: Sidedef, type: WallType): number {
  return type === WallType.Normal ? sd.normalType : type === WallType.Below ? sd.belowType : sd.aboveType;
}

/** D3DRenderWallExtract for one side of one wall section. */
function addWall(
  room: Room,
  w: Wall,
  type: WallType,
  side: 1 | -1,
  textureInfo: (id: number) => TextureInfo | null,
  batch: (id: number, animation?: TextureAnimation | null, group?: number | null) => Batch,
): void {
  const sdNum = side > 0 ? w.posSidedef : w.negSidedef;
  if (!sdNum) return;
  const sd = room.sidedefs[sdNum - 1];
  const texId = textureOf(sd, type);
  if (!texId) return;
  const dib = textureInfo(texId);
  if (!dib) return;

  const secNum = side > 0 ? w.posSector : w.negSector;
  const light = secNum ? room.sectors[secNum - 1].light : 0;
  const xOffset = side > 0 ? w.posXOffset : w.negXOffset;
  let yOffset = side > 0 ? w.posYOffset : w.negYOffset;

  // Corners: 0 = top at the side's start, 1 = bottom at start, 2 = bottom at end, 3 = top at end.
  const X = [0, 0, 0, 0],
    Y = [0, 0, 0, 0],
    Z = [0, 0, 0, 0];
  let topDown: boolean;
  if (side > 0) {
    X[0] = X[1] = w.x0;
    X[2] = X[3] = w.x1;
    Y[0] = Y[1] = w.y0;
    Y[2] = Y[3] = w.y1;
    if (type === WallType.Normal) {
      Z[0] = w.z2; Z[3] = w.zz2; Z[1] = w.z1; Z[2] = w.zz1;
      topDown = (sd.flags & WF.NORMAL_TOPDOWN) !== 0;
    } else if (type === WallType.Below) {
      if (w.bowtie & (BT.BELOW_POS | BT.BELOW_NEG)) {
        Z[0] = w.z1Neg; Z[3] = w.zz1Neg;
      } else {
        Z[0] = w.z1; Z[3] = w.zz1;
      }
      Z[1] = w.z0; Z[2] = w.zz0;
      topDown = (sd.flags & WF.BELOW_TOPDOWN) !== 0;
    } else {
      Z[0] = w.z3; Z[3] = w.zz3; Z[1] = w.z2; Z[2] = w.zz2;
      topDown = (sd.flags & WF.ABOVE_BOTTOMUP) === 0;
    }
  } else {
    X[0] = X[1] = w.x1;
    X[2] = X[3] = w.x0;
    Y[0] = Y[1] = w.y1;
    Y[2] = Y[3] = w.y0;
    if (type === WallType.Normal) {
      Z[0] = w.zz2; Z[3] = w.z2; Z[1] = w.zz1; Z[2] = w.z1;
      topDown = (sd.flags & WF.NORMAL_TOPDOWN) !== 0;
    } else if (type === WallType.Below) {
      Z[0] = w.zz1; Z[3] = w.z1; Z[1] = w.zz0; Z[2] = w.z0;
      topDown = (sd.flags & WF.BELOW_TOPDOWN) !== 0;
    } else {
      Z[0] = w.zz3; Z[3] = w.z3; Z[1] = w.zz2; Z[2] = w.z2;
      topDown = (sd.flags & WF.ABOVE_BOTTOMUP) === 0;
    }
  }

  const noVTile = type === WallType.Normal && (sd.flags & WF.NO_VTILE) !== 0;
  const S = [0, 0, 0, 0],
    T = [0, 0, 0, 0];
  yOffset = (yOffset << 16) >> 16; // "force a wraparound"
  const { width, height, shrink } = dib;
  const invW = 1 / width,
    invH = 1 / height;
  const invWF = 1 / (width * PETER_FUDGE);

  T[0] = T[1] = xOffset * shrink * invH;
  T[3] = T[0] + w.length * shrink * invH;
  T[2] = T[1] + w.length * shrink * invH;

  const F = FINENESS;
  const floorTo = (v: number) => v & ~(F - 1);
  const ceilTo = (v: number) => (v + F - 1) & ~(F - 1);
  if (!topDown) {
    const bottom = Z[1] === Z[2] ? Z[1] : floorTo(Math.min(Z[1], Z[2]));
    S[1] = S[2] = 1 - yOffset * shrink * invW;
    if (Z[1] !== Z[2]) {
      S[1] -= (Z[1] - bottom) * shrink * invWF;
      S[2] -= (Z[2] - bottom) * shrink * invWF;
    }
    S[0] = S[1] - (Z[0] - Z[1]) * shrink * invWF;
    S[3] = S[2] - (Z[3] - Z[2]) * shrink * invWF;
  } else {
    const top = Z[0] === Z[3] ? Z[0] : ceilTo(Math.max(Z[0], Z[3]));
    if (Z[0] === Z[3]) {
      S[0] = S[3] = 0;
    } else {
      S[0] = (top - Z[0]) * shrink * invWF;
      S[3] = (top - Z[3]) * shrink * invWF;
    }
    S[0] -= yOffset * shrink * invW;
    S[3] -= yOffset * shrink * invW;
    S[1] = S[0] + (Z[0] - Z[1]) * shrink * invWF;
    S[2] = S[3] + (Z[3] - Z[2]) * shrink * invWF;
  }

  // (Scrolling walls, ANIMATE_SCROLL, are animated later by offsetting s/t.)

  if (sd.flags & WF.BACKWARDS) {
    [T[0], T[3]] = [T[3], T[0]];
    [T[1], T[2]] = [T[2], T[1]];
  }

  if (noVTile) {
    if (S[0] < 0) {
      const tex = S[1] - S[0] || 1;
      Z[0] -= (Z[0] - Z[1]) * (-S[0] / tex);
      S[0] = 0;
    }
    if (S[3] < 0) {
      const tex = S[2] - S[3] || 1;
      Z[3] -= (Z[3] - Z[2]) * (-S[3] / tex);
      S[3] = 0;
    }
    Z[1] -= 16;
    Z[2] -= 16;
  }

  S[0] += invW;
  S[3] += invW;
  S[1] -= invW;
  S[2] -= invW;

  if (Z[0] === Z[1] && Z[3] === Z[2]) return;

  // Surface normal of this side: the separator, negated for the negative side.
  const nx = (w.separator.a / FINENESS) * side;
  const ny = (w.separator.b / FINENESS) * side;
  const b = batch(texId, wallAnimation(sd), sd.group ?? null);
  if (noVTile || sd.flags & WF.TRANSPARENT) b.transparent = true;
  const vert = (i: number): Vert => ({ x: X[i], y: Y[i], z: Z[i], s: S[i], t: T[i] });
  pushTri(b, vert(0), vert(1), vert(2), [nx, ny, 0], light, nx, ny, 1);
  pushTri(b, vert(0), vert(2), vert(3), [nx, ny, 0], light, nx, ny, 1);
}

/** D3DRenderFloorExtract / D3DRenderCeilingExtract (flat; sloped planes use the plane height). */
function addFlat(
  points: { x: number; y: number }[],
  s: Sector,
  ceiling: boolean,
  textureInfo: (id: number) => TextureInfo | null,
  batch: (id: number, animation?: TextureAnimation | null, group?: number | null) => Batch,
): void {
  const texId = ceiling ? s.ceilingType : s.floorType;
  if (!texId || !textureInfo(texId)) return;
  const slope = ceiling ? s.slopedCeiling : s.slopedFloor;
  // Texture origin: min(0, min x/y of the polygon), like the C code (left = top = 0 first).
  let left = 0,
    top = 0;
  if (slope && !ceiling) {
    left = slope.p0.x;
    top = slope.p0.y;
  } else {
    for (const p of points) {
      if (p.x < left) left = p.x;
      if (p.y < top) top = p.y;
    }
  }
  const z = (x: number, y: number) =>
    slope ? (-slope.a * x - slope.b * y - slope.d) / slope.c : ceiling ? s.ceilingHeight : s.floorHeight;
  const inv = 1 / FINENESS;
  // Sun shading only applies to sloped planes (flat floors/ceilings use FINENESS).
  let nx = 0,
    ny = 0,
    shaded = 0;
  if (slope) {
    const len = Math.hypot(slope.a, slope.b, slope.c) || 1;
    nx = slope.a / len;
    ny = slope.b / len;
    shaded = 1;
  }
  const b = batch(texId, sectorAnimation(s, ceiling), s.group ?? null);
  const v = points.map((p) => {
    const pz = z(p.x, p.y);
    if (slope) {
      const [ss, tt] = slopeST(slope, p.x, p.y, pz, s, ceiling);
      return { x: p.x, y: p.y, z: pz, s: ss * inv, t: tt * inv };
    }
    return { x: p.x, y: p.y, z: pz, s: (Math.abs(p.x - left) - s.tx) * inv, t: (Math.abs(p.y - top) - s.ty) * inv };
  });
  const facing: [number, number, number] = ceiling ? [0, 0, -1] : [0, 0, 1];
  for (let i = 1; i < v.length - 1; i++) pushTri(b, v[0], v[i], v[i + 1], facing, s.light, nx, ny, shaded);
}

/**
 * d3drender.c D3DRenderFloorExtract / D3DRenderCeilingExtract for a sloped plane: the
 * texture runs along the slope's own axes (p0 -> p1 and p0 -> p2, turned by its texture
 * angle). s is the distance from the line p0-p2, t from the line p0-p1, signed by which
 * side the point is on, plus half the sector's texture offset.
 */
function slopeST(
  slope: NonNullable<Sector["slopedFloor"]>,
  x: number,
  y: number,
  z: number,
  s: Sector,
  ceiling: boolean,
): [number, number] {
  const { p0, p1, p2 } = slope;
  // Distance from the point to the line p0 + U (q - p0)
  const lineDistance = (q: { x: number; y: number; z: number }) => {
    let temp = (q.x - p0.x) ** 2 + (q.z - p0.z) ** 2 + (q.y - p0.y) ** 2;
    if (temp === 0) temp = 1;
    const u = ((x - p0.x) * (q.x - p0.x) + (z - p0.z) * (q.z - p0.z) + (y - p0.y) * (q.y - p0.y)) / temp;
    return Math.hypot(x - (p0.x + u * (q.x - p0.x)), z - (p0.z + u * (q.z - p0.z)), y - (p0.y + u * (q.y - p0.y)));
  };
  let tt = lineDistance(p1);
  let ss = lineDistance(p2);
  if (!ceiling) {
    tt += s.ty / 2;
    ss += s.tx / 2;
  }
  // Which side of each axis the point is on (in the x/y plane)
  const unit = (dx: number, dy: number) => {
    const d = Math.hypot(dx, dy) || 1;
    return [dx / d, dy / d];
  };
  const [ux, uy] = unit(p1.x - p0.x, p1.y - p0.y);
  const [vx, vy] = unit(p2.x - p0.x, p2.y - p0.y);
  const [px, py] = unit(x - p0.x, y - p0.y);
  const du = px * ux + py * uy;
  if (ceiling ? du < 0 : du <= 0) ss = -ss;
  if (px * vx + py * vy > 0) tt = -tt;
  if (ceiling) {
    tt -= s.ty / 2;
    ss -= s.tx / 2;
  }
  return [ss, tt];
}

interface Vert {
  x: number;
  y: number;
  z: number;
  s: number;
  t: number;
}

/** Append a triangle wound counter-clockwise around `facing`; degenerate ones are dropped. */
function pushTri(
  b: Batch,
  p0: Vert,
  p1: Vert,
  p2: Vert,
  facing: [number, number, number],
  light: number,
  nx: number,
  ny: number,
  shaded: number,
): void {
  const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
  const bx = p2.x - p0.x, by = p2.y - p0.y, bz = p2.z - p0.z;
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const dot = cx * facing[0] + cy * facing[1] + cz * facing[2];
  if (Math.abs(cx) + Math.abs(cy) + Math.abs(cz) < 1e-6) return;
  const tri = dot >= 0 ? [p0, p1, p2] : [p0, p2, p1];
  for (const p of tri) {
    b.positions.push(p.x, p.y, p.z);
    b.uvs.push(p.s, p.t);
    b.lights.push(light);
    b.shade.push(nx, ny, shaded);
  }
}
