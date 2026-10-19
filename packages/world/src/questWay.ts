// Ours (docs/adr/0009-quests.md 5): where a quest step sends us, for the maps. A step's area is
// a list of rooms (the catalogue's CatalogStep.rooms: a visit's rooms, or where a kill's monster
// spawns); once the step is counted, or for talk and deliver, the destination is where it's handed
// in (CatalogNpc.rooms). Outside it, the way is a path over the rooms' exits (roomexits.json), and
// the exits to take out of this room are marked. No path, no mark: portals and rooms with no fixed
// number aren't in the exits.

import type { AmbientExits } from "./ambient/ambientLife.ts";
import type { CatalogStep } from "./quests.ts";

/** An exit to take out of the room we're in: a door's square (Kod row and column), or a side */
export type WayMark = { kind: "door"; row: number; col: number } | { kind: "edge"; side: "N" | "S" | "E" | "W" };

export interface QuestWay {
  /** We stand in one of the step's area rooms (the maps wash it gold) */
  inArea: boolean;
  /** We stand where the step is handed in */
  atTurnin: boolean;
  /** The exits out of this room toward the destination (none when there, or with no path) */
  marks: WayMark[];
  /** The rooms (files) from here to the nearest destination room, here first; null with no path or no destination */
  path: string[] | null;
}

type Exits = Record<string, AmbientExits>;

/** The rooms an exit of `room` leads to, each once */
function neighbours(exits: Exits, room: string): string[] {
  const e = exits[room];
  if (!e) return [];
  const out = new Set<string>();
  for (const [, , to] of e.doors) if (to) out.add(to);
  for (const edge of e.edges) if (edge.to) out.add(edge.to);
  return [...out];
}

/** The shortest path in rooms from `from` to any of `targets` (breadth first), or null */
export function findRoute(exits: Exits, from: string, targets: ReadonlySet<string>): string[] | null {
  if (targets.has(from)) return [from];
  const back = new Map<string, string>([[from, ""]]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const room of frontier)
      for (const n of neighbours(exits, room)) {
        if (back.has(n)) continue;
        back.set(n, room);
        if (targets.has(n)) {
          const path = [n];
          for (let r = room; r; r = back.get(r)!) path.unshift(r);
          return path;
        }
        next.push(n);
      }
    frontier = next;
  }
  return null;
}

/**
 * The exits of `room` that lead to `next`: its doors and its sides. A doorway several squares wide
 * (the Raza inn's is two) is one mark, at its middle (row and column may then be halves).
 */
export function exitsTo(exits: Exits, room: string, next: string): WayMark[] {
  const e = exits[room];
  if (!e) return [];
  // Each square once, then the squares that touch (sides or corners) gathered into doorways
  const squares = [...new Map(e.doors.filter(([, , to]) => to === next).map(([row, col]) => [`${row},${col}`, [row, col] as const])).values()];
  const doorways: (readonly [number, number])[][] = [];
  for (const sq of squares) {
    const touching = doorways.filter((d) => d.some(([r, c]) => Math.abs(r - sq[0]) <= 1 && Math.abs(c - sq[1]) <= 1));
    const merged = [sq, ...touching.flat()];
    for (const d of touching) doorways.splice(doorways.indexOf(d), 1);
    doorways.push(merged);
  }
  const marks: WayMark[] = doorways.map((d) => ({
    kind: "door",
    row: d.reduce((s, [r]) => s + r, 0) / d.length,
    col: d.reduce((s, [, c]) => s + c, 0) / d.length,
  }));
  for (const edge of e.edges) if (edge.to === next) marks.push({ kind: "edge", side: edge.side });
  return marks;
}

/** Whether a step is counted done and only wants handing in */
const counted = (step: CatalogStep, count: number): boolean => step.kind !== "talk" && step.kind !== "deliver" && count >= step.count;

/**
 * Where a step sends us: its area while it counts up, else where it's handed in. Rooms are
 * numbers; `rooFor` gives each one's file (rooms.json), `here` is the file of the room we're in.
 */
export function questWay(exits: Exits, rooFor: (rid: number) => string | undefined, here: string, step: CatalogStep, count: number): QuestWay {
  // Counting up, the area is the way (none known: no way yet); else the hand-in
  const toArea = !counted(step, count) && step.kind !== "talk" && step.kind !== "deliver";
  const files = (rids: number[]) => new Set(rids.map(rooFor).filter((f): f is string => !!f));
  const area = files(step.rooms.map((r) => r.rid));
  const turnin = files(step.turnin.rooms.map((r) => r.rid));
  const inArea = area.has(here) && !counted(step, count);
  const atTurnin = turnin.has(here);
  const targets = toArea ? area : turnin;
  if (!targets.size || targets.has(here)) return { inArea, atTurnin, marks: [], path: targets.size ? [here] : null };
  const path = findRoute(exits, here, targets);
  return { inArea, atTurnin, marks: path && path.length > 1 ? exitsTo(exits, here, path[1]!) : [], path };
}
