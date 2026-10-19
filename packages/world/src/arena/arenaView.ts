// Ours (docs/adr/0007-arena.md 4): the arena as this client draws it, from the sim's messages
// (arenaWire.ts), whether they come from the relay or from a sim running here with no relay. The
// messages are played back a little behind the sim's clock, so a late or bunched tick doesn't
// show: each tick is applied when its time comes, and figures glide between ticks.
//
// Everyone in it is an ambient object (ambientIds.ts): never in WorldState, never sent anywhere.

import { ANIMATE, type Animation } from "@shards/protocol";
import { FINENESS } from "@shards/formats";
import { animStateFrom, animStep } from "../animation.ts";
import type { Look, OverlayState, WorldObject } from "../state.ts";
import { ambientId, localRes } from "../ambient/ambientIds.ts";
import type { AmbientPersonInfo, AmbientSpeech } from "../ambient/ambientLife.ts";
import { lookFor, makePerson, type Appearance, type Pose } from "../ambient/townsfolk.ts";
import { ARENA_FIELDS, ARENA_SPELLS, WEB_OVERLAY, type ArenaSpellDef, type FieldKind } from "./arenaData.ts";
import type { ArenaChampion } from "./arenaRoster.ts";
import {
  ARENA_STATUS, type ArenaEvent, type ArenaFieldWire, type ArenaMessage, type ArenaMove, type ArenaPersonWire, type ArenaPhase, type ArenaRosterWire,
  type ArenaShotWire, type ArenaState, type ArenaTick,
} from "./arenaWire.ts";

const SQ = FINENESS;
/** Played back this far behind the newest tick (ms) */
const PLAYBACK_DELAY_MS = 220;
/** Ticks come every 100 ms: a figure glides from where it was to where it is over that */
const TICK_SPAN_MS = 100;
/** proto.h DRAWFX_TRANSLUCENT75/50/25: fading in and out */
const FADE_FX = [1, 2, 3, 0];
/** blakston.khd HS_HEAD, HS_LEGS */
const HS_HEAD = 1;
const HS_LEGS = 41;
/** The walls' last moment, more see-through (DRAWFX_TRANSLUCENT25) */
const FIELD_FADE_MS = 700;

/** A spell in flight, drawn like the server's projectiles (project.c) */
export interface ArenaShotView {
  id: number;
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
  destX: number;
  destY: number;
  progress: number;
  angle: number;
  /** project.c PROJ_FLAG_*: none (they fly at the casters' height) */
  flags: 0;
  info: { iconRes: number; light: { flags: number; intensity: number; color: number } };
  look: Look;
  spell: string;
}

/** What the inspect window shows of an arena fighter, besides AmbientPersonInfo's */
export interface ArenaFighterInfo {
  archetype: string;
  weapon: string | null;
  spell: string | null;
  wins: number;
  losses: number;
  kills: number;
  season: number;
  /** Seasons they were champion of */
  champion: number[];
  hp: number;
  maxHp: number;
}

interface Figure {
  wire: ArenaPersonWire;
  obj: WorldObject;
  /** Where it was at the tick before and at the last, and when the last came */
  from: { x: number; y: number };
  to: { x: number; y: number };
  at: number;
  /** What its looks were built for */
  built: string;
  say: { text: string; ms: number } | null;
}

interface FieldView {
  wire: ArenaFieldWire;
  obj: WorldObject;
}

interface ShotView {
  wire: ArenaShotWire;
  view: ArenaShotView;
  flight: number;
}

const ROLE_LABELS = { fighter: "Arena fighter", mage: "Arena mage", spectator: "Spectator" } as const;
const MOODS = ["Content", "Cheerful", "Thoughtful", "Excited", "Restless", "Bored", "Curious", "Grumpy", "Hopeful", "Rowdy"] as const;
const nameHash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);

function overlay(file: string, hotspot: number, animation: Animation): OverlayState {
  return { iconRes: localRes(file), hotspot, translation: 0, effect: 0, animation, anim: animStateFrom(animation) };
}

export class ArenaView {
  private figures = new Map<number, Figure>();
  private fieldMap = new Map<number, FieldView>();
  private shotMap = new Map<number, ShotView>();
  private queue: ArenaTick[] = [];
  private eventList: ArenaEvent[] = [];
  private roster = new Map<number, ArenaRosterWire>();
  private labels: ArenaState["labels"] = { arch: {}, weapon: {}, spell: {} };
  private spells: Record<string, ArenaSpellDef>;
  champions: ArenaChampion[] = [];
  season = 0;
  phase: ArenaPhase = "rest";
  /** Our clock less the sim's, once a state has come; and the sim time we're showing */
  private offset: number | null = null;
  private shown = 0;
  private readonly delay: number;

