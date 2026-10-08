// Builders for client -> server messages and parsers for server -> client ones.
// Formats follow clientd3d/protocol.c (client tables), blakserv/sprocket.c (how the
// server parses them) and clientd3d/server.c (how the client reads replies).

import { ByteReader, ByteWriter } from "./bytes.ts";
import { AP, ANIMATE, BP, CLIENT_MAJOR, CLIENT_MINOR, CLIENT_TAG_NUMBER, objId, objTag } from "./constants.ts";

// ---------------------------------------------------------------- login mode

export interface LoginInfo {
  username: string;
  /** 16-byte digest from passwordDigest(). */
  passwordDigest: Uint8Array;
  secretKey: string;
  screenWidth?: number;
  screenHeight?: number;
}

/** AP_LOGIN (clientd3d/login.c LoginSendInfo; parsed in blakserv/synched.c). */
export function buildLogin(info: LoginInfo): Uint8Array {
  return new ByteWriter()
    .u8(AP.LOGIN)
    .u8(CLIENT_MAJOR)
    .u8(CLIENT_MINOR)
    .i32(2) // os type: VER_PLATFORM_WIN32_NT; informational only (LogUserData)
    .i32(10) // os major
    .i32(0) // os minor
    .i32(1024 * 1024 * 1024) // RAM
    .i32(586) // cpu: PROCESSOR_INTEL_PENTIUM
    .u16(info.screenWidth ?? 1920)
    .u16(info.screenHeight ?? 1080)
    .i32(0) // displays possible
    .i32(0) // bandwidth
    .i32(32) // reserved: low byte = colour depth, next byte = partner code
    .string(info.username)
    .string(info.passwordDigest)
    .string(info.secretKey)
    .finish();
}

/** AP_REQ_GAME: last download time, a "catch" int, hostname. */
export function buildReqGame(downloadTime = 0): Uint8Array {
  return new ByteWriter().u8(AP.REQ_GAME).i32(downloadTime).i32(0).string("").finish();
}

export const buildLoginPing = (): Uint8Array => Uint8Array.of(AP.PING);

// ---------------------------------------------------------------- game mode: client -> server

export const buildSimple = (type: number): Uint8Array => Uint8Array.of(type);

export function buildUseCharacter(id: number): Uint8Array {
  return new ByteWriter().u8(BP.USE_CHARACTER).u32(id).finish();
}

export function buildSendCharInfo(): Uint8Array {
  return Uint8Array.of(BP.SYSTEM, BP.SEND_CHARINFO);
}

export interface NewCharInfo {
  id: number;
  name: string;
  description: string;
  gender: number;
  /** Face part resource ids: head, hair, eyes, nose, mouth. Empty = server default face. */
  faceParts: number[];
  hairTranslation: number;
  skinTranslation: number;
  /** Might, intellect, stamina, agility, mysticism, aim (each 1..50, sum <= 220 on our server). */
  stats: number[];
  spells: number[];
  skills: number[];
}

/** BP_SYSTEM / BP_NEW_CHARINFO (module/char/char.c, kod system.kod ReceiveClient). */
export function buildNewCharInfo(c: NewCharInfo): Uint8Array {
  const w = new ByteWriter().u8(BP.SYSTEM).u8(BP.NEW_CHARINFO).u32(c.id).string(c.name).string(c.description).u8(c.gender);
  const intArray = (a: number[]) => {
    w.u16(a.length);
    for (const v of a) w.i32(v);
  };
  intArray(c.faceParts);
  w.u8(c.hairTranslation).u8(c.skinTranslation);
  intArray(c.stats);
  intArray(c.spells);
  intArray(c.skills);
  return w.finish();
}

/** BP_REQ_MOVE. Coordinates are Kod fine units, 1-based (row/col 1 starts at 64). Row (y) goes first. */
export function buildReqMove(kodRow: number, kodCol: number, speed: number, roomId: number): Uint8Array {
  return new ByteWriter().u8(BP.REQ_MOVE).u16(kodRow).u16(kodCol).u8(speed).u32(roomId).finish();
}

export function buildReqTurn(id: number, angle: number): Uint8Array {
  return new ByteWriter().u8(BP.REQ_TURN).u32(objId(id)).u16(angle).finish();
}

