// Ours: the townsfolk, inn patrons, courtiers and arena fighters of the room you're in, seen by
// this client only.
//
// One AmbientLife per room visit. It builds the room's nav grid a little each frame, then keeps
// a crowd going:
// - In towns, people come out of a doorway and walk to another door (or out of sight) and go
//   in. Some run an errand on the way: they stop at a shop's door a while, as if trading. Guards
//   in the town's colours pace a beat.
// - In inns, patrons stand about, wander, gather to chat, and now and then leave by the door
//   while others come in.
// - In the castles, knights pace the halls and courtiers stand about as patrons do.
// - In the cities' shops, a customer or two comes in by the door, stands at the counter (by the
//   shopkeeper) or looks about a while, and goes.
// The arena's own fights are apart (arena/: one sim everyone watches); its foyer has a crowd.
// They step aside for the player, look twice at fine armour, wave back when waved at, run from
// spells, and say a word now and then (over their heads, never in the chat). Rain and snow thin the streets and hurry
// whoever is out. Nothing here is sent to the server.

import { FINENESS, kodToClient, type Room } from "@shards/formats";
import { NAV_CELL, cellAt, cellCentre, findPath, isOpen, navGridBuilder, nearestCell, randomCell, walkable, type NavGrid, type NavPoint } from "../navGrid.ts";
import type { WorldObject } from "../state.ts";
import type { ArenaFighterInfo } from "../arena/arenaView.ts";
import { busyAt, isErrandRoom, torchHours, weatherScale, type AmbientRoomSpec } from "./ambientRooms.ts";
import { chatterLine, scatterLine, type ChatterContext, type Role, type Weather } from "./chatter.ts";
import { personName } from "./names.ts";
import { tune } from "./tuning.ts";
import {
  C, fighterAppearance, guardAppearance, knightAppearance, ladyAppearance, lookFor, mageAppearance, makePerson, nobleAppearance, randomAppearance, setTorch,
  type Appearance, type Pose,
} from "./townsfolk.ts";

/** A room's doors (roomexits.json from the asset build), in Kod squares */
export interface AmbientExits {
  doors: [number, number, string | null][];
  edges: { side: "N" | "S" | "E" | "W"; to: string | null }[];
  arrivals: [number, number][];
}

/** What the crowd needs to know about the room each frame */
export interface AmbientFrame {
  /** Where the player stands (fine units), or null */
  player: NavPoint | null;
  /** Which way the player looks (client angle units): people come and go out of sight */
  facing?: number;
  /** Population scale (the Ambient Life setting) */
  scale: number;
  /** Real objects that block (MOVEON_NO): walkers keep out of their way */
  obstacles?: Iterable<NavPoint>;
  /** The game hour (0-23), or null when not known: how busy it is, and whether torches are lit */
  hour?: number | null;
  /** Rain or snow falling */
  weather?: Weather;
  /** The player wears armour worth a second look */
  impressive?: boolean;
}

/** Someone saying something, to show over their head */
export interface AmbientSpeech {
  obj: WorldObject;
  text: string;
}

/**
 * Something the crowd did that makes a sound (the client's ambientSounds.ts plays it): people
 * running from a spell, a patron's dice or drink
 */
export interface AmbientEvent {
  type: "flee" | "dice" | "drink";
  x: number;
  y: number;
  female?: boolean;
}

const SQ = FINENESS;
/** The inspect window's words for each role */
const ROLE_LABELS: Record<Role, string> = {
  folk: "Townsperson", patron: "Patron", customer: "Customer", guard: "Guard", knight: "Knight", lady: "Lady of the court", noble: "Noble",
  fighter: "Arena fighter", mage: "Arena mage", spectator: "Spectator",
};
/** Moods for when nothing in particular is going on, one per person (by their name) */
const MOODS = ["Content", "Cheerful", "Thoughtful", "Weary", "Busy", "Bored", "Curious", "Grumpy", "Hopeful", "Distracted"] as const;
/** The historic towns' ghosts' */
const GHOST_MOODS = ["Silent", "Wistful", "Forlorn", "Distant", "Lost in the past", "Restless"] as const;
const nameHash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** A walker stopping steps aside this far (fine units), so sprites don't share a spot */
const NUDGE_MIN = 24;
const NUDGE_MAX = 56;
/** How clear of walls that step must be */
const REACH_CLEARANCE_NUDGE = 64;
/** proto.h DRAWFX_TRANSLUCENT75/50/25: fading in and out */
const FADE_FX = [1, 2, 3, 0];
/** Ghosts (the historic towns) never get past half see-through: DRAWFX_TRANSLUCENT25, then 50 */
const GHOST_FX = [1, 1, 2, 2];
const FADE_MS = 600;
/** Turning speed, client angle units per ms */
const TURN_RATE = 6;
/** How long a walker waits for the player to get out of the way before going on */
const WAIT_FOR_PLAYER_MS = 1600;
const GREET_DISTANCE = 1.6 * SQ;
/** Waved at from nearer than this, anyone waves back, in front or not (the farther range is tune("waveRange")) */
const WAVE_NEAR = 2.5 * SQ;
const GREET_COOLDOWN_MS = 30000;
/** The player this close ahead: step aside */
const SIDESTEP_DISTANCE = 1.4 * SQ;
const SIDESTEP_COOLDOWN_MS = 2500;
/** Fine armour this close: a second look */
const GLANCE_DISTANCE = 3.5 * SQ;
const GLANCE_COOLDOWN_MS = 45000;
/** An area with no doors gets people only if it's this big (cells) and the player is in it */
const MIN_AREA_CELLS = 200;
/** Guards' beats, from one end to the other */
const BEAT_MIN = 5 * SQ,
  BEAT_MAX = 10 * SQ;
/** Cells this close to a blocking object are closed */
const OBSTACLE_RADIUS = 0.55 * SQ;
const OBSTACLE_REFRESH_MS = 1500;
/** Time per frame for building the nav grid */
const BUILD_BUDGET_MS = 3;

type Mode = "walk" | "idle";

interface Walker {
  obj: WorldObject;
  look: Appearance;
  role: Role;
  pose: Pose;
  mode: Mode;
  path: NavPoint[];
  pace: number;
  /** ms left standing (idle) */
  idleMs: number;
  /** Angle to turn to while standing, or -1 */
  faceAngle: number;
  /** Go in (or fade away) at the end of the path */
  leaving: boolean;
  /** 0..1 how visible, and which way it's going */
  fade: number;
  fadeDir: number;
  waitedMs: number;
  greetCooldown: number;
  sidestepMs: number;
  glanceMs: number;
  /** Inns: ms before they think of leaving */
  stayMs: number;
  /** After a wander: someone to face */
  faceId: number;
  /** Lights a torch after dark (towns), and whether it's lit */
  torchBearer: boolean;
  torch: boolean;
  /** The nav area they keep to (inns, castles, the arena) */
  area: number;
  /** Towns: the shop door they're visiting */
  errand: NavPoint | null;
  fleeing: boolean;
  say: { text: string; ms: number } | null;
  /** Guards: the two ends of their beat, and which they're heading for */
  beat: [NavPoint, NavPoint] | null;
  beatEnd: number;
  /** An emote playing (a dance, a cheer) for this long, and when to think of the next */
  emoteMs: number;
  nextEmoteMs: number;
  /** Which frame of the dance their cheer holds (lookFor's cheerFrame) */
  cheerFrame: number;
  /** Waved at: ms until they wave back (turning to us first) */
  waveBackMs: number;
  /** Ours (the inspect window): their name, the room they came in from, are going to, and run an errand to */
  name: string;
  fromRoom: string | null;
  toRoom: string | null;
  errandRoom: string | null;
}

