// Ours (docs/adr/0006-pets.md): one cosmetic pet per character, following its owner about, seen by
// everyone with this client and never by the server. The kinds are monsters' own art drawn small,
// as the critters are (ambient/critters.ts SPECIES); which ones a player may choose goes by their
// maximum health, Meridian 59 having no levels. Every client walks every pet itself from where its
// owner is (the server tells everyone that), so nothing about a pet's position is ever sent.

import { FINENESS, type Room } from "@shards/formats";
import { ANIMATE, type Animation, type ObjectInfo } from "@shards/protocol";
import { animStateFrom } from "./animation.ts";
import { findPath, navWalls, walkable, type NavGrid, type NavPoint } from "./navGrid.ts";
import type { Look, WorldObject } from "./state.ts";
import { ambientId, localRes } from "./ambient/ambientIds.ts";
import { seededRandom } from "./ambient/ambientLife.ts";
import { SPECIES, type Species } from "./ambient/critters.ts";

/** 2.1: the health tiers kinds and colours unlock at */
export const PET_TIERS = [20, 35, 50, 65, 80, 100, 120, 150] as const;

export interface PetColour {
  label: string;
  /** The art's palette translation (xlat), 0 for its own colours */
  xlat: number;
  /** Maximum health needed for this colour (at least the kind's) */
  health: number;
}

export interface PetKind {
  label: string;
  icon: string;
  /** SendMoveAnimation's cycle (groups 1-based); standing is group 1 */
  walk: Species["walk"];
  /** Drawn this many times the art's size */
  scale: number;
  /** Its own pace, squares a second (it hurries to keep up with its owner) */
  pace: number;
  /** Maximum health needed (2.1) */
  health: number;
  /** Its idle noise (the monster's "aware" sound) */
  sound: string;
  colours: PetColour[];
}

const natural = (health: number): PetColour[] => [{ label: "Natural", xlat: 0, health }];

/** From a critter's species: the same art, cycle and size, already measured in the game */
const fromSpecies = (s: Species, label: string, health: number): PetKind => ({
  label, icon: s.icon, walk: s.walk, scale: s.scale, pace: s.pace, health, sound: s.sound.replace("_dth", "_awr"), colours: natural(health),
});

/**
 * 1.3: the kinds. The critters' species first; more monsters drawn small, and more colours, are
 * added once each has been looked at in the game (docs/adr/0006-pets.md 6.4).
 */
export const PET_KINDS = {
  bunny: fromSpecies(SPECIES.bunny, "Bunny", 20),
  rat: fromSpecies(SPECIES.rat, "Rat", 20),
  greyBunny: fromSpecies(SPECIES.greyBunny, "Grey bunny", 35),
  centipede: fromSpecies(SPECIES.centipede, "Centipede", 35),
  babySpider: fromSpecies(SPECIES.babySpider, "Baby spider", 50),
  mutantAnt: fromSpecies(SPECIES.mutantAnt, "Mutant ant", 65),
  scorpion: fromSpecies(SPECIES.scorpion, "Scorpion", 80),
  spider: fromSpecies(SPECIES.spider, "Spider", 100),
} satisfies Record<string, PetKind>;
export type PetKindName = keyof typeof PET_KINDS;

export const petKind = (name: string): PetKind | undefined => (PET_KINDS as Record<string, PetKind>)[name];

/** A character's pet: its kind, colour (an index into the kind's) and name, "" for none */
export interface PetChoice {
  kind: string;
  colour: number;
  name: string;
}

/** 1.4: names are up to 16 Latin-1 characters */
export const PET_NAME_MAX = 16;

export function cleanPetName(s: string): string {
  return [...s.replace(/\s+/g, " ").trim()].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0xff && c.charCodeAt(0) !== 0x7f).join("").slice(0, PET_NAME_MAX).trim();
}

/** A pet from storage or the relay, checked: null when it isn't one we know (an unknown kind isn't drawn) */
export function readPetChoice(v: unknown): PetChoice | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const kind = typeof p.kind === "string" ? petKind(p.kind) : undefined;
  if (!kind) return null;
  const colour = Number.isInteger(p.colour) && (p.colour as number) >= 0 && (p.colour as number) < kind.colours.length ? (p.colour as number) : 0;
  return { kind: p.kind as string, colour, name: typeof p.name === "string" ? cleanPetName(p.name) : "" };
}

