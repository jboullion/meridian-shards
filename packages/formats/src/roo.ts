// .roo room files, read the way the original client reads them
// (clientd3d/bspload.c BSPRooFileLoad, LoadNodes/Walls/Sidedefs/Sectors/Things,
// SetWallHeights; drawbsp.c GetFloorHeight/GetCeilingHeight).
//
// Client coordinates: "fine" units, FINENESS = 1024 per grid square.
// x grows east, y grows south (rows), z is height. Kod coordinates (64 per square,
// 1-based) map as x = (col - 1) * 1024 + fineCol * 16, likewise for y.

export const FINENESS = 1024;
const ROO_MAGIC = [0x52, 0x4f, 0x4f, 0xb1];
const ROO_VERSION = 14; // the client accepts >= this (bspload.c checks room_version < ROO_VERSION)
const SECURITY_XOR = 0x89ab786c;

/** Sector flags (clientd3d/bsp.h). */
export const SF = {
  DEPTH0: 0x0,
  DEPTH_MASK: 0x3,
  SCROLL_FLOOR: 0x80,
  SCROLL_CEILING: 0x100,
  FLICKER: 0x200,
  SLOPED_FLOOR: 0x400,
  SLOPED_CEILING: 0x800,
} as const;

/** Sidedef (wall) flags (clientd3d/bsp.h WF_*). */
export const WF = {
  BACKWARDS: 0x1,
  TRANSPARENT: 0x2,
  PASSABLE: 0x4,
  MAP_NEVER: 0x8,
  MAP_ALWAYS: 0x10,
  NOLOOKTHROUGH: 0x20,
  ABOVE_BOTTOMUP: 0x40,
  BELOW_TOPDOWN: 0x80,
  NORMAL_TOPDOWN: 0x100,
  NO_VTILE: 0x200,
} as const;

/** Bowtie bits (bsp.h): a two-sided wall whose upper/lower edge crosses itself. */
export const BT = {
  BELOW_POS: 0x1,
  BELOW_NEG: 0x2,
  ABOVE_POS: 0x4,
  ABOVE_NEG: 0x8,
} as const;

export interface Slope {
  a: number;
  b: number;
  c: number;
  d: number;
  /** Texture origin (x, y from file; z from the plane). */
  p0: { x: number; y: number; z: number };
  /** Texture angle (client angle units, 4096 per circle). */
  angle: number;
}

export interface Sector {
  serverId: number;
  floorType: number;
  ceilingType: number;
  /** Texture origin in client fine units. */
  tx: number;
  ty: number;
  floorHeight: number;
  ceilingHeight: number;
  /** 0..255; > 127 means "affected by ambient light" (draw3d.c GetLightPaletteIndex). */
  light: number;
  flags: number;
  animateSpeed: number;
  slopedFloor: Slope | null;
  slopedCeiling: Slope | null;
}

export interface Sidedef {
  serverId: number;
  normalType: number;
  aboveType: number;
  belowType: number;
  flags: number;
  animateSpeed: number;
}

export interface Wall {
  posSidedef: number; // 1-based, 0 = none
  negSidedef: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  length: number;
  posXOffset: number; // signed 16-bit, Kod-ish texel units (see d3drender.c)
  negXOffset: number;
  posYOffset: number;
  negYOffset: number;
  posSector: number; // 1-based, 0 = none
  negSector: number;
  // Heights from SetWallHeights: z* at (x0, y0), zz* at (x1, y1).
  z0: number;
  z1: number;
  z2: number;
  z3: number;
  zz0: number;
  zz1: number;
  zz2: number;
  zz3: number;
  z0Neg: number;
  z1Neg: number;
  zz0Neg: number;
  zz1Neg: number;
  bowtie: number;
  /** Plane of the BSP node the wall lies in (normalised a, b to FINENESS). */
  separator: { a: number; b: number; c: number };
}

export interface BspInternal {
  type: "internal";
  bbox: [number, number, number, number];
  a: number;
  b: number;
  c: number;
  pos: number; // node index + 1, 0 = none
  neg: number;
  /** Indices (0-based) of the walls lying in this node's plane. */
  walls: number[];
}

export interface BspLeaf {
  type: "leaf";
  bbox: [number, number, number, number];
  sector: number; // 1-based
  points: { x: number; y: number }[];
}

