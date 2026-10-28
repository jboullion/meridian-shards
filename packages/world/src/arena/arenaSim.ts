// Ours (docs/adr/0007-arena.md): an arena's fights (the Arena of Kraanan's, or the Arena of Death's:
// arenaRooms.ts), as one simulation that everyone on a game server watches. The gateway runs it (tools/gateway/arena.ts) and sends what happens; with no
// feed the client runs it itself (arenaView.ts). It never touches the game: nothing here reaches
// blakserv, and real players are never in it.
//
// Rounds: a lot of the season's roster comes onto the floor and fights until one is left
// standing. The beaten go to the stands to watch (players beaten there leave no body either), the
// winner cheers with the stands, and the next lot comes in. The arena is shut at night.
//
// The fighting is the game's, as far as a crowd can have it: weapons by kind and quality
// (weapon.kod), armour that soaks blows, and spells with their Kod numbers: bolts that hurt, walls
// of fire that burn whoever stands in them, poison fog, webs that hold whoever walks into them,
// brambles that bar the way until they're cut down and scratch whoever brushes past, and blind and
// dazzle, after which the victim stumbles about unable to fight (AI_MOVE_RANDOM | AI_NOFIGHT, as
// the server does to monsters), and hold, which leaves them standing still. Bows shoot arrows.
//
// While a player's mock bout holds the floor (our server's, docs/adr/0019-arena-bouts.md; the
// watchers say so: setBusy), no round is fought: those on the floor leave, the stands stay.
//
// Fixed 50 ms ticks from a seeded random stream: the same seed and the same calls give the same
// fights (the tests rely on it).

import { FINENESS } from "@shards/formats";
import { NAV_CELL, cellAt, cellCentre, findPath, isOpen, randomCell, walkable, type NavGrid, type NavPoint } from "../navGrid.ts";
import { chatterLine, type ChatterContext, type Role } from "../ambient/chatter.ts";
import { personName } from "../ambient/names.ts";
import { randomAppearance, type Appearance, type Pose } from "../ambient/townsfolk.ts";
import { seededRandom } from "../ambient/ambientLife.ts";
import { EFFECT_INTERVAL_MS, WEAPON_DAMAGE, type ArchetypeDef, type ArenaSpellDef, type ArenaWeaponDef, type FieldKind } from "./arenaData.ts";
import { arenaOpenAt, type ArenaConfig } from "./arenaConfig.ts";
import type { ArenaChampion, ArenaRecord, RosterEntry } from "./arenaRoster.ts";
import {
  ARENA_STATUS, type ArenaEvent, type ArenaFieldWire, type ArenaMove, type ArenaPersonWire, type ArenaPhase, type ArenaRosterWire, type ArenaShotWire,
  type ArenaState, type ArenaTick,
} from "./arenaWire.ts";

const SQ = FINENESS;
export const ARENA_TICK_MS = 50;
/** Ticks are sent every this many (100 ms) */
export const ARENA_SEND_EVERY = 2;

/** Walking pace, fine units a ms; fighters close in a little faster; the blind stumble */
const PACE_MIN = 1.0,
  PACE_MAX = 1.6;
const CHASE_PACE = 1.2;
const STUMBLE_PACE = 0.45;
const TURN_RATE = 6;
const FADE_MS = 600;
/** A fighter strikes from this close (and its weapon's reach beyond arm's length: weapon.kod WEAPON_RANGE_*) */
const ARM = 1.1 * SQ;
/** A bolt landing this close to whom it was meant for hits */
const BOLT_REACH = 1.2 * SQ;
/** A wall's element touches whoever's within this (its square) */
const FIELD_REACH = 0.55 * SQ;
/** Brambles scratch whoever moves this close (bramble.kod InRange with bMovement), and bar cells this close */
const BRAMBLE_REACH = 0.9 * SQ;
const BRAMBLE_BLOCK = 0.55 * SQ;
/** Fields at most at once */
const MAX_FIELDS = 60;
/** poisfogc.kod POISON_LOSSRATE: 5000 * 10^-4 health a second */
const POISON_RATE = 0.5;
/** The fallen speak now and then; at most this many at once */
const MAX_SPEAKING = 2;
const SAY_MS = 3200;
/** How often a fighter looks for a nearer foe, and re-plans its way to them */
const RETARGET_MS = 4000;
const CHASE_STEP_MS = 350;
const FOREVER = 1e9;
/** A player's bout holds the floor at most this long, unless said again (anyone may say so: the gateway asks nobody) */
export const ARENA_BUSY_MAX_MS = 6 * 60_000;
/** Bowmen keep this far off (squares) */
const BOW_KEEP = 3;

type ArenaRole = "fighter" | "mage" | "spectator";

interface Person {
  id: number;
  rid: number;
  name: string;
  arch: string;
  role: ArenaRole;
  look: Appearance;
  x: number;
  y: number;
  angle: number;
  pose: Pose;
  ps: number;
  cf: number;
  hp: number;
  mhp: number;
  mana: number;
  mmana: number;
  webMs: number;
  blindMs: number;
  dazzleMs: number;
  holdMs: number;
  poisonBy: Person | null;
  winner: boolean;
  beaten: boolean;
  fade: number;
  fadeDir: number;
  /** Walking: the points ahead */
  path: NavPoint[];
  walking: boolean;
  pace: number;
  idleMs: number;
  faceAngle: number;
  /** Going: fade away at the end of the path */
  leaving: boolean;
  /** Spectators: how long they watch; everyone: emotes */
  stayMs: number;
  emoteMs: number;
  nextEmoteMs: number;
  /** The fight: whom, and the timers for the next swing, spell, step and look about */
  target: Person | null;
  swingMs: number;
  castMs: number;
  cooldownMs: number;
  stepMs: number;
  retargetMs: number;
  /** The cell they were in last tick (webs catch whoever steps into a new square) */
  lastSquare: number;
  moved: boolean;
  lastHitBy: Person | null;
  /** The bramble they're cutting through, until it falls */
  hacking: Field | null;
  area: number;
  say: string | null;
  sayMs: number;
  /**
   * Spectators: the fighter they're cheering for this round (a contestant when picked), and the
   * round they picked in (once theirs falls, they don't pick another until the next)
   */
  fav: Person | null;
  favRound: number;
  /** For the ticks: what was last sent, and whether they're new */
  sent: string;
  fresh: boolean;
}

interface Field {
  id: number;
  kind: FieldKind;
  x: number;
  y: number;
  angle: number;
  born: number;
  ends: number;
  caster: Person;
  power: number;
  /** Who it touched this cycle, and when the cycle ends */
  affected: Set<number>;
  cycleMs: number;
  /** Brambles: health, the most, and the look by it */
  hp: number;
  mhp: number;
  g: number;
  lit: boolean;
}

interface Shot {
  id: number;
  spell: string;
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  born: number;
  /** ms to arrive */
  flight: number;
  from: Person;
  to: Person;
}

export interface ArenaSimOptions {
  config: ArenaConfig;
  roster: RosterEntry[];
  /** The season's records by roster place, changed in place as fights are won and lost */
  records: Record<number, ArenaRecord>;
  champions: ArenaChampion[];
  season: number;
  seed: number;
  /** The sim's clock at the start (the gateway's ms): times in the messages count from it */
  now?: number;
  /** The fighting floor's nav area (arenaRooms.ts arenaFloorArea); the stands are the other big ones. Default 1, the biggest */
  floorArea?: number;
}