/** 2.1: whether a kind (and colour) is open to someone with this maximum health */
export function petUnlocked(kind: string, colour: number, maxHealth: number): boolean {
  const k = petKind(kind);
  const c = k?.colours[colour];
  return !!k && !!c && maxHealth >= Math.max(k.health, c.health);
}

// ---- moving (5) ----

const SQ = FINENESS;
/** 5.1: about a square behind the owner, to one side */
const BEHIND = 1.1 * SQ;
const SIDE_ANGLE = 0.6;
/** Close enough to the spot to stop */
const THERE = 0.35 * SQ;
/** 5.3: farther behind than this, it vanishes and comes back beside its owner */
const TOO_FAR = 5 * SQ;
/** Stuck (no way to its owner) this long: likewise */
const STUCK_MS = 3000;
/** 5.2: the owner standing this long, the pet wanders within this far of them */
const IDLE_AFTER_MS = 1500;
const WANDER = 2 * SQ;
const FADE_MS = 400;
/** proto.h DRAWFX_TRANSLUCENT75/50/25, for fading */
const FADE_FX = [1, 2, 3, 0];
/** Squares a second (SPEED_WALK 25 and SPEED_RUN 55 are squares per 10 s) */
const OWNER_SPEED_SCALE = 0.1;

/** A pet's owner this frame: a player in our room (or us) with a pet */
export interface PetOwner {
  /** Their object's id (ours or the server's) */
  id: number;
  /** Their character's name, which seeds what the pet does when idle */
  name: string;
  x: number;
  y: number;
  angle: number;
  /** Squares per 10 s while moving (SPEED_WALK 25, SPEED_RUN 55), 0 standing */
  speed: number;
  pet: PetChoice;
}

interface Pet {
  obj: WorldObject;
  owner: number;
  ownerName: string;
  /** Which kind and colour it's drawn as (a change remakes it) */
  key: string;
  kind: PetKind;
  name: string;
  /** -1 or 1: which side of its owner it keeps to */
  side: number;
  mode: "follow" | "wander" | "rest";
  to: NavPoint | null;
  path: NavPoint[];
  timer: number;
  /** When the owner last moved, and where they were */
  stillSince: number;
  ownerAt: NavPoint;
  stuckMs: number;
  fade: number;
  fadeDir: number;
  /** Fading out to come back beside the owner (not to go) */
  regroup: boolean;
  seen: boolean;
}