export type BspNode = BspInternal | BspLeaf;

export interface Room {
  version: number;
  /** The checksum stored in the file; the server sends it in BP_PLAYER. */
  security: number;
  /** Whether the checksum recomputed while loading matches (the client refuses the room otherwise). */
  securityOk: boolean;
  width: number;
  height: number;
  rows: number;
  cols: number;
  nodes: BspNode[];
  walls: Wall[];
  sidedefs: Sidedef[];
  sectors: Sector[];
  /** Room grid box (things box), translated so its minimum is (0, 0); client fine units. */
  thingsBox: { maxX: number; maxY: number };
}

class Reader {
  readonly dv: DataView;
  pos = 0;
  constructor(data: Uint8Array) {
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u8() {
    return this.dv.getUint8(this.pos++);
  }
  u16() {
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16() {
    const v = this.dv.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32() {
    const v = this.dv.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32() {
    const v = this.dv.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
}

/** Client angle tables: 4096 units per circle (trig.c COS/SIN return FINENESS-scaled values). */
const angleRad = (a: number) => (a * 2 * Math.PI) / 4096;

export function parseRoo(data: Uint8Array): Room {
  const r = new Reader(data);
  for (let i = 0; i < 4; i++) if (r.u8() !== ROO_MAGIC[i]) throw new Error("not a .roo file");
  const version = r.i32();
  if (version < ROO_VERSION) throw new Error(`.roo version ${version} too old`);
  let security = version;
  const storedSecurity = r.i32();
  r.pos = r.i32(); // main section
  const width = r.i32();
  const height = r.i32();
  const nodePos = r.i32();
  const wallPos = r.i32();
  r.i32(); // editor walls (not used by the client)
  const sidedefPos = r.i32();
  const sectorPos = r.i32();
  const thingPos = r.i32();

  // Nodes (LoadNodes)
  r.pos = nodePos;
  const numNodes = r.u16();
  const nodes: BspNode[] = [];
  const nodeWallNum: number[] = [];
  for (let i = 0; i < numNodes; i++) {
    const type = r.u8();
    const bbox: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()];
    if (type === 1) {
      const a = r.f32(),
        b = r.f32(),
        c = r.f32();
      const pos = r.u16(),
        neg = r.u16(),
        wallNum = r.u16();
      security += wallNum;
      nodes.push({ type: "internal", bbox, a, b, c, pos, neg, walls: [] });
      nodeWallNum[i] = wallNum;
    } else if (type === 2) {
      const sector = r.u16();
      const n = r.u16();
      const points = [];
      for (let j = 0; j < n; j++) points.push({ x: r.f32(), y: r.f32() });
      nodes.push({ type: "leaf", bbox, sector, points });
    } else throw new Error(`bad BSP node type ${type}`);
  }

  // Walls (LoadWalls)
  r.pos = wallPos;
  const numWalls = r.u16();
  const walls: Wall[] = [];
  const nextNum: number[] = [];
  for (let i = 0; i < numWalls; i++) {
    nextNum.push(r.u16());
    const posSidedef = r.u16(),
      negSidedef = r.u16();
    security += posSidedef + negSidedef;
    const x0 = r.f32(),
      y0 = r.f32(),
      x1 = r.f32(),
      y1 = r.f32();
    const length = r.f32();
    const posXOffset = r.i16(),
      negXOffset = r.i16(),
      posYOffset = r.i16(),
      negYOffset = r.i16();
    const posSector = r.u16(),
      negSector = r.u16();
    security += posSector + negSector;
    walls.push({
      posSidedef, negSidedef, x0, y0, x1, y1, length, posXOffset, negXOffset, posYOffset, negYOffset,
      posSector, negSector, z0: 0, z1: 0, z2: 0, z3: 0, zz0: 0, zz1: 0, zz2: 0, zz3: 0,
      z0Neg: 0, z1Neg: 0, zz0Neg: 0, zz1Neg: 0, bowtie: 0, separator: { a: 0, b: 0, c: 0 },
    });
  }

  // Sidedefs (LoadSidedefs)
  r.pos = sidedefPos;
  const numSidedefs = r.u16();
  const sidedefs: Sidedef[] = [];
  for (let i = 0; i < numSidedefs; i++) {
    const s: Sidedef = {
      serverId: r.u16(), normalType: r.u16(), aboveType: r.u16(), belowType: r.u16(), flags: r.i32(), animateSpeed: r.u8(),
    };
    security += s.serverId + s.aboveType + s.belowType + s.normalType + s.flags;
    sidedefs.push(s);
  }

  // Sectors (LoadSectors)
  r.pos = sectorPos;
  const numSectors = r.u16();
  const sectors: Sector[] = [];
  for (let i = 0; i < numSectors; i++) {
    const serverId = r.u16();
    const floorType = r.u16();
    const ceilingType = r.u16();
    security += serverId + floorType + ceilingType;
    const tx = r.u16() << 4; // FinenessKodToClient on a WORD
    const ty = r.u16() << 4;
    const fh = r.u16();
    const ch = r.u16();
    security += fh + ch;
    const light = r.u8();
    const flags = r.i32();
    security += light + flags;
    const animateSpeed = version >= 10 ? r.u8() : 0;
    const slopedFloor = flags & SF.SLOPED_FLOOR ? readSlope(r) : null;
    const slopedCeiling = flags & SF.SLOPED_CEILING ? readSlope(r) : null;
    sectors.push({
      serverId, floorType, ceilingType, tx, ty, floorHeight: fh << 4, ceilingHeight: ch << 4, light, flags,
      animateSpeed, slopedFloor, slopedCeiling,
    });
  }

  // Things: exactly two corner points (LoadThings), Kod fine units (64/square).
  r.pos = thingPos;
  const numThings = r.u16();
  if (numThings !== 2) throw new Error(`expected 2 things, got ${numThings}`);
  const tx0 = r.i32(),
    ty0 = r.i32(),
    tx1 = r.i32(),
    ty1 = r.i32();
  const thingsBox = { maxX: Math.abs(tx1 - tx0) * 16, maxY: Math.abs(ty1 - ty0) * 16 };

  // Swizzle (RoomSwizzle): wall lists per node, normalised separators, wall heights.
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type !== "internal") continue;
    const first = nodeWallNum[i];
    if (first) {
      const w0 = walls[first - 1];
      let a = node.a * FINENESS,
        b = node.b * FINENESS;
      const norm = Math.hypot(a, b) || 1;
      a = (a * FINENESS) / norm;
      b = (b * FINENESS) / norm;
      node.a = a;
      node.b = b;
      node.c = -(a * w0.x1 + b * w0.y1 + (a * w0.x0 + b * w0.y0)) / 2;
      for (let w = first; w !== 0; w = nextNum[w - 1]) {
        node.walls.push(w - 1);
        const wall = walls[w - 1];
        wall.separator = { a: node.a, b: node.b, c: node.c };
        setWallHeights(wall, sectors);
      }
    }
  }

  security = (security ^ SECURITY_XOR) | 0;
  return {
    version, security: storedSecurity, securityOk: security === storedSecurity, width, height,
    rows: height >> 10, cols: width >> 10, nodes, walls, sidedefs, sectors, thingsBox,
  };
}

function readSlope(r: Reader): Slope {
  let a = r.f32(),
    b = r.f32(),
    c = r.f32(),
    d = r.f32();
  if (c === 0) {
    a = 0;
    b = 0;
    c = 1024;
    d = 0;
  }
  const x = r.i32(),
    y = r.i32();
  const angle = r.i32();
  r.pos += 18; // 3 x 6 unused bytes
  return { a, b, c, d, p0: { x, y, z: (-a * x - b * y - d) / c }, angle };
}

/** drawbsp.c GetFloorHeight (x, y truncated to integers like the C long parameters). */
export function floorHeightAt(s: Sector, x: number, y: number): number {
  if (!s.slopedFloor) return s.floorHeight;
  const p = s.slopedFloor;
  return Math.round((-p.a * Math.trunc(x) - p.b * Math.trunc(y) - p.d) / p.c);
}

export function ceilingHeightAt(s: Sector, x: number, y: number): number {
  if (!s.slopedCeiling) return s.ceilingHeight;
  const p = s.slopedCeiling;
  return Math.round((-p.a * Math.trunc(x) - p.b * Math.trunc(y) - p.d) / p.c);
}

/** bspload.c SetWallHeights (the D3D branch for bowties). */
function setWallHeights(w: Wall, sectors: Sector[]): void {
  const S1 = w.posSector ? sectors[w.posSector - 1] : null;
  const S2 = w.negSector ? sectors[w.negSector - 1] : null;
  if (!S1 && !S2) {
    w.z0 = w.z1 = 0;
    w.z2 = w.z3 = FINENESS;
    w.zz0 = w.zz1 = 0;
    w.zz2 = w.zz3 = FINENESS;
    return;
  }
  if (!S1 || !S2) {
    const S = (S1 ?? S2)!;
    w.z0 = w.z1 = floorHeightAt(S, w.x0, w.y0);
    w.z2 = w.z3 = ceilingHeightAt(S, w.x0, w.y0);
    w.zz0 = w.zz1 = floorHeightAt(S, w.x1, w.y1);
    w.zz2 = w.zz3 = ceilingHeightAt(S, w.x1, w.y1);
    return;
  }
  let a0 = floorHeightAt(S1, w.x0, w.y0),
    b0 = floorHeightAt(S2, w.x0, w.y0),
    a1 = floorHeightAt(S1, w.x1, w.y1),
    b1 = floorHeightAt(S2, w.x1, w.y1);
  if (a0 > b0) {
    if (a1 >= b1) {
      w.bowtie = 0;
      w.z1 = a0;
      w.zz1 = a1;
      w.z0 = b0;
      w.zz0 = b1;
    } else {
      w.bowtie = BT.BELOW_POS;
      w.z1 = a0;
      w.zz1 = a1;
      w.z0 = b0;
      w.zz0 = a1;
      w.z1Neg = b0;
      w.zz1Neg = b1;
      w.z0Neg = b0;
      w.zz0Neg = a1;
    }
  } else if (b1 >= a1) {
    w.bowtie = 0;
    w.z1 = b0;
    w.zz1 = b1;
    w.z0 = a0;
    w.zz0 = a1;
  } else {
    w.bowtie = BT.BELOW_NEG;
    w.z1 = a0;
    w.zz1 = a1;
    w.z0 = a0;
    w.zz0 = b1;
    w.z1Neg = b0;
    w.zz1Neg = b1;
    w.z0Neg = a0;
    w.zz0Neg = b1;
  }

  a0 = ceilingHeightAt(S1, w.x0, w.y0);
  b0 = ceilingHeightAt(S2, w.x0, w.y0);
  a1 = ceilingHeightAt(S1, w.x1, w.y1);
  b1 = ceilingHeightAt(S2, w.x1, w.y1);
  if (a0 > b0) {
    if (a1 >= b1) {
      w.z3 = a0;
      w.zz3 = a1;
      w.z2 = b0;
      w.zz2 = b1;
    } else {
      w.bowtie |= BT.ABOVE_POS;
      w.z3 = a0;
      w.zz3 = b1;
      w.z2 = b0;
      w.zz2 = a1;
    }
  } else if (b1 >= a1) {
    w.z3 = b0;
    w.zz3 = b1;
    w.z2 = a0;
    w.zz2 = a1;
  } else {
    w.bowtie |= BT.ABOVE_NEG;
    w.z3 = b0;
    w.zz3 = a1;
    w.z2 = a0;
    w.zz2 = b1;
  }
}

/** The leaf (and so the sector) containing a point, by walking the BSP tree like the client. */
export function leafAt(room: Room, x: number, y: number): BspLeaf | null {
  let idx = room.nodes.length ? 0 : -1;
  while (idx >= 0) {
    const n = room.nodes[idx];
    if (n.type === "leaf") return n;
    const side = n.a * x + n.b * y + n.c;
    const next = side >= 0 ? n.pos : n.neg;
    if (!next) return null;
    idx = next - 1;
  }
  return null;
}

/** Kod grid position (1-based rows/cols, fine 0..63) to client fine coordinates. */
export function kodToClient(row: number, col: number, fineRow = 32, fineCol = 32): { x: number; y: number } {
  return { x: (col - 1) * FINENESS + fineCol * 16, y: (row - 1) * FINENESS + fineRow * 16 };
}

export { angleRad };