/** What the inspect window shows of someone in the crowd (AmbientLife.describe) */
export interface AmbientPersonInfo {
  object: WorldObject;
  name: string;
  female: boolean;
  /** What they are: "Townsperson", "Patron", "Guard"... */
  role: string;
  /** What they're doing now */
  doing: string;
  mood: string;
  /** Room files (lower case): where they came in from, are going, and the shop they're visiting */
  from: string | null;
  to: string | null;
  errand: string | null;
  /** An arena fighter's archetype, favourites and season (arena/arenaView.ts) */
  arena?: ArenaFighterInfo;
  /** An arena spectator's fighter this round */
  cheering?: string;
}

interface ExitPoint {
  /** The doorway itself (where walkers go in), and the cell before it */
  at: NavPoint;
  cell: number;
  area: number;
  /** A door you can go in by (arrival squares are just outside one) */
  door: boolean;
  /** A shop, smithy, bank and the like: somewhere to run an errand */
  errand: boolean;
  /** The room it leads to (lower case), when known */
  to: string | null;
}

/** mulberry32 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const angleTo = (dx: number, dy: number) => Math.round((Math.atan2(dy, dx) * 4096) / (2 * Math.PI)) & 4095;
const dist = (a: NavPoint, b: NavPoint) => Math.hypot(a.x - b.x, a.y - b.y);

export class AmbientLife {
  readonly spec: AmbientRoomSpec;
  private readonly exits: AmbientExits | undefined;
  private readonly rand: () => number;
  private readonly nameRand: () => number;
  private builder: Generator<void, NavGrid> | null;
  private grid: NavGrid | null = null;
  private points: ExitPoint[] = [];
  /** Towns: areas with somewhere to come from and go to, and how likely each is */
  private areas: { area: number; weight: number }[] = [];
  /** Cells in each area */
  private cells = new Map<number, number>();
  /** Inns and castles: the area with the most doors */
  private mainArea = 1;
  /** The population scale this frame: the setting, the hour and the weather */
  private busy = 1;
  /** The real objects that block (shopkeepers and the like), as of the last look */
  private blockers: NavPoint[] = [];
  private eventList: AmbientEvent[] = [];
  private walkers: Walker[] = [];
  private spawnMs = 0;
  private sayMs = 2000;
  private obstacleMs = 0;
  private playerAreaMs = 0;
  private playerArea = 0;
  private guardTries = 0;
  private ageMs = 0;
  private populated = false;
  private pointsPending = false;
  /** Towns: how many of the crowd already out are still to place (a couple a frame: each needs a path) */
  private toPlace = 0;
  private frame: AmbientFrame = { player: null, scale: 1 };
  private hour: number | null = null;
  private weather: Weather = null;

  /**
   * @param grid the room's nav grid if it's already built (the asset build's, or one kept from
   *   an earlier visit); without one, it's built here a little each frame
   */
  constructor(
    room: Room, spec: AmbientRoomSpec, exits: AmbientExits | undefined, seed = Math.floor(Math.random() * 2 ** 32), grid?: NavGrid,
    waterTextures?: ReadonlySet<number>,
  ) {
    this.spec = spec;
    this.exits = exits;
    this.rand = seededRandom(seed);
    // Names from a stream of their own: naming somebody changes nothing the crowd does
    this.nameRand = seededRandom((seed ^ 0x5bd1e995) >>> 0);
    if (grid) {
      grid.closed.fill(0);
      this.grid = grid;
      this.builder = null;
      this.pointsPending = true;
    } else this.builder = navGridBuilder(room, 2, waterTextures);
  }

  /** Whether the grid is built and the crowd is out */
  get ready(): boolean {
    return this.grid !== null && !this.pointsPending;
  }

  /** The figures to draw */
  objects(): WorldObject[] {
    return this.walkers.map((w) => w.obj);
  }

  /** What made a sound since the last call */
  takeEvents(): AmbientEvent[] {
    const e = this.eventList;
    this.eventList = [];
    return e;
  }

  private event(e: AmbientEvent): void {
    if (this.eventList.length < 40) this.eventList.push(e);
  }

  /** What's being said, over whose head */
  speech(): AmbientSpeech[] {
    return this.walkers.filter((w) => w.say && w.fadeDir >= 0).map((w) => ({ obj: w.obj, text: w.say!.text }));
  }

  /** Whether an id is someone in the crowd (the inspect window) */
  has(id: number): boolean {
    return this.walkers.some((w) => w.obj.id === id && w.fadeDir >= 0);
  }

  /** Someone in the crowd, as the inspect window shows them; null if they've gone */
  describe(id: number): AmbientPersonInfo | null {
    const w = this.walkers.find((v) => v.obj.id === id);
    if (!w) return null;
    const kind = this.spec.kind;
    const label = ROLE_LABELS[w.role] ?? "Townsperson";
    const role = this.spec.ghost ? `Ghost of a ${label.toLowerCase()}` : label;
    let doing: string;
    if (w.fleeing) doing = "Running from danger";
    else if (w.beat) doing = w.role === "knight" ? "Standing watch" : "Keeping the peace on their beat";
    else if (w.mode === "walk" && w.errand) doing = "Off on an errand";
    else if (w.mode === "walk" && w.leaving) doing = w.toRoom ? "On the way somewhere" : "Heading out";
    else if (w.mode === "walk") doing = "Strolling about";
    else if (w.errand) doing = "Trading at a shop's door";
    else if (w.emoteMs > 0 && w.pose === "dance") doing = "Dancing";
    else if (kind === "inn") doing = "Drinking and talking";
    else if (kind === "shop") doing = "Looking over the wares";
    else if (kind === "castle") doing = "Attending the court";
    else doing = "Standing about";
    let mood: string;
    if (w.fleeing) mood = "Frightened";
    else if (this.spec.ghost) mood = GHOST_MOODS[nameHash(w.name) % GHOST_MOODS.length];
    else if (w.say && w.waveBackMs > 0) mood = "Friendly";
    else if (this.weather === "rain" && kind === "town") mood = "Soggy";
    else if (this.weather === "snow" && kind === "town") mood = "Chilly";
    else if (kind === "inn" && this.hour !== null && (this.hour >= 20 || this.hour < 2)) mood = "Merry";
    else mood = MOODS[nameHash(w.name) % MOODS.length];
    return { object: w.obj, name: w.name, female: w.look.female, role, doing, mood, from: w.fromRoom, to: w.toRoom, errand: w.errandRoom };
  }

  /** The nav grid, once built (for the dev tools) */
  get nav(): NavGrid | null {
    return this.grid;
  }

  /** The paths walkers are on (for the dev tools) */
  paths(): NavPoint[][] {
    return this.walkers.filter((w) => w.mode === "walk").map((w) => [{ x: w.obj.x, y: w.obj.y }, ...w.path]);
  }

  /** Everyone goes at once (the setting turned off) */
  clear(): void {
    this.walkers = [];
  }

  /** A big spell went off at `at`: those within `radius` run (guards, knights and fighters stand and look) */
  scatter(at: NavPoint, radius: number): void {
    if (!this.ready) return;
    let cried = false;
    for (const w of this.walkers) {
      if (w.fadeDir < 0 || w.fleeing || dist(w.obj, at) > radius) continue;
      if (w.role === "guard" || w.role === "knight" || w.role === "fighter") {
        w.faceAngle = angleTo(at.x - w.obj.x, at.y - w.obj.y);
        continue;
      }
      if (this.flee(w, at) && !cried) {
        cried = true;
        // Ghosts run without a cry
        if (!this.spec.ghost) this.event({ type: "flee", x: w.obj.x, y: w.obj.y, female: w.look.female });
        if (this.rand() < 0.7) this.say(w, scatterLine(this.rand));
      }
    }
  }

  /**
   * The player waved (UA_WAVE) from `p`, facing `facing`: the nearest close by in front of them
   * (or anyone right beside them) stops, turns to them and waves back. Anyone holding a weapon
   * (guards, knights) turns and says a word instead.
   */
  wavedAt(p: NavPoint, facing: number): void {
    if (!this.ready) return;
    const ahead = (w: Walker) => Math.abs(((angleTo(w.obj.x - p.x, w.obj.y - p.y) - facing + 6144) % 4096) - 2048) < 700;
    const near = this.walkers
      .filter((w) => w.fadeDir >= 0 && w.fade >= 1 && !w.fleeing && w.waveBackMs <= 0 && dist(w.obj, p) < tune("waveRange") * SQ)
      .filter((w) => ahead(w) || dist(w.obj, p) < WAVE_NEAR)
      .sort((a, b) => dist(a.obj, p) - dist(b.obj, p));
    const w = near[0];
    if (!w) return;
    if (w.mode === "walk") this.pause(w, 2500 + this.rand() * 1500);
    else w.idleMs = Math.max(w.idleMs, 2000);
    w.emoteMs = 0;
    w.faceAngle = angleTo(p.x - w.obj.x, p.y - w.obj.y);
    w.greetCooldown = GREET_COOLDOWN_MS;
    w.waveBackMs = 450 + this.rand() * 400;
    const armed = !!w.look.gear?.weapon;
    if (!w.say && (armed || this.rand() < 0.4)) this.say(w, chatterLine(this.rand, this.context(w, { greeting: true })));
  }

  update(dt: number, frame: AmbientFrame): void {
    if (this.builder) {
      const start = performance.now();
      while (performance.now() - start < BUILD_BUDGET_MS) {
        const r = this.builder.next();
        if (r.done) {
          this.grid = r.value;
          this.builder = null;
          this.pointsPending = true;
          break;
        }
      }
      return;
    }
    if (this.pointsPending) {
      // The next frame: where the doors are, and on we go
      this.pointsPending = false;
      this.findPoints();
      this.obstacleMs = 0;
      // A rebuilt room: walkers find their way again from where they stand
      for (const w of this.walkers) if (w.mode === "walk") this.repath(w);
      return;
    }
    const g = this.grid!;
    this.frame = frame;
    this.ageMs += dt;
    if ((this.obstacleMs -= dt) <= 0) {
      this.obstacleMs = OBSTACLE_REFRESH_MS;
      this.closeAround(g, frame.obstacles ?? []);
    }
    if (frame.player && (this.playerAreaMs -= dt) <= 0) {
      this.playerAreaMs = 1000;
      const cell = nearestCell(g, frame.player.x, frame.player.y, 2);
      this.playerArea = cell >= 0 ? g.area[cell] : 0;
    }
    const kind = this.spec.kind;
    this.hour = frame.hour ?? null;
    this.weather = frame.weather ?? null;
    this.busy = frame.scale * busyAt(kind, this.hour) * weatherScale(kind, this.weather) * tune("crowdScale");
    const target = Math.round(this.spec.count * this.busy);
    // Guards are on duty whatever the hour; Few halves them, Many doesn't add any
    const guards = frame.scale > 0 ? Math.round((this.spec.guards ?? 0) * Math.min(1, frame.scale)) : 0;
    if (target === 0 && guards === 0) {
      this.clear();
      return;
    }
    if (!this.populated) {
      this.populated = true;
      this.populate(target);
    }
    for (let k = 0; k < 2 && this.toPlace > 0; k++, this.toPlace--) this.placeOnTheWay();
    this.keepGuards(guards);
    this.keepPopulation(target, dt);
    // Ghosts walk in the dark
    const dark = kind === "town" && !this.spec.ghost && torchHours(this.hour);
    for (const w of this.walkers) {
      if (w.torch !== (dark && w.torchBearer)) {
        w.torch = !w.torch;
        setTorch(w.obj, w.look, w.pose, w.torch);
      }
      if (w.say && (w.say.ms -= dt) <= 0) w.say = null;
    }
    this.chatter(dt);
    for (const w of this.walkers) this.step(w, dt, frame.player);
    this.walkers = this.walkers.filter((w) => !(w.fadeDir < 0 && w.fade <= 0));
  }

  // ---- places ----

  private findPoints(): void {
    const g = this.grid!;
    const points: ExitPoint[] = [];
    const add = (at: NavPoint, door: boolean, errand = false, to: string | null = null) => {
      // The nearest cell from which the doorway can be reached in a straight line: walkers stop
      // there, then step into the doorway itself
      const cell = nearestCell(g, at.x, at.y, 3);
      if (cell >= 0) points.push({ at, cell, area: g.area[cell], door, errand, to: to?.toLowerCase() ?? null });
    };
    const ex = this.exits;
    if (ex) {
      // Neighbouring door squares make one door, entered at its middle
      const groups: { rows: number[]; cols: number[]; to: string | null }[] = [];
      for (const [row, col, to] of ex.doors) {
        const grp = groups.find((d) => d.to === to && d.rows.some((r, k) => Math.abs(r - row) <= 1 && Math.abs(d.cols[k] - col) <= 1));
        if (grp) {
          grp.rows.push(row);
          grp.cols.push(col);
        } else groups.push({ rows: [row], cols: [col], to });
      }
      const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      for (const d of groups) {
        const r = mean(d.rows),
          c = mean(d.cols);
        add({ x: (c - 1) * SQ + SQ / 2, y: (r - 1) * SQ + SQ / 2 }, true, isErrandRoom(d.to), d.to);
      }
      // Where players come out of a door is beside it, not in it: only for doors with no way in
      // found above (people disappeared a step to the side of their door)
      const doors = points.length;
      for (const [row, col] of ex.arrivals) {
        const at = kodToClient(row, col);
        if (!points.slice(0, doors).some((p) => dist(p.at, at) < 2.5 * SQ)) add(at, false);
      }
      for (const e of ex.edges) for (const at of this.edgePoints(e.side)) add(at, true, false, e.to);
    }
    this.points = points;
    this.cells.clear();
    for (const a of g.area) if (a) this.cells.set(a, (this.cells.get(a) ?? 0) + 1);
    const counts = new Map<number, number>();
    for (const p of points) counts.set(p.area, (counts.get(p.area) ?? 0) + 1);
    // Towns: any area with a door, the main streets (more doors, more room) most of all
    this.areas = [...counts.entries()]
      .filter(([a]) => a > 0)
      .map(([area, n]) => ({ area, weight: (this.cells.get(area) ?? 0) * (n >= 2 ? 1 : 0.4) }))
      .sort((a, b) => b.weight - a.weight);
    // No doors known: the largest open area
    if (!this.areas.length) this.areas = [{ area: 1, weight: 1 }];
    const busiest = [...counts.entries()].filter(([a]) => a > 0).sort((a, b) => b[1] - a[1] || (this.cells.get(b[0]) ?? 0) - (this.cells.get(a[0]) ?? 0));
    this.mainArea = busiest[0]?.[0] ?? 1;
  }

  /** A few walkable spots along one side of the room */
  private edgePoints(side: "N" | "S" | "E" | "W"): NavPoint[] {
    const g = this.grid!;
    const out: NavPoint[] = [];
    const along = side === "N" || side === "S" ? g.cols : g.rows;
    for (let k = 0; k < along; k += 3) {
      for (let depth = 0; depth < 4; depth++) {
        const c = side === "N" || side === "S" ? k : side === "W" ? depth : g.cols - 1 - depth;
        const r = side === "E" || side === "W" ? k : side === "N" ? depth : g.rows - 1 - depth;
        const cell = r * g.cols + c;
        if (g.walk[cell] && g.area[cell] === 1) {
          out.push(cellCentre(g, cell));
          break;
        }
      }
    }
    // A handful, spread out
    return out.filter((_, i) => i % Math.max(1, Math.floor(out.length / 4)) === 0).slice(0, 4);
  }

  /** Close the cells next to things that block, so paths go round them */
  private closeAround(g: NavGrid, obstacles: Iterable<NavPoint>): void {
    g.closed.fill(0);
    this.blockers = [...obstacles].map((o) => ({ x: o.x, y: o.y }));
    const r = Math.ceil(OBSTACLE_RADIUS / NAV_CELL);
    for (const o of obstacles) {
      const c0 = Math.round(o.x / NAV_CELL),
        r0 = Math.round(o.y / NAV_CELL);
      for (let rr = r0 - r; rr <= r0 + r; rr++)
        for (let cc = c0 - r; cc <= c0 + r; cc++) {
          if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
          const i = rr * g.cols + cc;
          if (dist(cellCentre(g, i), o) < OBSTACLE_RADIUS) g.closed[i] = 1;
        }
    }
  }

  /** Towns: where the next walker goes about; the player's own part of town half the time */
  private pickArea(): number {
    const pa = this.playerArea;
    if (pa > 0 && this.rand() < 0.5 && (this.areas.some((a) => a.area === pa) || (this.cells.get(pa) ?? 0) >= MIN_AREA_CELLS)) return pa;
    const total = this.areas.reduce((s, a) => s + a.weight, 0);
    let r = this.rand() * total;
    for (const a of this.areas) if ((r -= a.weight) < 0) return a.area;
    return this.areas[0].area;
  }

  private pointsIn(area: number, door?: boolean): ExitPoint[] {
    return this.points.filter((p) => p.area === area && isOpen(this.grid!, p.cell) && (door === undefined || p.door === door));
  }

  private areaOf(p: NavPoint): number {
    const cell = nearestCell(this.grid!, p.x, p.y, 2);
    return cell >= 0 ? this.grid!.area[cell] : 0;
  }

  /** A path to an exit point that ends in the doorway itself, not just near it */
  private pathToPoint(from: NavPoint, p: ExitPoint): NavPoint[] | null {
    const g = this.grid!;
    const before = cellCentre(g, p.cell);
    const path = findPath(g, from, before);
    if (!path) return null;
    // nearestCell chose the cell for reaching the doorway straight on
    if (dist(before, p.at) > 1) path.push(p.at);
    return path;
  }

  /** Whether the player can't see a spot: far off, or behind them */
  private hidden(p: NavPoint): boolean {
    const pl = this.frame.player;
    if (!pl) return true;
    const d = dist(p, pl);
    if (d > 14 * SQ) return true;
    if (d < 2 * SQ) return false;
    const f = this.frame.facing;
    if (f === undefined) return d > 8 * SQ;
    const off = Math.abs(((angleTo(p.x - pl.x, p.y - pl.y) - f + 6144) % 4096) - 2048);
    return off > 900;
  }

  /** A random open cell in an area, out of the player's sight if one can be found */
  private hiddenCell(area: number): number {
    for (let k = 0; k < 30; k++) {
      const cell = randomCell(this.grid!, this.rand, area);
      if (cell < 0) return -1;
      if (this.hidden(cellCentre(this.grid!, cell))) return cell;
    }
    return this.openCellAwayFrom(area);
  }

  /** A random open cell in an area, not on top of the player; `near`: within tune("nearPlayer") squares of them if there's one */
  private openCellAwayFrom(area: number, near = false): number {
    const player = this.frame.player;
    let fallback = -1;
    for (let k = 0; k < 40; k++) {
      const cell = randomCell(this.grid!, this.rand, area);
      if (cell < 0) return -1;
      const d = player ? dist(cellCentre(this.grid!, cell), player) : Infinity;
      if (d < 1.5 * SQ) continue;
      if (!near || !player || d < tune("nearPlayer") * SQ) return cell;
      if (fallback < 0) fallback = cell;
    }
    return fallback;
  }

  private pick<T>(list: T[]): T {
    return list[Math.floor(this.rand() * list.length) % list.length];
  }

  // ---- people ----

  private newRole(): Role {
    const r = this.rand();
    switch (this.spec.kind) {
      case "town":
        return "folk";
      case "inn":
        return "patron";
      case "castle":
        // Mostly the court: few knights
        return r < 0.1 ? "knight" : r < 0.45 ? "lady" : "noble";
      case "shop":
        return "customer";
      case "arena":
        // The arena's foyer: all sorts (its floor is the arena sim's, arena/)
        return r < 0.4 ? "fighter" : r < 0.55 ? "mage" : "spectator";
    }
  }

  private dress(role: Role): Appearance {
    switch (role) {
      case "guard":
        return guardAppearance(this.rand, this.spec.livery ?? C.BLUE);
      case "knight":
        return knightAppearance(this.rand, this.spec.faction ?? "princess");
      case "lady":
        return ladyAppearance(this.rand);
      case "noble":
        return nobleAppearance(this.rand);
      case "fighter":
        return fighterAppearance(this.rand);
      case "mage":
        return mageAppearance(this.rand);
      default:
        return randomAppearance(this.rand);
    }
  }

  /** Where someone who stays in the room keeps to */
  private homeArea(): number {
    if (this.spec.kind === "town") return this.pickArea();
    const pa = this.playerArea;
    if (pa > 0 && pa !== this.mainArea && (this.cells.get(pa) ?? 0) >= MIN_AREA_CELLS && this.rand() < 0.4) return pa;
    return this.mainArea;
  }

  /** Whether they stay in the room, standing about (everyone but townsfolk) */
  private get stays(): boolean {
    return this.spec.kind !== "town";
  }

  private spawn(at: NavPoint, angle: number, fadeIn: boolean, role: Role, area: number, look = this.dress(role)): Walker {
    const obj = makePerson(look, Math.round(at.x), Math.round(at.y), angle);
    const slow = role === "guard" || role === "knight" || role === "lady";
    const pace = (tune("paceMin") + this.rand() * (tune("paceMax") - tune("paceMin"))) * (slow ? 0.75 : 1);
    const w: Walker = {
      obj, look, role, pose: "stand", mode: "idle", path: [], pace, idleMs: 0, faceAngle: -1, leaving: false, fade: fadeIn ? 0 : 1,
      fadeDir: fadeIn ? 1 : 0, waitedMs: 0, greetCooldown: 0, sidestepMs: 0, glanceMs: 0, stayMs: this.spec.kind === "shop" ? 20000 + this.rand() * 40000 : 60000 + this.rand() * 180000, faceId: -1,
      torchBearer: role === "guard" || (role === "folk" && this.rand() < tune("torchBearers")), torch: false, area, errand: null, fleeing: false,
      say: null, beat: null, beatEnd: 0, emoteMs: 0, nextEmoteMs: 2000 + this.rand() * 8000, cheerFrame: 0, waveBackMs: 0,
      name: personName(this.nameRand, role, look.female), fromRoom: null, toRoom: null, errandRoom: null,
    };
    this.applyFade(w);
    this.walkers.push(w);
    return w;
  }

  /** The crowd already out when you arrive */
  private populate(target: number): void {
    const g = this.grid!;
    if (this.stays) {
      for (let k = 0; k < target; k++) {
        const role = this.newRole();
        const area = this.homeArea();
        const cell = this.openCellAwayFrom(area, true);
        if (cell < 0) break;
        const w = this.spawn(cellCentre(g, cell), Math.floor(this.rand() * 4096), false, role, area);
        w.idleMs = this.rand() * 15000;
      }
      this.gatherPairs();
      return;
    }
    // Towns: most are already on their way somewhere
    this.toPlace = Math.ceil(target * 0.8);
  }

  /**
   * Towns: where someone goes from `from`: sometimes a shop's door first (an errand), else
   * another door to go in by, else (an area without doors) somewhere out of sight to fade away
   */
  private planTown(from: NavPoint, area: number): { path: NavPoint[]; errand: NavPoint | null; leaving: boolean; to: string | null; errandRoom: string | null } | null {
    const g = this.grid!;
    const errands = this.pointsIn(area).filter((p) => p.errand && dist(p.at, from) >= 4 * SQ);
    if (errands.length && this.rand() < tune("errandChance") * (this.weather ? 0.4 : 1)) {
      const p = this.pick(errands);
      const path = findPath(g, from, cellCentre(g, p.cell));
      if (path) return { path, errand: p.at, leaving: false, to: null, errandRoom: p.to };
    }
    const doors = this.pointsIn(area).filter((p) => dist(p.at, from) >= 8 * SQ);
    if (doors.length) {
      const door = this.pick(doors);
      const path = this.pathToPoint(from, door);
      if (path) return { path, errand: null, leaving: true, to: door.to, errandRoom: null };
    }
    const cell = this.hiddenCell(area);
    const path = cell >= 0 ? findPath(g, from, cellCentre(g, cell)) : null;
    return path ? { path, errand: null, leaving: true, to: null, errandRoom: null } : null;
  }

  /** Towns: someone part way along their walk from one door to another */
  private placeOnTheWay(): void {
    const g = this.grid!;
    const area = this.pickArea();
    const starts = this.pointsIn(area);
    const start = starts.length ? this.pick(starts) : null;
    const cell = start ? start.cell : this.openCellAwayFrom(area);
    if (cell < 0) return;
    const from = cellCentre(g, cell);
    const plan = this.planTown(from, area);
    if (!plan || !plan.path.length) return;
    const pts = [from, ...plan.path];
    const i = Math.floor(this.rand() * (pts.length - 1));
    const t = this.rand();
    const at = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    const player = this.frame.player;
    if (player && dist(at, player) < 1.5 * SQ) return;
    const w = this.spawn(at, angleTo(pts[i + 1].x - at.x, pts[i + 1].y - at.y), false, "folk", area);
    this.walk(w, pts.slice(i + 1), plan.leaving);
    w.errand = plan.errand;
    w.fromRoom = start?.to ?? null;
    w.toRoom = plan.to;
    w.errandRoom = plan.errandRoom;
  }

  /** Inns and castles: a few stand together in twos, facing each other */
  private gatherPairs(): void {
    const idle = this.walkers.filter((w) => w.mode === "idle" && !w.beat && w.role !== "fighter");
    for (let k = 0; k + 1 < idle.length; k += 2) {
      if (this.rand() < 0.5) continue;
      const a = idle[k],
        b = idle[k + 1];
      if (a.area !== b.area) continue;
      const spot = this.besideCell(a.obj, a.area);
      if (spot < 0) continue;
      const at = cellCentre(this.grid!, spot);
      b.obj.x = Math.round(at.x);
      b.obj.y = Math.round(at.y);
      this.face(a, b);
    }
  }

  private face(a: Walker, b: Walker): void {
    a.faceAngle = angleTo(b.obj.x - a.obj.x, b.obj.y - a.obj.y);
    b.faceAngle = angleTo(a.obj.x - b.obj.x, a.obj.y - b.obj.y);
  }

  /** An open cell next to someone (about a square away), or -1 */
  private besideCell(o: NavPoint, area: number): number {
    const g = this.grid!;
    for (let k = 0; k < 12; k++) {
      const a = this.rand() * 2 * Math.PI;
      const cell = nearestCell(g, o.x + Math.cos(a) * SQ, o.y + Math.sin(a) * SQ, 0, area);
      if (cell >= 0 && dist(cellCentre(g, cell), o) > SQ * 0.6) return cell;
    }
    return -1;
  }

  /** Keep about `target` people about (guards apart): come in by the doors, or go when there are too many */
  private keepPopulation(target: number, dt: number): void {
    const g = this.grid!;
    const stays = this.stays;
    // Guards are kept apart
    const people = this.walkers.filter((w) => !w.beat);
    // Towns: everyone is on their way to a door, so count all but those going in now
    const staying = people.filter((w) => (stays ? !w.leaving : w.fadeDir >= 0));
    if (staying.length > target) {
      for (const w of staying.filter((v) => !v.leaving).slice(0, staying.length - target)) this.leave(w);
      return;
    }
    if (staying.length + this.toPlace >= target || (this.spawnMs -= dt) > 0) return;
    // Sooner the emptier it is
    const full = target ? staying.length / target : 1;
    this.spawnMs = (stays ? 4000 + this.rand() * 10000 : 500 + this.rand() * 2500) * (0.3 + full);
    const role = this.newRole();
    const area = this.homeArea();
    const player = this.frame.player;
    // In by a door (from the doorway itself), or out of sight where there's none
    let starts = this.pointsIn(area).filter((p) => !player || dist(p.at, player) > 1.5 * SQ);
    // Those who stay come in by a door near the player, in a big room
    if (stays && player) starts = starts.filter((p) => dist(p.at, player) < tune("nearPlayer") * SQ);
    let from: NavPoint;
    let fromRoom: string | null = null;
    const lead: NavPoint[] = [];
    if (starts.length) {
      const p = this.pick(starts);
      from = p.at;
      fromRoom = p.to;
      lead.push(cellCentre(g, p.cell));
    } else {
      const cell = this.hiddenCell(area);
      if (cell < 0) return;
      from = cellCentre(g, cell);
    }
    const w = this.spawn(from, Math.floor(this.rand() * 4096), true, role, area);
    w.fromRoom = fromRoom;
    const start = lead[0] ?? from;
    if (stays) {
      // In from the door, and somewhere to stand
      const cell = this.openCellAwayFrom(area, true);
      const path = cell >= 0 ? findPath(g, start, cellCentre(g, cell)) : null;
      if (path) this.walk(w, [...lead, ...path], false);
      else w.idleMs = 5000;
      return;
    }
    const plan = this.planTown(start, area);
    if (plan) {
      this.walk(w, [...lead, ...plan.path], plan.leaving);
      w.errand = plan.errand;
      w.toRoom = plan.to;
      w.errandRoom = plan.errandRoom;
    } else this.leave(w);
  }

  /** Guards (towns) and knights (castles) on their beats: one more a frame until there are enough */
  private keepGuards(n: number): void {
    const guards = this.walkers.filter((w) => w.beat && w.fadeDir >= 0);
    if (guards.length > n) {
      const w = guards[guards.length - 1];
      w.leaving = true;
      w.fadeDir = -1;
      return;
    }
    if (guards.length === n || this.guardTries > 5) return;
    const area = this.spec.kind === "town" ? this.pickArea() : this.mainArea;
    const beat = this.findBeat(area, guards);
    if (!beat) {
      this.guardTries++;
      return;
    }
    const t = this.rand();
    const at = { x: beat[0].x + (beat[1].x - beat[0].x) * t, y: beat[0].y + (beat[1].y - beat[0].y) * t };
    const role: Role = this.spec.kind === "town" ? "guard" : "knight";
    const w = this.spawn(at, 0, this.ageMs > 1000, role, area);
    w.beat = beat;
    w.beatEnd = this.rand() < 0.5 ? 0 : 1;
    w.obj.angle = angleTo(beat[w.beatEnd].x - at.x, beat[w.beatEnd].y - at.y);
    this.walk(w, [beat[w.beatEnd]], false);
  }

  /** A straight stretch of open ground to pace, clear of doorways and the other guards' */
  private findBeat(area: number, guards: Walker[]): [NavPoint, NavPoint] | null {
    const g = this.grid!;
    const player = this.frame.player;
    const clear = (p: NavPoint) =>
      this.points.every((d) => dist(d.at, p) > 1.5 * SQ) && guards.every((v) => v.beat!.every((e) => dist(e, p) > 4 * SQ));
    for (let k = 0; k < 40; k++) {
      const cell = randomCell(g, this.rand, area);
      if (cell < 0) return null;
      const a = cellCentre(g, cell);
      if ((player && (dist(a, player) < 2 * SQ || (k < 30 && dist(a, player) > 2 * tune("nearPlayer") * SQ))) || !clear(a)) continue;
      const dir = (Math.floor(this.rand() * 8) * Math.PI) / 4;
      const len = BEAT_MIN + this.rand() * (BEAT_MAX - BEAT_MIN);
      const endCell = cellAt(g, a.x + Math.cos(dir) * len, a.y + Math.sin(dir) * len);
      if (endCell < 0 || !isOpen(g, endCell) || g.area[endCell] !== area) continue;
      const b = cellCentre(g, endCell);
      if (dist(a, b) >= BEAT_MIN * 0.9 && clear(b) && walkable(g, a.x, a.y, b.x, b.y)) return [a, b];
    }
    return null;
  }

  // ---- emotes ----

  /** An emote for a while: a dance or a cheer lasts `ms`; a wave or a point plays once */
  private emote(w: Walker, pose: Pose, ms: number): void {
    // A cheer is a frame of the dance, a different one each time
    if (pose === "cheer") w.cheerFrame = Math.floor(this.rand() * 17) % 17;
    this.setPose(w, pose, true);
    w.emoteMs = ms;
  }

  /**
   * Standing about, now and then: patrons (inns) wave, point at whoever they're with, or dance
   * (about one in ten); courtiers wave and point
   */
  private fidget(w: Walker): void {
    w.nextEmoteMs = 6000 + this.rand() * 14000;
    if (w.look.gear?.weapon || w.torch) return;
    const r = this.rand();
    const inn = this.spec.kind === "inn";
    if (inn && r < 0.1) return this.emote(w, "dance", 6000 + this.rand() * 9000);
    // A roll of the dice (11%) or a drink (14%) now and then
    if (inn && r > 0.75) return this.event({ type: r > 0.89 ? "dice" : "drink", x: w.obj.x, y: w.obj.y });
    const near = this.walkers.find((v) => v !== w && v.fadeDir >= 0 && dist(v.obj, w.obj) < 2.5 * SQ);
    if (near && r < 0.3) {
      w.faceAngle = angleTo(near.obj.x - w.obj.x, near.obj.y - w.obj.y);
      return this.emote(w, "point", 0);
    }
    if (r < 0.4) this.emote(w, "wave", 0);
  }

  // ---- speech ----

  private context(w: Walker, extra: Partial<ChatterContext> = {}): ChatterContext {
    return { place: this.spec.place, role: w.role, hour: this.hour, weather: this.weather, ...extra };
  }

  private say(w: Walker, text: string): void {
    // Ghosts say nothing (the line is still drawn, so the crowd's random stream is the same)
    if (this.spec.ghost) return;
    w.say = { text, ms: tune("sayMs") + text.length * 40 };
  }

  /** Now and then, someone near the player says something */
  private chatter(dt: number): void {
    if ((this.sayMs -= dt) > 0) return;
    this.sayMs = (this.spec.kind === "inn" ? 2500 : 4000) + this.rand() * 7000;
    const pl = this.frame.player;
    if (!pl || this.walkers.filter((w) => w.say).length >= tune("maxSpeaking")) return;
    const near = this.walkers.filter((w) => !w.say && w.fadeDir >= 0 && w.fade >= 1 && !w.fleeing && dist(w.obj, pl) < tune("speakRange") * SQ);
    if (!near.length) return;
    const w = this.pick(near);
    this.say(w, chatterLine(this.rand, this.context(w)));
  }

  // ---- moving about ----

  private walk(w: Walker, path: NavPoint[], leaving: boolean): void {
    w.emoteMs = 0;
    w.path = path;
    w.mode = "walk";
    w.leaving = leaving;
    w.waitedMs = 0;
    w.faceAngle = -1;
    w.faceId = -1;
    this.setPose(w, "walk");
  }

  /** Head for a door and go in; with none, out of sight and fade away */
  private leave(w: Walker): void {
    if (w.leaving && w.mode === "walk") return;
    w.errand = null;
    const g = this.grid;
    const here = { x: w.obj.x, y: w.obj.y };
    if (g) {
      const area = this.areaOf(here);
      const doors = this.pointsIn(area, true);
      const ways = doors.length ? doors : this.pointsIn(area);
      if (ways.length) {
        const near = ways.sort((a, b) => dist(a.at, here) - dist(b.at, here)).slice(0, 3);
        const path = this.pathToPoint(here, this.pick(near));
        if (path) return this.walk(w, path, true);
      } else if (!this.hidden(here)) {
        const cell = this.hiddenCell(area);
        const path = cell >= 0 ? findPath(g, here, cellCentre(g, cell)) : null;
        if (path?.length) return this.walk(w, path, true);
      }
    }
    w.leaving = true;
    w.fadeDir = -1;
  }

  /** Run from a spell: several squares away from it, then on about their business */
  private flee(w: Walker, from: NavPoint): boolean {
    const g = this.grid!;
    const o = w.obj;
    const area = this.areaOf(o);
    const base = o.x === from.x && o.y === from.y ? this.rand() * 2 * Math.PI : Math.atan2(o.y - from.y, o.x - from.x);
    for (let k = 0; k < 6; k++) {
      const a = base + (this.rand() - 0.5) * 1.6;
      const len = (5 + this.rand() * 4) * SQ;
      const cell = nearestCell(g, o.x + Math.cos(a) * len, o.y + Math.sin(a) * len, 3, area);
      if (cell < 0) continue;
      const path = findPath(g, o, cellCentre(g, cell));
      if (!path?.length) continue;
      w.errand = null;
      this.walk(w, path, false);
      w.fleeing = true;
      return true;
    }
    return false;
  }

  private repath(w: Walker): void {
    const end = w.path[w.path.length - 1];
    const path = end ? findPath(this.grid!, { x: w.obj.x, y: w.obj.y }, end) : null;
    if (path) w.path = path;
    else this.stand(w, 2000);
  }

  private stand(w: Walker, ms: number): void {
    w.mode = "idle";
    w.path = [];
    w.idleMs = ms;
    this.setPose(w, "stand");
    this.nudge(w);
  }

  /**
   * A step aside on stopping, a few fine units in a random direction the walls allow: two figures
   * (or a figure and a prop) standing on one spot draw at one depth and flicker through each other
   */
  private nudge(w: Walker): void {
    const a = this.rand() * 2 * Math.PI,
      r = NUDGE_MIN + this.rand() * (NUDGE_MAX - NUDGE_MIN);
    const x = Math.round(w.obj.x + Math.cos(a) * r),
      y = Math.round(w.obj.y + Math.sin(a) * r);
    if (this.grid && walkable(this.grid, w.obj.x, w.obj.y, x, y, REACH_CLEARANCE_NUDGE)) {
      w.obj.x = x;
      w.obj.y = y;
    }
  }

  /** Stop a while, then go on the way they were going */
  private pause(w: Walker, ms: number): void {
    const rest = w.path,
      leaving = w.leaving;
    this.stand(w, ms);
    w.path = rest;
    w.leaving = leaving;
  }

  /** A swing or a wave plays once, so `again` starts it over */
  private setPose(w: Walker, pose: Pose, again = false): void {
    if (w.pose === pose && !again) return;
    w.pose = pose;
    const o = w.obj;
    if (pose === "walk") o.look = o.moving;
    else {
      o.normal = lookFor(w.look, pose, w.torch, w.cheerFrame);
      o.look = o.normal;
    }
    o.info.overlays = o.look.overlays;
    o.version++;
  }

  private applyFade(w: Walker): void {
    const dt = (this.spec.ghost ? GHOST_FX : FADE_FX)[Math.min(3, Math.floor(w.fade * 4))];
    if (w.obj.info.drawingType !== dt) w.obj.info.drawingType = dt;
  }

  private turnTowards(w: Walker, angle: number, dt: number): void {
    const diff = ((angle - w.obj.angle + 6144) % 4096) - 2048;
    const max = TURN_RATE * dt;
    w.obj.angle = (w.obj.angle + Math.max(-max, Math.min(max, diff)) + 4096) & 4095;
  }

  /** The player right ahead: a step to the side away from them, then on */
  private sidestep(w: Walker, player: NavPoint, next: NavPoint): boolean {
    const g = this.grid!;
    const o = w.obj;
    const hl = Math.hypot(next.x - o.x, next.y - o.y) || 1;
    const dx = (next.x - o.x) / hl,
      dy = (next.y - o.y) / hl;
    const cross = dx * (player.y - o.y) - dy * (player.x - o.x);
    const side = cross > 0 ? -1 : 1;
    w.sidestepMs = SIDESTEP_COOLDOWN_MS;
    for (const s of [side, -side]) {
      const p = { x: o.x - dy * s * 0.9 * SQ + dx * 0.4 * SQ, y: o.y + dx * s * 0.9 * SQ + dy * 0.4 * SQ };
      const cell = cellAt(g, p.x, p.y);
      if (cell < 0 || !isOpen(g, cell) || !walkable(g, o.x, o.y, p.x, p.y)) continue;
      const end = w.path[w.path.length - 1];
      const rest = walkable(g, p.x, p.y, next.x, next.y) ? w.path : findPath(g, p, end);
      if (!rest) continue;
      w.path = [p, ...rest];
      return true;
    }
    return false;
  }

  /** Bumped into while standing: a step back out of the way */
  private shuffle(w: Walker, player: NavPoint): void {
    const g = this.grid!;
    const o = w.obj;
    w.sidestepMs = SIDESTEP_COOLDOWN_MS;
    const d = dist(o, player) || 1;
    const p = { x: o.x + ((o.x - player.x) / d) * 0.9 * SQ, y: o.y + ((o.y - player.y) / d) * 0.9 * SQ };
    const cell = cellAt(g, p.x, p.y);
    if (cell < 0 || !isOpen(g, cell) || !walkable(g, o.x, o.y, p.x, p.y)) return;
    const end = w.path[w.path.length - 1];
    const rest = end ? (findPath(g, p, end) ?? w.path) : [];
    const leaving = w.leaving;
    const face = angleTo(player.x - o.x, player.y - o.y);
    this.walk(w, [p, ...rest], leaving);
    // Stepping back, still facing them
    if (!rest.length) w.faceAngle = face;
  }

  private step(w: Walker, dt: number, player: NavPoint | null): void {
    if (w.fadeDir) {
      w.fade = Math.max(0, Math.min(1, w.fade + (w.fadeDir * dt) / FADE_MS));
      if (w.fade >= 1 && w.fadeDir > 0) w.fadeDir = 0;
      this.applyFade(w);
    }
    if (w.fadeDir < 0) return;
    // Waved at: the wave back, once they've turned to us
    if (w.waveBackMs > 0 && (w.waveBackMs -= dt) <= 0 && w.mode === "idle" && !w.look.gear?.weapon) this.emote(w, "wave", 0);
    w.greetCooldown -= dt;
    w.stayMs -= dt;
    w.sidestepMs -= dt;
    w.glanceMs -= dt;
    const o = w.obj;
    const near = player ? dist(o, player) : Infinity;
    const town = this.spec.kind === "town";

    // Fine armour going by: a second look (and maybe a word)
    if (this.frame.impressive && player && near < GLANCE_DISTANCE && w.glanceMs <= 0 && !w.fleeing && w.role !== "fighter") {
      w.glanceMs = GLANCE_COOLDOWN_MS;
      if (this.rand() < 0.6) {
        if (w.mode === "walk") this.pause(w, 1200 + this.rand() * 1200);
        w.faceAngle = angleTo(player.x - o.x, player.y - o.y);
        if (!w.say && this.rand() < 0.45) this.say(w, chatterLine(this.rand, this.context(w, { impressed: true })));
      }
    }

    if (w.mode === "walk") {
      const next = w.path[0];
      if (!next) return this.arrive(w);
      // The player in the way, just ahead: step aside, or wait for them to pass
      if (player && near < SIDESTEP_DISTANCE) {
        const hl = Math.hypot(next.x - o.x, next.y - o.y) || 1;
        const ahead = ((next.x - o.x) * (player.x - o.x) + (next.y - o.y) * (player.y - o.y)) / (hl * (near || 1));
        if (ahead > 0.5) {
          const aside = w.sidestepMs <= 0 && !w.beat && !w.fleeing && this.sidestep(w, player, next);
          if (!aside && near < 0.9 * SQ && (w.waitedMs += dt) < WAIT_FOR_PLAYER_MS) {
            this.setPose(w, "stand");
            return;
          }
        }
      } else w.waitedMs = 0;
      this.setPose(w, "walk");
      const wet = this.weather && town && w.role === "folk" ? tune("wetPace") : 1;
      let move = w.pace * dt * (w.fleeing ? tune("fleePace") : wet);
      let x = o.x,
        y = o.y;
      while (move > 0 && w.path.length) {
        const p = w.path[0];
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= move) {
          x = p.x;
          y = p.y;
          move -= d;
          w.path.shift();
          // Townsfolk stop now and then on the way to look about (less in the rain)
          if (town && w.role === "folk" && !w.fleeing && w.path.length > 1 && this.rand() < (this.weather ? 0.02 : 0.06)) {
            o.x = Math.round(x);
            o.y = Math.round(y);
            this.pause(w, 1500 + this.rand() * 4000);
            w.faceAngle = Math.floor(this.rand() * 4096);
            return;
          }
        } else {
          x += ((p.x - x) / d) * move;
          y += ((p.y - y) / d) * move;
          move = 0;
        }
      }
      const head = w.path[0];
      if (head) this.turnTowards(w, angleTo(head.x - x, head.y - y), dt);
      o.x = Math.round(x);
      o.y = Math.round(y);
      // An errand: stop at the shop's door a while, as if trading
      if (w.errand && dist(o, w.errand) < 1.3 * SQ) this.arrive(w);
      return;
    }

    // Standing about
    // An emote that lasts (a dance, a cheer) ends; another now and then
    if (w.emoteMs > 0 && (w.emoteMs -= dt) <= 0) this.setPose(w, "stand");
    const fidgets = this.spec.kind === "inn" || w.role === "lady" || w.role === "noble" || w.role === "spectator";
    if (fidgets && w.emoteMs <= 0 && (w.nextEmoteMs -= dt) <= 0) this.fidget(w);
    if (player && near < 0.75 * SQ && w.sidestepMs <= 0) return this.shuffle(w, player);
    if (player && near < GREET_DISTANCE && w.greetCooldown <= 0) {
      // Someone comes close: turn to them, and sometimes wave or say hello
      w.greetCooldown = GREET_COOLDOWN_MS;
      w.faceAngle = angleTo(player.x - o.x, player.y - o.y);
      if (this.rand() < 0.4 && !w.look.gear?.weapon) this.setPose(w, "wave");
      if (!w.say && this.rand() < 0.35) this.say(w, chatterLine(this.rand, this.context(w, { greeting: true })));
    }
    if (w.faceAngle >= 0) this.turnTowards(w, w.faceAngle, dt);
    if ((w.idleMs -= dt) > 0) return;
    // Paused on the way: go on
    if (w.path.length) return this.walk(w, w.path, w.leaving);
    if (w.beat) {
      // The other end of the beat
      w.beatEnd ^= 1;
      const end = w.beat[w.beatEnd];
      const path = walkable(this.grid!, o.x, o.y, end.x, end.y) ? [end] : (findPath(this.grid!, o, end) ?? [end]);
      return this.walk(w, path, false);
    }
    if (town) return this.leave(w);
    if (w.stayMs < 0 && this.rand() < 0.5 && (this.pointsIn(w.area).length || this.hidden(o))) return this.leave(w);
    this.wander(w);
  }

  /** The end of a walk: go in, stand a while, or (towns) head for a door */
  private arrive(w: Walker): void {
    const o = w.obj;
    if (w.leaving) {
      w.fadeDir = -1;
      return this.setPose(w, "stand");
    }
    const fled = w.fleeing;
    w.fleeing = false;
    if (w.beat) {
      // At the end of the beat: a look along the way they came
      const other = w.beat[w.beatEnd ^ 1];
      this.stand(w, 2000 + this.rand() * 3000);
      w.faceAngle = angleTo(o.x - other.x, o.y - other.y);
      return;
    }
    if (w.errand) {
      const door = w.errand;
      w.errand = null;
      this.stand(w, 3000 + this.rand() * 6000);
      w.faceAngle = angleTo(door.x - o.x, door.y - o.y);
      return;
    }
    // Towns: a breath (longer after running), then a door
    if (this.spec.kind === "town") return this.stand(w, fled ? 1500 + this.rand() * 2000 : 300);
    // Inns and the rest: stand a while, maybe facing whoever we came to talk to
    this.stand(w, (fled ? 2000 : 6000) + this.rand() * 25000);
    const friend = this.walkers.find((v) => v.obj.id === w.faceId);
    if (friend) this.face(w, friend);
    // Shops: whoever's at the counter faces the shopkeeper
    else if (this.spec.kind === "shop") {
      const by = this.blockers.filter((b) => dist(b, o) < 1.8 * SQ).sort((a, b) => dist(a, o) - dist(b, o))[0];
      if (by) w.faceAngle = angleTo(by.x - o.x, by.y - o.y);
    }
  }

  /** Inns and the rest: go and stand somewhere else in their part of the room, often next to someone */
  private wander(w: Walker): void {
    const g = this.grid!;
    const here = { x: w.obj.x, y: w.obj.y };
    const others = this.walkers.filter((v) => v !== w && v.mode === "idle" && !v.leaving && !v.beat && v.area === w.area);
    let cell = -1,
      friend: Walker | null = null;
    // Shops: up to the counter, beside the shopkeeper (or whatever else stands in the room), as often as not
    const counter = this.spec.kind === "shop" && this.rand() < 0.6 ? this.blockers.filter((b) => dist(b, here) < 10 * SQ) : [];
    if (counter.length) cell = this.besideCell(this.pick(counter), w.area);
    else if (others.length && this.rand() < 0.4) {
      friend = this.pick(others);
      cell = this.besideCell(friend.obj, w.area);
    }
    for (let k = 0; cell < 0 && k < 10; k++) {
      const c = randomCell(g, this.rand, w.area);
      if (c >= 0 && dist(cellCentre(g, c), here) < 7 * SQ) cell = c;
    }
    const path = cell >= 0 ? findPath(g, here, cellCentre(g, cell)) : null;
    if (!path || !path.length) return this.stand(w, 5000 + this.rand() * 10000);
    this.walk(w, path, false);
    w.faceId = friend?.obj.id ?? -1;
  }
}