  constructor(opts: { delayMs?: number; spells?: Record<string, ArenaSpellDef> } = {}) {
    this.delay = opts.delayMs ?? PLAYBACK_DELAY_MS;
    this.spells = opts.spells ?? ARENA_SPELLS;
  }

  /** Whether a state has come (before that there's nothing to draw) */
  get ready(): boolean {
    return this.offset !== null;
  }

  /** A message from the sim */
  receive(m: ArenaMessage): void {
    if (m.t === "arenaState") this.reset(m);
    else if (this.offset !== null) this.queue.push(m);
  }

  /** Everything gone (we left, or the setting went off) */
  clear(): void {
    this.figures.clear();
    this.fieldMap.clear();
    this.shotMap.clear();
    this.queue = [];
    this.offset = null;
  }

  private reset(s: ArenaState): void {
    this.clear();
    this.offset = 0;
    this.labels = s.labels;
    this.season = s.season;
    this.champions = s.champions;
    this.phase = s.phase;
    this.roster = new Map(s.roster.map((r) => [r.rid, r]));
    this.shown = s.now;
    // The clock's lined up on the next frame
    this.syncTo = s.now;
    for (const p of s.people) this.addFigure(p, s.now);
    for (const f of s.fields) this.addField(f);
    for (const sh of s.shots) this.addShot(sh);
  }

  /** A state's time, to line our clock up with on the next frame */
  private syncTo: number | null = null;

  private offsetFor(simNow: number, localNow: number): void {
    this.offset = localNow - (simNow - this.delay);
  }

  /**
   * One frame at local time `now` (ms, any steady clock): apply the ticks due, place the figures
   * between ticks, fly the spells, age the walls
   */
  update(now: number, dt: number): void {
    if (this.offset === null) return;
    if (this.syncTo !== null) {
      this.offsetFor(this.syncTo, now);
      this.syncTo = null;
    }
    // A jitter buffer: keep the delay's worth of ticks queued, catching up or easing off slowly
    const newest = this.queue.length ? this.queue[this.queue.length - 1].now : this.shown;
    const behind = newest - (now - this.offset);
    if (behind > this.delay * 3) this.offsetFor(newest, now);
    else if (behind > this.delay * 1.5) this.offset -= Math.min(dt * 0.1, 10);
    else if (behind < this.delay * 0.5) this.offset += Math.min(dt * 0.1, 10);
    const t = now - this.offset;
    while (this.queue.length && this.queue[0].now <= t) this.apply(this.queue.shift()!);
    this.shown = t;
    for (const f of this.figures.values()) {
      const k = Math.max(0, Math.min(1, (t - f.at) / TICK_SPAN_MS));
      f.obj.x = Math.round(f.from.x + (f.to.x - f.from.x) * k);
      f.obj.y = Math.round(f.from.y + (f.to.y - f.from.y) * k);
      if (f.say && (f.say.ms -= dt) <= 0) f.say = null;
    }
    for (const s of this.shotMap.values()) {
      const p = Math.max(0, Math.min(1, (t - s.wire.t) / s.flight));
      const v = s.view;
      v.progress = p;
      v.x = v.sourceX + (v.destX - v.sourceX) * p;
      v.y = v.sourceY + (v.destY - v.sourceY) * p;
      animStep(v.look.anim, 0, dt);
      if (p >= 1) this.shotMap.delete(s.wire.id);
    }
    for (const f of this.fieldMap.values()) {
      animStep(f.obj.look.anim, 0, dt);
      // The last moment: more see-through
      if (f.wire.end - t < FIELD_FADE_MS && f.obj.info.drawingType !== 1) {
        f.obj.info.drawingType = 1;
        f.obj.version++;
      }
      if (t >= f.wire.end + 500) this.fieldMap.delete(f.wire.id);
    }
  }

  private apply(m: ArenaTick): void {
    this.phase = m.phase;
    if (m.season !== undefined) this.season = m.season;
    if (m.champions) this.champions = m.champions;
    for (const r of m.ro ?? []) this.roster.set(r.rid, r);
    for (const p of m.add ?? []) this.addFigure(p, m.now);
    for (const mv of m.mv ?? []) this.move(mv, m.now);
    for (const id of m.del ?? []) this.figures.delete(id);
    for (const f of m.fa ?? []) this.addField(f);
    for (const [id, g] of m.fc ?? []) {
      const f = this.fieldMap.get(id);
      if (!f) continue;
      f.wire.g = g;
      this.setFieldLook(f);
    }
    for (const id of m.fd ?? []) this.fieldMap.delete(id);
    for (const s of m.sh ?? []) this.addShot(s);
    for (const [id, text] of m.say ?? []) {
      const f = this.figures.get(id);
      if (f) f.say = { text, ms: 3200 + text.length * 40 };
    }
    for (const e of m.ev ?? []) if (this.eventList.length < 80) this.eventList.push(e);
  }