/** Say types (include/proto.h SAY_*). */
export const SAY = { NORMAL: 1, YELL: 2, EVERYONE: 3, GROUP: 4, RESOURCE: 5, EMOTE: 6, MESSAGE: 7, DM: 9, GUILD: 10 } as const;

export function buildSay(text: string, info: number = SAY.NORMAL): Uint8Array {
  return new ByteWriter().u8(BP.SAY_TO).u8(info).string(text).finish();
}

/**
 * BP_SAY_GROUP (protocol.c PARAM_ID_LIST, PARAM_STRING): a u16 count, the players' ids,
 * then the text. "tell" and group messages (command.c CommandTell, groupdlg.c).
 */
export function buildSayGroup(ids: readonly number[], text: string): Uint8Array {
  const w = new ByteWriter().u8(BP.SAY_GROUP).u16(ids.length);
  for (const id of ids) w.u32(objId(id));
  return w.string(text).finish();
}

export function buildReqLook(id: number): Uint8Array {
  return new ByteWriter().u8(BP.REQ_LOOK).u32(objId(id)).finish();
}

// ---------------------------------------------------------------- game mode: server -> client

export interface Animation {
  type: number;
  group?: number;
  period?: number;
  groupLow?: number;
  groupHigh?: number;
  groupFinal?: number;
}

export interface Overlay {
  iconRes: number;
  hotspot: number;
  translation: number;
  effect: number;
  animation: Animation;
}

export interface ObjectInfo {
  id: number;
  amount: number;
  iconRes: number;
  nameRes: number;
  flags: number;
  drawingType: number;
  minimapFlags: number;
  nameColor: number;
  objectType: number;
  moveOnType: number;
  light: { flags: number; intensity: number; color: number };
  translation: number;
  effect: number;
  animation: Animation;
  overlays: Overlay[];
}

export interface RoomObject extends ObjectInfo {
  /** Kod fine coordinates, 1-based (as sent). */
  kodRow: number;
  kodCol: number;
  /** Server angle units, 0..4095. */
  angle: number;
  motion: { translation: number; effect: number; animation: Animation; overlays: Overlay[] };
}

/** Optional palette-translation / effect prefix (server.c ExtractPaletteTranslation). */
function readTranslation(r: ByteReader): { translation: number; effect: number } {
  const start = r.pos;
  const t = r.u8();
  if (t === ANIMATE.TRANSLATION) return { translation: r.u8(), effect: 0 };
  if (t === ANIMATE.EFFECT) return { translation: 0, effect: r.u8() };
  r.pos = start;
  return { translation: 0, effect: 0 };
}

/** Bitmap groups arrive 1-based from the server (BitmapGroupSToC). Kept as sent. */
function readAnimation(r: ByteReader): Animation {
  const type = r.u8();
  switch (type) {
    case ANIMATE.NONE:
      return { type, group: r.u16() };
    case ANIMATE.CYCLE:
      return { type, period: r.u32(), groupLow: r.u16(), groupHigh: r.u16() };
    case ANIMATE.ONCE:
      return { type, period: r.u32(), groupLow: r.u16(), groupHigh: r.u16(), groupFinal: r.u16() };
    default:
      return { type };
  }
}

function readOverlays(r: ByteReader): Overlay[] {
  const n = r.u8();
  const out: Overlay[] = [];
  for (let i = 0; i < n; i++) {
    const iconRes = r.u32();
    const hotspot = r.u8();
    const { translation, effect } = readTranslation(r);
    out.push({ iconRes, hotspot, translation, effect, animation: readAnimation(r) });
  }
  return out;
}

