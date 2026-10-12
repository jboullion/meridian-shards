// Ours (docs/adr/0005-friends.md section 4): following a friend. In their room, a spot a square
// behind them, planned over the nav grid every half second; across rooms, the exits they send
// (breadcrumbs): walk to the door and use it, or walk off the edge, then carry on in the next room.
// This decides where to go; the scene turns that into PlayerMover input, so movement keeps move.c's
// rules and the server and others see ordinary walking. Pure logic, tested in Node.

import { findPath, type NavGrid, type NavPoint } from "../navGrid.ts";
import type { AmbientExits } from "../ambient/ambientLife.ts";
import type { ExitBody } from "./friends.ts";

const SQ = 1024;
/** Plan again this often (ms) */
const REPLAN_MS = 500;
/** Stand this far behind the leader, and don't bother moving when this close (fine units) */
const BEHIND = 1.2 * SQ;
const CLOSE_ENOUGH = 1.6 * SQ;
/** A waypoint counts as reached this close */
const REACHED = 160;
/** Run when the leader runs (squares per 10 s: SPEED_WALK 25, SPEED_RUN 55), or we're this far behind */
const RUN_SPEED = 40;
const RUN_DISTANCE = 4 * SQ;
/**
 * A door: this close, walk straight for its square (the grid's cells keep off walls, and a door is
 * in one); on it, use it (BP_REQ_GO needs us standing on the exit's square), again every so often,
 * and give up after a while
 */
const NEAR_DOOR = 1.5 * SQ;
const GO_EVERY_MS = 1200;
const DOOR_GIVE_UP_MS = 6000;
/** Walking off an edge: give up if the room hasn't changed by then */
const EDGE_GIVE_UP_MS = 8000;
/** The leader vanished with no exit message: wait this long for a late one, then try the nearest door */
const LATE_EXIT_MS = 2500;
/** The nearest door must be this close to where the leader was last seen */
const FALLBACK_DOOR = 3 * SQ;
/** No path for this long: give up */
const NO_PATH_MS = 3000;
/** 4.5: three rooms behind is too far */
export const MAX_ROOMS_BEHIND = 3;

export interface FollowFrame {
  now: number;
  /** Our room's file, lower case */
  room: string;
  self: NavPoint;
  /** The leader's object, if it's in our room; its speed in squares per 10 s */
  leader: (NavPoint & { speed: number }) | null;
  /** The room's nav grid, or null to walk straight (no grid yet) */
  grid: NavGrid | null;
  /** The room's size (fine units), for walking off an edge */
  size: { width: number; height: number };
  /** The room's exits (roomexits.json), for a late or lost exit message */
  exits: AmbientExits | undefined;
}

export type FollowStep =
  | { kind: "idle" }
  | { kind: "walk"; to: NavPoint; run: boolean }
  /** Stand on the door square and send BP_REQ_GO */
  | { kind: "go" }
  | { kind: "stop"; why: string };

/** The middle of a Kod square (1-based row, column), in fine units */
export const squareCentre = (row: number, col: number): NavPoint => ({ x: (col - 1) * SQ + SQ / 2, y: (row - 1) * SQ + SQ / 2 });

/** The Kod square a fine position is in */
export const squareOf = (p: NavPoint): [number, number] => [Math.floor(p.y / SQ) + 1, Math.floor(p.x / SQ) + 1];