  private addFigure(p: ArenaPersonWire, now: number): void {
    const obj = makePerson(p.look, p.x, p.y, p.a);
    const f: Figure = { wire: p, obj, from: { x: p.x, y: p.y }, to: { x: p.x, y: p.y }, at: now, built: "", say: null };
    this.figures.set(p.id, f);
    this.dress(f);
  }

  private move(mv: ArenaMove, now: number): void {
    const f = this.figures.get(mv[0]);
    if (!f) return;
    const [, x, y, a, pose, ps, cf, hp, st, fade, fd, fav] = mv;
    f.from = { x: f.obj.x, y: f.obj.y };
    f.to = { x, y };
    f.at = now;
    Object.assign(f.wire, { x, y, a, pose, ps, cf, hp, st, fade, fd });
    if (fav !== undefined) f.wire.fav = fav;
    f.obj.angle = a;
    this.dress(f);
  }

  /**
   * The figure's looks for its pose and state: the winner's weapon put away (it cheers with empty
   * hands), the webs on the legs of whoever's stuck, and the blinding ring or dazzling star about
   * the head of whoever can't see (the spells' own projectile art)
   */
  private dress(f: Figure): void {
    const w = f.wire;
    const key = `${w.pose}|${w.ps}|${w.cf}|${w.st}`;
    const o = f.obj;
    const drawFx = FADE_FX[Math.min(3, Math.floor((w.fade / 100) * 4))];
    if (o.info.drawingType !== drawFx) {
      o.info.drawingType = drawFx;
      o.version++;
    }
    if (key === f.built) return;
    f.built = key;
    let look: Appearance = w.look;
    if (w.st & ARENA_STATUS.WINNER && look.gear?.weapon) look = { ...look, gear: { ...look.gear, weapon: undefined } };
    const extra: OverlayState[] = [];
    if (w.st & ARENA_STATUS.WEBBED) extra.push(overlay(WEB_OVERLAY, HS_LEGS, { type: ANIMATE.NONE, group: 1 }));
    const curse = w.st & ARENA_STATUS.BLIND ? this.spells.blind : w.st & ARENA_STATUS.DAZZLED ? this.spells.dazzle : null;
    if (curse?.projectile) extra.push(overlay(curse.projectile.file, HS_HEAD, curse.projectile.animation));
    const build = (pose: Pose): Look => {
      const l = lookFor(look, pose, false, w.cf);
      return extra.length ? { ...l, overlays: [...l.overlays, ...extra] } : l;
    };
    o.normal = build(w.pose === "walk" ? "stand" : w.pose);
    o.moving = build("walk");
    o.look = w.pose === "walk" ? o.moving : o.normal;
    o.info.overlays = o.look.overlays;
    o.version++;
  }

  private addField(w: ArenaFieldWire): void {
    const def = ARENA_FIELDS[w.kind as FieldKind];
    if (!def) return;
    const id = ambientId();
    const light = w.lit && def.light ? { ...def.light } : { flags: 0, intensity: 0, color: 0 };
    const look: Look = { anim: animStateFrom(def.animation), overlays: [], translation: 0 };
    const obj: WorldObject = {
      id, x: w.x, y: w.y, angle: w.a, normal: look, moving: look, look, motion: null, version: 0,
      info: {
        id, amount: 0, iconRes: localRes(def.file), nameRes: 0, flags: 0, drawingType: def.drawFx, minimapFlags: 0, nameColor: 0, objectType: 0,
        moveOnType: 0, light, translation: 0, effect: 0, animation: def.animation, overlays: [],
      },
    };
    const f = { wire: { ...w }, obj };
    this.fieldMap.set(w.id, f);
    if (w.kind === "bramble" && w.g && w.g < 5) this.setFieldLook(f);
  }

  /** A bramble's look by its health, once grown (bramble.kod SendAnimation) */
  private setFieldLook(f: FieldView): void {
    const animation: Animation = { type: ANIMATE.NONE, group: Math.max(1, Math.min(5, f.wire.g)) };
    const look: Look = { anim: animStateFrom(animation), overlays: [], translation: 0 };
    f.obj.normal = f.obj.moving = f.obj.look = look;
    f.obj.info.animation = animation;
    f.obj.version++;
  }