/** server.c ExtractObject. */
export function readObject(r: ByteReader, withLight = true): ObjectInfo {
  const id = r.u32();
  const amount = objTag(id) === CLIENT_TAG_NUMBER ? r.u32() : 0;
  const iconRes = r.u32();
  const nameRes = r.u32();
  const flags = r.u32();
  const drawingType = r.u8();
  const minimapFlags = r.u32();
  const nameColor = r.u32();
  const objectType = r.u8();
  const moveOnType = r.u8();
  let light = { flags: 0, intensity: 0, color: 0 };
  if (withLight) {
    const lf = r.u16();
    light = lf === 0 ? { flags: 0, intensity: 0, color: 0 } : { flags: lf, intensity: r.u8(), color: r.u16() };
  }
  const { translation, effect } = readTranslation(r);
  const animation = readAnimation(r);
  const overlays = readOverlays(r);
  return {
    id, amount, iconRes, nameRes, flags, drawingType, minimapFlags, nameColor,
    objectType, moveOnType, light, translation, effect, animation, overlays,
  };
}

/** server.c ExtractNewRoomObject. */
export function readRoomObject(r: ByteReader): RoomObject {
  const obj = readObject(r);
  const kodRow = r.u16();
  const kodCol = r.u16();
  const angle = r.u16();
  const { translation, effect } = readTranslation(r);
  const animation = readAnimation(r);
  const overlays = readOverlays(r);
  return { ...obj, kodRow, kodCol, angle, motion: { translation, effect, animation, overlays } };
}

export interface PlayerInfo {
  id: number;
  iconRes: number;
  nameRes: number;
  roomId: number;
  roomRes: number;
  roomNameRes: number;
  roomSecurity: number;
  ambientLight: number;
  playerLight: number;
  backgroundRes: number;
  wadingSoundRes: number;
  roomFlags: number;
  depths: [number, number, number];
}

/** BP_PLAYER (server.c HandlePlayer). `roomSecurity` is the .roo checksum the client must match. */
export function readPlayer(r: ByteReader): PlayerInfo {
  return {
    id: r.u32(),
    iconRes: r.u32(),
    nameRes: r.u32(),
    roomId: r.u32(),
    roomRes: r.u32(),
    roomNameRes: r.u32(),
    roomSecurity: r.u32(),
    ambientLight: r.u8(),
    playerLight: r.u8(),
    backgroundRes: r.u32(),
    wadingSoundRes: r.u32(),
    roomFlags: r.u32(),
    depths: [r.u32(), r.u32(), r.u32()],
  };
}

/** BP_ROOM_CONTENTS (server.c HandleRoomContents). */
export function readRoomContents(r: ByteReader): { roomId: number; objects: RoomObject[] } {
  const roomId = r.u32();
  const n = r.u16();
  const objects: RoomObject[] = [];
  for (let i = 0; i < n; i++) objects.push(readRoomObject(r));
  return { roomId, objects };
}

/** BP_MOVE: id, row, col, speed (bit 7 = turn to face). */
export function readMove(r: ByteReader): { id: number; kodRow: number; kodCol: number; speed: number; turnToFace: boolean } {
  const id = r.u32();
  const kodRow = r.u16();
  const kodCol = r.u16();
  const s = r.u8();
  return { id, kodRow, kodCol, speed: s & 0x7f, turnToFace: (s & 0x80) !== 0 };
}

/** BP_CHANGE (server.c HandleChange): an object's new look plus its motion state. */
export function readChange(r: ByteReader): { object: ObjectInfo; motion: RoomObject["motion"] } {
  const object = readObject(r);
  const { translation, effect } = readTranslation(r);
  const animation = readAnimation(r);
  const overlays = readOverlays(r);
  return { object, motion: { translation, effect, animation, overlays } };
}

/** BP_TURN: id, angle. */
export function readTurn(r: ByteReader): { id: number; angle: number } {
  return { id: r.u32(), angle: r.u16() };
}

export interface CharacterSlot {
  id: number;
  name: string;
  /** 1 = the slot still needs character creation (Kod IsFirstTime). */
  flags: number;
}

/** Face parts the creator offers for one gender (module/char char.h FaceInfo). */
export interface FaceParts {
  hair: number[];
  head: number;
  eyes: number[];
  noses: number[];
  mouths: number[];
}

/** A spell or skill the creator offers (char.h Spell / Skill): `id` is the Kod number, not an object. */
export interface CreatorChoice {
  id: number;
  nameRes: number;
  descRes: number;
  cost: number;
  school: number;
}

