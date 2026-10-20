// Walking for the agent (docs/adr/0020-ai-playtester.md): paths over the room's nav grid
// (packages/world/src/navGrid.ts, the townsfolk's), walked as BP_REQ_MOVE steps like the headless
// tools' (tools/headless/quest.ts walk), facing the way we go. Exits as the friends' following
// does them (social/follow.ts): stand on a door's square and send BP_REQ_GO, or walk onto an edge;
// across rooms, the shortest way over roomexits.json (questWay.ts findRoute).

import {
  cellCentre, exitsTo, findPath, findRoute, isOpen, nearestCell, squareCentre, squareOf, type NavGrid, type NavPoint,
} from "../../packages/world/src/index.ts";
import { sleep, type Body } from "./body.ts";
import { angleTo } from "./describe.ts";

const SQ = 1024;
/** One step every TICK_MS: a walk is about 2 squares a second (SPEED_WALK is 25 squares per 10 s) */
const TICK_MS = 250;
const STEP = 512;
const WALK_SPEED = 25;
/** A waypoint counts as reached this close (fine units) */
const REACHED = 96;
/** Give up after the server snaps us back this many times */
const MAX_SNAPS = 3;
/** Pressing go on a door: every so often, for so long */
const GO_EVERY_MS = 1200;
const DOOR_GIVE_UP_MS = 6000;
/** The longest any one walk may take */
const WALK_LIMIT_MS = 120_000;

export interface WalkResult {
  ok: boolean;
  /** What happened, for the agent */
  text: string;
}

