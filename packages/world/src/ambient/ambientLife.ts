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
// - At the arena, fighters and mages fight in rounds on its floor while spectators watch from the
//   sides (unless real players are there): the beaten are sent to the stands, as players are,
//   until one is left, who wins, and after a few seconds the next lot comes in.
// They step aside for the player, look twice at fine armour, wave back when waved at, run from
// spells, and say a word now and then (over their heads, never in the chat). Rain and snow thin the streets and hurry
// whoever is out. Nothing here is sent to the server.

import { ANIMATE, type Animation } from "@shards/protocol";
import { FINENESS, kodToClient, type Room } from "@shards/formats";
import { animStateFrom, animStep } from "../animation.ts";
import { NAV_CELL, cellAt, cellCentre, findPath, isOpen, navGridBuilder, nearestCell, randomCell, walkable, type NavGrid, type NavPoint } from "../navGrid.ts";
import type { Look, WorldObject } from "../state.ts";
import { ambientId, localRes } from "./ambientIds.ts";
import { busyAt, isErrandRoom, torchHours, weatherScale, type AmbientRoomSpec } from "./ambientRooms.ts";
import { chatterLine, scatterLine, type ChatterContext, type Role, type Weather } from "./chatter.ts";
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
  /** Other players in the room: the arena's mock bouts stop for real fights */
  others?: number;
}

/** Someone saying something, to show over their head */
export interface AmbientSpeech {
  obj: WorldObject;
  text: string;
}

/**
 * Something the crowd did that makes a sound (the client's ambientSounds.ts plays it): a weapon
 * swung (and whether it struck, and what armour), a spell cast or landing, a cheer in the stands,
 * a fighter beaten, a round won, people running from a spell, a patron's dice or drink
 */
export interface AmbientEvent {
  type: "swing" | "cast" | "impact" | "cheer" | "death" | "victory" | "flee" | "dice" | "drink";
  /** A cast: which spell */
  spell?: ArenaSpell;
  x: number;
  y: number;
  /** A swing: what it struck, if anything */
  hit?: "metal" | "leather" | "flesh" | null;
  /** A spell: which */
  bolt?: "fire" | "lightning";
  female?: boolean;
}

/** A spell flying between the arena's mages: drawn like a projectile (project.c), never sent */
export interface AmbientShot {
  id: number;
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
  destX: number;
  destY: number;
  progress: number;
  /** progress per ms (state.ts addProjectile) */
  increment: number;
  bolt: "fire" | "lightning";
  angle: number;
  /** project.c's PROJ_FLAG_*: none (they fly at the casters' height) */
  flags: 0;
  info: { iconRes: number; light: { flags: number; intensity: number; color: number } };
  look: Look;
}

/**
 * The bolt spells (boltspel/fireball.kod, lightnin.kod): their projectiles' art, animation
 * (SendProjectileAnimation), speed in squares a second (GetProjectileSpeed) and light
 * (LIGHT_FLAG_ON | LIGHT_FLAG_DYNAMIC, 100, LIGHT_BORANGE or LIGHT_LIGHTNING)
 */
const BOLTS: { file: string; animation: Animation; speed: number; color: number }[] = [
  { file: "fireball.bgf", animation: { type: ANIMATE.CYCLE, period: 40, groupLow: 1, groupHigh: 2 }, speed: 10, color: 0x7e40 },
  { file: "lightnin.bgf", animation: { type: ANIMATE.CYCLE, period: 40, groupLow: 2, groupHigh: 3 }, speed: 12, color: 0x3dff },
];

/** The art the arena's spells need (the bolts and the wall spells' elements), to load ahead of time */
export function boltArt(): string[] {
  return [...BOLTS.map((b) => b.file), ...Object.values(FIELDS).map((f) => f.file)];
}

const SQ = FINENESS;
/** proto.h DRAWFX_TRANSLUCENT75/50/25: fading in and out */
const FADE_FX = [1, 2, 3, 0];
const FADE_MS = 600;
/** Walking pace, fine units per ms (a player walks about 3 squares a second) */
const PACE_MIN = 1.0,
  PACE_MAX = 1.6;
/** Running from a spell, and hurrying through rain or snow */
const FLEE_PACE = 2.4;
const WET_PACE = 1.3;
/** Turning speed, client angle units per ms */
const TURN_RATE = 6;
/** How long a walker waits for the player to get out of the way before going on */
const WAIT_FOR_PLAYER_MS = 1600;
const GREET_DISTANCE = 1.6 * SQ;
/** Waved at from this close, someone in front of the player waves back (or, nearer, anyone) */
const WAVE_RANGE = 6 * SQ;
const WAVE_NEAR = 2.5 * SQ;
const GREET_COOLDOWN_MS = 30000;
/** The player this close ahead: step aside */
const SIDESTEP_DISTANCE = 1.4 * SQ;
const SIDESTEP_COOLDOWN_MS = 2500;
/** Fine armour this close: a second look */
const GLANCE_DISTANCE = 3.5 * SQ;
const GLANCE_COOLDOWN_MS = 45000;
/** Speech: how long a line stays up, and only within this distance of the player */
const SAY_MS = 3200;
const SPEAK_RANGE = 10 * SQ;
const MAX_SPEAKING = 2;
/** Towns: how many walkers go on an errand, and how near the door they stop */
const ERRAND_CHANCE = 0.3;
/** An area with no doors gets people only if it's this big (cells) and the player is in it */
const MIN_AREA_CELLS = 200;
/** In a big room (a castle's courtyard), those who stay keep mostly within this of the player */
const NEAR_PLAYER = 18 * SQ;
/** Guards' beats, from one end to the other */
const BEAT_MIN = 5 * SQ,
  BEAT_MAX = 10 * SQ;