export interface CharInfo {
  hairTranslations: number[];
  faceTranslations: number[];
  /** [male, female] */
  parts: [FaceParts, FaceParts];
  spells: CreatorChoice[];
  skills: CreatorChoice[];
}

/** BP_CHARINFO (module/char/char.c HandleCharInfo): what the character creator offers. */
export function readCharInfo(r: ByteReader): CharInfo {
  const bytes = () => {
    const n = r.u8();
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(r.u8());
    return out;
  };
  const ids = () => {
    const n = r.i32();
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(r.u32());
    return out;
  };
  const hairTranslations = bytes();
  const faceTranslations = bytes();
  const face = (): FaceParts => {
    const hair = ids();
    const head = r.u32();
    return { hair, head, eyes: ids(), noses: ids(), mouths: ids() };
  };
  const parts: [FaceParts, FaceParts] = [face(), face()];
  const choices = () => {
    const n = r.i32();
    const out: CreatorChoice[] = [];
    for (let i = 0; i < n; i++) out.push({ id: r.i32(), nameRes: r.u32(), descRes: r.u32(), cost: r.i32(), school: r.u8() });
    return out;
  };
  const spells = choices();
  return { hairTranslations, faceTranslations, parts, spells, skills: choices() };
}

/** BP_CHARACTERS (module/char/char.c HandleCharacters). */
export function readCharacters(r: ByteReader): { characters: CharacterSlot[]; motd: string } {
  const n = r.u16();
  const characters: CharacterSlot[] = [];
  for (let i = 0; i < n; i++) characters.push({ id: r.u32(), name: r.string(), flags: r.u8() });
  const motd = r.string();
  return { characters, motd };
}

/** BP_INVENTORY / offers / BP_OFFERED etc. (server.c ExtractObjectList): u16 count, objects. */
export function readObjectList(r: ByteReader): ObjectInfo[] {
  const n = r.u16();
  const out: ObjectInfo[] = [];
  for (let i = 0; i < n; i++) out.push(readObject(r));
  return out;
}

// ---------------------------------------------------------------- stats, spells, skills (module/merintr)

/** Stat kinds (include/proto.h STATS_NUMERIC / STATS_LIST) and numeric tags (STAT_INT / STAT_RES). */
export const STATS = { NUMERIC: 1, LIST: 2 } as const;
export const STAT_TAG = { INT: 1, RES: 2 } as const;
/** Stat groups (module/merintr/stats.h). Group 1 is the main bars (health, mana, vigor). */
export const STAT_GROUP = { MAIN: 1, STATS: 2, SPELLS: 3, SKILLS: 4, QUESTS: 5, INVENTORY: 6 } as const;
/** Enchantment kinds (include/proto.h ENCHANT_*). */
export const ENCHANT = { PLAYER: 1, ROOM: 2 } as const;

export interface Statistic {
  /** Ordinal within the group (1-based). */
  num: number;
  nameRes: number;
  type: number;
  /** STATS_NUMERIC: an integer with limits (tag INT) or a resource string (tag RES). */
  numeric?: { tag: number; value: number; min: number; max: number; currentMax: number };
  /** STATS_LIST: an object (spell, skill) with a value (percent) and icon. */
  list?: { id: number; value: number; icon: number };
}

/** merintr.c ExtractStatistic. */
export function readStatistic(r: ByteReader): Statistic {
  const num = r.u8();
  const nameRes = r.u32();
  const type = r.u8();
  if (type === STATS.NUMERIC) {
    const tag = r.u8();
    const value = r.i32();
    const numeric = { tag, value, min: 0, max: 0, currentMax: 0 };
    if (tag === STAT_TAG.INT) {
      numeric.min = r.i32();
      numeric.max = r.i32();
      numeric.currentMax = r.i32();
    }
    return { num, nameRes, type, numeric };
  }
  if (type === STATS.LIST) return { num, nameRes, type, list: { id: r.u32(), value: r.i32(), icon: r.u32() } };
  throw new Error(`unknown stat type ${type}`);
}

/** BP_STAT: group, one statistic. */
export function readStat(r: ByteReader): { group: number; stat: Statistic } {
  const group = r.u8();
  return { group, stat: readStatistic(r) };
}

