// Which rooms connect to which, read from the Kod source, so the client can load the rooms
// next to the one you're in before you walk into them. The protocol never says where an
// exit leads (the server handles BP_REQ_GO), but every room class lists its exits:
//
//   resources:  room_raza = raza.roo
//   classvars:  prRoom = room_raza          (or the only .roo resource in the file)
//               piRoom_num = RID_RAZA
//   CreateStandardExits():
//      plExits = Cons([ 7, 26, RID_RAZA_INN, 8, 6, ROTATE_NONE ],plExits);
//      plEdge_Exits = Cons([LEAVE_NORTH, RID_RAZA_FOREST, 43, 41, ROTATE_NONE], plEdge_exits);
//
// with RID_* defined in kod/include/blakston.khd. The links are made two-way (an exit's
// destination usually has one back, and a missed one costs nothing but a later load).
// Output: { "raza.roo": ["razabank.roo", "razainn.roo", ...], ... }, by lower-case file name.

export interface KodFile {
  path: string;
  text: string;
}

/** RID_NAME = 300 lines from the .khd headers. */
export function parseRids(khd: string): Map<string, number> {
  const rids = new Map<string, number>();
  for (const m of khd.matchAll(/^\s*(RID_\w+)\s*=\s*(\d+)/gm)) rids.set(m[1], Number(m[2]));
  return rids;
}

const arrival = (row?: string, col?: string) => (row && col ? { destRow: Number(row), destCol: Number(col) } : {});

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

interface RoomClass {
  rid: number;
  roo: string;
  exits: Set<number>;
  /** plExits squares: Kod row and column (1-based), and the RID it leads to (null: ROOM_LOCKED_DOOR) */
  doors: { row: number; col: number; dest: number | null; destRow?: number; destCol?: number }[];
  /** plEdge_Exits: which side of the room (LEAVE_NORTH ...) leads where, and the square it puts you on there */
  edges: { side: string; dest: number; destRow?: number; destCol?: number }[];
  /** viTerrain_type's TERRAIN_* names (none when the class doesn't set it) */
  terrain: string[];
}