/** The arena: a fighter swings from this close; a mage keeps further than KEEP_AWAY, within CAST_RANGE */
const REACH = 1.25 * SQ;
const KEEP_AWAY = 4 * SQ;
/** A mage stands this long (and up to 2.5 s more) after each step back before the next */
const MAGE_STAND_MS = 3000;
const CAST_RANGE = 8 * SQ;
const MAX_BOUTS = 4;
/** The arena's rounds: health, and what a blow, a bolt and a ring of flames take */
const FIGHTER_HP = 100,
  MAGE_HP = 70;
const SWING_DAMAGE = [7, 15],
  BOLT_DAMAGE = [20, 30];
const RING_DAMAGE = 10;
/** A bolt that lands this close to its target (it may have moved) hits */
const BOLT_REACH = 1.2 * SQ;
/** A wall spell's element hurts whoever stands this close (FIELDS' hurt: a second) */
const FIELD_REACH = 0.6 * SQ;
/** The winner's moment (and up to 2 s more) */
const VICTORY_MS = 5000;
/** The beaten watch from the stands this long (and up to a minute more), then go */
const BEATEN_WATCH_MS = 60000;
/** Fighters close in a little faster than they walk */
const CHASE_PACE = 1.2;
/** The spells the arena's mages cast, and how often each */
const SPELLS = [
  ["fireball", 3], ["lightning", 3], ["firewall", 1.2], ["bramble", 1], ["poisonfog", 1], ["ring", 1], ["web", 1.2],
] as const;
export type ArenaSpell = (typeof SPELLS)[number][0];
/**
 * The wall spells' elements (wallelem/*.kod): art, animation (SendAnimation), DRAWFX_* and light
 * (wallfire.kod SendLightingInformation: LIGHT_RED, brighter here so the walls light the floor)
 */
const FIELDS = {
  fire: { file: "woflame.bgf", cycle: 100, drawFx: 2, hurt: 10, light: { flags: 0x3, intensity: 30, color: 0x5000 } },
  bramble: { file: "wothorns.bgf", grow: 250, drawFx: 0, hurt: 5 },
  fog: { file: "poisoncl.bgf", cycle: 240, drawFx: 2, hurt: 7 },
  web: { file: "webspell.bgf", drawFx: 0, hurt: 0 },
} as const;
/** How long a wall spell lasts here (the server's last 20 s and more), its last moment fading, and at most how many elements */
const FIELD_MS = 7000;
const FIELD_FADE_MS = 700;
const MAX_FIELDS = 40;
/** Cells this close to a blocking object are closed */
const OBSTACLE_RADIUS = 0.55 * SQ;
const OBSTACLE_REFRESH_MS = 1500;
/** How many townsfolk carry a torch after dark */
const TORCH_BEARERS = 0.8;
/** Time per frame for building the nav grid */
const BUILD_BUDGET_MS = 3;
/** Standing for good (fighters between swings) */
const FOREVER = 1e9;

type Mode = "walk" | "idle";

interface Bout {
  a: Walker;
  b: Walker;
  /** Between them (where the stands cheer) */
  centre: NavPoint;
  ms: number;
  ended: boolean;
}