/** BP_STAT_GROUP: group, u8 count, statistics. */
export function readStatGroup(r: ByteReader): { group: number; stats: Statistic[] } {
  const group = r.u8();
  const n = r.u8();
  const stats: Statistic[] = [];
  for (let i = 0; i < n; i++) stats.push(readStatistic(r));
  return { group, stats };
}

/** BP_STAT_GROUPS: u8 count, name resources. */
export function readStatGroups(r: ByteReader): number[] {
  const n = r.u8();
  const names: number[] = [];
  for (let i = 0; i < n; i++) names.push(r.u32());
  return names;
}

export interface Spell {
  object: ObjectInfo;
  numTargets: number;
  /** 0-based school (the server sends it 1-based). */
  school: number;
}

/** merintr.c ExtractNewSpell. */
export function readSpell(r: ByteReader): Spell {
  const object = readObject(r);
  const numTargets = r.u8();
  return { object, numTargets, school: r.u8() - 1 };
}

/** BP_SPELLS: u16 count, spells. */
export function readSpells(r: ByteReader): Spell[] {
  const n = r.u16();
  const out: Spell[] = [];
  for (let i = 0; i < n; i++) out.push(readSpell(r));
  return out;
}

/** BP_ADD_ENCHANTMENT: kind, object. */
export function readAddEnchantment(r: ByteReader): { kind: number; object: ObjectInfo } {
  const kind = r.u8();
  return { kind, object: readObject(r) };
}

/** BP_REMOVE_ENCHANTMENT: kind, id. */
export function readRemoveEnchantment(r: ByteReader): { kind: number; id: number } {
  return { kind: r.u8(), id: r.u32() };
}

/** BP_USE_LIST: u16 count, ids of the items in use (wielded, worn). */
export function readUseList(r: ByteReader): number[] {
  const n = r.u16();
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r.u32());
  return out;
}

export const buildSendStatGroups = (): Uint8Array => Uint8Array.of(BP.SEND_STAT_GROUPS);
export const buildSendStats = (group: number): Uint8Array => Uint8Array.of(BP.SEND_STATS, group);
export const buildSendSpells = (): Uint8Array => Uint8Array.of(BP.SEND_SPELLS);
export const buildSendSkills = (): Uint8Array => Uint8Array.of(BP.SEND_SKILLS);
export const buildSendEnchantments = (kind: number): Uint8Array => Uint8Array.of(BP.SEND_ENCHANTMENTS, kind);

// ---------------------------------------------------------------- trade (buy.c, offer.c)

export interface BuyItem {
  object: ObjectInfo;
  cost: number;
}

/** BP_BUY_LIST / BP_WITHDRAWAL_LIST (server.c HandleBuyList): seller, u16 count, (object, u32 cost). */
export function readBuyList(r: ByteReader): { seller: ObjectInfo; items: BuyItem[] } {
  const seller = readObject(r);
  const n = r.u16();
  const items: BuyItem[] = [];
  for (let i = 0; i < n; i++) items.push({ object: readObject(r), cost: r.u32() });
  return { seller, items };
}

/** BP_OFFER (someone offers us items): the offerer, then the object list. */
export function readOffer(r: ByteReader): { offerer: ObjectInfo; items: ObjectInfo[] } {
  const offerer = readObject(r);
  return { offerer, items: readObjectList(r) };
}

/** An object reference in a request (protocol.c PARAM_OBJECT): id, plus the amount for number items. */
export interface ObjectRef {
  id: number;
  amount?: number;
}

function writeObjectList(w: ByteWriter, items: ObjectRef[]): void {
  // protocol.c PARAM_OBJECT_LIST: number items with no amount are left out.
  const sent = items.filter((o) => objTag(o.id) !== CLIENT_TAG_NUMBER || (o.amount ?? 0) > 0);
  w.u16(sent.length);
  for (const o of sent) {
    w.u32(o.id);
    if (objTag(o.id) === CLIENT_TAG_NUMBER) w.u32(o.amount ?? 0);
  }
}

export const buildReqBuy = (seller: number): Uint8Array => new ByteWriter().u8(BP.REQ_BUY).u32(objId(seller)).finish();

