// Ours: small critters (rats, spiders, centipedes, ants, scorpions, bunnies) that scurry about
// near the player, seen by this client only. They're the monsters' own art, drawn small, with
// the walk cycles, corpses and death sounds their Kod classes give them. A click or an attack
// kills one at once: it squeaks, lies there a while and fades. No experience, nothing dropped,
// and the server never hears of them (they're never in WorldState).
//
// What lives where comes from the room's terrain (viTerrain_type, roomterrain.json from the asset
// build). They need no paths: each dashes a short straight way the walls allow and rests. Rats
// and bunnies run from the player when they come close; the rest pay no mind.

import { FINENESS, SF, ceilingHeightAt, floorHeightAt, leafAt, type Room } from "@shards/formats";
import { ANIMATE, type Animation, type ObjectInfo } from "@shards/protocol";
import { animStateFrom } from "../animation.ts";
import { navWalls, walkable, type NavGrid, type NavPoint } from "../navGrid.ts";
import type { Look, WorldObject } from "../state.ts";
import { ambientId, localRes } from "./ambientIds.ts";
import { AMBIENT_ROOMS } from "./ambientRooms.ts";
import { seededRandom } from "./ambientLife.ts";

/** proto.h OF_NPC: a shadow under it, like a monster's (ObjectsView) */
const OF_NPC = 0x2000;
/** proto.h DRAWFX_TRANSLUCENT75/50/25, for fading */
const FADE_FX = [1, 2, 3, 0];

export interface Species {
  icon: string;
  /** The corpse (the monster's dead icon) */
  dead: string;
  /** SendMoveAnimation's cycle (groups 1-based); standing is group 1 (object.kod SendAnimation) */
  walk: { period: number; low: number; high: number };
  /**
   * Drawn this many times the art's size (the monsters are giants of their kind): a rat about a
   * third of a square long, a baby spider a fifth; bunnies three quarters the game's (babies)
   */
  scale: number;
  /** Squares a second when dashing */
  pace: number;
  /** How far a dash goes (squares) and how long a rest lasts (ms) */
  dash: [number, number];
  rest: [number, number];
  /** The death sound (the monster's sound_death) */
  sound: string;
  /** Out at night this much as by day */
  night?: number;
  /** Runs from the player (rats and bunnies); the rest pay us no mind */
  shy?: boolean;
}

/** The Kod monster classes' art, animations and sounds (giarat, centip, spdrbaby, redant, scorpion, bunny .kod) */
export const SPECIES = {
  rat: { icon: "rat.bgf", dead: "ratx.bgf", walk: { period: 75, low: 2, high: 6 }, scale: 0.4, pace: 3.4, dash: [1, 4], rest: [500, 4000], sound: "rat_dth.ogg", night: 1.5, shy: true },
  centipede: { icon: "centip.bgf", dead: "centipx.bgf", walk: { period: 120, low: 2, high: 6 }, scale: 0.18, pace: 1.1, dash: [0.5, 2.5], rest: [800, 5000], sound: "cnt_dth.ogg" },
  // The baby spider monster (spdrbaby.kod) for both: the grown spider's art is a giant's
  babySpider: { icon: "spdrby.bgf", dead: "spdrbyx.bgf", walk: { period: 150, low: 1, high: 3 }, scale: 0.21, pace: 2.4, dash: [0.5, 2.5], rest: [500, 3500], sound: "bsp_dth.ogg" },
  spider: { icon: "spdrby.bgf", dead: "spdrbyx.bgf", walk: { period: 150, low: 1, high: 3 }, scale: 0.26, pace: 2.6, dash: [0.5, 3], rest: [500, 4000], sound: "bsp_dth.ogg" },
  mutantAnt: { icon: "antr.bgf", dead: "antrx.bgf", walk: { period: 125, low: 1, high: 3 }, scale: 0.08, pace: 2.2, dash: [0.5, 3], rest: [400, 3000], sound: "ant_dth.ogg" },
  scorpion: { icon: "scorp.bgf", dead: "scorpx.bgf", walk: { period: 200, low: 2, high: 3 }, scale: 0.11, pace: 1.5, dash: [0.5, 2], rest: [1000, 6000], sound: "scp_dth.ogg" },
  bunny: { icon: "bunny2.bgf", dead: "bunny2x.bgf", walk: { period: 180, low: 2, high: 3 }, scale: 0.68, pace: 3, dash: [1, 4], rest: [1500, 8000], sound: "bunny_dth.ogg", night: 0.3, shy: true },
  greyBunny: { icon: "bunnygrey.bgf", dead: "bunnygreyx.bgf", walk: { period: 180, low: 2, high: 3 }, scale: 0.56, pace: 3, dash: [1, 4], rest: [1500, 8000], sound: "bunny_dth.ogg", night: 0.3, shy: true },
} as const satisfies Record<string, Species>;
export type SpeciesName = keyof typeof SPECIES;

