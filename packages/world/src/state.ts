// What the client knows about the world, kept up to date from server messages
// (clientd3d/server.c handlers -> game.c / object.c / moveobj.c). Renderer-agnostic.

import {
  BP, ByteReader, CLIENT_TAG_NUMBER, EFFECT, ENCHANT, objId, objTag, readEffect, readPlayerOverlay, readRadiusShoot, readShoot, type Shot, readAddEnchantment, readChange, readMove, readObject,
  readObjectList, readPlayer, readRemoveEnchantment, readRoomContents, readRoomObject, readSpells, readStat,
  readStatGroup, readStatGroups, readTurn, readRoomChange, type RoomChange, readUseList, readSpell, readBgOverlay, type Animation, type BgOverlay, type ObjectInfo, type Overlay,
  type PlayerInfo, type RoomObject, type Spell, type Statistic,
} from "@shards/protocol";
import { animStateFrom, type AnimState } from "./animation.ts";

export interface OverlayState extends Overlay {
  anim: AnimState;
}

/** An appearance: animation, overlays and palette translation. */
export interface Look {
  anim: AnimState;
  overlays: OverlayState[];
  translation: number;
}

/** Interpolated motion between server positions (moveobj.c Motion). */
export interface Motion {
  sourceX: number;
  sourceY: number;
  destX: number;
  destY: number;
  progress: number;
  /** progress per ms */
  increment: number;
  /** grid squares per 10 seconds */
  speed: number;
}

/** A room object as the client tracks it (room_contents_node). */
export interface WorldObject {
  id: number;
  info: ObjectInfo;
  /** Client fine coordinates (1024 per square, 0-based). */
  x: number;
  y: number;
  /** Client angle units, 0..4095. */
  angle: number;
  /** Normal look and the look used while moving (obj.normal_* and motion.*). */
  normal: Look;
  moving: Look;
  /** The look to draw now (game.c RoomObjectSetAnimation). */
  look: Look;
  motion: Motion | null;
  /** Bumped whenever the look changes (for render caches). */
  version: number;
}

/** proto.h REMOTE_VIEW_* */
export const REMOTE_VIEW = {
  MOVE: 0x1, TURN: 0x2, TILT: 0x4, CAST: 0x8, LOOK: 0x10,
  TOP: 0x100, BOTTOM: 0x200, MID: 0x400, SPECIFIED: 0x800,
  CONTROL: 0x10000, ESC_CANCELS: 0x20000, VALID_HEIGHT: 0x40000, VALID_LIGHT: 0x80000,
} as const;

export interface RemoteView {
  id: number;
  flags: number;
  height: number;
  light: number;
}

export interface Lighting {
  ambient: number;
  playerLight: number;
  /** BP_LIGHT_SHADING */
  shadeIntensity: number;
  sunAngle: number;
}

export interface OnlinePlayer {
  id: number;
  nameRes: number;
  name: string;
  flags: number;
}