export function buildReqBuyItems(seller: number, items: ObjectRef[]): Uint8Array {
  const w = new ByteWriter().u8(BP.REQ_BUY_ITEMS).u32(objId(seller));
  writeObjectList(w, items);
  return w.finish();
}

export const buildReqWithdrawal = (banker: number): Uint8Array => new ByteWriter().u8(BP.REQ_WITHDRAWAL).u32(objId(banker)).finish();

export function buildReqWithdrawalItems(banker: number, items: ObjectRef[]): Uint8Array {
  const w = new ByteWriter().u8(BP.REQ_WITHDRAWAL_ITEMS).u32(objId(banker));
  writeObjectList(w, items);
  return w.finish();
}

export function buildReqDeposit(banker: number, items: ObjectRef[]): Uint8Array {
  const w = new ByteWriter().u8(BP.REQ_DEPOSIT).u32(objId(banker));
  writeObjectList(w, items);
  return w.finish();
}

/** BP_REQ_OFFER: give items to someone (selling to an NPC starts here). */
export function buildReqOffer(target: number, items: ObjectRef[]): Uint8Array {
  const w = new ByteWriter().u8(BP.REQ_OFFER).u32(objId(target));
  writeObjectList(w, items);
  return w.finish();
}

export function buildReqCounteroffer(items: ObjectRef[]): Uint8Array {
  const w = new ByteWriter().u8(BP.REQ_COUNTEROFFER);
  writeObjectList(w, items);
  return w.finish();
}

/** BP_REQ_CAST: spell, target objects. */
export function buildReqCast(spell: number, targets: ObjectRef[]): Uint8Array {
  const w = new ByteWriter().u8(BP.REQ_CAST).u32(objId(spell));
  writeObjectList(w, targets);
  return w.finish();
}

// ---------------------------------------------------------------- combat and effects (milestone 6)

/** include/proto.h ATTACK_NORMAL */
export const ATTACK_NORMAL = 1;

/** BP_REQ_ATTACK: attack kind, target (protocol.c PARAM_ATTACK_INFO, PARAM_ID). */
export function buildReqAttack(target: number, kind = ATTACK_NORMAL): Uint8Array {
  return new ByteWriter().u8(BP.REQ_ATTACK).u8(kind).u32(objId(target)).finish();
}

/** Player overlay hotspots (include/proto.h HOTSPOT_*): where on the screen it's drawn. */
export const HOTSPOT = { NW: 1, N: 2, NE: 3, E: 4, SE: 5, S: 6, SW: 7, W: 8, CENTER: 9 } as const;

/**
 * BP_PLAYER_OVERLAY (server.c HandlePlayerOverlay): i8 hotspot, then an object with no
 * lighting whose id is the overlay slot (1 or 2: weapon hand and shield hand). Hotspot 0
 * hides the slot.
 */
export function readPlayerOverlay(r: ByteReader): { hotspot: number; object: ObjectInfo } {
  const hs = r.u8();
  return { hotspot: hs > 127 ? hs - 256 : hs, object: readObject(r, false) };
}

export interface Shot {
  iconRes: number;
  translation: number;
  animation: Animation;
  source: number;
  /** BP_SHOOT: the target; BP_RADIUS_SHOOT: 0 */
  dest: number;
  /** squares per second */
  speed: number;
  /** PROJ_FLAG_* (1 = follow the ground) */
  flags: number;
  light: { flags: number; intensity: number; color: number };
  /** BP_RADIUS_SHOOT: range in thousands of fine units, and how many in the ring */
  range: number;
  number: number;
}

function readLight(r: ByteReader): Shot["light"] {
  const flags = r.u16();
  return flags === 0 ? { flags: 0, intensity: 0, color: 0 } : { flags, intensity: r.u8(), color: r.u16() };
}

/** BP_SHOOT (server.c HandleShoot): a projectile from one object to another. */
export function readShoot(r: ByteReader): Shot {
  const iconRes = r.u32();
  const { translation } = readTranslation(r);
  const animation = readAnimation(r);
  const source = r.u32();
  const dest = r.u32();
  const speed = r.u8();
  const flags = r.u16();
  return { iconRes, translation, animation, source, dest, speed, flags, light: readLight(r), range: 0, number: 1 };
}