/** A wall spell's element on the floor */
interface Field {
  obj: WorldObject;
  ms: number;
  drawFx: number;
  /** Health a second it takes from whoever stands in it */
  hurt: number;
}

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
  bout: Bout | null;
  /** An emote playing (a dance, a cheer) for this long, and when to think of the next */
  emoteMs: number;
  nextEmoteMs: number;
  /** Which frame of the dance their cheer holds (lookFor's cheerFrame) */
  cheerFrame: number;
  /** In a fight: ms to the next swing or spell, to the next move, and still held by a web */
  actMs: number;
  stepMs: number;
  webbedMs: number;
  /** The arena: health left; at 0 they're beaten */
  hp: number;
  /** Waved at: ms until they wave back (turning to us first) */
  waveBackMs: number;
  /** Beaten in the arena and sent to the stands (not counted as one of them) */
  beaten: boolean;
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
  private builder: Generator<void, NavGrid> | null;
  private grid: NavGrid | null = null;
  private points: ExitPoint[] = [];
  /** Towns: areas with somewhere to come from and go to, and how likely each is */
  private areas: { area: number; weight: number }[] = [];
  /** Cells in each area */
  private cells = new Map<number, number>();
  /** Inns and castles: the area with the most doors; the arena: its floor */
  private mainArea = 1;
  /** The arena: the areas round its floor, where spectators stand */
  private galleries: number[] = [];
  /** The arena: the middle of its floor, which the stands watch */
  private pitCentre: NavPoint | null = null;
  private shotList: AmbientShot[] = [];
  /** Who each bolt in flight is meant for */
  private shotTargets = new Map<number, Walker>();
  private fieldList: Field[] = [];
  /** How many were beaten this round */
  private beatenThisRound = 0;
  /** The arena's floor: how many fight in this round (`spec.countRange`) */
  private floorCount: number;
  /** The arena's round: fighting; won (the winner's moment); or between rounds, the next lot due */
  private phase: "fight" | "won" | "rest" = "rest";
  private phaseMs = 0;
  private winner: Walker | null = null;
  /** The population scale this frame: the setting, the hour and the weather */
  private busy = 1;
  /** The real objects that block (shopkeepers and the like), as of the last look */
  private blockers: NavPoint[] = [];
  private eventList: AmbientEvent[] = [];
  private walkers: Walker[] = [];
  private bouts: Bout[] = [];
  private spawnMs = 0;
  private boutMs = 3000;
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
    this.floorCount = this.pickCount();
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

  /** The wall spells' elements on the floor (the arena's mages): drawn like objects */
  fields(): WorldObject[] {
    return this.fieldList.map((f) => f.obj);
  }

  /** Spells in flight (the arena's mages) */
  shots(): AmbientShot[] {
    return this.shotList;
  }

  /** What's being said, over whose head */
  speech(): AmbientSpeech[] {
    return this.walkers.filter((w) => w.say && w.fadeDir >= 0).map((w) => ({ obj: w.obj, text: w.say!.text }));
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
    this.bouts = [];
    this.shotList = [];
    this.shotTargets.clear();
    this.fieldList = [];
    this.beatenThisRound = 0;
    this.phase = "rest";
    this.phaseMs = 0;
    this.winner = null;
  }

  /** A big spell went off at `at`: those within `radius` run (guards, knights and fighters stand and look) */
  scatter(at: NavPoint, radius: number): void {
    if (!this.ready) return;
    let cried = false;
    for (const w of this.walkers) {
      if (w.fadeDir < 0 || w.fleeing || w.bout || dist(w.obj, at) > radius) continue;
      if (w.role === "guard" || w.role === "knight" || w.role === "fighter") {
        w.faceAngle = angleTo(at.x - w.obj.x, at.y - w.obj.y);
        continue;
      }
      if (this.flee(w, at) && !cried) {
        cried = true;
        this.event({ type: "flee", x: w.obj.x, y: w.obj.y, female: w.look.female });
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
      .filter((w) => w.fadeDir >= 0 && w.fade >= 1 && !w.bout && !w.fleeing && w.waveBackMs <= 0 && dist(w.obj, p) < WAVE_RANGE)
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
    this.busy = frame.scale * busyAt(kind, this.hour) * weatherScale(kind, this.weather);
    const target = Math.round(this.floorCount * this.busy);
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
    if (this.spec.spectators) this.keepSpectators(frame.scale > 0 ? Math.max(4, Math.round(this.spec.spectators * Math.min(1.5, frame.scale))) : 0);
    this.burnFields(dt);
    // The arena's floor goes by rounds
    if (this.spec.bouts) this.runRound(dt, target, frame.others ?? 0);
    else this.keepPopulation(target, dt);
    this.flyShots(dt);
    const dark = kind === "town" && torchHours(this.hour);
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
    const add = (at: NavPoint, door: boolean, errand = false) => {
      // The nearest cell from which the doorway can be reached in a straight line: walkers stop
      // there, then step into the doorway itself
      const cell = nearestCell(g, at.x, at.y, 3);
      if (cell >= 0) points.push({ at, cell, area: g.area[cell], door, errand });
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
        add({ x: (c - 1) * SQ + SQ / 2, y: (r - 1) * SQ + SQ / 2 }, true, isErrandRoom(d.to));
      }
      // Where players come out of a door is beside it, not in it: only for doors with no way in
      // found above (people disappeared a step to the side of their door)
      const doors = points.length;
      for (const [row, col] of ex.arrivals) {
        const at = kodToClient(row, col);
        if (!points.slice(0, doors).some((p) => dist(p.at, at) < 2.5 * SQ)) add(at, false);
      }
      for (const e of ex.edges) for (const at of this.edgePoints(e.side)) add(at, true);
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
    if (this.spec.bouts) {
      // The arena's floor is its largest area (no doors: fighters are let in); the stands round it
      this.mainArea = 1;
      this.galleries = [...this.cells.entries()].filter(([a, n]) => a !== 1 && n >= 100).map(([a]) => a);
      let sx = 0,
        sy = 0,
        n = 0;
      for (let i = 0; i < g.area.length; i++)
        if (g.area[i] === 1) {
          const c = cellCentre(g, i);
          sx += c.x;
          sy += c.y;
          n++;
        }
      this.pitCentre = n ? { x: sx / n, y: sy / n } : null;
    }
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

  /** A random open cell in an area, not on top of the player; `near`: within NEAR_PLAYER of them if there's one */
  private openCellAwayFrom(area: number, near = false): number {
    const player = this.frame.player;
    let fallback = -1;
    for (let k = 0; k < 40; k++) {
      const cell = randomCell(this.grid!, this.rand, area);
      if (cell < 0) return -1;
      const d = player ? dist(cellCentre(this.grid!, cell), player) : Infinity;
      if (d < 1.5 * SQ) continue;
      if (!near || !player || d < NEAR_PLAYER) return cell;
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
        // The arena's floor: fighters and mages (the stands are kept apart); its foyer, all sorts
        // At least two mages, so there's magic to see
        if (this.spec.bouts) return this.walkers.filter((w) => w.role === "mage" && this.contestant(w)).length < 2 || r >= 0.7 ? "mage" : "fighter";
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
  private homeArea(role: Role): number {
    if (this.spec.kind === "town") return this.pickArea();
    if (this.spec.bouts) return role !== "spectator" || !this.galleries.length ? this.mainArea : this.galleryArea();
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
    const pace = (PACE_MIN + this.rand() * (PACE_MAX - PACE_MIN)) * (slow ? 0.75 : 1);
    const w: Walker = {
      obj, look, role, pose: "stand", mode: "idle", path: [], pace, idleMs: 0, faceAngle: -1, leaving: false, fade: fadeIn ? 0 : 1,
      fadeDir: fadeIn ? 1 : 0, waitedMs: 0, greetCooldown: 0, sidestepMs: 0, glanceMs: 0, stayMs: this.spec.kind === "shop" ? 20000 + this.rand() * 40000 : 60000 + this.rand() * 180000, faceId: -1,
      torchBearer: role === "guard" || (role === "folk" && this.rand() < TORCH_BEARERS), torch: false, area, errand: null, fleeing: false,
      say: null, beat: null, beatEnd: 0, bout: null, emoteMs: 0, nextEmoteMs: 2000 + this.rand() * 8000, cheerFrame: 0, actMs: 0, stepMs: 0, webbedMs: 0,
      hp: role === "mage" ? MAGE_HP : FIGHTER_HP, beaten: false, waveBackMs: 0,
    };
    this.applyFade(w);
    this.walkers.push(w);
    return w;
  }

  /** The crowd already out when you arrive */
  private populate(target: number): void {
    const g = this.grid!;
    // The arena's floor fills by rounds (runRound), its stands by keepSpectators
    if (this.spec.bouts) return;
    if (this.stays) {
      for (let k = 0; k < target; k++) {
        const role = this.newRole();
        const area = this.homeArea(role);
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
  private planTown(from: NavPoint, area: number): { path: NavPoint[]; errand: NavPoint | null; leaving: boolean } | null {
    const g = this.grid!;
    const errands = this.pointsIn(area).filter((p) => p.errand && dist(p.at, from) >= 4 * SQ);
    if (errands.length && this.rand() < ERRAND_CHANCE * (this.weather ? 0.4 : 1)) {
      const p = this.pick(errands);
      const path = findPath(g, from, cellCentre(g, p.cell));
      if (path) return { path, errand: p.at, leaving: false };
    }
    const doors = this.pointsIn(area).filter((p) => dist(p.at, from) >= 8 * SQ);
    if (doors.length) {
      const path = this.pathToPoint(from, this.pick(doors));
      if (path) return { path, errand: null, leaving: true };
    }
    const cell = this.hiddenCell(area);
    const path = cell >= 0 ? findPath(g, from, cellCentre(g, cell)) : null;
    return path ? { path, errand: null, leaving: true } : null;
  }

  /** Towns: someone part way along their walk from one door to another */
  private placeOnTheWay(): void {
    const g = this.grid!;
    const area = this.pickArea();
    const starts = this.pointsIn(area);
    const cell = starts.length ? this.pick(starts).cell : this.openCellAwayFrom(area);
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
    // Guards and the arena's stands are kept apart
    const people = this.walkers.filter((w) => !w.beat && !(this.spec.spectators && w.role === "spectator"));
    // Towns: everyone is on their way to a door, so count all but those going in now
    const staying = people.filter((w) => (stays ? !w.leaving : w.fadeDir >= 0));
    if (staying.length > target) {
      for (const w of staying.filter((v) => !v.leaving && !v.bout).slice(0, staying.length - target)) this.leave(w);
      return;
    }
    if (staying.length + this.toPlace >= target || (this.spawnMs -= dt) > 0) return;
    // Sooner the emptier it is
    const full = target ? staying.length / target : 1;
    this.spawnMs = (stays ? 4000 + this.rand() * 10000 : 500 + this.rand() * 2500) * (0.3 + full);
    const role = this.newRole();
    const area = this.homeArea(role);
    const player = this.frame.player;
    // In by a door (from the doorway itself), or out of sight where there's none
    let starts = this.pointsIn(area).filter((p) => !player || dist(p.at, player) > 1.5 * SQ);
    // Those who stay come in by a door near the player, in a big room
    if (stays && player) starts = starts.filter((p) => dist(p.at, player) < NEAR_PLAYER);
    let from: NavPoint;
    const lead: NavPoint[] = [];
    if (starts.length) {
      const p = this.pick(starts);
      from = p.at;
      lead.push(cellCentre(g, p.cell));
    } else {
      const cell = this.hiddenCell(area);
      if (cell < 0) return;
      from = cellCentre(g, cell);
    }
    const w = this.spawn(from, Math.floor(this.rand() * 4096), true, role, area);
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
      if ((player && (dist(a, player) < 2 * SQ || (k < 30 && dist(a, player) > 2 * NEAR_PLAYER))) || !clear(a)) continue;
      const dir = (Math.floor(this.rand() * 8) * Math.PI) / 4;
      const len = BEAT_MIN + this.rand() * (BEAT_MAX - BEAT_MIN);
      const endCell = cellAt(g, a.x + Math.cos(dir) * len, a.y + Math.sin(dir) * len);
      if (endCell < 0 || !isOpen(g, endCell) || g.area[endCell] !== area) continue;
      const b = cellCentre(g, endCell);
      if (dist(a, b) >= BEAT_MIN * 0.9 && clear(b) && walkable(g, a.x, a.y, b.x, b.y)) return [a, b];
    }
    return null;
  }

  // ---- the arena ----

  /** How many fight in a round (`spec.countRange`) */
  private pickCount(): number {
    const range = this.spec.countRange;
    return range ? range[0] + Math.floor(this.rand() * (range[1] - range[0] + 1)) : this.spec.count;
  }

  /** Still in the round: a fighter or mage on the floor, standing */
  private contestant(w: Walker): boolean {
    return (w.role === "fighter" || w.role === "mage") && w.fadeDir >= 0 && !w.leaving && w.hp > 0;
  }

  /**
   * The arena's rounds: everyone on the floor fights (in pairs, `runBouts`) until one is left
   * standing. The stands cheer the winner, who goes after a few seconds; the fallen are carried
   * off, and the next lot comes in.
   */
  private runRound(dt: number, target: number, others: number): void {
    const floor = this.walkers.filter((w) => this.contestant(w));
    if (this.phase === "fight") {
      this.runBouts(dt, others);
      const left = floor.filter((w) => w.hp > 0);
      if (left.length > 1) return;
      if (left.length === 1 && this.beatenThisRound) {
        this.victory(left[0]);
        this.phase = "won";
        this.phaseMs = VICTORY_MS + this.rand() * 2000;
      } else {
        this.phase = "rest";
        this.phaseMs = 1500;
      }
      return;
    }
    if ((this.phaseMs -= dt) > 0) return;
    if (this.phase === "won") {
      // The winner goes
      const w = this.winner;
      this.winner = null;
      if (w && this.walkers.includes(w)) {
        w.emoteMs = 0;
        this.setPose(w, "stand");
        this.leave(w);
      }
      this.phase = "rest";
      this.phaseMs = 2000 + this.rand() * 2000;
      return;
    }
    if (target <= 0) return;
    // The next lot: fade in about the floor (those already out when we arrive just stand there)
    const first = this.ageMs < 1000;
    if (!first) this.floorCount = this.pickCount();
    const n = Math.max(2, Math.round(this.floorCount * this.busy));
    this.beatenThisRound = 0;
    const g = this.grid!;
    for (let k = floor.length; k < n; k++) {
      const role = this.newRole();
      const cell = this.openCellAwayFrom(this.mainArea, true);
      if (cell < 0) break;
      const w = this.spawn(cellCentre(g, cell), Math.floor(this.rand() * 4096), !first, role, this.mainArea);
      w.stayMs = FOREVER;
      w.idleMs = 1000 + this.rand() * 2000;
      const c = this.pitCentre;
      if (c) w.obj.angle = angleTo(c.x - w.obj.x, c.y - w.obj.y);
    }
    this.boutMs = first ? 300 : FADE_MS + 600;
    this.phase = "fight";
  }

  /** The last one standing: a cheer of their own, and the stands roar */
  private victory(w: Walker): void {
    this.winner = w;
    if (w.mode === "walk") this.stand(w, FOREVER);
    w.idleMs = FOREVER;
    w.faceAngle = -1;
    this.emote(w, "cheer", FOREVER);
    this.say(w, chatterLine(this.rand, this.context(w, { won: true })));
    this.event({ type: "victory", x: w.obj.x, y: w.obj.y });
    for (const f of this.walkers)
      if (f.role === "spectator" && f.fadeDir >= 0 && f.mode === "idle" && this.rand() < 0.6) this.emote(f, this.rand() < 0.75 ? "cheer" : "wave", 2000 + this.rand() * 2500);
  }

  /** A blow, a bolt or a burning wall lands: health off, and at none they're beaten */
  private hurt(w: Walker, amount: number): void {
    if (w.hp <= 0 || w.fadeDir < 0 || !w.bout) return;
    w.hp -= amount;
    if (w.hp <= 0) this.beat(w);
  }

  /**
   * One is beaten: a cry, gone from the floor, and the stands cheer. Players beaten in the arena
   * leave no body: they're sent to the stands, and so are these, to watch the rest.
   */
  private beat(w: Walker): void {
    w.hp = 0;
    this.beatenThisRound++;
    if (w.bout) this.endBout(w.bout);
    const o = w.obj;
    this.event({ type: "death", x: o.x, y: o.y, female: w.look.female });
    w.say = null;
    w.fade = 0;
    w.fadeDir = -1;
    for (const [id, t] of this.shotTargets) if (t === w) this.shotTargets.delete(id);
    this.cheer({ x: o.x, y: o.y });
    if (!this.galleries.length) return;
    const area = this.galleryArea();
    const cell = this.openCellAwayFrom(area);
    if (cell < 0) return;
    const fan = this.spawn(cellCentre(this.grid!, cell), 0, true, "spectator", area, w.look);
    fan.beaten = true;
    fan.stayMs = BEATEN_WATCH_MS + this.rand() * 60000;
    fan.idleMs = FOREVER;
    this.faceThePit(fan);
    fan.obj.angle = fan.faceAngle;
    if (this.rand() < 0.5) this.say(fan, chatterLine(this.rand, this.context(fan, { lost: true })));
  }

  /**
   * The fights in a round, while no real players are about: any two fighters or mages square off.
   * Fighters close in and swing once in reach; mages back away to keep their distance and cast
   * when they've stood still. One falling ends their fight, and the other finds another.
   */
  private runBouts(dt: number, others: number): void {
    for (const b of this.bouts) {
      if (b.ended) continue;
      const gone = [b.a, b.b].some((w) => w.fadeDir < 0 || !this.walkers.includes(w));
      if (others > 0 || gone || (b.ms -= dt) <= 0) {
        this.endBout(b);
        continue;
      }
      b.centre = { x: (b.a.obj.x + b.b.obj.x) / 2, y: (b.a.obj.y + b.b.obj.y) / 2 };
      this.fight(b.a, b.b, dt);
      if (!b.ended) this.fight(b.b, b.a, dt);
    }
    this.bouts = this.bouts.filter((b) => !b.ended);
    if (others > 0 || this.bouts.length >= MAX_BOUTS || (this.boutMs -= dt) > 0) return;
    this.boutMs = 400 + this.rand() * 800;
    const free = this.walkers.filter((w) => this.contestant(w) && !w.bout && w.mode === "idle" && !w.fleeing);
    if (free.length < 2) return;
    const a = this.pick(free);
    const b = free.filter((w) => w !== a).sort((x, y) => dist(x.obj, a.obj) - dist(y.obj, a.obj))[0];
    const bout: Bout = { a, b, centre: { x: (a.obj.x + b.obj.x) / 2, y: (a.obj.y + b.obj.y) / 2 }, ms: 20000 + this.rand() * 25000, ended: false };
    a.bout = b.bout = bout;
    for (const w of [a, b]) {
      w.actMs = 600 + this.rand() * (w.role === "mage" ? 2500 : 800);
      w.stepMs = 0;
      w.webbedMs = 0;
    }
    this.bouts.push(bout);
  }

  /** One fighter's or mage's turn in a fight against `o` */
  private fight(w: Walker, o: Walker, dt: number): void {
    const g = this.grid!;
    const d = dist(w.obj, o.obj);
    w.stepMs -= dt;
    w.actMs -= dt;
    // Held in a web: nothing but struggle
    if (w.webbedMs > 0) {
      w.webbedMs -= dt;
      if (w.mode === "walk") this.stand(w, FOREVER);
      w.faceAngle = angleTo(o.obj.x - w.obj.x, o.obj.y - w.obj.y);
      return;
    }
    if (w.role === "fighter") {
      if (d > REACH) {
        // Close in: to just short of them, again and again as they move
        if (w.stepMs > 0) return;
        w.stepMs = 350;
        const to = { x: o.obj.x + ((w.obj.x - o.obj.x) / (d || 1)) * 0.9 * SQ, y: o.obj.y + ((w.obj.y - o.obj.y) / (d || 1)) * 0.9 * SQ };
        const path = walkable(g, w.obj.x, w.obj.y, to.x, to.y) ? [to] : findPath(g, w.obj, to);
        if (path?.length) this.walk(w, path, false);
        return;
      }
      if (w.mode === "walk") this.stand(w, FOREVER);
      w.faceAngle = angleTo(o.obj.x - w.obj.x, o.obj.y - w.obj.y);
      if (w.actMs > 0) return;
      w.actMs = 650 + this.rand() * 900;
      this.setPose(w, "attack", true);
      // About half the swings land; the sound is the armour's
      const body = o.look.body;
      const hit = this.rand() < 0.5 ? null : /^bt[eiklmn]\.bgf$/.test(body) ? "metal" : /^bt[gh]\.bgf$/.test(body) ? "leather" : "flesh";
      this.event({ type: "swing", x: w.obj.x, y: w.obj.y, hit, female: o.look.female });
      this.boutTalk(w);
      if (hit) this.hurt(o, this.between(SWING_DAMAGE));
      return;
    }
    // A mage: a short step back from whoever comes close (or in, when too far to cast), then a
    // stand of a few seconds to cast, which lets a fighter catch up
    if (w.mode === "walk") return;
    if (w.stepMs <= 0 && (d < KEEP_AWAY || d > CAST_RANGE)) {
      const to = d < KEEP_AWAY ? this.awayFrom(w, o) : this.towards(w, o, (KEEP_AWAY + CAST_RANGE) / 2);
      w.stepMs = to ? MAGE_STAND_MS + this.rand() * 2500 : 1000;
      if (to) {
        this.walk(w, [to], false);
        return;
      }
    }
    w.faceAngle = angleTo(o.obj.x - w.obj.x, o.obj.y - w.obj.y);
    if (w.actMs > 0) return;
    // A spell every 6-14 s
    w.actMs = 6400 + this.rand() * 7200;
    this.setPose(w, "cast", true);
    this.castAt(w, o);
    this.boutTalk(w);
  }

  /** Now and then a fighter shouts, or the stands cheer the blow */
  private boutTalk(w: Walker): void {
    const speaking = this.walkers.filter((v) => v.say).length;
    if (speaking <= MAX_SPEAKING && !w.say && this.rand() < 0.1) this.say(w, chatterLine(this.rand, this.context(w)));
    else if (speaking <= MAX_SPEAKING && this.rand() < 0.12 && w.bout) this.cheer(w.bout.centre);
  }

  /** An open spot on the floor a few squares further from `o`, reachable in a straight line */
  private awayFrom(w: Walker, o: Walker): NavPoint | null {
    const base = Math.atan2(w.obj.y - o.obj.y, w.obj.x - o.obj.x);
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const a = base + turn + (this.rand() - 0.5) * 0.3;
      const len = (1.5 + this.rand()) * SQ;
      const p = { x: w.obj.x + Math.cos(a) * len, y: w.obj.y + Math.sin(a) * len };
      if (this.spotOpen(p) && walkable(this.grid!, w.obj.x, w.obj.y, p.x, p.y)) return p;
    }
    return null;
  }

  /** An open spot on the line to `o`, `keep` from them */
  private towards(w: Walker, o: Walker, keep: number): NavPoint | null {
    const d = dist(w.obj, o.obj) || 1;
    const p = { x: o.obj.x + ((w.obj.x - o.obj.x) / d) * keep, y: o.obj.y + ((w.obj.y - o.obj.y) / d) * keep };
    return this.spotOpen(p) && walkable(this.grid!, w.obj.x, w.obj.y, p.x, p.y) ? p : null;
  }

  private spotOpen(p: NavPoint): boolean {
    const cell = cellAt(this.grid!, p.x, p.y);
    return cell >= 0 && isOpen(this.grid!, cell) && this.grid!.area[cell] === this.mainArea;
  }

  private between([lo, hi]: number[]): number {
    return lo + this.rand() * (hi - lo);
  }

  private endBout(b: Bout): void {
    b.ended = true;
    for (const w of [b.a, b.b]) {
      w.bout = null;
      w.webbedMs = 0;
      if (w.mode === "walk") this.stand(w, 0);
      this.setPose(w, "stand");
      w.idleMs = 1000 + this.rand() * 2000;
      w.faceAngle = -1;
    }
  }

  /** A spectator near a bout cheers it on */
  private cheer(at: NavPoint): void {
    const fans = this.walkers.filter((w) => w.role === "spectator" && w.mode === "idle" && w.fadeDir >= 0 && !w.say && dist(w.obj, at) < 14 * SQ);
    if (!fans.length) return;
    const w = this.pick(fans);
    this.emote(w, this.rand() < 0.6 ? "cheer" : "wave", 1500 + this.rand() * 1500);
    this.say(w, chatterLine(this.rand, this.context(w)));
  }

  /**
   * A spell from a mage at their opponent: the casting arms, then a bolt across the floor, or one
   * of the wall spells laid as walspell/*.kod lays them: a wall of fire or brambles across the way
   * in front of the caster, a poison fog or a web on the target, a ring of flames round them
   */
  private castAt(from: Walker, to: Walker): void {
    const spell = this.pickWeighted(SPELLS);
    this.event({ type: "cast", x: from.obj.x, y: from.obj.y, spell });
    if (spell === "fireball" || spell === "lightning") return this.shoot(from, to, BOLTS[spell === "fireball" ? 0 : 1]);
    const f = from.obj,
      t = to.obj;
    const d = dist(f, t) || 1;
    const ux = (t.x - f.x) / d,
      uy = (t.y - f.y) / d;
    // Across the way: perpendicular to caster -> target
    const across = (cx: number, cy: number, n: number, gap: number) =>
      Array.from({ length: n }, (_, k) => {
        const off = (k - (n - 1) / 2) * gap;
        return { x: cx - uy * off, y: cy + ux * off };
      });
    const ahead = { x: f.x + ux * Math.min(1.5 * SQ, d / 2), y: f.y + uy * Math.min(1.5 * SQ, d / 2) };
    switch (spell) {
      case "firewall":
        across(ahead.x, ahead.y, 7, 0.5 * SQ).forEach((p, k) => this.field("fire", p, k % 2 === 0));
        break;
      case "bramble":
        across(ahead.x, ahead.y, 5, 0.75 * SQ).forEach((p) => this.field("bramble", p));
        break;
      case "poisonfog":
        across(t.x, t.y, 3, 0.7 * SQ).forEach((p) => this.field("fog", p));
        break;
      case "ring":
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          this.field("fire", { x: t.x + Math.cos(a) * SQ, y: t.y + Math.sin(a) * SQ }, k % 2 === 0);
        }
        this.hurt(to, RING_DAMAGE);
        break;
      case "web":
        this.field("web", { x: t.x, y: t.y });
        // web.kod: it holds who it catches
        if (to.bout) to.webbedMs = 2500 + this.rand() * 1500;
        break;
    }
  }

  private pickWeighted<T>(list: readonly (readonly [T, number])[]): T {
    const total = list.reduce((s, [, w]) => s + w, 0);
    let r = this.rand() * total;
    for (const [v, w] of list) if ((r -= w) < 0) return v;
    return list[list.length - 1][0];
  }

  /** A bolt across the floor (project.c, as the server sends a projectile) */
  private shoot(from: Walker, to: Walker, bolt: (typeof BOLTS)[number]): void {
    const kind = bolt.file === "fireball.bgf" ? "fire" : "lightning";
    const s = { x: from.obj.x, y: from.obj.y },
      d = { x: to.obj.x, y: to.obj.y };
    const len = dist(s, d) / SQ;
    const id = ambientId();
    this.shotTargets.set(id, to);
    this.shotList.push({
      id, x: s.x, y: s.y, sourceX: s.x, sourceY: s.y, destX: d.x, destY: d.y, progress: 0,
      increment: len ? bolt.speed / 1000 / len : 1, angle: angleTo(d.x - s.x, d.y - s.y), flags: 0, bolt: kind,
      info: { iconRes: localRes(bolt.file), light: { flags: 0x3, intensity: 100, color: bolt.color } },
      look: { anim: animStateFrom(bolt.animation), overlays: [], translation: 0 },
    });
  }

  /** One element of a wall spell on the floor (wallelem/*.kod), if there's open floor there */
  private field(kind: keyof typeof FIELDS, at: NavPoint, lit = false): void {
    if (!this.spotOpen(at) || this.fieldList.length >= MAX_FIELDS) return;
    const f = FIELDS[kind];
    const id = ambientId();
    const animation: Animation = "cycle" in f ? { type: ANIMATE.CYCLE, period: f.cycle + Math.floor(this.rand() * 40), groupLow: 1, groupHigh: 5 }
      : "grow" in f ? { type: ANIMATE.ONCE, period: f.grow, groupLow: 1, groupHigh: 5, groupFinal: 5 }
      : { type: ANIMATE.NONE, group: 1 };
    const look: Look = { anim: animStateFrom(animation), overlays: [], translation: 0 };
    const light = lit && "light" in f ? { ...f.light } : { flags: 0, intensity: 0, color: 0 };
    const obj: WorldObject = {
      id, x: Math.round(at.x), y: Math.round(at.y), angle: Math.floor(this.rand() * 4096), normal: look, moving: look, look, motion: null, version: 0,
      info: {
        id, amount: 0, iconRes: localRes(f.file), nameRes: 0, flags: 0, drawingType: f.drawFx, minimapFlags: 0, nameColor: 0, objectType: 0,
        moveOnType: 0, light, translation: 0, effect: 0, animation, overlays: [],
      },
    };
    this.fieldList.push({ obj, ms: FIELD_MS + this.rand() * 3000, drawFx: f.drawFx, hurt: f.hurt });
  }

  /**
   * The wall spells' elements burn out after a while, fading as they go, and hurt whoever stands
   * in them
   */
  private burnFields(dt: number): void {
    if (!this.fieldList.length) return;
    for (const b of this.bouts)
      for (const w of [b.a, b.b]) {
        let hurt = 0;
        for (const f of this.fieldList) if (f.hurt && dist(f.obj, w.obj) < FIELD_REACH) hurt = Math.max(hurt, f.hurt);
        if (hurt) this.hurt(w, (hurt * dt) / 1000);
      }
    for (const f of this.fieldList) {
      f.ms -= dt;
      animStep(f.obj.look.anim, 0, dt);
      // The last moment: more see-through (proto.h DRAWFX_TRANSLUCENT25)
      if (f.ms < FIELD_FADE_MS && f.obj.info.drawingType !== 1) {
        f.obj.info.drawingType = 1;
        f.obj.version++;
      }
    }
    this.fieldList = this.fieldList.filter((f) => f.ms > 0);
  }

  /** project.c ProjectilesMove: on their way, gone when they arrive */
  private flyShots(dt: number): void {
    if (!this.shotList.length) return;
    for (const p of this.shotList) {
      p.progress += p.increment * dt;
      p.x = p.sourceX + Math.min(1, p.progress) * (p.destX - p.sourceX);
      p.y = p.sourceY + Math.min(1, p.progress) * (p.destY - p.sourceY);
      animStep(p.look.anim, 0, dt);
    }
    for (const p of this.shotList) {
      if (p.progress < 1) continue;
      this.event({ type: "impact", x: p.destX, y: p.destY, bolt: p.bolt });
      // It hits if they're still about where it was aimed
      const t = this.shotTargets.get(p.id);
      this.shotTargets.delete(p.id);
      if (t && dist(t.obj, { x: p.destX, y: p.destY }) < BOLT_REACH) this.hurt(t, this.between(BOLT_DAMAGE));
    }
    this.shotList = this.shotList.filter((p) => p.progress < 1);
  }

  // ---- the stands ----

  /** A stand to put someone in, the bigger ones more often */
  private galleryArea(): number {
    const total = this.galleries.reduce((t, a) => t + (this.cells.get(a) ?? 0), 0);
    let r = this.rand() * total;
    for (const a of this.galleries) if ((r -= this.cells.get(a) ?? 0) < 0) return a;
    return this.galleries[0] ?? this.mainArea;
  }

  /** The arena's stands are never empty: watchers, kept apart from the floor's count (and the beaten, who go after a while) */
  private keepSpectators(n: number): void {
    if (!this.galleries.length) return;
    for (const w of this.walkers) if (w.beaten && w.stayMs < 0 && w.fadeDir >= 0 && !w.leaving) this.leave(w);
    const fans = this.walkers.filter((w) => w.role === "spectator" && w.fadeDir >= 0 && !w.beaten);
    if (fans.length > n) {
      fans[fans.length - 1].fadeDir = -1;
      return;
    }
    if (fans.length === n) return;
    const area = this.galleryArea();
    const cell = this.openCellAwayFrom(area);
    if (cell < 0) return;
    const w = this.spawn(cellCentre(this.grid!, cell), 0, this.ageMs > 1000, "spectator", area);
    w.stayMs = FOREVER;
    w.idleMs = 5000 + this.rand() * 20000;
    this.faceThePit(w);
    w.obj.angle = w.faceAngle;
  }

  private faceThePit(w: Walker): void {
    const c = this.pitCentre;
    if (c) w.faceAngle = angleTo(c.x - w.obj.x, c.y - w.obj.y);
  }

  // ---- emotes ----

  /** An emote for a while: a dance or a cheer lasts `ms`; a wave or a point plays once */
  private emote(w: Walker, pose: Pose, ms: number): void {
    // A cheer is a frame of the dance, a different one each time
    if (pose === "cheer") w.cheerFrame = Math.floor(this.rand() * 17) % 17;
    this.setPose(w, pose, true);
    w.emoteMs = ms;
    if (pose === "cheer" && this.spec.spectators) this.event({ type: "cheer", x: w.obj.x, y: w.obj.y, female: w.look.female });
  }

  /**
   * Standing about, now and then: patrons (inns) wave, point at whoever they're with, or dance
   * (about one in ten); courtiers wave and point; the stands cheer, wave, point and dance
   */
  private fidget(w: Walker): void {
    const fan = w.role === "spectator" && !!this.spec.spectators;
    w.nextEmoteMs = fan ? 1500 + this.rand() * 4500 : 6000 + this.rand() * 14000;
    if (w.look.gear?.weapon || w.torch) return;
    const r = this.rand();
    if (fan) {
      if (r < 0.35) this.emote(w, "cheer", 1500 + this.rand() * 2000);
      else if (r < 0.55) this.emote(w, "wave", 0);
      else if (r < 0.72) this.emote(w, "point", 0);
      else if (r < 0.82) this.emote(w, "dance", 4000 + this.rand() * 5000);
      return;
    }
    const inn = this.spec.kind === "inn";
    if (inn && r < 0.1) return this.emote(w, "dance", 6000 + this.rand() * 9000);
    // A roll of the dice (5%) or a drink (14%) now and then
    if (inn && r > 0.81) return this.event({ type: r > 0.95 ? "dice" : "drink", x: w.obj.x, y: w.obj.y });
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
    w.say = { text, ms: SAY_MS + text.length * 40 };
  }

  /** Now and then, someone near the player says something */
  private chatter(dt: number): void {
    if ((this.sayMs -= dt) > 0) return;
    this.sayMs = (this.spec.kind === "inn" ? 2500 : 4000) + this.rand() * 7000;
    const pl = this.frame.player;
    if (!pl || this.walkers.filter((w) => w.say).length >= MAX_SPEAKING) return;
    const near = this.walkers.filter((w) => !w.say && w.fadeDir >= 0 && w.fade >= 1 && !w.fleeing && !w.bout && dist(w.obj, pl) < SPEAK_RANGE);
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
    const dt = FADE_FX[Math.min(3, Math.floor(w.fade * 4))];
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
    if (this.frame.impressive && player && near < GLANCE_DISTANCE && w.glanceMs <= 0 && !w.bout && !w.fleeing && w.role !== "fighter") {
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
      if (player && near < SIDESTEP_DISTANCE && !w.bout) {
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
      const wet = this.weather && town && w.role === "folk" ? WET_PACE : 1;
      const chase = w.bout && w.role === "fighter" ? CHASE_PACE : 1;
      let move = w.pace * dt * (w.fleeing ? FLEE_PACE : wet * chase);
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
    if (w.bout) {
      if (w.faceAngle >= 0) this.turnTowards(w, w.faceAngle, dt);
      return;
    }
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
    // The stands watch the middle of the floor (once they've turned back from greeting us)
    if (w.role === "spectator" && this.spec.spectators && w.greetCooldown < GREET_COOLDOWN_MS - 3000) this.faceThePit(w);
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
    if (w.bout) return this.stand(w, FOREVER);
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
    const others = this.walkers.filter((v) => v !== w && v.mode === "idle" && !v.leaving && !v.bout && !v.beat && v.area === w.area);
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