export type WorldEvent =
  | { type: "player"; player: PlayerInfo; roomChanged: boolean }
  | { type: "roomContents" }
  | { type: "objectAdded" | "objectChanged" | "objectMoved"; id: number }
  | { type: "objectRemoved"; id: number }
  /** The server moved or turned *us* (teleport, rejected move, BP_TURN). */
  | { type: "selfMoved"; x: number; y: number }
  | { type: "selfTurned"; angle: number }
  | { type: "inventory" }
  | { type: "players" }
  | { type: "lighting" }
  | { type: "background"; resource: number }
  /** A stat group changed (BP_STAT / BP_STAT_GROUP), or the list of groups (group 0). */
  | { type: "stats"; group: number }
  | { type: "spells" }
  | { type: "skills" }
  | { type: "enchantments" }
  /** Which inventory items are in use (wielded, worn) changed. */
  | { type: "inUse" }
  /** Our first-person overlays (weapon and shield hands) changed. */
  | { type: "playerOverlays" }
  /** A screen effect started or stopped (blind, paralyzed, pain...). */
  | { type: "effect"; effect: number }
  /** The sun or moon was added, moved or removed (BP_ADD/CHANGE/REMOVE_BG_OVERLAY) */
  | { type: "bgOverlays" }
  /**
   * Object ids are about to change (BP_WAIT before a save) or have changed (BP_INVALIDATE_DATA
   * after it): the target and anything else holding an id is stale
   */
  | { type: "idsStale" }
  /** BP_SECTOR_MOVE, BP_WALL_ANIMATE and the rest: the room changed (roomAnim.ts) */
  | { type: "roomChange"; change: RoomChange }
  /** BP_SET_VIEW / BP_RESET_VIEW: seeing through another object's eyes (game.c SetPlayerRemoteView) */
  | { type: "remoteView" }
  /** BP_WAIT / BP_UNWAIT: the server is saving (game.c GameWait / GameUnwait) */
  | { type: "wait"; waiting: boolean };

/** The sun or the moon on the sky (boverlay.c), with its animation. */
export interface BgOverlayState {
  info: BgOverlay;
  look: Look;
}

/** A projectile in flight (project.c Projectile): a sprite moving from source to dest. */
export interface Projectile {
  /** Negative, so it never collides with an object id */
  id: number;
  info: { iconRes: number; light: Shot["light"]; flags: number };
  look: Look;
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
  destX: number;
  destY: number;
  progress: number;
  /** progress per ms */
  increment: number;
  angle: number;
  flags: number;
}

/** A first-person overlay (overlay.c PlayerOverlay): drawn at a screen hotspot. */
export interface PlayerOverlayState {
  hotspot: number;
  info: ObjectInfo;
  look: Look;
}

/**
 * Screen effects (clientd3d effect.c `effects`). Times are milliseconds left, counted
 * down by tick() like AnimateEffects.
 */
export interface Effects {
  paralyzed: boolean;
  blind: boolean;
  pain: number;
  whiteout: number;
  invert: number;
  shake: number;
  blur: number;
  waver: number;
  /** EFFECT_FLASHXLAT: a colour flash by xlat id, for `flashTime` ms */
  flashXlat: number;
  flashTime: number;
  xlatOverride: number;
  raining: boolean;
  snowing: boolean;
  sand: boolean;
  /** EFFECT_FIREWORKS: until EFFECT_CLEARWEATHER (effect.c:107) */
  fireworks: boolean;
}

const noEffects = (): Effects => ({
  paralyzed: false, blind: false, pain: 0, whiteout: 0, invert: 0, shake: 0, blur: 0, waver: 0,
  flashXlat: 0, flashTime: 0, xlatOverride: 0, raining: false, snowing: false, sand: false, fireworks: false,
});

/**
 * A map keyed by object id that ignores the id's tag bits, as the client's lookups do
 * (object.c CompareIdObject: GetObjId(a) == GetObjId(b)). The server names a number
 * item (a stack of shillings) with its tag in some messages and without it in others.
 * Values keep their full ids.
 */
export class ObjectMap<V> extends Map<number, V> {
  override get(id: number): V | undefined {
    return super.get(objId(id));
  }
  override has(id: number): boolean {
    return super.has(objId(id));
  }
  override set(id: number, v: V): this {
    return super.set(objId(id), v);
  }
  override delete(id: number): boolean {
    return super.delete(objId(id));
  }
}

/** A set of object ids that ignores tag bits (see ObjectMap). */
export class ObjectIdSet extends Set<number> {
  override add(id: number): this {
    return super.add(objId(id));
  }
  override has(id: number): boolean {
    return super.has(objId(id));
  }
  override delete(id: number): boolean {
    return super.delete(objId(id));
  }
}