/** What lives in a room: how many about the player at once, and which */
export interface Habitat {
  name: string;
  count: number;
  mix: [SpeciesName, number][];
  /** They swim in shallow water too (sewers, swamps), at its surface */
  wades?: boolean;
}

const has = (t: readonly string[], ...names: string[]) => names.some((n) => t.includes(n));

/**
 * The room's critters from its terrain (TERRAIN_* names), or null for none. Rooms that don't say
 * (most town buildings): a town street (ambientRooms.ts) has rats, a town's other rooms the odd one.
 */
/** The vaults (each town's vault keeper's room: barvault.kod, bergvault.kod, jasvault.kod, razavault.kod, kocbank.kod) */
const VAULTS = new Set(["barvault.roo", "bergvault.roo", "jasvault.roo", "razavault.roo", "kocbank.roo"]);

export function habitatOf(roomFile: string, terrain: readonly string[] | undefined): Habitat | null {
  // The vaults' cellars have rats; the arena has none (its crowd is enough)
  if (VAULTS.has(roomFile)) return { name: "vault", count: 4, mix: [["rat", 1]] };
  if (AMBIENT_ROOMS[roomFile]?.kind === "arena") return null;
  const t = terrain ?? [];
  if (!t.length) {
    const spec = AMBIENT_ROOMS[roomFile];
    if (spec?.kind === "town") return { name: "street", count: 4, mix: [["rat", 1]] };
    if (spec || /^(tos|bar|mar|jas|cor|raza|koc|berg|jixa)/.test(roomFile)) return { name: "indoors", count: 0.6, mix: [["rat", 1]] };
    return null;
  }
  if (has(t, "SEWERS")) return { name: "sewer", count: 9, mix: [["rat", 8], ["centipede", 2]], wades: true };
  if (has(t, "CAVES", "MINES", "LAIR")) return { name: "cave", count: 6, mix: [["spider", 6], ["centipede", 1]] };
  if (has(t, "CITY") && !has(t, "SHOP", "RESIDENCE", "GUILDHALL", "TEMPLE", "CASTLE")) return { name: "street", count: 4, mix: [["rat", 1]] };
  if (has(t, "SHOP", "RESIDENCE", "GUILDHALL")) return { name: "indoors", count: 0.6, mix: [["rat", 1]] };
  if (has(t, "DESERT", "BADLANDS")) return { name: "desert", count: 6, mix: [["scorpion", 4], ["mutantAnt", 2]] };
  if (has(t, "MOUNTAIN")) return { name: "mountain", count: 6, mix: [["mutantAnt", 4], ["scorpion", 2]] };
  if (has(t, "SWAMP")) return { name: "swamp", count: 6, mix: [["centipede", 3], ["babySpider", 3]], wades: true };
  if (has(t, "FOREST", "FIELDS", "HILLS"))
    return { name: "wild", count: 8, mix: [["babySpider", 3], ["centipede", 3], ["bunny", 1.5], ["greyBunny", 0.7]] };
  if (has(t, "JUNGLE", "ROAD", "RIVER", "LAKE", "BEACH")) return { name: "wild", count: 6, mix: [["babySpider", 3], ["centipede", 3]] };
  if (has(t, "NECROPOLIS")) return { name: "crypt", count: 4, mix: [["spider", 3], ["rat", 1]] };
  return null;
}