const none = (group: number): Animation => ({ type: ANIMATE.NONE, group });
const look = (animation: Animation, translation: number): Look => ({ anim: animStateFrom(animation), overlays: [], translation });
const dist = (a: NavPoint, b: NavPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const angleTo = (dx: number, dy: number) => Math.round((Math.atan2(dy, dx) * 4096) / (2 * Math.PI)) & 4095;

/** FNV-1a: the same number for the same text on every client */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

/** The art every kind needs, to load ahead */
export function petArt(): string[] {
  return [...new Set(Object.values(PET_KINDS).map((k) => k.icon))];
}

/** Every pet in a room (ours and other players'), walked after its owner */
export class Pets {
  private readonly room: Room;
  private readonly walls: NavGrid;
  private grid: NavGrid | null;
  private pets: Pet[] = [];

  constructor(room: Room, grid: NavGrid | null = null) {
    this.room = room;
    this.walls = navWalls(room);
    this.grid = grid;
  }

  /** The room's nav grid once there is one, for finding a way round walls */
  setGrid(grid: NavGrid | null): void {
    this.grid = grid;
  }

  objects(): WorldObject[] {
    return this.pets.map((p) => p.obj);
  }

  /** The pets with names, to show under them */
  named(): { obj: WorldObject; name: string }[] {
    return this.pets.filter((p) => p.name && p.fadeDir >= 0).map((p) => ({ obj: p.obj, name: p.name }));
  }

  /** A pet near `at` to make its noise, or null */
  voice(at: NavPoint, range: number, rand: () => number): { x: number; y: number; sound: string } | null {
    const near = this.pets.filter((p) => !p.fadeDir && dist(p.obj, at) < range);
    if (!near.length) return null;
    const p = near[Math.floor(rand() * near.length) % near.length];
    return { x: p.obj.x, y: p.obj.y, sound: p.kind.sound };
  }

  /** `now`: the clock's time (ms), which seeds the idle wandering so clients see much the same */
  update(dt: number, owners: readonly PetOwner[], now: number): void {
    for (const p of this.pets) p.seen = false;
    for (const o of owners) {
      const kind = petKind(o.pet.kind);
      if (!kind) continue;
      const key = `${o.pet.kind}:${o.pet.colour}`;
      // Its pet: here, or fading out only to come back beside them
      let p = this.pets.find((x) => x.owner === o.id && (x.fadeDir >= 0 || x.regroup));
      // Another kind or colour: the old one goes, the new one comes
      if (p && p.key !== key) {
        p.fadeDir = -1;
        p.regroup = false;
        p = undefined;
      }
      if (!p) p = this.spawn(o, kind, key);
      p.seen = true;
      p.name = o.pet.name;
      this.step(p, o, dt, now);
    }
    // Owners gone (left, died, hidden): their pets fade with them
    for (const p of this.pets)
      if (!p.seen && p.fadeDir >= 0) {
        p.fadeDir = -1;
        p.regroup = false;
      }
    for (const p of this.pets) if (!p.seen) this.fadeStep(p, dt);
    this.pets = this.pets.filter((p) => !(p.fadeDir < 0 && p.fade <= 0 && !p.regroup));
  }

  /** A spot beside the owner (behind, to its side) that the room allows */
  private besideOwner(o: PetOwner, side: number, extra = 0): NavPoint {
    const a = (o.angle * 2 * Math.PI) / 4096 + Math.PI + side * SIDE_ANGLE + extra;
    for (const r of [BEHIND, 0.7 * SQ, 0.4 * SQ]) {
      const p = { x: Math.round(o.x + Math.cos(a) * r), y: Math.round(o.y + Math.sin(a) * r) };
      if (walkable(this.walls, o.x, o.y, p.x, p.y, 64)) return p;
    }
    return { x: o.x, y: o.y };
  }

  private spawn(o: PetOwner, kind: PetKind, key: string): Pet {
    const side = hash(o.name) & 1 ? 1 : -1;
    const at = this.besideOwner(o, side);
    const id = ambientId();
    const colour = kind.colours[readPetChoice(o.pet)?.colour ?? 0] ?? kind.colours[0];
    const normal = look(none(1), colour.xlat);
    const walk = look({ type: ANIMATE.CYCLE, period: kind.walk.period, groupLow: kind.walk.low, groupHigh: kind.walk.high }, colour.xlat);
    const info: ObjectInfo = {
      id, amount: 0, iconRes: localRes(kind.icon), nameRes: 0, flags: 0, drawingType: FADE_FX[0], minimapFlags: 0, nameColor: 0, objectType: 0,
      moveOnType: 0, light: { flags: 0, intensity: 0, color: 0 }, translation: colour.xlat, effect: 0, animation: none(1), overlays: [],
    };
    const obj: WorldObject = { id, info, x: at.x, y: at.y, angle: o.angle, normal, moving: walk, look: normal, motion: null, version: 0, scale: kind.scale };
    const pet: Pet = {
      obj, owner: o.id, ownerName: o.name, key, kind, name: o.pet.name, side, mode: "rest", to: null, path: [], timer: 0, stillSince: 0,
      ownerAt: { x: o.x, y: o.y }, stuckMs: 0, fade: 0, fadeDir: 1, regroup: false, seen: true,
    };
    this.pets.push(pet);
    return pet;
  }

  private fadeStep(p: Pet, dt: number): void {
    if (!p.fadeDir) return;
    p.fade = Math.max(0, Math.min(1, p.fade + (p.fadeDir * dt) / FADE_MS));
    const fx = FADE_FX[Math.min(3, Math.floor(p.fade * 4))];
    if (p.obj.info.drawingType !== fx) p.obj.info.drawingType = fx;
    if (p.fadeDir > 0 && p.fade >= 1) p.fadeDir = 0;
  }

  private setMoving(p: Pet, moving: boolean): void {
    const want = moving ? p.obj.moving : p.obj.normal;
    if (p.obj.look !== want) {
      p.obj.look = want;
      p.obj.version++;
    }
  }

  private step(p: Pet, o: PetOwner, dt: number, now: number): void {
    const obj = p.obj;
    this.fadeStep(p, dt);
    // Faded out to regroup: back beside the owner
    if (p.fadeDir < 0) {
      if (p.fade > 0) return;
      const at = this.besideOwner(o, p.side);
      obj.x = at.x;
      obj.y = at.y;
      obj.angle = o.angle;
      p.mode = "rest";
      p.path = [];
      p.to = null;
      p.stuckMs = 0;
      p.regroup = false;
      p.fadeDir = 1;
      this.setMoving(p, false);
      return;
    }
    const owner = { x: o.x, y: o.y };
    if (dist(owner, p.ownerAt) > 16 || o.speed > 0) p.stillSince = now;
    p.ownerAt = owner;
    // 5.3: too far behind (or the owner was moved far): vanish and come back beside them
    if (dist(obj, owner) > TOO_FAR || p.stuckMs > STUCK_MS) {
      p.fadeDir = -1;
      p.regroup = true;
      return;
    }
    const idle = now - p.stillSince > IDLE_AFTER_MS;
    const spot = this.besideOwner(o, p.side);
    if (!idle || p.mode === "follow") {
      // 5.1: to its spot behind the owner, hurrying to keep up
      if (dist(obj, spot) <= THERE) {
        if (p.mode === "follow") {
          p.mode = "rest";
          p.timer = 1500;
          this.setMoving(p, false);
          obj.angle = o.angle;
        }
        if (!idle) return;
      } else {
        p.mode = "follow";
        const keepUp = (o.speed * OWNER_SPEED_SCALE * 1.15 || 0) * SQ;
        const pace = Math.max((p.kind.pace * SQ) / 1000, keepUp / 1000);
        this.moveTo(p, spot, pace * (dist(obj, spot) > 2 * SQ ? 1.5 : 1), dt);
        return;
      }
    }
    // 5.2: the owner stands: rest, now and then wander a little about them
    if (p.mode === "rest") {
      if ((p.timer -= dt) > 0) return;
      // Seeded by the owner and the second, so other clients pick much the same
      const rand = seededRandom(hash(`${o.name}|${Math.floor(now / 1000)}`));
      for (let k = 0; k < 6; k++) {
        const a = rand() * 2 * Math.PI,
          r = (0.5 + rand() * 0.5) * WANDER;
        const t = { x: Math.round(o.x + Math.cos(a) * r), y: Math.round(o.y + Math.sin(a) * r) };
        if (walkable(this.walls, obj.x, obj.y, t.x, t.y, 64)) {
          p.mode = "wander";
          p.to = t;
          p.path = [];
          break;
        }
      }
      if (p.mode === "rest") p.timer = 1000;
      return;
    }
    if (p.mode === "wander" && p.to) {
      if (dist(obj, p.to) <= THERE / 2) {
        p.mode = "rest";
        p.to = null;
        p.timer = 2000 + seededRandom(hash(`${o.name}|rest|${Math.floor(now / 1000)}`))() * 4000;
        this.setMoving(p, false);
        return;
      }
      this.moveTo(p, p.to, (p.kind.pace * SQ) / 1000 / 2, dt);
    }
  }

  /** Straight where the walls allow, else along a path over the nav grid (when there is one) */
  private moveTo(p: Pet, to: NavPoint, pace: number, dt: number): void {
    const obj = p.obj;
    let next = to;
    if (!walkable(this.walls, obj.x, obj.y, to.x, to.y, 64)) {
      if (this.grid && (!p.path.length || dist(p.path[p.path.length - 1], to) > SQ)) p.path = findPath(this.grid, obj, to) ?? [];
      while (p.path.length && dist(obj, p.path[0]) < THERE / 2) p.path.shift();
      if (p.path.length) next = p.path[0];
      else {
        // No way round: it waits, and soon comes back beside its owner
        p.stuckMs += dt;
        this.setMoving(p, false);
        return;
      }
    } else p.path = [];
    p.stuckMs = 0;
    const d = dist(obj, next);
    const move = Math.min(d, pace * dt);
    if (d > 1) {
      obj.angle = angleTo(next.x - obj.x, next.y - obj.y);
      obj.x = Math.round(obj.x + ((next.x - obj.x) / d) * move);
      obj.y = Math.round(obj.y + ((next.y - obj.y) / d) * move);
    }
    this.setMoving(p, true);
  }
}