/** Kod fine coordinates (1-based, 64 per square) to client fine (server.c ExtractCoordinates). */
export const kodToFine = (kod: number): number => (kod - 64) * 16;
/** Client fine to Kod fine for BP_REQ_MOVE (protocol.h RequestMove). */
export const fineToKod = (fine: number): number => (fine >> 4) + 64;

export class WorldState {
  player: PlayerInfo | null = null;
  readonly objects = new ObjectMap<WorldObject>();
  readonly inventory = new ObjectMap<ObjectInfo>();
  readonly players = new Map<number, OnlinePlayer>();
  lighting: Lighting = { ambient: 0, playerLight: 0, shadeIntensity: 0, sunAngle: 0 };
  background = 0;
  /** Stat groups by number (module/merintr stats.c): group 1 = health, mana, vigor, XP. Sorted by `num`. */
  readonly stats = new Map<number, Statistic[]>();
  /** Name resources of the stat groups (BP_STAT_GROUPS), index 0 = group 1. */
  statGroupNames: number[] = [];
  spells: Spell[] = [];
  /** UC_SPELL_SCHOOLS: the schools' name resources, by school number (spells.c submenus) */
  spellSchools: number[] = [];
  skills: ObjectInfo[] = [];
  /** Enchantments on us (ENCHANT_PLAYER) and on the room (ENCHANT_ROOM), by object id. */
  readonly enchantments = { player: new ObjectMap<ObjectInfo>(), room: new ObjectMap<ObjectInfo>() };
  /** First-person overlays, slots 1 and 2 (index 0 and 1). */
  readonly playerOverlays: (PlayerOverlayState | null)[] = [null, null];
  effects: Effects = noEffects();
  /** The sun and moon (current_room.bg_overlays), by id; the server sends them at logon and every game hour */
  readonly bgOverlays = new Map<number, BgOverlayState>();
  /** Projectiles flying in the room (current_room.projectiles) */
  readonly projectiles = new Map<number, Projectile>();
  private nextProjectile = -1;
  /** Inventory items in use (BP_USE_LIST, BP_USE, BP_UNUSE). */
  readonly inUse = new ObjectIdSet();
  /** Resource ids whose strings changed at runtime (BP_CHANGE_RESOURCE: player names etc.). */
  readonly dynamicResources = new Map<number, string>();
  private readonly listeners = new Set<(e: WorldEvent) => void>();