/** The art every species needs, to load ahead */
export function critterArt(h: Habitat): string[] {
  return [...new Set(h.mix.flatMap(([n]) => [SPECIES[n].icon, SPECIES[n].dead]))];
}

/** Spawned this far from the player (fine units), and gone past the last */
const SPAWN_NEAR = 4 * FINENESS,
  SPAWN_FAR = 12 * FINENESS,
  GONE = 18 * FINENESS;
/** They run from the player this close */
const SHY = 2 * FINENESS;
/** Floors more than this above or below the player's (rooftops, ledges) get none */
const SAME_LEVEL = 600;
const MAX_STEP = 24 * 16;
/** Time a frame for finding where critters can be */
const SAMPLE_BUDGET_MS = 2;
/** A corpse lies this long, then fades */
const CORPSE_MS = 6000;
const FADE_MS = 500;

/**
 * A critter: a room object, with a height of its own while it swims (ObjectsView draws objects in
 * water sunk to the bottom, as the original does; a rat would be lost under the surface)
 */
type CritterObject = WorldObject & { z?: number };

interface Critter {
  obj: CritterObject;
  species: Species;
  mode: "rest" | "dash" | "dead";
  /** ms left resting, or lying dead */
  timer: number;
  to: NavPoint | null;
  pace: number;
  fade: number;
  fadeDir: number;
}

const none = (group: number): Animation => ({ type: ANIMATE.NONE, group });

/** A critter's look: one bitmap, no overlays (the art is the object's iconRes) */
function look(animation: Animation): Look {
  return { anim: animStateFrom(animation), overlays: [], translation: 0 };
}

export class Critters {
  readonly habitat: Habitat;
  private readonly room: Room;
  private readonly walls: NavGrid;
  private readonly rand: () => number;
  private critters: Critter[] = [];
  /** Where critters can be: x, y and floor height, three numbers a spot */
  private readonly spots: number[] = [];
  private sampler: Generator<void, void> | null;
  private spawnMs = 0;
  private started = false;
  /** Fractional counts (an indoor rat now and then) are decided once a visit */
  private readonly extra: number;
  /** Floor textures that are water though the sector has no depth (Raza's pool: watertextures.json) */
  private readonly waterTextures: ReadonlySet<number>;

  constructor(room: Room, habitat: Habitat, seed = Math.floor(Math.random() * 2 ** 32), waterTextures: ReadonlySet<number> = new Set()) {
    this.room = room;
    this.waterTextures = waterTextures;
    this.habitat = habitat;
    this.rand = seededRandom(seed);
    this.walls = navWalls(room);
    this.extra = this.rand();
    this.sampler = this.findSpots();
  }

  /**
   * Every spot a critter could be, half a square apart, found a few rows a frame: random points
   * mostly miss in a sewer's narrow walkways or a cave's tunnels
   */
  private *findSpots(): Generator<void, void> {
    const step = FINENESS / 2;
    const { maxX, maxY } = this.room.thingsBox;
    let row = 0;
    for (let y = step / 2; y < maxY; y += step, row++) {
      for (let x = step / 2; x < maxX; x += step) {
        const floor = this.standable(x, y, null);
        if (floor !== null) this.spots.push(x, y, floor);
      }
      if (row % 4 === 3) yield;
    }
  }

  /** The critters and corpses to draw */
  objects(): WorldObject[] {
    return this.critters.map((c) => c.obj);
  }

  /** A live critter's id: clicks and attacks can kill it */
  has(id: number): boolean {
    return this.critters.some((c) => c.obj.id === id && c.mode !== "dead");
  }