function parseRoom(file: KodFile, rids: Map<string, number>): RoomClass | null {
  const src = stripComments(file.text);
  const ridName = /\bpiRoom_num\s*=\s*(RID_\w+)/.exec(src)?.[1];
  const rid = ridName ? rids.get(ridName) : undefined;
  if (rid === undefined) return null;
  const roos = new Map<string, string>();
  for (const m of src.matchAll(/^\s*(\w+)\s*=\s*([\w-]+\.roo)\b/gim)) roos.set(m[1], m[2].toLowerCase());
  const prRoom = /\bprRoom\s*=\s*(\w+)/.exec(src)?.[1];
  const roo = (prRoom && roos.get(prRoom)) ?? (roos.size === 1 ? [...roos.values()][0] : undefined);
  if (!roo) return null;
  const exits = new Set<number>();
  const doors: RoomClass["doors"] = [];
  const edges: RoomClass["edges"] = [];
  for (const line of src.split(/\r?\n/)) {
    if (!/\bpl(Edge_)?Exits\s*=\s*Cons\s*\(/i.test(line)) continue;
    for (const m of line.matchAll(/\bRID_\w+/g)) {
      const dest = rids.get(m[0]);
      if (dest !== undefined && dest !== rid) exits.add(dest);
    }
    const door = /\bplExits\s*=\s*Cons\s*\(\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\w+)\s*(?:,\s*(\d+)\s*,\s*(\d+))?/i.exec(line);
    if (door) {
      const dest = rids.get(door[3]);
      if (dest !== undefined || door[3] === "ROOM_LOCKED_DOOR")
        doors.push({ row: Number(door[1]), col: Number(door[2]), dest: dest ?? null, ...arrival(door[4], door[5]) });
    }
    const edge = /\bplEdge_Exits\s*=\s*Cons\s*\(\s*\[\s*LEAVE_(NORTH|SOUTH|EAST|WEST)\s*,\s*(RID_\w+)\s*(?:,\s*(\d+)\s*,\s*(\d+))?/i.exec(line);
    const edgeDest = edge ? rids.get(edge[2]) : undefined;
    if (edge && edgeDest !== undefined) edges.push({ side: edge[1].toUpperCase()[0], dest: edgeDest, ...arrival(edge[3], edge[4]) });
  }
  for (const a of areaExits(src, rids)) {
    if (a.dest === null || a.dest === rid) continue;
    exits.add(a.dest);
    doors.push(a);
  }
  return { rid, roo, exits, doors, edges, terrain: terrainOf(src) };
}

/** A bound on a square: the square just inside it ("new_row < 32": 31) */
function inside(op: string, n: number): number {
  return op === "<" ? n - 1 : op === ">" ? n + 1 : n;
}

/**
 * Ours: the ways out that a room's SomethingMoved takes when a player walks into an area,
 * `if (new_row < 32) AND (new_col > 66)` then UtilGoNearSquare to RID_C4 (Marion's ways to the
 * Ileria woods, the Deep Woods' to the Temple of Shal'ille): each one a door at the area's inner
 * corner, the square nearest the room's middle that's in it. One bound alone (a side) isn't read.
 */
function areaExits(src: string, rids: Map<string, number>): RoomClass["doors"] {
  const body = /^\s{3}SomethingMoved\s*\([^)]*\)\s*\n([\s\S]*?)(?=^\s{3}\w+\s*\([^)]*\)\s*$|^end\b)/m.exec(src)?.[1];
  if (!body) return [];
  const out: RoomClass["doors"] = [];
  const cond = /\bif\s*\(?\s*new_(row|col)\s*(<=|>=|<|>|=)\s*(\d+)\s*\)?\s*and\s*\(?\s*new_(row|col)\s*(<=|>=|<|>|=)\s*(\d+)\s*\)?/gi;
  const ifs = [...body.matchAll(cond)];
  ifs.forEach((m, i) => {
    if (m[1].toLowerCase() === m[4].toLowerCase()) return;
    const block = body.slice(m.index, ifs[i + 1]?.index ?? body.length);
    const to = /#num\s*=\s*(RID_\w+)/.exec(block)?.[1];
    const dest = to ? rids.get(to) : undefined;
    if (dest === undefined || !/UtilGoNearSquare/.test(block)) return;
    const at = { [m[1].toLowerCase()]: inside(m[2], Number(m[3])), [m[4].toLowerCase()]: inside(m[5], Number(m[6])) };
    const dr = /#new_row\s*=\s*(\d+)/.exec(block)?.[1];
    const dc = /#new_col\s*=\s*(\d+)/.exec(block)?.[1];
    out.push({ row: at.row!, col: at.col!, dest, ...arrival(dr, dc) });
  });
  return out;
}

/** viTerrain_type = TERRAIN_CITY | TERRAIN_SHOP (perhaps over lines ending in "\"): the names */
function terrainOf(src: string): string[] {
  const expr = /\bviTerrain_type\s*=\s*((?:[^\n]*\\\s*\n)*[^\n]*)/.exec(src)?.[1] ?? "";
  return [...new Set([...expr.matchAll(/\bTERRAIN_(\w+)/g)].map((m) => m[1]))].sort();
}

/** A copy of a room (the death realm's, test rooms) comes after the room itself */
const copyRank = (path: string) => (/deathrealm|newroom|profroom/i.test(path) ? 1 : 0);
const byOriginal = (files: KodFile[]) => [...files].sort((a, b) => copyRank(a.path) - copyRank(b.path));

/** Room file -> the room files its exits lead to (and those leading to it), sorted. */
export function buildRoomLinks(kodFiles: KodFile[], khd: string): Record<string, string[]> {
  const rids = parseRids(khd);
  const rooms = kodFiles.map((f) => parseRoom(f, rids)).filter((r): r is RoomClass => r !== null);
  const rooByRid = new Map<number, string>();
  for (const r of rooms) if (!rooByRid.has(r.rid)) rooByRid.set(r.rid, r.roo);
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!links.has(a)) links.set(a, new Set());
    links.get(a)!.add(b);
  };
  for (const r of rooms)
    for (const dest of r.exits) {
      const to = rooByRid.get(dest);
      if (!to) continue;
      link(r.roo, to);
      link(to, r.roo);
    }
  return Object.fromEntries([...links.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));
}

/**
 * One room's ways in and out (roomexits.json), in Kod squares (1-based row, column): door squares
 * with the room file they lead to (null when locked), the sides that lead out, and the squares
 * other rooms' exits put you on here (just outside the doors, usually).
 */
export interface RoomExits {
  doors: [number, number, string | null][];
  edges: { side: "N" | "S" | "E" | "W"; to: string | null }[];
  arrivals: [number, number][];
}

/**
 * Room file -> where its exits are, for the ambient townsfolk (ours) to walk between doors.
 * Locked doors count too: people go home through them.
 */