/** BP_RADIUS_SHOOT (server.c HandleRadiusShoot): `number` projectiles in a ring out to `range`. */
export function readRadiusShoot(r: ByteReader): Shot {
  const iconRes = r.u32();
  const { translation } = readTranslation(r);
  const animation = readAnimation(r);
  const source = r.u32();
  const speed = r.u8();
  const flags = r.u16();
  const range = r.u8();
  const number = r.u8();
  return { iconRes, translation, animation, source, dest: 0, speed, flags, light: readLight(r), range, number };
}

/** Screen effects (include/proto.h EFFECT_*). */
export const EFFECT = {
  INVERT: 1, SHAKE: 2, PARALYZE: 3, RELEASE: 4, BLIND: 5, SEE: 6, PAIN: 7, BLUR: 8, RAINING: 9, SNOWING: 10,
  CLEARWEATHER: 11, SAND: 12, CLEARSAND: 13, WAVER: 14, FLASHXLAT: 15, WHITEOUT: 16, XLATOVERRIDE: 17, FIREWORKS: 18,
} as const;

export interface Effect {
  type: number;
  /** milliseconds, for the timed effects */
  duration: number;
  /** FLASHXLAT / XLATOVERRIDE */
  xlat: number;
}

/** BP_EFFECT (effect.c PerformEffect): u16 effect, then parameters by type. */
export function readEffect(r: ByteReader): Effect {
  const type = r.u16();
  const e: Effect = { type, duration: 0, xlat: 0 };
  switch (type) {
    case EFFECT.XLATOVERRIDE:
      e.xlat = r.i32();
      break;
    case EFFECT.INVERT:
    case EFFECT.SHAKE:
    case EFFECT.PAIN:
    case EFFECT.WHITEOUT:
    case EFFECT.BLUR:
    case EFFECT.WAVER:
      e.duration = r.i32();
      break;
    case EFFECT.FLASHXLAT:
      e.duration = r.i32();
      e.xlat = r.i32();
      break;
    default:
      break;
  }
  return e;
}

// ---------------------------------------------------------------- user commands (BP_USERCOMMAND)

/** Some user command types (include/proto.h UC_*). */
export const UC = {
  REST: 5, STAND: 6, REQ_PREFERENCES: 7, SEND_PREFERENCES: 9, RECEIVE_PREFERENCES: 34, DEPOSIT: 35, WITHDRAW: 36, BALANCE: 37,
} as const;

/**
 * The game options the server keeps for each player (include/proto.h CF_*): sent with
 * UC_SEND_PREFERENCES, read back with UC_REQ_PREFERENCES / UC_RECEIVE_PREFERENCES.
 */
export const CF = {
  SAFETY_OFF: 0x0001, TEMPSAFE: 0x0002, GROUPING: 0x0004, AUTOLOOT: 0x0008, AUTOCOMBINE: 0x0010, BAGS: 0x0020, SPELLPOWER: 0x0040,
} as const;

/** BP_USERCOMMAND, the command type, then its int parameters (protocol.c ToServer). */
export function buildUserCommand(uc: number, ...ints: number[]): Uint8Array {
  const w = new ByteWriter().u8(BP.USERCOMMAND).u8(uc);
  for (const v of ints) w.i32(v);
  return w.finish();
}

// ---------------------------------------------------------------- sound (server.c HandlePlayWave etc.)

/** BP_PLAY_WAVE flags (include/proto.h SF_*). */
export const SF = { LOOP: 0x01, RANDOM_PITCH: 0x02, RANDOM_PLACE: 0x04 } as const;

export interface PlayWave {
  resource: number;
  /** Source object (0 = none). */
  object: number;
  flags: number;
  /** 1-based big-grid row/col, 0 = at the player. */
  row: number;
  col: number;
  radius: number;
  maxVolume: number;
}

export function readPlayWave(r: ByteReader): PlayWave {
  return {
    resource: r.u32(), object: r.u32(), flags: r.u8(),
    row: r.i32(), col: r.i32(), radius: r.i32(), maxVolume: r.i32(),
  };
}

export { AP, BP };