  /** The nearest live critter within `range` of a point (fine units), or null */
  nearest(p: NavPoint, range: number): WorldObject | null {
    let best: WorldObject | null = null,
      d = range;
    for (const c of this.critters) {
      if (c.mode === "dead" || c.fadeDir) continue;
      const cd = Math.hypot(c.obj.x - p.x, c.obj.y - p.y);
      if (cd <= d) [best, d] = [c.obj, cd];
    }
    return best;
  }

  /** A live critter within `range` to make a noise (its Kod "aware" sound), or null */
  voice(p: NavPoint, range: number, rand = Math.random): { x: number; y: number; sound: string } | null {
    const near = this.critters.filter((c) => c.mode !== "dead" && !c.fadeDir && Math.hypot(c.obj.x - p.x, c.obj.y - p.y) < range);
    if (!near.length) return null;
    const c = near[Math.floor(rand() * near.length) % near.length];
    return { x: c.obj.x, y: c.obj.y, sound: c.species.sound.replace("_dth", "_awr") };
  }

  /** Killed at once: its corpse lies a while; where it was and the sound it makes, or null if it's no critter (or dead) */
  squish(id: number): { x: number; y: number; sound: string } | null {
    const c = this.critters.find((v) => v.obj.id === id && v.mode !== "dead");
    if (!c) return null;
    c.mode = "dead";
    c.timer = CORPSE_MS;
    c.fade = 1;
    c.fadeDir = 0;
    const o = c.obj;
    o.info.iconRes = localRes(c.species.dead);
    o.normal = o.moving = o.look = look(none(1));
    o.info.flags = 0;
    o.info.drawingType = 0;
    o.version++;
    return { x: o.x, y: o.y, sound: c.species.sound };
  }

  /**
   * @param facing the player's angle (client units): new critters turn up out of view if they can
   */
  update(dt: number, frame: { player: NavPoint | null; facing?: number; scale: number; hour?: number | null }): void {
    const p = frame.player;
    if (!p) return;
    if (this.sampler) {
      const start = performance.now();
      while (performance.now() - start < SAMPLE_BUDGET_MS)
        if (this.sampler.next().done) {
          this.sampler = null;
          break;
        }
      // Wait for the spots about us before the first lot comes out
      if (this.sampler && !this.started) return;
    }
    const night = frame.hour !== null && frame.hour !== undefined && (frame.hour >= 20 || frame.hour < 6);
    const raw = this.habitat.count * frame.scale;
    const target = Math.floor(raw) + (this.extra < raw % 1 ? 1 : 0);
    if (target === 0) {
      this.critters = this.critters.filter((c) => c.mode === "dead");
    } else if (!this.started) {
      // Already about when we arrive, anywhere around us
      this.started = true;
      for (let k = 0; k < target; k++) this.spawn(p, null, night, false);
    } else {
      const alive = this.critters.filter((c) => c.mode !== "dead" && c.fadeDir >= 0).length;
      if (alive < target && (this.spawnMs -= dt) <= 0) {
        this.spawnMs = 500 + this.rand() * 2500;
        this.spawn(p, frame.facing ?? null, night, true);
      }
      // Too many (the setting turned down): the farthest go
      if (alive > target) {
        const far = this.critters.filter((c) => c.mode !== "dead" && c.fadeDir >= 0).sort((a, b) => dist(b.obj, p) - dist(a.obj, p));
        for (const c of far.slice(0, alive - target)) c.fadeDir = -1;
      }
    }
    for (const c of this.critters) this.step(c, dt, p);
    this.critters = this.critters.filter((c) => !(c.fadeDir < 0 && c.fade <= 0) && (c.mode === "dead" || dist(c.obj, p) < GONE));
  }