export function buildRoomExits(kodFiles: KodFile[], khd: string): Record<string, RoomExits> {
  const rids = parseRids(khd);
  const rooms = byOriginal(kodFiles).map((f) => parseRoom(f, rids)).filter((r): r is RoomClass => r !== null);
  const rooByRid = new Map<number, string>();
  for (const r of rooms) if (!rooByRid.has(r.rid)) rooByRid.set(r.rid, r.roo);
  const out = new Map<string, RoomExits>();
  const entry = (roo: string) => {
    let e = out.get(roo);
    if (!e) out.set(roo, (e = { doors: [], edges: [], arrivals: [] }));
    return e;
  };
  const done = new Set<string>();
  for (const r of rooms) {
    // Rooms sharing a file: the first class's exits only
    if (done.has(r.roo)) continue;
    done.add(r.roo);
    for (const d of r.doors) {
      entry(r.roo).doors.push([d.row, d.col, d.dest === null ? null : (rooByRid.get(d.dest) ?? null)]);
      const to = d.dest === null ? undefined : rooByRid.get(d.dest);
      if (to && d.destRow && d.destCol) entry(to).arrivals.push([d.destRow, d.destCol]);
    }
    for (const e of r.edges) {
      const to = rooByRid.get(e.dest);
      entry(r.roo).edges.push({ side: e.side as RoomExits["edges"][number]["side"], to: to ?? null });
      if (to && e.destRow && e.destCol) entry(to).arrivals.push([e.destRow, e.destCol]);
    }
  }
  for (const e of out.values()) {
    const seen = new Set<string>();
    e.arrivals = e.arrivals.filter(([r, c]) => !seen.has(`${r},${c}`) && seen.add(`${r},${c}`)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  return Object.fromEntries([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** One room to go to (rooms.json): its number, its name (vrName) and its file */
export interface RoomListing {
  rid: number;
  name: string;
  roo: string;
}

/**
 * Every room with a number, by number (rooms.json), for the admin console's Travel list (ours,
 * after the remaster's data/net/rooms.json). The name is the room class's vrName string
 * (`room_name_raza = "Raza"`); a class without one takes its parent's, else the file's name.
 */
export function buildRoomList(kodFiles: KodFile[], khd: string): RoomListing[] {
  const rids = parseRids(khd);
  const className = (src: string) => /^\s*(\w+)\s+is\s+(\w+)/m.exec(src);
  // Kod's names ignore case: the Jasper tavern names room_name_JasperTavern as room_name_jaspertavern
  const strings = (src: string) => new Map([...src.matchAll(/^[ \t]*(\w+)[ \t]*=[ \t]*"([^"\n]*)"/gm)].map((m) => [m[1]!.toLowerCase(), m[2]]));
  const classes = new Map<string, { parent: string; name?: string }>();
  for (const f of kodFiles) {
    const src = stripComments(f.text);
    const head = className(src);
    if (!head) continue;
    const vr = /\bvrName\s*=\s*(\w+)/.exec(src)?.[1];
    classes.set(head[1].toLowerCase(), { parent: head[2].toLowerCase(), name: vr ? strings(src).get(vr.toLowerCase()) : undefined });
  }
  const nameOf = (cls: string): string | undefined => {
    for (let c = classes.get(cls), n = 0; c && n < 20; c = classes.get(c.parent), n++) if (c.name) return c.name;
    return undefined;
  };
  const out = new Map<number, RoomListing>();
  for (const f of byOriginal(kodFiles)) {
    const r = parseRoom(f, rids);
    if (!r || out.has(r.rid)) continue;
    const cls = className(stripComments(f.text))?.[1].toLowerCase();
    const name = (cls && nameOf(cls))?.replace(/\s+/g, " ").trim();
    out.set(r.rid, { rid: r.rid, name: name || r.roo.replace(/\.roo$/, ""), roo: r.roo });
  }
  return [...out.values()].sort((a, b) => a.rid - b.rid);
}

/**
 * Room file -> its terrain (viTerrain_type, the TERRAIN_* names without the prefix; a class
 * without one takes its parent's), for the ambient critters (ours): what scurries about where.
 * Rooms that don't say are left out.
 */
export function buildRoomTerrain(kodFiles: KodFile[], khd: string): Record<string, string[]> {
  const rids = parseRids(khd);
  const className = (src: string) => /^\s*(\w+)\s+is\s+(\w+)/m.exec(src);
  // Every class's parent and own terrain, rooms or not (BarloqueNorth is BarloqueRoom)
  const classes = new Map<string, { parent: string; terrain: string[] }>();
  for (const f of kodFiles) {
    const src = stripComments(f.text);
    const head = className(src);
    if (head) classes.set(head[1].toLowerCase(), { parent: head[2].toLowerCase(), terrain: terrainOf(src) });
  }
  const inherited = (name: string): string[] => {
    for (let c = classes.get(name), n = 0; c && n < 20; c = classes.get(c.parent), n++) if (c.terrain.length) return c.terrain;
    return [];
  };
  const out = new Map<string, string[]>();
  for (const f of byOriginal(kodFiles)) {
    const r = parseRoom(f, rids);
    if (!r || out.has(r.roo)) continue;
    const name = className(stripComments(f.text))?.[1].toLowerCase();
    const terrain = r.terrain.length ? r.terrain : name ? inherited(name) : [];
    if (terrain.length) out.set(r.roo, terrain);
  }
  return Object.fromEntries([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
