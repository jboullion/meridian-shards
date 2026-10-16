// Ours (docs/adr/0006-pets.md): one cosmetic pet per character, following its owner about, seen by
// everyone with this client and never by the server. The kinds are monsters' own art drawn small,
// with their Kod walk cycles (a table of their own, apart from the critters'); which ones a player
// may choose goes by their maximum health, Meridian 59 having no levels. Every client walks every
// pet itself from where its owner is (the server tells everyone that), so nothing about a pet's
// position is ever sent.

import { FINENESS, floorHeightAt, leafAt, type Room } from "@shards/formats";
import { ANIMATE, type Animation, type ObjectInfo } from "@shards/protocol";
import { animStateFrom } from "./animation.ts";
import { findPath, navWalls, walkable, type NavGrid, type NavPoint } from "./navGrid.ts";
import type { Look, OverlayState, WorldObject } from "./state.ts";
import { ambientId, localRes } from "./ambient/ambientIds.ts";
import { seededRandom } from "./ambient/ambientLife.ts";

/** 2.1: the health tiers kinds and colours unlock at */
export const PET_TIERS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150] as const;

export interface PetColour {
  label: string;
  /** The art's palette translation (xlat), 0 for its own colours */
  xlat: number;
  /** Maximum health needed for this colour (at least the kind's) */
  health: number;
}

/** A cycle through groups (1-based, as the Kod's AddPacket gives them), or null: group 1, still */
export type PetAnim = { period: number; low: number; high: number } | null;

export interface PetKind {
  label: string;
  icon: string;
  /** Standing (the Kod's SendAnimation) and moving (SendMoveAnimation) */
  stand: PetAnim;
  walk: PetAnim;
  /** Drawn this many times the art's size (measured against the rat's, tried in the game) */
  scale: number;
  /** Its own pace, squares a second (it hurries to keep up with its owner) */
  pace: number;
  /** Maximum health needed (2.1) */
  health: number;
  /** Its idle noise (the monster's "aware" sound) */
  sound: string;
  colours: PetColour[];
  /** It flies this high over the floor (fine units) */
  fly?: number;
  /** It bobs up and down (OF_BOUNCING, as the fey do) */
  bounce?: boolean;
  /** An overlay (the dragonfly's wings): its art, hotspot, cycles and whether it's translucent */
  overlay?: { icon: string; hotspot: number; stand: PetAnim; walk: PetAnim; translucent?: boolean };
  /** Kinds shown as one in the window, the owner's karma choosing which (the fey) */
  group?: { name: string; label: string; karma: "good" | "evil" };
}

const natural = (health: number): PetColour[] => [{ label: "Natural", xlat: 0, health }];
const cycle = (period: number, low: number, high: number): PetAnim => ({ period, low, high });

/** A kind from its Kod class: the art, animations and aware sound (monster/*.kod) */
function kind(label: string, health: number, k: Omit<PetKind, "label" | "health" | "colours">): PetKind {
  return { label, health, colours: natural(health), ...k };
}

/** The fey's: they fly, bobbing (fairy.kod, evfairy.kod piDrawEffectFlag = OF_BOUNCING) */
const FEY = { stand: cycle(100, 1, 2), walk: cycle(100, 3, 4), scale: 0.5, pace: 3, fly: 380, bounce: true } as const;

/**
 * 1.3: the kinds, from the Kod's monster classes. Small pests stay critter-sized (the rat at 0.4, a
 * third of a square long); the rarer ones grow, to half a person's height for the troll (a drawn
 * height of art height / shrink * scale / 64 squares; a person is about 0.86). More colours come
 * once each is looked at in the game (docs/adr/0006-pets.md 6.4)
 */