const dist = (a: NavPoint, b: NavPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Watches the world while we walk: did the server snap us back, did the room change */
function watch(body: Body): { snaps: () => number; roomChanged: () => boolean; stop: () => void } {
  let snaps = 0,
    changed = false;
  const off = body.live.world.on((e) => {
    if (e.type === "selfMoved") snaps++;
    if (e.type === "player" && e.roomChanged) changed = true;
  });
  return { snaps: () => snaps, roomChanged: () => changed, stop: off };
}

/** The room's grid, or null for one not in the game files (we then walk straight) */
async function gridOf(body: Body): Promise<NavGrid | null> {
  return (await body.data.room(body.roomFile))?.grid ?? null;
}

/** A path from us to `to`, falling back to the nearest open cell within 4 squares of it */
async function pathTo(body: Body, to: NavPoint): Promise<NavPoint[] | null> {
  const grid = await gridOf(body);
  const self = body.live.world.self!;
  if (!grid) return [to];
  const path = findPath(grid, self, to);
  if (path?.length) return path;
  // Out of reach (behind a counter, in a wall): as near as our own floor goes, whatever's between
  const start = nearestCell(grid, self.x, self.y, 6, 0, false);
  const near = start >= 0 ? nearestCell(grid, to.x, to.y, 12, grid.area[start], false) : -1;
  return near >= 0 ? findPath(grid, self, cellCentre(grid, near)) : null;
}

/**
 * Walks through the points. `stopWhen` ends it early (reached what we wanted). Stops when the
 * server snaps us back MAX_SNAPS times or the room changes.
 */
async function walkPoints(body: Body, points: NavPoint[], stopWhen?: () => boolean): Promise<WalkResult> {
  const session = body.live;
  const w = watch(body);
  const started = Date.now();
  let facing = -1;
  try {
    for (const p of points) {
      for (;;) {
        const self = session.world.self;
        if (!self) return { ok: false, text: "You left the game." };
        if (w.roomChanged()) return { ok: false, text: "The room changed on the way." };
        if (w.snaps() >= MAX_SNAPS) return { ok: false, text: `The server kept moving you back near row ${squareOf(self)[0]}, col ${squareOf(self)[1]}: something's in the way.` };
        if (stopWhen?.()) return { ok: true, text: "" };
        if (Date.now() - started > WALK_LIMIT_MS) return { ok: false, text: "Took too long; stopped." };
        const dx = p.x - self.x,
          dy = p.y - self.y;
        const d = Math.hypot(dx, dy);
        if (d <= REACHED) break;
        const angle = angleTo(dx, dy);
        if (Math.abs(angle - facing) > 64) body.turnTo((facing = angle));
        const step = Math.min(d, STEP);
        body.stepTo(self.x + (dx / d) * step, self.y + (dy / d) * step, WALK_SPEED);
        await sleep(TICK_MS);
      }
    }
    return { ok: true, text: "" };
  } finally {
    w.stop();
  }
}

const here = (body: Body): string => {
  const self = body.live.world.self!;
  const [row, col] = squareOf(self);
  return `row ${row}, col ${col}`;
};

/** Walks to the middle of a square */
export async function walkTo(body: Body, row: number, col: number): Promise<WalkResult> {
  const target = squareCentre(row, col);
  const path = await pathTo(body, target);
  if (!path) return { ok: false, text: `No way to row ${row}, col ${col} from ${here(body)} (walls, or it's not walkable).` };
  const r = await walkPoints(body, path);
  const left = dist(body.live.world.self!, target) / SQ;
  return { ok: r.ok, text: `${r.text ? `${r.text} ` : ""}Now at ${here(body)}${left > 0.6 ? `, ${left.toFixed(1)} squares short (as close as the floor allows)` : ""}.` };
}

/** Walks up to an object, until within `within` squares, following it if it moves */
export async function walkToObject(body: Body, id: number, within = 1.2): Promise<WalkResult> {
  const world = body.live.world;
  for (let tries = 0; tries < 6; tries++) {
    const o = world.objects.get(id);
    const self = world.self;
    if (!o || !self) return { ok: false, text: `Object ${id} isn't here.` };
    if (dist(self, o) <= within * SQ) return { ok: true, text: `Beside it, at ${here(body)}.` };
    const path = await pathTo(body, o);
    if (!path) return { ok: false, text: `No way to object ${id} from ${here(body)}.` };
    const at = { x: o.x, y: o.y };
    // Walk until close, or until it has moved a square from where we planned
    const r = await walkPoints(body, path, () => {
      const now = world.objects.get(id);
      return !now || dist(world.self!, now) <= within * SQ || dist(now, at) > SQ;
    });
    if (!r.ok) return { ok: false, text: `${r.text} At ${here(body)}.` };
    // The whole way walked and it hasn't moved: the floor ends short of it (a counter, a wall)
    const now = world.objects.get(id);
    if (now && dist(now, at) <= SQ && dist(world.self!, now) > within * SQ)
      return { ok: true, text: `As close as the floor allows, ${(dist(world.self!, now) / SQ).toFixed(1)} squares away (a counter or wall between). At ${here(body)}.` };
  }
  const o = world.objects.get(id);
  const self = world.self!;
  return o && dist(self, o) <= within * SQ
    ? { ok: true, text: `Beside it, at ${here(body)}.` }
    : { ok: false, text: `Couldn't get within ${within} squares${o ? ` (${(dist(self, o) / SQ).toFixed(1)} away)` : ""}. At ${here(body)}.` };
}

/** The neighbouring room a name, number or file means, from here */
function neighbourFile(body: Body, to: string): string | null {
  const e = body.data.exits[body.roomFile];
  if (!e) return null;
  const files = new Set<string>([...e.doors.map(([, , f]) => f ?? ""), ...e.edges.map((x) => x.to ?? "")].filter(Boolean));
  const w = to.trim().toLowerCase();
  for (const f of files) if (f === w || f === `${w}.roo`) return f;
  const byRoom = body.data.findRoom(to);
  if (byRoom && files.has(byRoom.roo)) return byRoom.roo;
  for (const f of files) if (body.data.roomsOf(f).some((r) => r.name.toLowerCase().includes(w))) return f;
  return null;
}

/** Waits for the room to change, up to `ms` */
async function roomChange(body: Body, from: string, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 100) {
    if (body.roomFile && body.roomFile !== from) return true;
    await sleep(100);
  }
  return false;
}

/** Goes through a door: onto its square, then BP_REQ_GO until the room changes */
async function useDoor(body: Body, row: number, col: number): Promise<WalkResult> {
  const from = body.roomFile;
  const door = squareCentre(row, col);
  const path = await pathTo(body, door);
  if (!path) return { ok: false, text: `No way to the door at row ${row}, col ${col}.` };
  const r = await walkPoints(body, path, () => body.roomFile !== from);
  if (body.roomFile !== from) return { ok: true, text: "" };
  if (!r.ok) return r;
  // The grid keeps off walls; a door's square may be in one: the last bit straight
  await walkPoints(body, [door], () => body.roomFile !== from);
  for (let t = 0; t < DOOR_GIVE_UP_MS; t += GO_EVERY_MS) {
    body.live.go();
    if (await roomChange(body, from, GO_EVERY_MS)) return { ok: true, text: "" };
  }
  return { ok: false, text: `The door at row ${row}, col ${col} didn't let you through (locked, or not a door you can use).` };
}