  /** Whether a critter can be at a point: a dry floor about the player's level, with room, away from walls */
  private standable(x: number, y: number, level: number | null): number | null {
    const leaf = leafAt(this.room, x, y);
    if (!leaf?.sector) return null;
    const s = this.room.sectors[leaf.sector - 1];
    // Dry, or shallow water for those that swim (water painted on a dry floor counts as shallow)
    const depth = s.flags & SF.DEPTH_MASK || (this.waterTextures.has(s.floorType) ? 1 : 0);
    if (depth > (this.habitat.wades ? 1 : 0)) return null;
    const floor = floorHeightAt(s, x, y);
    if (ceilingHeightAt(s, x, y) - floor < FINENESS / 4) return null;
    if (level !== null && Math.abs(floor - level) > SAME_LEVEL) return null;
    if (!walkable(this.walls, x, y, x, y, 96)) return null;
    return floor;
  }

  /** Swimming: drawn at the water's surface (the floor as drawn); on dry floor, as any object */
  private float(o: CritterObject): void {
    const leaf = leafAt(this.room, o.x, o.y);
    const s = leaf?.sector ? this.room.sectors[leaf.sector - 1] : null;
    o.z = s && s.flags & SF.DEPTH_MASK ? floorHeightAt(s, o.x, o.y) : undefined;
  }

  private floorAt(x: number, y: number): number | null {
    const leaf = leafAt(this.room, x, y);
    return leaf?.sector ? floorHeightAt(this.room.sectors[leaf.sector - 1], x, y) : null;
  }

  private pick(night: boolean): Species {
    const mix = this.habitat.mix.map(([n, w]) => [SPECIES[n], w * (night ? ((SPECIES[n] as Species).night ?? 1) : 1)] as [Species, number]);
    const total = mix.reduce((s, [, w]) => s + w, 0);
    let r = this.rand() * total;
    for (const [sp, w] of mix) if ((r -= w) < 0) return sp;
    return mix[mix.length - 1][0];
  }

  /** A new critter somewhere about the player, out of view (behind or to the side) when it fades in */
  private spawn(p: NavPoint, facing: number | null, night: boolean, fadeIn: boolean): void {
    const level = this.floorAt(p.x, p.y);
    // The spots in reach and about our level; out of view if there are any (more than 60 degrees off ahead)
    // (none there, as in a sewer's water channel: any farther off before they'd go)
    const near: number[] = [],
      behind: number[] = [],
      farther: number[] = [];
    const sp = this.spots;
    for (let i = 0; i < sp.length; i += 3) {
      const dx = sp[i] - p.x,
        dy = sp[i + 1] - p.y;
      const d = Math.hypot(dx, dy);
      if (d < SPAWN_NEAR || d > GONE - 2 * FINENESS || (level !== null && Math.abs(sp[i + 2] - level) > SAME_LEVEL)) continue;
      if (d > SPAWN_FAR) {
        farther.push(i);
        continue;
      }
      near.push(i);
      if (facing !== null) {
        const off = Math.abs(((Math.round((Math.atan2(dy, dx) * 4096) / (2 * Math.PI)) - facing + 6144) % 4096) - 2048);
        if (off > 680) behind.push(i);
      }
    }
    const from = behind.length ? behind : near.length ? near : farther;
    if (from.length) {
      const i = from[Math.floor(this.rand() * from.length)];
      // Jittered within its half square, if that's floor too
      let x = Math.round(sp[i] + (this.rand() - 0.5) * 200),
        y = Math.round(sp[i + 1] + (this.rand() - 0.5) * 200);
      if (this.standable(x, y, null) === null) [x, y] = [sp[i], sp[i + 1]];
      const species = this.pick(night);
      const id = ambientId();
      const walk: Animation = { type: ANIMATE.CYCLE, period: species.walk.period, groupLow: species.walk.low, groupHigh: species.walk.high };
      const normal = look(none(1));
      const info: ObjectInfo = {
        id, amount: 0, iconRes: localRes(species.icon), nameRes: 0, flags: OF_NPC, drawingType: fadeIn ? FADE_FX[0] : 0, minimapFlags: 0,
        nameColor: 0, objectType: 0, moveOnType: 0, light: { flags: 0, intensity: 0, color: 0 }, translation: 0, effect: 0, animation: none(1), overlays: [],
      };
      const obj: CritterObject = {
        id, info, x, y, angle: Math.floor(this.rand() * 4096), normal, moving: look(walk), look: normal, motion: null, version: 0, scale: species.scale,
      };
      this.float(obj);
      this.critters.push({ obj, species, mode: "rest", timer: this.rand() * 3000, to: null, pace: (species.pace * FINENESS) / 1000, fade: fadeIn ? 0 : 1, fadeDir: fadeIn ? 1 : 0 });
      return;
    }
  }