  private addShot(w: ArenaShotWire): void {
    const def = this.spells[w.spell];
    const proj = def?.projectile;
    if (!proj) return;
    const len = Math.hypot(w.dx - w.sx, w.dy - w.sy) / SQ;
    const view: ArenaShotView = {
      id: ambientId(), x: w.sx, y: w.sy, sourceX: w.sx, sourceY: w.sy, destX: w.dx, destY: w.dy, progress: 0, flags: 0, spell: w.spell,
      angle: Math.round((Math.atan2(w.dy - w.sy, w.dx - w.sx) * 4096) / (2 * Math.PI)) & 4095,
      info: { iconRes: localRes(proj.file), light: proj.light ? { flags: 0x3, intensity: 100, color: proj.light } : { flags: 0, intensity: 0, color: 0 } },
      look: { anim: animStateFrom(proj.animation), overlays: [], translation: 0 },
    };
    this.shotMap.set(w.id, { wire: w, view, flight: (len / proj.speed) * 1000 });
  }

  // ---- for the scene ----

  /** The figures to draw */
  objects(): WorldObject[] {
    return [...this.figures.values()].map((f) => f.obj);
  }

  /** The walls' elements on the floor */
  fields(): WorldObject[] {
    return [...this.fieldMap.values()].map((f) => f.obj);
  }

  /** Spells in flight */
  shots(): ArenaShotView[] {
    return [...this.shotMap.values()].map((s) => s.view);
  }

  /** What's being said, over whose head */
  speech(): AmbientSpeech[] {
    return [...this.figures.values()].filter((f) => f.say && f.wire.fd >= 0).map((f) => ({ obj: f.obj, text: f.say!.text }));
  }

  /** What made a sound since the last call */
  takeEvents(): ArenaEvent[] {
    const e = this.eventList;
    this.eventList = [];
    return e;
  }

  private figureOf(id: number): Figure | undefined {
    for (const f of this.figures.values()) if (f.obj.id === id) return f;
    return undefined;
  }

  /** Whether an object id is someone in the arena */
  has(id: number): boolean {
    const f = this.figureOf(id);
    return !!f && f.wire.fd >= 0;
  }

  /** Someone in the arena, as the inspect window shows them; null if they've gone */
  describe(id: number): AmbientPersonInfo | null {
    const f = this.figureOf(id);
    if (!f) return null;
    const w = f.wire;
    const r = w.rid >= 0 ? this.roster.get(w.rid) : undefined;
    const st = w.st;
    let doing: string;
    if (st & ARENA_STATUS.WINNER) doing = "Savouring a victory";
    else if (st & ARENA_STATUS.BEATEN) doing = "Getting over a beating, in the stands";
    else if (w.role === "spectator") doing = "Watching the bouts";
    else if (st & ARENA_STATUS.BLIND) doing = "Stumbling about, blinded";
    else if (st & ARENA_STATUS.DAZZLED) doing = "Stumbling about, dazzled";
    else if (st & ARENA_STATUS.WEBBED) doing = "Stuck fast in a web";
    else if (st & ARENA_STATUS.HELD) doing = "Held fast by a spell";
    else if (this.phase === "fight") doing = st & ARENA_STATUS.POISONED ? "Fighting, poisoned" : "Fighting a bout";
    else doing = "Waiting for the next bout";
    let mood: string;
    if (st & ARENA_STATUS.WINNER) mood = "Triumphant";
    else if (st & ARENA_STATUS.BEATEN) mood = "Sore";
    else if (st & (ARENA_STATUS.BLIND | ARENA_STATUS.DAZZLED | ARENA_STATUS.WEBBED | ARENA_STATUS.HELD)) mood = "Furious";
    else if (w.role !== "spectator" && this.phase === "fight") mood = w.hp < w.mhp / 4 ? "Desperate" : "Fierce";
    else mood = MOODS[nameHash(w.name) % MOODS.length];
    const archLabel = this.labels.arch[w.arch] ?? w.arch;
    const role = r ? archLabel || ROLE_LABELS[w.role] : ROLE_LABELS[w.role];
    const info: AmbientPersonInfo = {
      object: f.obj, name: w.name || "Spectator", female: w.look.female, role, doing, mood, from: null, to: null, errand: null,
    };
    // A spectator's fighter this round
    const fav = w.fav !== undefined && w.fav >= 0 ? this.figures.get(w.fav)?.wire.name : undefined;
    if (fav) info.cheering = fav;
    if (r)
      info.arena = {
        archetype: archLabel,
        weapon: r.weapon ? (this.labels.weapon[r.weapon] ?? r.weapon) : null,
        spell: r.spell ? (this.labels.spell[r.spell] ?? r.spell) : null,
        wins: r.rec.wins, losses: r.rec.losses, kills: r.rec.kills, season: this.season, champion: r.champ,
        hp: w.role === "spectator" ? 0 : w.hp, maxHp: w.role === "spectator" ? 0 : w.mhp,
      };
    return info;
  }
}