const dist = (a: NavPoint, b: NavPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const angleTo = (dx: number, dy: number) => Math.round((Math.atan2(dy, dx) * 4096) / (2 * Math.PI)) & 4095;

/**
 * The game hour at a real time (ms), as blakserv works it out (system.kod SystemInitGameHour):
 * a day is two real hours, from Kod time (Unix time less KOD_TIME_BASE) less five hours
 */
export function arenaHourAt(now: number): number {
  const kod = Math.floor(now / 1000) - 1760000000 - 5 * 3600;
  return Math.floor((((kod % 7200) + 7200) % 7200) / 300);
}

export class ArenaSim {
  private readonly grid: NavGrid;
  private config: ArenaConfig;
  private roster: RosterEntry[];
  private records: Record<number, ArenaRecord>;
  private champions: ArenaChampion[];
  season: number;
  private readonly rand: () => number;
  private readonly nameRand: () => number;
  /** The sim's clock (ms) */
  now: number;
  private people: Person[] = [];
  private fields: Field[] = [];
  private shots: Shot[] = [];
  private nextId = 1;
  phase: ArenaPhase = "rest";
  private phaseMs = 1500;
  private roundMs = 0;
  private beatenThisRound = 0;
  /** Counts the rounds, for the spectators' favourites */
  private round = 0;
  private winner: Person | null = null;
  private pit: NavPoint = { x: 0, y: 0 };
  private readonly floorArea: number;
  /** Until when (the sim's clock) a player's bout holds the floor */
  private busyUntil = 0;
  private galleries: number[] = [];
  private areaCells = new Map<number, number>();
  private blocksVersion = 0;
  private tickCount = 0;
  // What the next tick message holds
  private gone: number[] = [];
  private fieldsAdded: ArenaFieldWire[] = [];
  private fieldsChanged: [number, number][] = [];
  private fieldsGone: number[] = [];
  private shotsAdded: ArenaShotWire[] = [];
  private events: ArenaEvent[] = [];
  private said: [number, string][] = [];
  private rosterChanged = new Set<number>();
  private championsChanged = false;
  private seasonChanged = false;
  /** Called when a round ends (the gateway saves the records then) */
  onRoundEnd?: () => void;

  constructor(grid: NavGrid, opts: ArenaSimOptions) {
    // Our own blocked cells (brambles), whoever else uses the grid
    this.grid = { ...grid, closed: new Uint8Array(grid.closed.length) };
    this.config = opts.config;
    this.roster = opts.roster;
    this.records = opts.records;
    this.champions = opts.champions;
    this.season = opts.season;
    this.rand = seededRandom(opts.seed);
    this.nameRand = seededRandom((opts.seed ^ 0x5bd1e995) >>> 0);
    this.now = opts.now ?? 0;
    this.floorArea = opts.floorArea ?? 1;
    for (const a of grid.area) if (a) this.areaCells.set(a, (this.areaCells.get(a) ?? 0) + 1);
    // The floor is its area (by default the largest: nav areas are numbered largest first); the stands the other big ones
    this.galleries = [...this.areaCells.entries()].filter(([a, n]) => a !== this.floorArea && n >= 100).map(([a]) => a);
    let sx = 0,
      sy = 0,
      n = 0;
    for (let i = 0; i < grid.area.length; i++)
      if (grid.area[i] === this.floorArea) {
        const c = cellCentre(grid, i);
        sx += c.x;
        sy += c.y;
        n++;
      }
    if (n) this.pit = { x: sx / n, y: sy / n };
  }

  /** A new season: its roster fights from the next round */
  setSeason(season: number, roster: RosterEntry[], records: Record<number, ArenaRecord>, champions: ArenaChampion[]): void {
    this.season = season;
    this.roster = roster;
    this.records = records;
    this.champions = champions;
    this.seasonChanged = true;
    this.championsChanged = true;
    for (const r of roster) this.rosterChanged.add(r.id);
  }

  /**
   * A player's bout holds the floor (true), or is over (false): while it does, no round is fought
   * and those on the floor leave it. It lapses after ARENA_BUSY_MAX_MS unless said again
   */
  setBusy(busy: boolean): void {
    this.busyUntil = busy ? this.now + ARENA_BUSY_MAX_MS : 0;
  }

  /** Whether a player's bout holds the floor */
  get busy(): boolean {
    return this.now < this.busyUntil;
  }

  // ---- stepping ----

  /** One tick (ARENA_TICK_MS), at the game hour (null: as by day) */
  update(dt: number, hour: number | null): void {
    this.now += dt;
    this.tickCount++;
    const open = arenaOpenAt(this.config.open, hour);
    if (!open && this.phase !== "closed") this.close();
    if (open && this.phase === "closed") {
      this.phase = "rest";
      this.phaseMs = 1000;
    }
    if (open) {
      this.keepSpectators();
      this.runRound(dt);
    }
    this.burnFields(dt);
    this.flyShots();
    for (const p of this.people) this.think(p, dt);
    for (const p of this.people) this.step(p, dt);
    for (const p of this.people) if (p.say && (p.sayMs -= dt) <= 0) p.say = null;
    const before = this.people.length;
    this.people = this.people.filter((p) => {
      if (p.fadeDir < 0 && p.fade <= 0) {
        this.gone.push(p.id);
        return false;
      }
      return true;
    });
    if (this.people.length !== before) for (const p of this.people) if (p.target && !this.people.includes(p.target)) p.target = null;
  }

  // ---- what's sent ----

  /** Everything, for someone who starts watching */
  state(): ArenaState {
    const c = this.config;
    const labels = {
      arch: Object.fromEntries(Object.entries(c.archetypes).map(([k, a]) => [k, a.label])),
      weapon: Object.fromEntries(Object.entries(c.weapons).map(([k, w]) => [k, w.label])),
      spell: Object.fromEntries(Object.entries(c.spells).map(([k, s]) => [k, s.label])),
    };
    return {
      t: "arenaState", now: this.now, season: this.season, labels, phase: this.phase,
      people: this.people.map((p) => this.personWire(p)),
      fields: this.fields.map((f) => this.fieldWire(f)),
      shots: this.shots.map((s) => this.shotWire(s)),
      roster: this.roster.map((r) => this.rosterWire(r.id)),
      champions: this.champions,
    };
  }

  /** What changed since the last call */
  tick(): ArenaTick {
    const m: ArenaTick = { t: "arenaTick", now: this.now, phase: this.phase };
    const add: ArenaPersonWire[] = [];
    const mv: ArenaMove[] = [];
    for (const p of this.people) {
      const move = this.moveOf(p);
      const key = move.join(",");
      if (p.fresh) {
        p.fresh = false;
        add.push(this.personWire(p));
      } else if (key !== p.sent) mv.push(move);
      p.sent = key;
    }
    if (add.length) m.add = add;
    if (mv.length) m.mv = mv;
    if (this.gone.length) m.del = this.gone.splice(0);
    if (this.fieldsAdded.length) m.fa = this.fieldsAdded.splice(0);
    if (this.fieldsChanged.length) m.fc = this.fieldsChanged.splice(0);
    if (this.fieldsGone.length) m.fd = this.fieldsGone.splice(0);
    if (this.shotsAdded.length) m.sh = this.shotsAdded.splice(0);
    if (this.events.length) m.ev = this.events.splice(0);
    if (this.said.length) m.say = this.said.splice(0);
    if (this.rosterChanged.size) {
      m.ro = [...this.rosterChanged].filter((id) => this.roster[id]).map((id) => this.rosterWire(id));
      this.rosterChanged.clear();
    }
    if (this.championsChanged) {
      m.champions = this.champions;
      this.championsChanged = false;
    }
    if (this.seasonChanged) {
      m.season = this.season;
      this.seasonChanged = false;
    }
    return m;
  }

  private st(p: Person): number {
    return (
      (p.webMs > 0 ? ARENA_STATUS.WEBBED : 0) | (p.blindMs > 0 ? ARENA_STATUS.BLIND : 0) | (p.dazzleMs > 0 ? ARENA_STATUS.DAZZLED : 0) |
      (p.poisonBy ? ARENA_STATUS.POISONED : 0) | (p.winner ? ARENA_STATUS.WINNER : 0) | (p.beaten ? ARENA_STATUS.BEATEN : 0) |
      (p.holdMs > 0 ? ARENA_STATUS.HELD : 0)
    );
  }

  private moveOf(p: Person): ArenaMove {
    return [p.id, Math.round(p.x), Math.round(p.y), p.angle, p.pose, p.ps, p.cf, Math.ceil(p.hp), this.st(p), Math.round(p.fade * 100), p.fadeDir, p.fav?.id ?? -1];
  }

  private personWire(p: Person): ArenaPersonWire {
    return {
      id: p.id, rid: p.rid, name: p.name, arch: p.arch, role: p.role, look: p.look, x: Math.round(p.x), y: Math.round(p.y), a: p.angle, pose: p.pose,
      ps: p.ps, cf: p.cf, hp: Math.ceil(p.hp), mhp: p.mhp, st: this.st(p), fade: Math.round(p.fade * 100), fd: p.fadeDir, fav: p.fav?.id ?? -1,
    };
  }

  private fieldWire(f: Field): ArenaFieldWire {
    return { id: f.id, kind: f.kind, x: Math.round(f.x), y: Math.round(f.y), a: f.angle, t: f.born, end: f.ends, g: f.g, lit: f.lit };
  }

  private shotWire(s: Shot): ArenaShotWire {
    return { id: s.id, spell: s.spell, sx: Math.round(s.sx), sy: Math.round(s.sy), dx: Math.round(s.dx), dy: Math.round(s.dy), t: s.born };
  }

  private rosterWire(rid: number): ArenaRosterWire {
    const r = this.roster[rid];
    return {
      rid, name: r.name, arch: r.arch, weapon: r.weapon, spell: r.spell, rec: { ...(this.records[rid] ?? { wins: 0, losses: 0, kills: 0 }) },
      champ: this.champions.filter((c) => c.name === r.name && c.arch === r.arch).map((c) => c.season),
    };
  }

  // ---- for the tests and dev tools ----

  /** Who's in the arena, as watchers see them */
  get everyone(): ArenaPersonWire[] {
    return this.people.map((p) => this.personWire(p));
  }

  /** The fields on the floor */
  get fieldList(): ArenaFieldWire[] {
    return this.fields.map((f) => this.fieldWire(f));
  }

  /** The grid with the brambles' cells closed */
  get nav(): NavGrid {
    return this.grid;
  }

  get pitCentre(): NavPoint {
    return this.pit;
  }

  // ---- rounds ----

  private contestant(p: Person): boolean {
    return (p.role === "fighter" || p.role === "mage") && p.fadeDir >= 0 && !p.leaving && p.hp > 0 && !p.beaten;
  }

  private runRound(dt: number): void {
    if (this.busy) {
      if (this.phase === "fight" || this.phase === "won") this.yieldFloor();
      return;
    }
    const floor = this.people.filter((p) => this.contestant(p));
    if (this.phase === "fight") {
      this.roundMs += dt;
      const left = floor.filter((p) => !p.winner);
      if (left.length > 1 && this.roundMs < this.config.roundMaxMs) return;
      if (left.length > 1) {
        // Too long: the healthiest left wins, and the rest yield
        left.sort((a, b) => b.hp / b.mhp - a.hp / a.mhp);
        for (const p of left.slice(1)) this.beat(p, true);
        left.length = 1;
      }
      if (left.length === 1 && this.beatenThisRound) {
        this.victory(left[0]);
        this.phase = "won";
        this.phaseMs = this.between(this.config.victoryMs);
      } else {
        this.endRound();
        this.phase = "rest";
        this.phaseMs = 1500;
      }
      return;
    }
    if ((this.phaseMs -= dt) > 0) return;
    if (this.phase === "won") {
      const w = this.winner;
      this.winner = null;
      if (w && this.people.includes(w)) {
        w.emoteMs = 0;
        this.setPose(w, "stand");
        this.walkOff(w);
      }
      this.phase = "rest";
      this.phaseMs = this.between(this.config.restMs);
      for (const p of this.people) p.fav = null;
      return;
    }
    if (this.phase !== "rest") return;
    this.startRound(floor);
  }

  private startRound(floor: Person[]): void {
    const c = this.config;
    const n = c.floor[0] + Math.floor(this.rand() * (c.floor[1] - c.floor[0] + 1));
    const present = new Set(this.people.filter((p) => p.fadeDir >= 0).map((p) => p.rid));
    const free = this.roster.filter((r) => !present.has(r.id));
    const casters = (list: { arch: string }[]) => list.filter((r) => this.config.archetypes[r.arch]?.role === "mage").length;
    const chosen: RosterEntry[] = [];
    // At least so many casters when the roster has them, so there's magic to see
    for (let k = floor.length; k < n && free.length; k++) {
      const needMage = casters(chosen) + casters(floor) < c.minCasters;
      const pool = needMage && casters(free) ? free.filter((r) => this.config.archetypes[r.arch]?.role === "mage") : free;
      const r = pool[Math.floor(this.rand() * pool.length) % pool.length];
      chosen.push(r);
      free.splice(free.indexOf(r), 1);
    }
    for (const r of chosen) {
      const cell = this.openCell(this.floorArea);
      if (cell < 0) break;
      const at = cellCentre(this.grid, cell);
      const p = this.spawnFighter(r, at);
      p.idleMs = 1000 + this.rand() * 2000;
      p.angle = angleTo(this.pit.x - p.x, this.pit.y - p.y);
    }
    this.beatenThisRound = 0;
    this.roundMs = 0;
    this.round++;
    this.phase = "fight";
  }

  private endRound(): void {
    this.onRoundEnd?.();
  }

  /** The last one standing: a cheer of their own (weapon put away), and the stands roar */
  private victory(w: Person): void {
    this.winner = w;
    w.winner = true;
    w.target = null;
    this.stand(w, FOREVER);
    w.faceAngle = -1;
    this.emote(w, "cheer", FOREVER);
    this.speak(w, { won: true });
    this.event({ type: "victory", x: w.x, y: w.y });
    if (w.rid >= 0) this.record(w.rid, "wins");
    // Their fans cheer loudest, and a couple say so; the rest of the stands cheer too
    let said = 0;
    for (const f of this.people) {
      if (f.role !== "spectator" || f.fadeDir < 0 || f.walking) continue;
      if (f.fav === w) {
        this.emote(f, "cheer", 3500 + this.rand() * 2500);
        if (said < 2 && !f.say) {
          said++;
          this.speak(f, { fan: { name: w.name, outcome: "won" } });
        }
      } else if (this.rand() < 0.6) this.emote(f, this.rand() < 0.75 ? "cheer" : "wave", 2000 + this.rand() * 2500);
    }
    this.endRound();
  }

  /** The winner walks a few squares off and is gone */
  private walkOff(w: Person): void {
    for (let k = 0; k < 10; k++) {
      const a = this.rand() * 2 * Math.PI;
      const to = { x: w.x + Math.cos(a) * 4 * SQ, y: w.y + Math.sin(a) * 4 * SQ };
      const path = this.spotOpen(to) ? findPath(this.grid, w, to) : null;
      if (path?.length) {
        this.walk(w, path);
        w.leaving = true;
        return;
      }
    }
    w.leaving = true;
    w.fadeDir = -1;
  }

  /** A player's bout takes the floor: the round stops, those on it walk off, their walls and spells go; the stands stay */
  private yieldFloor(): void {
    this.winner = null;
    for (const p of this.people) {
      if (p.role === "spectator" || p.fadeDir < 0 || p.leaving) continue;
      p.target = null;
      p.winner = false;
      p.emoteMs = 0;
      this.setPose(p, "stand");
      this.walkOff(p);
    }
    for (const f of this.fields) this.fieldsGone.push(f.id);
    this.fields = [];
    this.shots = [];
    this.reblock();
    for (const p of this.people) p.fav = null;
    this.phase = "rest";
    this.phaseMs = this.between(this.config.restMs);
    this.endRound();
  }

  /** Shut for the night: everyone goes, the walls with them */
  private close(): void {
    this.phase = "closed";
    this.winner = null;
    for (const p of this.people) {
      p.leaving = true;
      p.fadeDir = -1;
      p.target = null;
    }
    for (const f of this.fields) this.fieldsGone.push(f.id);
    this.fields = [];
    this.shots = [];
    this.reblock();
  }

  private record(rid: number, what: keyof ArenaRecord): void {
    const r = (this.records[rid] ??= { wins: 0, losses: 0, kills: 0 });
    r[what]++;
    this.rosterChanged.add(rid);
  }

  // ---- people ----

  private spawn(role: ArenaRole, look: Appearance, at: NavPoint, area: number, fadeIn: boolean): Person {
    const p: Person = {
      id: this.nextId++, rid: -1, name: "", arch: "", role, look, x: at.x, y: at.y, angle: Math.floor(this.rand() * 4096), pose: "stand", ps: 0, cf: 0,
      hp: 1, mhp: 1, mana: 0, mmana: 0, webMs: 0, blindMs: 0, dazzleMs: 0, holdMs: 0, poisonBy: null, winner: false, beaten: false,
      fade: fadeIn ? 0 : 1, fadeDir: fadeIn ? 1 : 0, path: [], walking: false, pace: PACE_MIN + this.rand() * (PACE_MAX - PACE_MIN), idleMs: 0, faceAngle: -1,
      leaving: false, stayMs: FOREVER, emoteMs: 0, nextEmoteMs: 1500 + this.rand() * 4500, target: null, swingMs: 0, castMs: 0, cooldownMs: 0, stepMs: 0,
      retargetMs: 0, lastSquare: -1, moved: false, lastHitBy: null, hacking: null, area, say: null, sayMs: 0, fav: null, favRound: -1, sent: "", fresh: true,
    };
    this.people.push(p);
    return p;
  }

  private spawnFighter(r: RosterEntry, at: NavPoint): Person {
    const a = this.archetype(r.arch);
    const p = this.spawn(a.role, r.look, at, this.floorArea, true);
    p.rid = r.id;
    p.name = r.name;
    p.arch = r.arch;
    p.mhp = Math.round(this.between(a.hp));
    p.hp = p.mhp;
    p.mmana = a.mana;
    p.mana = a.mana;
    p.castMs = this.between(a.temper.castEvery) * 0.5;
    p.lastSquare = this.square(p);
    return p;
  }

  private archetype(key: string): ArchetypeDef {
    return this.config.archetypes[key] ?? Object.values(this.config.archetypes)[0];
  }

  /** The arena's stands are never empty while it's open, and the beaten go after a while */
  private keepSpectators(): void {
    if (!this.galleries.length) return;
    for (const p of this.people) if (p.beaten && p.stayMs < 0 && p.fadeDir >= 0) p.fadeDir = -1;
    const fans = this.people.filter((p) => p.role === "spectator" && p.fadeDir >= 0 && !p.beaten);
    const n = this.config.spectators;
    if (fans.length > n) {
      fans[fans.length - 1].fadeDir = -1;
      return;
    }
    if (fans.length === n) return;
    const area = this.galleryArea();
    const cell = this.openCell(area);
    if (cell < 0) return;
    const look = randomAppearance(this.rand);
    const p = this.spawn("spectator", look, cellCentre(this.grid, cell), area, this.tickCount > 20);
    p.name = personName(this.nameRand, "spectator", look.female);
    p.idleMs = 5000 + this.rand() * 20000;
    this.facePit(p);
    p.angle = p.faceAngle;
  }

  private galleryArea(): number {
    const total = this.galleries.reduce((t, a) => t + (this.areaCells.get(a) ?? 0), 0);
    let r = this.rand() * total;
    for (const a of this.galleries) if ((r -= this.areaCells.get(a) ?? 0) < 0) return a;
    return this.galleries[0] ?? 1;
  }

  private facePit(p: Person): void {
    p.faceAngle = angleTo(this.pit.x - p.x, this.pit.y - p.y);
  }

  /** A blow, a bolt, a wall or the poison lands: health off, and at none they're beaten */
  private hurt(p: Person, amount: number, by: Person | null): void {
    if (p.hp <= 0 || !this.contestant(p)) return;
    if (by && by !== p) p.lastHitBy = by;
    p.hp -= amount * this.config.damageScale;
    if (p.hp <= 0) this.beat(p, false);
  }

  /** The cry a hurt player gives (player.kod GetOuchSound): 1 when hale to 4 when nearly done; 0 when beaten (the death cry instead) */
  private ouch(p: Person): number {
    if (p.hp <= 0) return 0;
    const f = (p.hp / p.mhp) * 100;
    return f > 75 ? 1 : f > 50 ? 2 : f > 25 ? 3 : 4;
  }

  /**
   * One is beaten (or yields, a round gone on too long): a cry, gone from the floor, the stands
   * cheer, and they're in the stands to watch the rest
   */
  private beat(p: Person, yielded: boolean): void {
    p.hp = 0;
    this.beatenThisRound++;
    if (!yielded) this.event({ type: "death", x: p.x, y: p.y, female: p.look.female });
    if (p.rid >= 0) this.record(p.rid, "losses");
    const killer = p.lastHitBy ?? p.poisonBy;
    if (!yielded && killer && killer.rid >= 0 && killer !== p) this.record(killer.rid, "kills");
    p.fade = Math.min(p.fade, 1);
    p.fadeDir = -1;
    p.leaving = true;
    p.say = null;
    p.target = null;
    for (const o of this.people) if (o.target === p) o.target = null;
    this.booFall(p);
    this.cheer(p);
    if (!this.galleries.length) return;
    const area = this.galleryArea();
    const cell = this.openCell(area);
    if (cell < 0) return;
    const fan = this.spawn("spectator", p.look, cellCentre(this.grid, cell), area, true);
    fan.rid = p.rid;
    fan.name = p.name;
    fan.arch = p.arch;
    fan.beaten = true;
    fan.stayMs = this.between(this.config.beatenWatchMs);
    fan.idleMs = FOREVER;
    this.facePit(fan);
    fan.angle = fan.faceAngle;
    if (this.rand() < 0.5) this.speak(fan, { lost: true });
  }

  /** A fighter falls: their fans boo (pointing at the floor), a couple of them aloud, and they've no one to cheer this round */
  private booFall(p: Person): void {
    let said = 0;
    for (const f of this.people) {
      if (f.fav !== p) continue;
      f.fav = null;
      if (f.fadeDir < 0 || f.walking) continue;
      this.emote(f, "point", 0);
      if (said < 2 && !f.say) {
        said++;
        this.speak(f, { fan: { name: p.name, outcome: "lost" } });
      }
    }
  }

  /** A spectator picks a fighter to cheer for, once a round, from those still standing */
  private pickFavourite(p: Person): void {
    if (p.beaten || p.favRound === this.round || this.phase !== "fight") return;
    p.favRound = this.round;
    const on = this.people.filter((o) => this.contestant(o));
    p.fav = on.length ? on[Math.floor(this.rand() * on.length) % on.length] : null;
  }

  /** A spectator near a fight cheers it on */
  private cheer(at: NavPoint): void {
    const fans = this.people.filter((p) => p.role === "spectator" && !p.walking && p.fadeDir >= 0 && !p.say && dist(p, at) < 14 * SQ);
    if (!fans.length) return;
    const p = fans[Math.floor(this.rand() * fans.length) % fans.length];
    this.emote(p, this.rand() < 0.6 ? "cheer" : "wave", 1500 + this.rand() * 1500);
    if (this.speakers() < MAX_SPEAKING) this.speak(p, {});
  }

  // ---- thinking ----

  private think(p: Person, dt: number): void {
    if (p.fadeDir < 0) return;
    p.cooldownMs -= dt;
    p.castMs -= dt;
    p.swingMs -= dt;
    p.stepMs -= dt;
    p.retargetMs -= dt;
    p.stayMs -= dt;
    if (p.webMs > 0) p.webMs = Math.max(0, p.webMs - dt);
    if (p.blindMs > 0) p.blindMs = Math.max(0, p.blindMs - dt);
    if (p.dazzleMs > 0) p.dazzleMs = Math.max(0, p.dazzleMs - dt);
    if (p.holdMs > 0) p.holdMs = Math.max(0, p.holdMs - dt);
    if (p.mmana) p.mana = Math.min(p.mmana, p.mana + (this.archetype(p.arch).manaRegen * dt) / 1000);
    if (p.role === "spectator" || p.winner) return this.idle(p, dt);
    if (!this.contestant(p) || this.phase !== "fight") return this.idle(p, dt);
    if (p.poisonBy) this.hurt(p, (POISON_RATE * dt) / 1000, p.poisonBy);
    if (!this.contestant(p)) return;
    // Held: still as a statue, neither moving nor fighting (hold.kod)
    if (p.holdMs > 0) return;
    if (p.blindMs > 0 || p.dazzleMs > 0) return this.stumble(p);
    if (p.idleMs > 0) {
      p.idleMs -= dt;
      return;
    }
    if (!p.target || !this.contestant(p.target) || p.retargetMs <= 0) {
      p.retargetMs = RETARGET_MS;
      p.target = this.pickTarget(p) ?? p.target;
      if (p.target && !this.contestant(p.target)) p.target = null;
    }
    const o = p.target;
    if (!o) return;
    const a = this.archetype(p.arch);
    if (a.role === "fighter") this.fightMelee(p, o, a);
    else this.fightMagic(p, o, a);
  }

  /** The nearest foe, those nobody's fighting yet first */
  private pickTarget(p: Person): Person | null {
    let best: Person | null = null,
      score = Infinity;
    for (const o of this.people) {
      if (o === p || !this.contestant(o) || o.winner) continue;
      const taken = this.people.some((q) => q !== p && q.target === o) ? 3 * SQ : 0;
      const s = dist(p, o) + taken + (o === p.target ? -1.5 * SQ : 0);
      if (s < score) {
        score = s;
        best = o;
      }
    }
    return best;
  }

  private reachOf(p: Person): number {
    const w = this.weaponOf(p);
    return ARM + (w ? w.reach - 128 : 0);
  }

  private weaponOf(p: Person) {
    const r = p.rid >= 0 ? this.roster[p.rid] : undefined;
    return r?.weapon ? (this.config.weapons[r.weapon] ?? null) : null;
  }

  private fightMelee(p: Person, o: Person, a: ArchetypeDef): void {
    const bow = this.weaponOf(p)?.bow;
    if (bow) return this.fightBow(p, o, bow);
    const d = dist(p, o);
    const reach = this.reachOf(p);
    // A war-mage casts now and then, mostly while closing in
    if (a.spells.length && p.castMs <= 0 && p.cooldownMs <= 0 && d > reach && !p.walking) {
      if (this.castAt(p, o, a)) return;
    }
    if (d > reach) {
      if (p.webMs > 0) {
        p.faceAngle = angleTo(o.x - p.x, o.y - p.y);
        return;
      }
      // Cutting through brambles: on till they fall
      if (p.hacking && this.fields.includes(p.hacking) && dist(p, p.hacking) < reach + 0.8 * SQ) return this.swingAtBramble(p, p.hacking);
      p.hacking = null;
      if (p.stepMs > 0) return;
      p.stepMs = CHASE_STEP_MS;
      const to = { x: o.x + ((p.x - o.x) / (d || 1)) * 0.9 * SQ, y: o.y + ((p.y - o.y) / (d || 1)) * 0.9 * SQ };
      const path = this.pathTo(p, to) ?? this.pathTo(p, o);
      // No way through, or a long way round: hack at the brambles in the way
      const bramble = this.brambleNear(p, reach + 0.6 * SQ, o);
      if (bramble && (!path?.length || this.length(p, path) > d * 1.3 + SQ)) {
        p.hacking = bramble;
        return this.swingAtBramble(p, bramble);
      }
      if (path?.length) return this.walk(p, path);
      if (p.walking) this.stand(p, 0);
      return;
    }
    if (p.walking) this.stand(p, FOREVER);
    p.faceAngle = angleTo(o.x - p.x, o.y - p.y);
    if (p.swingMs > 0) return;
    this.swing(p, o);
  }

  private fightMagic(p: Person, o: Person, a: ArchetypeDef): void {
    const d = dist(p, o);
    const keep = a.temper.keepAway * SQ;
    const range = a.temper.castRange * SQ;
    // A short step back from whoever comes close (or in, when too far to cast), then a stand to cast
    if (p.walking) return;
    if (p.webMs <= 0 && p.stepMs <= 0 && (d < keep || d > range)) {
      const to = d < keep ? this.awayFrom(p, o) : this.towards(p, o, (keep + range) / 2);
      p.stepMs = to ? this.between(a.temper.stepEvery ?? [2500, 5000]) : 1000;
      if (to) return this.walk(p, [to]);
    }
    p.faceAngle = angleTo(o.x - p.x, o.y - p.y);
    // Cornered: a caster swings their fists, little as it does
    if (d < ARM && p.swingMs <= 0 && (p.mana < 7 || this.rand() < 0.3)) return this.swing(p, o);
    if (p.castMs > 0 || p.cooldownMs > 0) return;
    if (!this.castAt(p, o, a)) p.castMs = 800;
  }

  /** With a bow: keep a few squares off, as a caster does, and loose an arrow each time the bow's drawn */
  private fightBow(p: Person, o: Person, bow: NonNullable<ArenaWeaponDef["bow"]>): void {
    const d = dist(p, o);
    const keep = BOW_KEEP * SQ;
    const range = bow.range * SQ;
    if (p.walking) return;
    if (p.webMs <= 0 && p.stepMs <= 0 && (d < keep - 0.5 * SQ || d > range)) {
      const to = d < keep ? this.awayFrom(p, o) : this.towards(p, o, (keep + range) / 2);
      p.stepMs = to ? 2000 + this.rand() * 2000 : 800;
      if (to) return this.walk(p, [to]);
    }
    p.faceAngle = angleTo(o.x - p.x, o.y - p.y);
    if (p.swingMs > 0 || d > range) return;
    const s = this.config.spells[bow.shot];
    if (!s) return;
    const w = this.weaponOf(p);
    p.swingMs = (w?.swingMs ?? 1800) * (0.85 + this.rand() * 0.3);
    p.angle = p.faceAngle;
    this.setPose(p, "shoot", true);
    this.event({ type: "cast", x: p.x, y: p.y, spell: bow.shot });
    this.shoot(p, o, bow.shot, s);
    this.chatterInFight(p);
  }

  /** Blind or dazzled: stumbling about, unable to fight (blind.kod: AI_MOVE_RANDOM | AI_NOFIGHT) */
  private stumble(p: Person): void {
    if (p.webMs > 0 || p.walking || p.stepMs > 0) return;
    p.stepMs = 900 + this.rand() * 1400;
    for (let k = 0; k < 6; k++) {
      const a = this.rand() * 2 * Math.PI;
      const len = (0.6 + this.rand()) * SQ;
      const to = { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len };
      if (this.straight(p, to)) return this.walk(p, [to]);
    }
  }

  /** Spectators, the winner and those waiting: stand, face the floor, cheer now and then */
  private idle(p: Person, dt: number): void {
    if (p.walking) return;
    if (p.emoteMs > 0 && (p.emoteMs -= dt) <= 0) this.setPose(p, "stand");
    if (p.role !== "spectator" || p.fadeDir < 0) return;
    this.facePit(p);
    this.pickFavourite(p);
    if (p.emoteMs <= 0 && (p.nextEmoteMs -= dt) <= 0) {
      p.nextEmoteMs = 1500 + this.rand() * 4500;
      const r = this.rand();
      if (r < 0.35) this.emote(p, "cheer", 1500 + this.rand() * 2000);
      else if (r < 0.55) this.emote(p, "wave", 0);
      else if (r < 0.72) this.emote(p, "point", 0);
      else if (r < 0.82) this.emote(p, "dance", 4000 + this.rand() * 5000);
      // Now and then, a word for their fighter
      if (p.fav && this.contestant(p.fav) && !p.say && this.speakers() < MAX_SPEAKING && this.rand() < 0.05) this.speak(p, { fan: { name: p.fav.name } });
    }
  }

  // ---- blows ----

  private swing(p: Person, o: Person): void {
    const a = this.archetype(p.arch);
    const w = this.weaponOf(p);
    p.swingMs = (w?.swingMs ?? 1300) * (0.85 + this.rand() * 0.3);
    this.setPose(p, "attack", true);
    // Armour turns some blows; a foe held fast or blind is easier to hit
    const armour = this.armourOf(o);
    const helpless = o.webMs > 0 || o.blindMs > 0 || o.dazzleMs > 0 || o.holdMs > 0 ? 0.15 : 0;
    const lands = this.rand() < a.hit - (armour?.dodge ?? 0) + helpless;
    if (!lands) {
      this.event({ type: "swing", x: p.x, y: p.y, hit: null, ouch: 0, female: o.look.female });
      return this.chatterInFight(p);
    }
    // weapon.kod GetBaseDamage: by kind, with the quality's bonus; and the arm behind it, less the armour
    const base = w ? WEAPON_DAMAGE[w.kind] : ([1, 3] as const);
    const raw = this.int(base[0], base[1]) + (w?.quality ?? 0) + Math.round(this.between(a.might));
    const damage = Math.max(1, raw - (armour?.soak ?? 0));
    this.hurt(o, damage, p);
    // player.kod DoHitMessageSound: the sound by how hard (in hundredths: 300 and 600), and the victim's cry
    const hit = damage <= 3 ? "flesh" : damage <= 6 ? "leather" : "metal";
    this.event({ type: "swing", x: p.x, y: p.y, hit, ouch: this.ouch(o), female: o.look.female });
    this.chatterInFight(p);
  }

  private armourOf(p: Person) {
    const body = p.look.body;
    return Object.values(this.config.armour).find((a) => a.files.includes(body)) ?? null;
  }

  private swingAtBramble(p: Person, f: Field): void {
    if (p.walking) this.stand(p, FOREVER);
    p.faceAngle = angleTo(f.x - p.x, f.y - p.y);
    if (p.swingMs > 0) return;
    const w = this.weaponOf(p);
    p.swingMs = (w?.swingMs ?? 1300) * (0.85 + this.rand() * 0.3);
    this.setPose(p, "attack", true);
    const base = w ? WEAPON_DAMAGE[w.kind] : ([1, 3] as const);
    f.hp -= this.int(base[0], base[1]) + (w?.quality ?? 0);
    this.event({ type: "swing", x: p.x, y: p.y, hit: "leather", ouch: 0, female: false });
    if (f.hp <= 0) {
      this.event({ type: "chop", x: f.x, y: f.y });
      this.removeField(f);
      return;
    }
    const g = this.brambleLook(f);
    if (g !== f.g) {
      f.g = g;
      this.fieldsChanged.push([f.id, g]);
    }
  }

  /** bramble.kod SendAnimation: a frame by health, fifths of the most */
  private brambleLook(f: Field): number {
    const frac = f.hp / f.mhp;
    return frac < 0.2 ? 1 : frac < 0.4 ? 2 : frac < 0.6 ? 3 : frac < 0.8 ? 4 : 5;
  }

  /** How far a path goes */
  private length(from: NavPoint, path: NavPoint[]): number {
    let len = 0,
      at = from;
    for (const q of path) {
      len += dist(at, q);
      at = q;
    }
    return len;
  }

  private brambleNear(p: Person, within: number, toward: NavPoint): Field | null {
    let best: Field | null = null,
      score = Infinity;
    for (const f of this.fields) {
      if (f.kind !== "bramble") continue;
      const d = dist(f, p);
      // The ones between us and them
      if (d > within || dist(f, toward) > dist(p, toward)) continue;
      const s = d + dist(f, toward) * 0.5;
      if (s < score) {
        score = s;
        best = f;
      }
    }
    return best;
  }

  // ---- spells ----

  /** A spell at `o`, picked by what's going on, if one suits and there's the mana; false if none */
  private castAt(p: Person, o: Person, a: ArchetypeDef): boolean {
    const key = this.chooseSpell(p, o, a);
    if (!key) return false;
    const s = this.config.spells[key];
    p.mana -= s.mana;
    p.cooldownMs = s.postCast * 1000;
    p.castMs = this.between(a.temper.castEvery);
    if (p.walking) this.stand(p, 0);
    p.faceAngle = angleTo(o.x - p.x, o.y - p.y);
    p.angle = p.faceAngle;
    this.setPose(p, "cast", true);
    this.event({ type: "cast", x: p.x, y: p.y, spell: key });
    if (s.kind === "wall") this.layWall(p, o, s, a.power);
    else this.shoot(p, o, key, s);
    this.chatterInFight(p);
    return true;
  }

  private chooseSpell(p: Person, o: Person, a: ArchetypeDef): string | null {
    const d = dist(p, o);
    const fav = p.rid >= 0 ? this.roster[p.rid]?.spell : null;
    const melee = this.archetype(o.arch).role === "fighter";
    const closing = melee && d < 5.5 * SQ && o.webMs <= 0;
    const helpless = o.webMs > 0 || o.blindMs > 0 || o.dazzleMs > 0 || o.holdMs > 0;
    const choices: [string, number][] = [];
    for (const [key, weight] of a.spells) {
      const s = this.config.spells[key];
      if (!s || p.mana < s.mana || d > s.range * SQ) continue;
      let m = 1;
      if (s.kind === "bolt") m = (d > 3 * SQ ? 1.5 : 1) * (helpless ? 2 : 1);
      else if (s.kind === "curse") {
        if (o.blindMs > 0 || o.dazzleMs > 0 || o.holdMs > 0) continue;
        m = melee ? (closing ? 3 : 1.5) : 0.8;
      } else if (s.wall) {
        const ahead = s.wall.ahead * SQ;
        switch (s.wall.field) {
          case "web":
            if (o.webMs > 0) continue;
            m = closing && d > ahead ? 3 : 0.3;
            break;
          case "bramble":
            m = closing && d > ahead + 0.5 * SQ ? 2.5 : 0.2;
            break;
          case "fire":
            m = d > ahead + 0.5 * SQ ? 1.2 : 0.3;
            break;
          case "fog":
            m = d > ahead - 1 * SQ && d < ahead + 1.8 * SQ ? 2 : 0.2;
            break;
        }
      }
      if (key === fav) m *= 1.6;
      choices.push([key, weight * m]);
    }
    if (!choices.length) return null;
    const total = choices.reduce((t, [, w]) => t + w, 0);
    let r = this.rand() * total;
    for (const [k, w] of choices) if ((r -= w) < 0) return k;
    return choices[choices.length - 1][0];
  }

  /** A bolt or curse across the floor (project.c, as the server sends a projectile); one with no projectile (Hold) lands at once */
  private shoot(p: Person, o: Person, key: string, s: ArenaSpellDef): void {
    const speed = s.projectile?.speed;
    const len = dist(p, o) / SQ;
    const flight = speed ? (len / speed) * 1000 : 0;
    const shot: Shot = { id: this.nextId++, spell: key, sx: p.x, sy: p.y, dx: o.x, dy: o.y, born: this.now, flight, from: p, to: o };
    this.shots.push(shot);
    this.shotsAdded.push(this.shotWire(shot));
  }

  private flyShots(): void {
    if (!this.shots.length) return;
    const landed = this.shots.filter((s) => this.now - s.born >= s.flight);
    if (!landed.length) return;
    this.shots = this.shots.filter((s) => !landed.includes(s));
    for (const s of landed) {
      const def = this.config.spells[s.spell];
      const t = s.to;
      const hit = !!def && this.contestant(t) && dist(t, { x: s.dx, y: s.dy }) < BOLT_REACH;
      if (hit && def.kind === "bolt" && def.damage) this.hurt(t, this.int(def.damage[0], def.damage[1]), s.from);
      if (hit && def.curse) this.curse(t, def, this.archetype(s.from.arch).power);
      this.event({ type: "impact", x: s.dx, y: s.dy, spell: s.spell, ouch: hit && def.kind === "bolt" ? this.ouch(t) : 0, female: t.look.female });
    }
  }

  /** blind.kod / dazzle.kod GetDuration */
  private curse(t: Person, def: ArenaSpellDef, power: number): void {
    const c = def.curse!;
    let ms = c.base + power * c.perPower;
    if (c.extra) ms = Math.max(c.min, Math.min(c.max, ms + this.int(c.extra[0], c.extra[1])));
    ms = this.int(Math.floor((ms * (100 - c.deviation)) / 100), ms);
    ms = Math.max(c.min, Math.min(c.max, ms));
    if (c.status === "blind") t.blindMs = ms;
    else if (c.status === "dazzle") t.dazzleMs = ms;
    else {
      // Held: they stand where they are, and keep their foe
      t.holdMs = ms;
      if (t.walking) this.stand(t, 0);
      return;
    }
    t.target = null;
    if (t.walking) this.stand(t, 0);
    if (this.speakers() < MAX_SPEAKING && this.rand() < 0.6) this.speak(t, { blinded: true });
  }

  /**
   * A wall spell, laid as walspell/*.kod lays it: a line across the way `ahead` squares in front
   * of the caster (fire, brambles), or a square of elements centred `ahead` squares in front (webs,
   * fog), turned to face whom it's cast at
   */
  private layWall(p: Person, o: Person, s: ArenaSpellDef, power: number): void {
    const w = s.wall!;
    const d = dist(p, o) || 1;
    const ux = (o.x - p.x) / d,
      uy = (o.y - p.y) / d;
    const cx = p.x + ux * w.ahead * SQ,
      cy = p.y + uy * w.ahead * SQ;
    const spots: NavPoint[] = [];
    if (w.layout === "line") {
      for (let k = 0; k < w.count; k++) {
        const off = (k - (w.count - 1) / 2) * w.spacing * SQ;
        spots.push({ x: cx - uy * off, y: cy + ux * off });
      }
    } else {
      const side = Math.max(1, Math.round(Math.sqrt(w.count)));
      for (let i = 0; i < side; i++)
        for (let j = 0; j < side; j++) {
          const a = (i - (side - 1) / 2) * w.spacing * SQ,
            b = (j - (side - 1) / 2) * w.spacing * SQ;
          spots.push({ x: cx + ux * a - uy * b, y: cy + uy * a + ux * b });
        }
    }
    const life = this.fieldLife(w.field, power);
    spots.forEach((at, k) => this.addField(w.field, at, p, power, life, k % 2 === 0));
    if (w.field === "bramble") this.reblock();
  }

  /** How long a wall's element lasts (ms): its Kod duration from spell power, ±20 s, bounded, times the config's fieldLife */
  private fieldLife(kind: FieldKind, power: number): number {
    let secs: number;
    switch (kind) {
      case "fire":
        // firewall.kod: power * 2 + 30, 30-180 (:84-85); wallfire.kod GetDuration: ±20, 30-200 s (:74-76)
        secs = Math.max(30, Math.min(180, power * 2 + 30));
        break;
      case "bramble":
        // brmblwll.kod: power * 3 + 45, 45-270; bramble.kod Constructor: ±20, 30-200 s
        secs = Math.max(45, Math.min(270, power * 3 + 45));
        break;
      default:
        // summweb.kod, summpfog.kod: power * 4 / 3 + 20, 20-130 (web.kod: ±20, 20-150 s)
        secs = Math.max(20, Math.min(130, Math.floor((power * 4) / 3) + 20));
    }
    secs = Math.max(20, Math.min(200, this.int(secs - 20, secs + 20)));
    return secs * 1000 * this.config.fieldLife;
  }

  private addField(kind: FieldKind, at: NavPoint, caster: Person, power: number, life: number, lit: boolean): void {
    if (!this.spotOpen(at) || this.fields.length >= MAX_FIELDS) return;
    // Brambles don't grow on someone (they'd be caught inside)
    if (kind === "bramble" && this.people.some((q) => this.contestant(q) && dist(q, at) < BRAMBLE_BLOCK)) return;
    // bramble.kod: health from the spell power, bound(power / 2, 10, 50)
    const mhp = kind === "bramble" ? Math.max(10, Math.min(50, Math.floor(power / 2))) : 0;
    const f: Field = {
      id: this.nextId++, kind, x: at.x, y: at.y, angle: Math.floor(this.rand() * 4096), born: this.now, ends: this.now + life, caster, power,
      affected: new Set(), cycleMs: this.cycle(), hp: mhp, mhp, g: kind === "bramble" ? 5 : 0, lit,
    };
    this.fields.push(f);
    this.fieldsAdded.push(this.fieldWire(f));
  }

  /** wallelem.kod GetPeriodicDuration: 90-110% of EFFECT_INTERVAL */
  private cycle(): number {
    return (EFFECT_INTERVAL_MS * (90 + this.rand() * 20)) / 100;
  }

  private removeField(f: Field): void {
    this.fields = this.fields.filter((x) => x !== f);
    this.fieldsGone.push(f.id);
    if (f.kind === "bramble") this.reblock();
  }

  /** The cells brambles stand on are closed to everyone's paths; those walking find their way again */
  private reblock(): void {
    const g = this.grid;
    g.closed.fill(0);
    const r = Math.ceil(BRAMBLE_BLOCK / NAV_CELL);
    for (const f of this.fields) {
      if (f.kind !== "bramble") continue;
      const c0 = Math.round(f.x / NAV_CELL),
        r0 = Math.round(f.y / NAV_CELL);
      for (let rr = r0 - r; rr <= r0 + r; rr++)
        for (let cc = c0 - r; cc <= c0 + r; cc++) {
          if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
          const i = rr * g.cols + cc;
          if (dist(cellCentre(g, i), f) < BRAMBLE_BLOCK) g.closed[i] = 1;
        }
    }
    this.blocksVersion++;
    for (const p of this.people) if (p.walking && p.path.length) this.repath(p);
  }

  /**
   * The walls at work, each touching a person at most once a cycle (wallelem.kod CheckForEffect):
   * fire burns whoever's in it (wallfire.kod: random(0, max), max = power / 6, 1-16); fog may
   * poison them (poisfogc.kod: odds 50 + power / 2, 50-90 in 100); a web holds whoever steps into
   * it (web.kod: random(max - 2, max) s, max = 3 + power / 33, up to 5); brambles scratch whoever
   * brushes past (bramble.kod: random(0, max), max = power / 15, up to 5). Then they age, and go.
   */
  private burnFields(dt: number): void {
    if (!this.fields.length) return;
    const fighters = this.people.filter((p) => this.contestant(p));
    for (const f of this.fields) {
      if ((f.cycleMs -= dt) <= 0) {
        f.cycleMs = this.cycle();
        f.affected.clear();
      }
      for (const p of fighters) {
        if (f.affected.has(p.id) || !this.contestant(p)) continue;
        const d = dist(p, f);
        switch (f.kind) {
          case "fire": {
            if (d > FIELD_REACH) break;
            f.affected.add(p.id);
            const dmg = this.int(0, Math.max(1, Math.min(16, Math.floor(f.power / 6))));
            if (dmg > 0) {
              this.hurt(p, dmg, f.caster);
              this.event({ type: "burn", x: p.x, y: p.y, ouch: this.ouch(p), female: p.look.female });
            }
            break;
          }
          case "fog": {
            if (d > FIELD_REACH) break;
            f.affected.add(p.id);
            const odds = Math.max(50, Math.min(90, 50 + Math.floor(f.power / 2)));
            if (!p.poisonBy && this.int(1, 100) < odds) {
              p.poisonBy = f.caster;
              this.event({ type: "poisoned", x: p.x, y: p.y, ouch: this.ouch(p), female: p.look.female });
            }
            break;
          }
          case "web": {
            // Only stepping into a new square catches (web.kod DoEffect), and not while held already
            if (d > FIELD_REACH || !p.moved || p.webMs > 0) break;
            f.affected.add(p.id);
            const max = Math.min(5, 3 + Math.floor(f.power / 33));
            const secs = Math.max(1, this.int(max - 2, max));
            p.webMs = secs * 1000;
            if (p.walking) this.stand(p, 0);
            this.event({ type: "stuck", x: p.x, y: p.y, ouch: 0, female: p.look.female });
            if (this.speakers() < MAX_SPEAKING && this.rand() < 0.4) this.speak(p, { webbed: true });
            break;
          }
          case "bramble": {
            if (d > BRAMBLE_REACH || !p.moved) break;
            f.affected.add(p.id);
            const dmg = this.int(0, Math.min(5, Math.floor(f.power / 15)));
            if (dmg > 0) {
              this.hurt(p, dmg, f.caster);
              this.event({ type: "scratch", x: p.x, y: p.y, ouch: this.ouch(p), female: p.look.female });
            }
            break;
          }
        }
      }
    }
    const old = this.fields.filter((f) => this.now >= f.ends);
    for (const f of old) this.removeField(f);
  }

  // ---- moving about ----

  /** A path that keeps out of fire and fog if it can (brambles are always in the way) */
  private pathTo(p: Person, to: NavPoint): NavPoint[] | null {
    const g = this.grid;
    const hazards: number[] = [];
    for (const f of this.fields) {
      if (f.kind !== "fire" && f.kind !== "fog") continue;
      const i = cellAt(g, f.x, f.y);
      if (i >= 0 && !g.closed[i] && dist(f, to) > SQ) {
        g.closed[i] = 2;
        hazards.push(i);
      }
    }
    let path = findPath(g, p, to);
    for (const i of hazards) g.closed[i] = 0;
    if (!path && hazards.length) path = findPath(g, p, to);
    return path;
  }

  private walk(p: Person, path: NavPoint[]): void {
    p.emoteMs = 0;
    p.path = path;
    p.walking = true;
    p.faceAngle = -1;
    this.setPose(p, "walk");
  }

  private stand(p: Person, ms: number): void {
    p.walking = false;
    p.path = [];
    p.idleMs = ms === FOREVER ? 0 : ms;
    this.setPose(p, "stand");
  }

  private repath(p: Person): void {
    const end = p.path[p.path.length - 1];
    const path = end ? this.pathTo(p, end) : null;
    if (path) p.path = path;
    else this.stand(p, 0);
  }

  private awayFrom(p: Person, o: Person): NavPoint | null {
    const base = Math.atan2(p.y - o.y, p.x - o.x);
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const a = base + turn + (this.rand() - 0.5) * 0.3;
      const len = (1.5 + this.rand()) * SQ;
      const to = { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len };
      if (this.straight(p, to)) return to;
    }
    return null;
  }

  private towards(p: Person, o: Person, keep: number): NavPoint | null {
    const d = dist(p, o) || 1;
    const to = { x: o.x + ((p.x - o.x) / d) * keep, y: o.y + ((p.y - o.y) / d) * keep };
    return this.straight(p, to) ? to : null;
  }

  /** Whether someone can walk straight there: no wall, and no bramble's cell (or the stands) on the way */
  private straight(from: NavPoint, to: NavPoint): boolean {
    if (!this.spotOpen(to)) return false;
    const steps = Math.ceil(dist(from, to) / (NAV_CELL / 3));
    for (let k = 1; k < steps; k++) {
      const cell = cellAt(this.grid, from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps);
      if (!isOpen(this.grid, cell)) return false;
    }
    return walkable(this.grid, from.x, from.y, to.x, to.y);
  }

  private spotOpen(at: NavPoint): boolean {
    const cell = cellAt(this.grid, at.x, at.y);
    return cell >= 0 && isOpen(this.grid, cell) && this.grid.area[cell] === this.floorArea;
  }

  /** A random open cell in an area, not where someone stands */
  private openCell(area: number): number {
    for (let k = 0; k < 40; k++) {
      const cell = randomCell(this.grid, this.rand, area);
      if (cell < 0) return -1;
      const at = cellCentre(this.grid, cell);
      if (this.people.every((p) => p.fadeDir < 0 || dist(p, at) > 0.8 * SQ)) return cell;
    }
    return randomCell(this.grid, this.rand, area);
  }

  /** Which square (a half-square cell's square: the nav grid's cell, halved) someone is in */
  private square(p: NavPoint): number {
    return Math.floor(p.y / SQ) * 4096 + Math.floor(p.x / SQ);
  }

  private step(p: Person, dt: number): void {
    if (p.fadeDir) {
      p.fade = Math.max(0, Math.min(1, p.fade + (p.fadeDir * dt) / FADE_MS));
      if (p.fade >= 1 && p.fadeDir > 0) p.fadeDir = 0;
    }
    p.moved = false;
    if (p.fadeDir < 0 && !p.leaving) return;
    if (p.walking && p.webMs <= 0 && p.holdMs <= 0) {
      const next = p.path[0];
      if (!next) {
        p.walking = false;
        this.setPose(p, "stand");
        if (p.leaving) p.fadeDir = -1;
      } else {
        this.setPose(p, "walk");
        const slow = p.blindMs > 0 || p.dazzleMs > 0 ? STUMBLE_PACE : p.target && p.role === "fighter" ? CHASE_PACE : 1;
        let move = p.pace * dt * slow;
        let x = p.x,
          y = p.y;
        while (move > 0 && p.path.length) {
          const q = p.path[0];
          const d = Math.hypot(q.x - x, q.y - y);
          if (d <= move) {
            x = q.x;
            y = q.y;
            move -= d;
            p.path.shift();
          } else {
            x += ((q.x - x) / d) * move;
            y += ((q.y - y) / d) * move;
            move = 0;
          }
        }
        const head = p.path[0];
        if (head) this.turnTowards(p, angleTo(head.x - x, head.y - y), dt);
        p.x = x;
        p.y = y;
        if (!p.path.length) {
          p.walking = false;
          this.setPose(p, "stand");
          if (p.leaving) p.fadeDir = -1;
        }
      }
    } else if (p.faceAngle >= 0) this.turnTowards(p, p.faceAngle, dt);
    const sq = this.square(p);
    if (sq !== p.lastSquare) {
      p.moved = true;
      p.lastSquare = sq;
    } else if (p.walking) {
      // Brambles scratch whoever moves past them at all
      p.moved = this.fields.some((f) => f.kind === "bramble" && dist(f, p) < BRAMBLE_REACH);
    }
  }

  private turnTowards(p: Person, angle: number, dt: number): void {
    const diff = ((angle - p.angle + 6144) % 4096) - 2048;
    const max = TURN_RATE * dt;
    p.angle = (p.angle + Math.max(-max, Math.min(max, diff)) + 4096) & 4095;
  }

  /** A swing or a cast plays once, so `again` starts it over */
  private setPose(p: Person, pose: Pose, again = false): void {
    if (p.pose === pose && !again) return;
    p.pose = pose;
    if (again) p.ps++;
  }

  /** An emote for a while: a dance or a cheer lasts `ms`; a wave or a point plays once */
  private emote(p: Person, pose: Pose, ms: number): void {
    if (pose === "cheer") p.cf = Math.floor(this.rand() * 17) % 17;
    this.setPose(p, pose, true);
    p.emoteMs = ms || 1200;
    if (pose === "cheer") this.event({ type: "cheer", x: p.x, y: p.y, female: p.look.female });
  }

  // ---- speech ----

  private speakers(): number {
    return this.people.filter((p) => p.say).length;
  }

  private speak(p: Person, extra: Partial<ChatterContext>): void {
    const role: Role = p.role;
    const text = chatterLine(this.rand, { place: "arena", role, hour: null, weather: null, ...extra });
    p.say = text;
    p.sayMs = SAY_MS + text.length * 40;
    this.said.push([p.id, text]);
  }

  /** Now and then a fighter shouts, or the stands cheer the blow */
  private chatterInFight(p: Person): void {
    const n = this.speakers();
    if (n < MAX_SPEAKING && !p.say && this.rand() < 0.08) this.speak(p, {});
    else if (n < MAX_SPEAKING && this.rand() < 0.12) this.cheer(p);
  }

  private event(e: ArenaEvent): void {
    if (this.events.length < 60) this.events.push({ ...e, x: Math.round(e.x), y: Math.round(e.y) } as ArenaEvent);
  }

  // ---- numbers ----

  private between([lo, hi]: readonly number[]): number {
    return lo + this.rand() * (hi - lo);
  }

  /** Kod's Random(lo, hi): a whole number, both ends included */
  private int(lo: number, hi: number): number {
    return lo + Math.floor(this.rand() * (hi - lo + 1));
  }
}