  /** A short straight dash the walls and floors allow, away from the player if `away` */
  private dash(c: Critter, away: NavPoint | null): boolean {
    const o = c.obj;
    const [lo, hi] = c.species.dash;
    for (let k = 0; k < 8; k++) {
      let a = this.rand() * 2 * Math.PI;
      if (away) a = Math.atan2(o.y - away.y, o.x - away.x) + (this.rand() - 0.5) * (Math.PI / 2);
      const len = (lo + this.rand() * (hi - lo)) * FINENESS;
      const tx = Math.round(o.x + Math.cos(a) * len),
        ty = Math.round(o.y + Math.sin(a) * len);
      if (!this.clearRun(o.x, o.y, tx, ty)) continue;
      c.to = { x: tx, y: ty };
      c.mode = "dash";
      o.angle = Math.round((a * 4096) / (2 * Math.PI)) & 4095;
      o.look = o.moving;
      o.version++;
      return true;
    }
    return false;
  }

  /** No wall in the way, and dry floor all along with no step too high */
  private clearRun(x0: number, y0: number, x1: number, y1: number): boolean {
    if (!walkable(this.walls, x0, y0, x1, y1, 80)) return false;
    let last = this.floorAt(x0, y0);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 128));
    for (let k = 1; k <= steps; k++) {
      const x = x0 + ((x1 - x0) * k) / steps,
        y = y0 + ((y1 - y0) * k) / steps;
      const f = this.standable(x, y, null);
      if (f === null || last === null || Math.abs(f - last) > MAX_STEP) return false;
      last = f;
    }
    return true;
  }

  private step(c: Critter, dt: number, p: NavPoint): void {
    if (c.fadeDir) {
      c.fade = Math.max(0, Math.min(1, c.fade + (c.fadeDir * dt) / FADE_MS));
      if (c.fade >= 1 && c.fadeDir > 0) c.fadeDir = 0;
      const fx = FADE_FX[Math.min(3, Math.floor(c.fade * 4))];
      if (c.obj.info.drawingType !== fx) c.obj.info.drawingType = fx;
      if (c.fadeDir < 0) return;
    }
    const o = c.obj;
    if (c.mode === "dead") {
      if ((c.timer -= dt) <= 0 && !c.fadeDir) c.fadeDir = -1;
      return;
    }
    // The player close: the shy ones run
    if (c.species.shy && dist(o, p) < SHY && c.mode === "rest" && this.dash(c, p)) c.pace = (c.species.pace * 1.4 * FINENESS) / 1000;
    if (c.mode === "rest") {
      if ((c.timer -= dt) <= 0 && !this.dash(c, null)) c.timer = 500 + this.rand() * 1500;
      return;
    }
    const to = c.to!;
    const d = Math.hypot(to.x - o.x, to.y - o.y);
    const move = c.pace * dt;
    if (d <= move) {
      o.x = to.x;
      o.y = to.y;
      if (this.habitat.wades) this.float(o);
      c.mode = "rest";
      c.to = null;
      c.pace = (c.species.pace * FINENESS) / 1000;
      const [lo, hi] = c.species.rest;
      c.timer = lo + this.rand() * (hi - lo);
      o.look = o.normal;
      o.version++;
      return;
    }
    o.x = Math.round(o.x + ((to.x - o.x) / d) * move);
    o.y = Math.round(o.y + ((to.y - o.y) / d) * move);
    if (this.habitat.wades) this.float(o);
  }
}

const dist = (a: NavPoint, b: NavPoint) => Math.hypot(a.x - b.x, a.y - b.y);