  on(fn: (e: WorldEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: WorldEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /** Our own room object, if we've seen it. */
  get self(): WorldObject | undefined {
    return this.player ? this.objects.get(this.player.id) : undefined;
  }

  /** Advance interpolated motion (moveobj.c ObjectsMove / MoveSingle). */
  tick(dt: number): void {
    // effect.c AnimateEffects
    const fx = this.effects;
    const down = (v: number) => Math.max(0, v - dt);
    fx.pain = down(fx.pain);
    fx.whiteout = down(fx.whiteout);
    fx.invert = down(fx.invert);
    fx.shake = down(fx.shake);
    fx.blur = down(fx.blur);
    fx.waver = down(fx.waver);
    if (fx.flashXlat) {
      fx.flashTime -= dt;
      if (fx.flashTime <= 0) fx.flashXlat = fx.flashTime = 0;
    }
    // project.c ProjectilesMove: drop the ones that arrived
    for (const p of this.projectiles.values()) {
      p.progress += p.increment * dt;
      if (p.progress >= 1) this.projectiles.delete(p.id);
      else {
        p.x = p.sourceX + p.progress * (p.destX - p.sourceX);
        p.y = p.sourceY + p.progress * (p.destY - p.sourceY);
      }
    }
    for (const o of this.objects.values()) {
      const m = o.motion;
      if (!m) continue;
      m.progress += m.increment * dt;
      if (m.progress >= 1) {
        o.x = m.destX;
        o.y = m.destY;
        o.motion = null;
        o.look = o.normal;
        o.version++;
      } else {
        o.x = Math.round(m.sourceX + m.progress * (m.destX - m.sourceX));
        o.y = Math.round(m.sourceY + m.progress * (m.destY - m.sourceY));
      }
    }
  }

  /** BP_WAIT: a save is coming and will renumber objects; drop what holds an id (the target). */
  /**
   * inventry.c InventoryMoveCurrentItem (list_move_to_nth): `id` takes `target`'s place in
   * the inventory's order. The server is told with BP_REQ_INVENTORY_MOVE.
   */
  moveInventoryItem(id: number, target: number): boolean {
    const entries = [...this.inventory.entries()];
    const from = entries.findIndex(([k]) => k === objId(id));
    const to = entries.findIndex(([k]) => k === objId(target));
    if (from < 0 || to < 0 || from === to) return false;
    const [moved] = entries.splice(from, 1);
    entries.splice(to, 0, moved);
    this.inventory.clear();
    for (const [k, v] of entries) this.inventory.set(k, v);
    this.emit({ type: "inventory" });
    return true;
  }

  setSpellSchools(schools: number[]): void {
    this.spellSchools = schools;
    this.emit({ type: "spells" });
  }

  emitIdsStale(): void {
    this.emit({ type: "idsStale" });
  }

  /**
   * BP_SET_VIEW: the view is another object's (the DM's Globe of Seeing), with REMOTE_VIEW_*
   * flags saying what we may do and where the eyes are; null for our own eyes.
   */
  remoteView: RemoteView | null = null;

  /** cursor.c UserMoveEsc: back to our own eyes (the client decides this alone) */
  endRemoteView(): void {
    if (!this.remoteView) return;
    this.remoteView = null;
    this.emit({ type: "remoteView" });
  }

  /**
   * The changes to the current room since the last BP_PLAYER, in order (roomAnim.ts
   * LiveRoom replays them onto its copy of the room once the room has loaded).
   */
  roomChanges: RoomChange[] = [];

  /**
   * Set while the server saves (BP_WAIT until BP_UNWAIT): the original enters GAME_WAIT,
   * where it shows the wait cursor and neither moves nor animates (statgame.c, animate.c:95).
   */
  waiting = false;

  setWaiting(waiting: boolean): void {
    if (this.waiting === waiting) return;
    this.waiting = waiting;
    this.emit({ type: "wait", waiting });
  }

  /**
   * game.c ResetUserData (BP_INVALIDATE_DATA, sent after the server's garbage collection has
   * renumbered every object): forget the room, the inventory and our overlays; the session asks
   * for them again. The sun and moon stay: the server only sends them at logon, and their next
   * hourly update replaces them by picture (the original drops them until then).
   */
  resetData(): void {
    this.objects.clear();
    this.projectiles.clear();
    this.inventory.clear();
    this.inUse.clear();
    this.enchantments.player.clear();
    this.enchantments.room.clear();
    this.playerOverlays[0] = this.playerOverlays[1] = null;
    this.emit({ type: "idsStale" });
    this.emit({ type: "inventory" });
    this.emit({ type: "inUse" });
    this.emit({ type: "enchantments" });
    this.emit({ type: "playerOverlays" });
  }

  /** Feed one game-mode message (positioned after the type byte). Returns true if handled. */
  handle(type: number, r: ByteReader): boolean {
    switch (type) {
      case BP.PLAYER: {
        const prev = this.player?.roomId;
        this.player = readPlayer(r);
        this.lighting.ambient = this.player.ambientLight;
        this.lighting.playerLight = this.player.playerLight;
        this.background = this.player.backgroundRes;
        if (prev !== this.player.roomId) this.enchantments.room.clear();
        // game.c HandlePlayer reloads the room every time; the server then sends every
        // change again (user.kod ToCliPlayer)
        this.roomChanges = [];
        this.emit({ type: "player", player: this.player, roomChanged: prev !== this.player.roomId });
        return true;
      }
      case BP.ROOM_CONTENTS: {
        const rc = readRoomContents(r);
        this.objects.clear();
        this.projectiles.clear();
        for (const o of rc.objects) this.objects.set(o.id, fromRoomObject(o));
        this.emit({ type: "roomContents" });
        return true;
      }
      case BP.CREATE: {
        const o = readRoomObject(r);
        this.objects.set(o.id, fromRoomObject(o));
        this.emit({ type: "objectAdded", id: o.id });
        return true;
      }
      case BP.REMOVE: {
        const id = r.u32();
        this.objects.delete(id);
        this.emit({ type: "objectRemoved", id });
        return true;
      }
      case BP.CHANGE: {
        const { object, motion } = readChange(r);
        const cur = this.objects.get(object.id);
        if (cur) {
          // game.c ChangeObject: the look is replaced; position stays; motion state too.
          cur.info = object;
          cur.normal = lookFrom(object.animation, object.overlays, object.translation);
          cur.moving = lookFrom(motion.animation, motion.overlays, motion.translation);
          cur.look = cur.motion ? cur.moving : cur.normal;
          cur.version++;
          this.emit({ type: "objectChanged", id: object.id });
        }
        // ...and the same object in the inventory (a stack of shillings after buying)
        if (this.inventory.has(object.id)) {
          this.inventory.set(object.id, object);
          this.emit({ type: "inventory" });
        }
        return true;
      }
      case BP.MOVE: {
        const m = readMove(r);
        this.moveObject(m.id, kodToFine(m.kodCol), kodToFine(m.kodRow), m.speed, m.turnToFace);
        return true;
      }
      case BP.TURN: {
        const t = readTurn(r);
        const cur = this.objects.get(t.id);
        if (cur) {
          cur.angle = t.angle & 4095;
          this.emit(t.id === this.player?.id ? { type: "selfTurned", angle: cur.angle } : { type: "objectMoved", id: t.id });
        }
        return true;
      }
      case BP.INVENTORY: {
        this.inventory.clear();
        for (const o of readObjectList(r)) this.inventory.set(o.id, o);
        this.emit({ type: "inventory" });
        return true;
      }
      case BP.INVENTORY_ADD: {
        const o = readObject(r);
        this.inventory.set(o.id, o);
        this.emit({ type: "inventory" });
        return true;
      }
      case BP.INVENTORY_REMOVE: {
        const id = r.u32();
        this.inventory.delete(id);
        this.inUse.delete(id);
        this.emit({ type: "inventory" });
        return true;
      }
      case BP.PLAYERS: {
        this.players.clear();
        const n = r.u16();
        for (let i = 0; i < n; i++) this.addPlayer(r);
        this.emit({ type: "players" });
        return true;
      }
      case BP.PLAYER_ADD:
        this.addPlayer(r);
        this.emit({ type: "players" });
        return true;
      case BP.PLAYER_REMOVE:
        this.players.delete(r.u32());
        this.emit({ type: "players" });
        return true;
      case BP.LIGHT_AMBIENT:
        this.lighting.ambient = r.u8();
        this.emit({ type: "lighting" });
        return true;
      case BP.LIGHT_PLAYER:
        this.lighting.playerLight = r.u8();
        this.emit({ type: "lighting" });
        return true;
      case BP.LIGHT_SHADING:
        // server.c HandleLightShading: u8 intensity, u16 sun x (angle), u16 sun y (unused)
        this.lighting.shadeIntensity = r.u8();
        this.lighting.sunAngle = r.u16();
        this.emit({ type: "lighting" });
        return true;
      case BP.ADD_BG_OVERLAY:
      case BP.CHANGE_BG_OVERLAY: {
        // boverlay.c BackgroundOverlayAdd / BackgroundOverlayChange
        const info = readBgOverlay(r);
        // After a save renumbers objects, the hourly update comes under a new id: the same
        // picture replaces the old one rather than showing twice
        for (const [id, b] of this.bgOverlays) if (id !== info.id && b.info.iconRes === info.iconRes) this.bgOverlays.delete(id);
        this.bgOverlays.set(info.id, { info, look: lookFrom(info.animation, [], info.translation) });
        this.emit({ type: "bgOverlays" });
        return true;
      }
      case BP.REMOVE_BG_OVERLAY:
        this.bgOverlays.delete(r.u32());
        this.emit({ type: "bgOverlays" });
        return true;
      case BP.SECTOR_MOVE:
      case BP.WALL_ANIMATE:
      case BP.SECTOR_ANIMATE:
      case BP.SECTOR_CHANGE:
      case BP.CHANGE_TEXTURE:
      case BP.SECTOR_LIGHT: {
        const change = readRoomChange(type, r)!;
        this.roomChanges.push(change);
        this.emit({ type: "roomChange", change });
        return true;
      }
      case BP.SET_VIEW: {
        // server.c HandleSetView: object, flags, height, light
        const id = r.u32();
        const flags = r.i32();
        const height = r.i32();
        const light = r.u8();
        // game.c SetPlayerRemoteView: our own id (or none) means our own eyes
        this.remoteView = id && id !== this.player?.id ? { id, flags, height, light } : null;
        this.emit({ type: "remoteView" });
        return true;
      }
      case BP.RESET_VIEW:
        this.remoteView = null;
        this.emit({ type: "remoteView" });
        return true;
      case BP.BACKGROUND:
        this.background = r.u32();
        this.emit({ type: "background", resource: this.background });
        return true;
      case BP.CHANGE_RESOURCE: {
        const id = r.u32();
        this.dynamicResources.set(id, r.string());
        return true;
      }
      case BP.STAT_GROUPS:
        this.statGroupNames = readStatGroups(r);
        this.emit({ type: "stats", group: 0 });
        return true;
      case BP.STAT_GROUP: {
        const g = readStatGroup(r);
        this.stats.set(g.group, g.stats);
        this.emit({ type: "stats", group: g.group });
        return true;
      }
      case BP.STAT: {
        // stats.c StatChange: replace the stat with the same number in its group
        const { group, stat } = readStat(r);
        const list = this.stats.get(group) ?? [];
        const i = list.findIndex((s) => s.num === stat.num);
        if (i >= 0) list[i] = stat;
        else list.push(stat);
        this.stats.set(group, list);
        this.emit({ type: "stats", group });
        return true;
      }
      case BP.SPELLS:
        this.spells = readSpells(r);
        this.emit({ type: "spells" });
        return true;
      case BP.SPELL_ADD:
        this.spells = [...this.spells, readSpell(r)];
        this.emit({ type: "spells" });
        return true;
      case BP.SPELL_REMOVE: {
        const id = r.u32();
        this.spells = this.spells.filter((s) => s.object.id !== id);
        this.emit({ type: "spells" });
        return true;
      }
      case BP.SKILLS:
        this.skills = readObjectList(r);
        this.emit({ type: "skills" });
        return true;
      case BP.SKILL_ADD:
        this.skills = [...this.skills, readObject(r)];
        this.emit({ type: "skills" });
        return true;
      case BP.SKILL_REMOVE: {
        const id = r.u32();
        this.skills = this.skills.filter((s) => s.id !== id);
        this.emit({ type: "skills" });
        return true;
      }
      case BP.ADD_ENCHANTMENT: {
        const e = readAddEnchantment(r);
        (e.kind === ENCHANT.ROOM ? this.enchantments.room : this.enchantments.player).set(e.object.id, e.object);
        this.emit({ type: "enchantments" });
        return true;
      }
      case BP.REMOVE_ENCHANTMENT: {
        const e = readRemoveEnchantment(r);
        (e.kind === ENCHANT.ROOM ? this.enchantments.room : this.enchantments.player).delete(e.id);
        this.emit({ type: "enchantments" });
        return true;
      }
      case BP.SHOOT: {
        // project.c ProjectileAdd
        const shot = readShoot(r);
        const src = this.objects.get(shot.source),
          dst = this.objects.get(shot.dest);
        if (src && dst && src !== dst) this.addProjectile(shot, src.x, src.y, dst.x, dst.y);
        return true;
      }
      case BP.RADIUS_SHOOT: {
        // project.c RadiusProjectileAdd: a ring of shots out to range * 1000 fine units
        const shot = readRadiusShoot(r);
        const src = this.objects.get(shot.source);
        if (src) {
          for (let i = 0; i < shot.number; i++) {
            const a = (((360 / shot.number) * i) * Math.PI) / 180;
            this.addProjectile(shot, src.x, src.y, src.x + shot.range * 1000 * Math.cos(a), src.y + shot.range * 1000 * Math.sin(a));
          }
        }
        return true;
      }
      case BP.PLAYER_OVERLAY: {
        // overlay.c SetPlayerOverlay: the object's id is the slot (1-based)
        const { hotspot, object } = readPlayerOverlay(r);
        const slot = object.id - 1;
        if (slot >= 0 && slot < this.playerOverlays.length) {
          this.playerOverlays[slot] = { hotspot, info: object, look: lookFrom(object.animation, object.overlays, object.translation) };
          this.emit({ type: "playerOverlays" });
        }
        return true;
      }
      case BP.EFFECT: {
        const e = readEffect(r);
        const fx = this.effects;
        const capped = (d: number, fallback: number) => (d > 10000 || d < 0 ? fallback : d);
        switch (e.type) {
          case EFFECT.XLATOVERRIDE: fx.xlatOverride = e.xlat; break;
          case EFFECT.INVERT: fx.invert = e.duration; break;
          case EFFECT.SHAKE: fx.shake = e.duration; break;
          case EFFECT.PARALYZE: fx.paralyzed = true; break;
          case EFFECT.RELEASE: fx.paralyzed = false; break;
          case EFFECT.BLIND: fx.blind = true; break;
          case EFFECT.SEE: fx.blind = false; break;
          case EFFECT.RAINING: fx.raining = true; break;
          case EFFECT.SNOWING: fx.snowing = true; break;
          case EFFECT.FIREWORKS: fx.fireworks = true; break;
          case EFFECT.CLEARWEATHER: fx.raining = fx.snowing = fx.fireworks = false; break;
          case EFFECT.SAND: fx.sand = true; break;
          case EFFECT.CLEARSAND: fx.sand = false; break;
          case EFFECT.PAIN: fx.pain = capped(e.duration, 10000); break;
          case EFFECT.WHITEOUT: fx.whiteout = capped(e.duration, 10000); break;
          case EFFECT.BLUR: fx.blur = Math.min(200000, fx.blur + (e.duration < 0 ? 10000 : e.duration)); break;
          case EFFECT.WAVER: fx.waver = Math.min(200000, fx.waver + (e.duration < 0 ? 10000 : e.duration)); break;
          case EFFECT.FLASHXLAT:
            fx.flashTime = capped(e.duration, 1000);
            fx.flashXlat = e.xlat < 0 || e.xlat > 0xff ? 0 : e.xlat;
            break;
        }
        this.emit({ type: "effect", effect: e.type });
        return true;
      }
      case BP.USE_LIST:
        this.inUse.clear();
        for (const id of readUseList(r)) this.inUse.add(id);
        this.emit({ type: "inUse" });
        return true;
      case BP.USE:
        this.inUse.add(r.u32());
        this.emit({ type: "inUse" });
        return true;
      case BP.UNUSE:
        this.inUse.delete(r.u32());
        this.emit({ type: "inUse" });
        return true;
      default:
        return false;
    }
  }

  private addProjectile(shot: Shot, sx: number, sy: number, dx: number, dy: number): void {
    const dist = Math.hypot(dx - sx, dy - sy) / 1024;
    const id = this.nextProjectile--;
    this.projectiles.set(id, {
      id,
      info: { iconRes: shot.iconRes, light: shot.light, flags: 0 },
      look: lookFrom(shot.animation, [], shot.translation),
      x: sx, y: sy, sourceX: sx, sourceY: sy, destX: dx, destY: dy, progress: 0,
      increment: shot.speed === 0 || dist === 0 ? 1 : shot.speed / 1000 / dist,
      angle: Math.round((Math.atan2(dy - sy, dx - sx) * 4096) / (2 * Math.PI)) & 4095,
      flags: shot.flags,
    });
  }

  /** moveobj.c MoveObject2: the server moved an object. */
  private moveObject(id: number, x: number, y: number, speed: number, turnToFace: boolean): void {
    const o = this.objects.get(id);
    if (!o) return;
    if (turnToFace) {
      const dx = x - o.x,
        dy = y - o.y;
      const dir = dy > 0 ? (dx > 0 ? 1 : dx < 0 ? 3 : 2) : dy < 0 ? (dx > 0 ? 7 : dx < 0 ? 5 : 6) : dx > 0 ? 0 : dx < 0 ? 4 : -1;
      if (dir >= 0) o.angle = (dir * 4096) / 8;
    }
    if (id === this.player?.id) {
      // Our own position: no interpolation (ServerMovedPlayer).
      o.x = x;
      o.y = y;
      o.motion = null;
      this.emit({ type: "selfMoved", x, y });
      return;
    }
    if (speed === 0) {
      o.x = x;
      o.y = y;
      o.motion = null;
      o.look = o.normal;
      o.version++;
      this.emit({ type: "objectMoved", id });
      return;
    }
    let s = speed;
    if (o.motion) {
      // Combine with the motion in progress so it doesn't fall behind (MoveObject2).
      s = Math.max(o.motion.speed, speed);
      const remaining = Math.hypot(o.x - x, o.y - y) / 1024;
      if (remaining > 1) {
        const old = Math.hypot(o.motion.destX - o.motion.sourceX, o.motion.destY - o.motion.sourceY) / 1024 || 0.00001;
        if (remaining / old > 1) s *= remaining / old;
      }
    }
    const dist = Math.hypot(x - o.x, y - o.y) / 1024;
    o.motion = {
      sourceX: o.x, sourceY: o.y, destX: x, destY: y, progress: 0,
      increment: dist === 0 ? 1 : s / 10000 / dist,
      speed: s,
    };
    if (o.look !== o.moving) {
      o.look = o.moving;
      o.version++;
    }
    this.emit({ type: "objectMoved", id });
  }

  private addPlayer(r: ByteReader): void {
    const id = r.u32(),
      nameRes = r.u32(),
      name = r.string(),
      flags = r.u32();
    r.u8(); // drawing type
    r.u32(); // minimap flags
    r.u32(); // name colour
    r.u8(); // object type
    r.u8(); // moveon type
    this.dynamicResources.set(nameRes, name);
    this.players.set(id, { id, nameRes, name, flags });
  }
}

function lookFrom(animation: Animation, overlays: Overlay[], translation: number): Look {
  return {
    anim: animStateFrom(animation),
    overlays: overlays.map((o) => ({ ...o, anim: animStateFrom(o.animation) })),
    translation,
  };
}

function fromRoomObject(o: RoomObject): WorldObject {
  const normal = lookFrom(o.animation, o.overlays, o.translation);
  const moving = lookFrom(o.motion.animation, o.motion.overlays, o.motion.translation);
  return {
    id: o.id, info: o, x: kodToFine(o.kodCol), y: kodToFine(o.kodRow), angle: o.angle & 4095,
    normal, moving, look: normal, motion: null, version: 0,
  };
}

/** Number items (tag 1) carry an amount (e.g. shillings). */
export const isNumberItem = (id: number): boolean => objTag(id) === CLIENT_TAG_NUMBER;