export const PET_KINDS = {
  babySpider: kind("Baby spider", 20, { icon: "spdrby.bgf", stand: null, walk: cycle(150, 1, 3), scale: 0.21, pace: 2.4, sound: "bsp_awr.ogg" }),
  rat: kind("Rat", 30, { icon: "rat.bgf", stand: null, walk: cycle(75, 2, 6), scale: 0.4, pace: 3.4, sound: "rat_awr.ogg" }),
  centipede: kind("Centipede", 40, { icon: "centip.bgf", stand: null, walk: cycle(120, 2, 6), scale: 0.18, pace: 1.1, sound: "cnt_awr.ogg" }),
  goodFey: kind("Fey", 50, { icon: "faerie-g.bgf", ...FEY, sound: "god_awr.ogg", group: { name: "fey", label: "Fey", karma: "good" } }),
  evilFey: kind("Dark fey", 50, { icon: "faerie-e.bgf", ...FEY, sound: "evl_awr.ogg", group: { name: "fey", label: "Fey", karma: "evil" } }),
  mutantAnt: kind("Mutant ant", 60, { icon: "antr.bgf", stand: null, walk: cycle(125, 1, 3), scale: 0.12, pace: 2.2, sound: "ant_awr.ogg" }),
  spider: kind("Spider", 70, { icon: "spider.bgf", stand: null, walk: cycle(150, 1, 3), scale: 0.25, pace: 2.6, sound: "spd_awr.ogg" }),
  scorpion: kind("Scorpion", 80, { icon: "scorp.bgf", stand: null, walk: cycle(200, 2, 3), scale: 0.16, pace: 1.5, sound: "scp_awr.ogg" }),
  blackSpider: kind("Black spider", 90, { icon: "spidmagc.bgf", stand: null, walk: cycle(150, 2, 7), scale: 0.3, pace: 2.6, sound: "spd_awr.ogg" }),
  troll: kind("Troll", 100, { icon: "troll.bgf", stand: null, walk: cycle(200, 2, 3), scale: 0.47, pace: 2, sound: "trl_awr.ogg" }),
  // dfly.kod: hovering (groups 2-3) and flying (4-5), its wings an overlay a frame behind, translucent
  dragonfly: kind("Dragonfly", 110, {
    icon: "dfly.bgf", stand: cycle(100, 2, 3), walk: cycle(100, 4, 5), scale: 0.6, pace: 3.5, fly: 260, sound: "df_awr.ogg",
    overlay: { icon: "dflywing.bgf", hotspot: 1, stand: cycle(100, 1, 2), walk: cycle(100, 3, 4), translucent: true },
  }),
  mollusk: kind("Mollusk creature", 120, { icon: "mollusk.bgf", stand: null, walk: cycle(80, 2, 6), scale: 0.53, pace: 1.6, sound: "mol_awr.ogg" }),
  narthylWorm: kind("Narthyl worm", 130, { icon: "darkbeas.bgf", stand: cycle(150, 1, 4), walk: cycle(150, 1, 4), scale: 0.53, pace: 1.4, sound: "wrm_awr.ogg" }),
  lupogg: kind("Lupogg", 140, { icon: "lupogg.bgf", stand: null, walk: cycle(200, 2, 5), scale: 0.69, pace: 3, sound: "lup_awr.ogg" }),
  shadowbeast: kind("Shadowbeast", 150, { icon: "shadow.bgf", stand: null, walk: cycle(125, 2, 6), scale: 0.78, pace: 2.5, sound: "sha_awr.ogg" }),
} satisfies Record<string, PetKind>;
export type PetKindName = keyof typeof PET_KINDS;

/** The kind of a group (the fey) a karma calls for: good at 0 and above */
export function petForKarma(group: string, karma: number | null): string | undefined {
  const want = (karma ?? 0) >= 0 ? "good" : "evil";
  return Object.entries(PET_KINDS as Record<string, PetKind>).find(([, k]) => k.group?.name === group && k.group.karma === want)?.[0];
}

/** (Own keys only: a kind comes from other players through our server, and "constructor" isn't one) */
export const petKind = (name: string): PetKind | undefined => (Object.hasOwn(PET_KINDS, name) ? (PET_KINDS as Record<string, PetKind>)[name] : undefined);

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

/**
 * Kinds taken out (the bunnies, 2026-10-12) and what a pet saved as one becomes, so nobody who had
 * one is left without a pet: the rat, the nearest of what's left
 */
const RETIRED_KINDS: Record<string, string> = { bunny: "rat", greyBunny: "rat" };

/** A pet from storage or our server, checked: null when it isn't one we know (an unknown kind isn't drawn) */
export function readPetChoice(v: unknown): PetChoice | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const name = typeof p.kind === "string" ? (Object.hasOwn(RETIRED_KINDS, p.kind) ? RETIRED_KINDS[p.kind] : p.kind) : undefined;
  const kind = name !== undefined ? petKind(name) : undefined;
  if (!name || !kind) return null;
  const colour = Number.isInteger(p.colour) && (p.colour as number) >= 0 && (p.colour as number) < kind.colours.length ? (p.colour as number) : 0;
  return { kind: name, colour, name: typeof p.name === "string" ? cleanPetName(p.name) : "" };
}

/** 2.1: whether a kind (and colour) is open to someone with this maximum health */
export function petUnlocked(kind: string, colour: number, maxHealth: number): boolean {
  const k = petKind(kind);
  const c = k?.colours[colour];
  return !!k && !!c && maxHealth >= Math.max(k.health, c.health);
}

// ---- moving (5) ----

const SQ = FINENESS;
/**
 * 5.1: a square behind the owner and to their right (45 degrees round from straight behind), the
 * same side for every pet (2026-10-13; it was a side by the owner's name)
 */