/** Walks off a side of the room: to the open cell nearest that side, then on out */
async function useEdge(body: Body, side: "N" | "S" | "E" | "W"): Promise<WalkResult> {
  const from = body.roomFile;
  const loaded = await body.data.room(from);
  const grid = loaded?.grid;
  if (!loaded || !grid) return { ok: false, text: "This room isn't in the asset build, so its edges can't be found." };
  const self = body.live.world.self!;
  const start = nearestCell(grid, self.x, self.y);
  const area = start >= 0 ? grid.area[start] : 0;
  // The open cells in our area closest to that side, nearest us among them
  let best = -1,
    bestKey = Infinity;
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    if (!isOpen(grid, i) || (area && grid.area[i] !== area)) continue;
    const p = cellCentre(grid, i);
    const toSide = side === "N" ? p.y : side === "S" ? loaded.room.height - p.y : side === "W" ? p.x : loaded.room.width - p.x;
    const key = Math.round(toSide / SQ) * 1e6 + dist(p, self);
    if (key < bestKey) {
      bestKey = key;
      best = i;
    }
  }
  if (best < 0) return { ok: false, text: `No way to the ${side} edge.` };
  const edge = cellCentre(grid, best);
  const path = await pathTo(body, edge);
  if (!path) return { ok: false, text: `No way to the ${side} edge.` };
  const r = await walkPoints(body, path, () => body.roomFile !== from);
  if (body.roomFile !== from) return { ok: true, text: "" };
  if (!r.ok) return r;
  // On out, a little at a time: the room's Kod moves us on at its edge
  const out = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 }, E: { x: 1, y: 0 } }[side];
  for (let k = 1; k <= 6 && body.roomFile === from; k++) {
    await walkPoints(body, [{ x: edge.x + out.x * k * 256, y: edge.y + out.y * k * 256 }], () => body.roomFile !== from);
    if (await roomChange(body, from, 400)) break;
  }
  return body.roomFile !== from ? { ok: true, text: "" } : { ok: false, text: `Walked to the ${side} edge, but the room didn't change.` };
}

/** Takes an exit to a neighbouring room (by file, number or name), the nearest way that leads there */
export async function takeExit(body: Body, to: string): Promise<WalkResult> {
  const from = body.roomFile;
  const file = neighbourFile(body, to);
  if (!file) return { ok: false, text: `No exit from ${from} leads to "${to}". Use look_around for the exits.` };
  const self = body.live.world.self!;
  const doors = (body.data.exits[from]?.doors ?? []).filter(([, , f]) => f === file).map(([row, col]) => ({ row, col, d: dist(squareCentre(row, col), self) }));
  doors.sort((a, b) => a.d - b.d);
  const edges = exitsTo(body.data.exits, from, file).filter((m) => m.kind === "edge");
  let r: WalkResult = { ok: false, text: "" };
  for (const door of doors.slice(0, 2)) {
    r = await useDoor(body, door.row, door.col);
    if (r.ok) break;
  }
  if (!r.ok)
    for (const e of edges) {
      if (e.kind !== "edge") continue;
      r = await useEdge(body, e.side);
      if (r.ok) break;
    }
  if (!r.ok) return { ok: false, text: r.text || `Couldn't reach ${file}.` };
  return { ok: true, text: `Now in ${body.roomFile}${body.roomFile !== file ? ` (expected ${file})` : ""}, at ${here(body)}.` };
}

/** Walks room to room to a room by number, name or file, over the known exits */
export async function travelTo(body: Body, to: string): Promise<WalkResult> {
  const target = body.data.findRoom(to);
  if (!target) return { ok: false, text: `No room "${to}" in rooms.json.` };
  const route = findRoute(body.data.exits, body.roomFile, new Set([target.roo]));
  if (!route) return { ok: false, text: `No known way on foot from ${body.roomFile} to ${target.roo} (${target.name}). Portals and teleports aren't in the exits.` };
  const went: string[] = [body.roomFile];
  for (const next of route.slice(1)) {
    const r = await takeExit(body, next);
    if (!r.ok) return { ok: false, text: `Stopped in ${body.roomFile} on the way (${went.join(" → ")}): ${r.text}` };
    went.push(body.roomFile);
    if (body.roomFile === target.roo) break;
  }
  return { ok: body.roomFile === target.roo, text: `${went.join(" → ")}. Now in ${body.roomFile}, at ${here(body)}.` };
}
