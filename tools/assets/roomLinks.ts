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

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

interface RoomClass {
  rid: number;
  roo: string;
  exits: Set<number>;
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
  for (const line of src.split(/\r?\n/)) {
    if (!/\bpl(Edge_)?Exits\s*=\s*Cons\s*\(/i.test(line)) continue;
    for (const m of line.matchAll(/\bRID_\w+/g)) {
      const dest = rids.get(m[0]);
      if (dest !== undefined && dest !== rid) exits.add(dest);
    }
  }
  return { rid, roo, exits };
}

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