const BEHIND = 1 * SQ;
const SIDE_ANGLE = Math.PI / 4;
/** Their right, as the client's angles go (x east, y south: a quarter turn up is to the right) */
const RIGHT = 1;
/** Close enough to the spot to stop */
const THERE = 0.35 * SQ;
/** 5.3: farther than this, it vanishes and comes back beside its owner */
const TOO_FAR = 5 * SQ;
/** Stuck (no way to its owner) this long: likewise */
const STUCK_MS = 3000;
/** 5.2: the owner standing this long, the pet potters about its spot behind them, this far from it */
const IDLE_AFTER_MS = 1500;
const WANDER = 0.6 * SQ;
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
  obj: PetObject;
  owner: number;
  ownerName: string;
  /** Which kind and colour it's drawn as (a change remakes it) */
  key: string;
  kind: PetKind;
  name: string;
  /** 1: its owner's right, which it keeps to */
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
  return [...new Set(Object.values(PET_KINDS as Record<string, PetKind>).flatMap((k) => [k.icon, ...(k.overlay ? [k.overlay.icon] : [])]))];
}

/** proto.h OF_BOUNCING */
const OF_BOUNCING = 0x10000;

const animOf = (a: PetAnim): Animation => (a ? { type: ANIMATE.CYCLE, period: a.period, groupLow: a.low, groupHigh: a.high } : none(1));

/** A kind's look, standing or moving, in a colour: its art's cycle, and its overlay's */
function petLook(k: PetKind, moving: boolean, xlat: number): Look {
  const overlays: OverlayState[] = [];
  if (k.overlay) {
    const animation = animOf(moving ? k.overlay.walk : k.overlay.stand);
    overlays.push({ iconRes: localRes(k.overlay.icon), hotspot: k.overlay.hotspot, translation: xlat, effect: k.overlay.translucent ? 1 : 0, animation, anim: animStateFrom(animation) });
  }
  return { anim: animStateFrom(animOf(moving ? k.walk : k.stand)), overlays, translation: xlat };
}

/** A pet: a room object with a height of its own when it flies */
type PetObject = WorldObject & { z?: number };

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
    // Those that fly, over the floor beneath them
    for (const p of this.pets) if (p.kind.fly) p.obj.z = (this.floorAt(p.obj.x, p.obj.y) ?? 0) + p.kind.fly;
    this.pets = this.pets.filter((p) => !(p.fadeDir < 0 && p.fade <= 0 && !p.regroup));
  }

  private floorAt(x: number, y: number): number | null {
    const leaf = leafAt(this.room, x, y);
    return leaf?.sector ? floorHeightAt(this.room.sectors[leaf.sector - 1], x, y) : null;
  }

  /** A spot beside the owner (behind, to their right) that the room allows */
  private besideOwner(o: PetOwner, side: number, extra = 0): NavPoint {
    const a = (o.angle * 2 * Math.PI) / 4096 + Math.PI - side * SIDE_ANGLE + extra;
    for (const r of [BEHIND, 0.7 * SQ, 0.4 * SQ]) {
      const p = { x: Math.round(o.x + Math.cos(a) * r), y: Math.round(o.y + Math.sin(a) * r) };
      if (walkable(this.walls, o.x, o.y, p.x, p.y, 64)) return p;
    }
    return { x: o.x, y: o.y };
  }

  private spawn(o: PetOwner, kind: PetKind, key: string): Pet {
    const side = RIGHT;
    const at = this.besideOwner(o, side);
    const id = ambientId();
    const colour = kind.colours[readPetChoice(o.pet)?.colour ?? 0] ?? kind.colours[0];
    const normal = petLook(kind, false, colour.xlat);
    const walk = petLook(kind, true, colour.xlat);
    const info: ObjectInfo = {
      id, amount: 0, iconRes: localRes(kind.icon), nameRes: 0, flags: kind.bounce ? OF_BOUNCING : 0, drawingType: FADE_FX[0], minimapFlags: 0, nameColor: 0, objectType: 0,
      moveOnType: 0, light: { flags: 0, intensity: 0, color: 0 }, translation: colour.xlat, effect: 0, animation: none(1), overlays: [],
    };
    const obj: PetObject = { id, info, x: at.x, y: at.y, angle: o.angle, normal, moving: walk, look: normal, motion: null, version: 0, scale: kind.scale };
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
      const home = this.besideOwner(o, p.side);
      for (let k = 0; k < 6; k++) {
        const a = rand() * 2 * Math.PI,
          r = (0.3 + rand() * 0.7) * WANDER;
        const t = { x: Math.round(home.x + Math.cos(a) * r), y: Math.round(home.y + Math.sin(a) * r) };
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