const dist = (a: NavPoint, b: NavPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Just past the room's edge on `side`, in line with `at` */
function beyondEdge(side: "N" | "S" | "E" | "W", at: NavPoint, size: { width: number; height: number }): NavPoint {
  switch (side) {
    case "N":
      return { x: at.x, y: -SQ };
    case "S":
      return { x: at.x, y: size.height + SQ };
    case "W":
      return { x: -SQ, y: at.y };
    case "E":
      return { x: size.width + SQ, y: at.y };
  }
}

/**
 * Which way the leader left (4.3), from their last square in the old room and the room they're in
 * now: a door near them that leads there, else an edge that does (the nearest side). Neither: not
 * a known exit (a teleport, a portal, death, a Kod-scripted door).
 */
export function exitTaken(
  exits: AmbientExits | undefined, from: string, to: string, at: [number, number], size: { width: number; height: number } | null,
): ExitBody {
  const out: ExitBody = { type: "exit", from, to, at };
  if (!exits) return out;
  let best: { d: number; sq: [number, number] } | null = null;
  for (const [row, col, dest] of exits.doors) {
    if (dest !== to) continue;
    const d = Math.hypot(row - at[0], col - at[1]);
    if (d <= 2.5 && (!best || d < best.d)) best = { d, sq: [row, col] };
  }
  if (best) return { ...out, door: best.sq };
  const edges = exits.edges.filter((e) => e.to === to);
  if (!edges.length) return out;
  if (edges.length === 1 || !size) return { ...out, edge: edges[0].side };
  const p = squareCentre(at[0], at[1]);
  const away = { N: p.y, S: size.height - p.y, W: p.x, E: size.width - p.x };
  edges.sort((a, b) => away[a.side] - away[b.side]);
  return { ...out, edge: edges[0].side };
}

export class FollowPlanner {
  /** The exits the leader took that we haven't yet, oldest first */
  readonly trail: ExitBody[] = [];
  readonly leaderName: string;
  private path: NavPoint[] = [];
  private planned = -Infinity;
  private noPathSince: number | null = null;
  /** Where we last saw the leader in this room, and when they vanished from it */
  private lastSeen: NavPoint | null = null;
  private vanishedAt: number | null = null;
  /** Using the next exit: when we got to it, and when we last pressed go */
  private exitStarted: number | null = null;
  private lastGo = -Infinity;
  private room = "";

  constructor(leaderName: string) {
    this.leaderName = leaderName;
  }

  /** The leader's exit message (4.3); a reason to stop, or null */
  addExit(exit: ExitBody): string | null {
    if (!exit.door && !exit.edge) return `${this.leaderName} left by a way you can't follow`;
    this.trail.push(exit);
    if (this.trail.length >= MAX_ROOMS_BEHIND) return `${this.leaderName} is too far ahead`;
    return null;
  }

  /** We came into another room: it should be the next on the trail; a reason to stop, or null */
  enteredRoom(room: string): string | null {
    const next = this.trail[0];
    this.path = [];
    this.planned = -Infinity;
    this.exitStarted = null;
    this.lastSeen = null;
    this.vanishedAt = null;
    this.noPathSince = null;
    if (next && room === next.to.toLowerCase()) {
      this.trail.shift();
      this.room = room;
      return null;
    }
    // Ours or the server's doing (a teleport, a death): not where the leader went
    if (this.room && room !== this.room) return "you went another way";
    this.room = room;
    return null;
  }

  step(f: FollowFrame): FollowStep {
    if (!this.room) this.room = f.room;
    const next = this.trail.find((e) => e.from.toLowerCase() === f.room);
    if (next) return this.toExit(next, f);
    if (f.leader) {
      this.lastSeen = { x: f.leader.x, y: f.leader.y };
      this.vanishedAt = null;
      return this.toLeader(f.leader, f);
    }
    // They've gone and haven't said where: wait for a late message, then the nearest door to where they were
    this.vanishedAt ??= f.now;
    if (f.now - this.vanishedAt < LATE_EXIT_MS) return { kind: "idle" };
    const seen = this.lastSeen;
    let door: { d: number; row: number; col: number; to: string } | null = null;
    if (seen && f.exits)
      for (const [row, col, to] of f.exits.doors) {
        if (!to) continue;
        const d = dist(squareCentre(row, col), seen);
        if (d <= FALLBACK_DOOR && (!door || d < door.d)) door = { d, row, col, to };
      }
    if (!door) return { kind: "stop", why: `${this.leaderName} left by a way you can't follow` };
    this.trail.push({ type: "exit", from: f.room, to: door.to, at: [door.row, door.col], door: [door.row, door.col] });
    return { kind: "idle" };
  }

  private toLeader(leader: NavPoint & { speed: number }, f: FollowFrame): FollowStep {
    const d = dist(f.self, leader);
    if (d <= CLOSE_ENOUGH) {
      this.path = [];
      this.noPathSince = null;
      return { kind: "idle" };
    }
    // A square behind them, on our side
    const target = { x: leader.x + ((f.self.x - leader.x) / d) * BEHIND, y: leader.y + ((f.self.y - leader.y) / d) * BEHIND };
    const run = leader.speed >= RUN_SPEED || d > RUN_DISTANCE;
    return this.walkTo(target, f, run);
  }

  private toExit(exit: ExitBody, f: FollowFrame): FollowStep {
    const run = true;
    if (exit.door) {
      const door = squareCentre(exit.door[0], exit.door[1]);
      if (this.exitStarted === null && dist(f.self, door) > NEAR_DOOR) return this.walkTo(door, f, run);
      this.exitStarted ??= f.now;
      if (f.now - this.exitStarted > DOOR_GIVE_UP_MS) return { kind: "stop", why: "the door wouldn't let you through" };
      const [row, col] = squareOf(f.self);
      if (row !== exit.door[0] || col !== exit.door[1]) return { kind: "walk", to: door, run: false };
      if (f.now - this.lastGo >= GO_EVERY_MS) {
        this.lastGo = f.now;
        return { kind: "go" };
      }
      return { kind: "idle" };
    }
    // An edge: to where they crossed, then on out
    const at = squareCentre(exit.at[0], exit.at[1]);
    if (this.exitStarted === null && dist(f.self, at) > SQ) return this.walkTo(at, f, run);
    this.exitStarted ??= f.now;
    if (f.now - this.exitStarted > EDGE_GIVE_UP_MS) return { kind: "stop", why: "you couldn't find the way out" };
    return { kind: "walk", to: beyondEdge(exit.edge!, at, f.size), run };
  }

  private walkTo(target: NavPoint, f: FollowFrame, run: boolean): FollowStep {
    if (!f.grid) return { kind: "walk", to: target, run };
    if (f.now - this.planned >= REPLAN_MS || !this.path.length) {
      this.planned = f.now;
      const path = findPath(f.grid, f.self, target);
      if (path?.length) {
        this.path = path;
        this.noPathSince = null;
      } else {
        this.path = [];
        this.noPathSince ??= f.now;
        if (f.now - this.noPathSince > NO_PATH_MS) return { kind: "stop", why: `you can't find a way to ${this.leaderName}` };
        return { kind: "idle" };
      }
    }
    while (this.path.length > 1 && dist(f.self, this.path[0]) < REACHED) this.path.shift();
    return { kind: "walk", to: this.path[0], run };
  }
}
