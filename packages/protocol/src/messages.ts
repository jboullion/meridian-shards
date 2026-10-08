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

/** BP_LOOK flags (include/proto.h DF_*): the description box is shown, and editable. */
export const DF = { EDITABLE: 0x01, INSCRIBED: 0x02 } as const;

/** BP_CHANGE_DESCRIPTION: a new inscription or player description (dialog.c IDOK RequestChangeDescription). */
export function buildChangeDescription(id: number, text: string): Uint8Array {
  return new ByteWriter().u8(BP.CHANGE_DESCRIPTION).u32(objId(id)).string(text).finish();
}

/**
 * protocol.c PARAM_OBJECT: the id with its number-item tag, then the amount for number items
 * (BP_REQ_DROP, BP_REQ_GET_FROM_CONTAINER, BP_REQ_PUT).
 */
function writeObject(w: ByteWriter, id: number, amount?: number): ByteWriter {
  w.u32(id);
  if (amount !== undefined) w.u32(amount);
  return w;
}

/** BP_SEND_OBJECT_CONTENTS: what's inside a container (RequestObjectContents); BP_OBJECT_CONTENTS answers. */
export function buildReqObjectContents(id: number): Uint8Array {
  return new ByteWriter().u8(BP.SEND_OBJECT_CONTENTS).u32(objId(id)).finish();
}

/** BP_REQ_GET_FROM_CONTAINER: take something out of a container (RequestPickupFromContainer). */
export function buildReqGetFromContainer(id: number, amount?: number): Uint8Array {
  return writeObject(new ByteWriter().u8(BP.REQ_GET_FROM_CONTAINER), id, amount).finish();
}

/** BP_REQ_PUT: put an inventory item (and how many) into a container (RequestPut). */
export function buildReqPut(id: number, amount: number | undefined, container: number): Uint8Array {
  return writeObject(new ByteWriter().u8(BP.REQ_PUT), id, amount).u32(objId(container)).finish();
}

/** BP_REQ_APPLY: use one object on another (gameuser.c ApplyCallback RequestApply). */
export function buildReqApply(item: number, target: number): Uint8Array {
  return new ByteWriter().u8(BP.REQ_APPLY).u32(objId(item)).u32(objId(target)).finish();
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
export function readAnimation(r: ByteReader): Animation {
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

/**
 * A background overlay, the sun or the moon (boverlay.h BackgroundOverlay): drawn on the sky at
 * `angle` (client angle units, east = 0) and `height` pixels above the horizon.
 */
export interface BgOverlay {
  id: number;
  iconRes: number;
  nameRes: number;
  translation: number;
  effect: number;
  animation: Animation;
  angle: number;
  /** As the client reads it, a WORD: Kod's negative heights (below the horizon) come out above 32767 */
  height: number;
}

/** server.c ExtractNewBackgroundOverlay (BP_ADD_BG_OVERLAY, BP_CHANGE_BG_OVERLAY). */
export function readBgOverlay(r: ByteReader): BgOverlay {
  const id = r.u32();
  const iconRes = r.u32();
  const nameRes = r.u32();
  const { translation, effect } = readTranslation(r);
  const animation = readAnimation(r);
  return { id, iconRes, nameRes, translation, effect, animation, angle: r.u16(), height: r.u16() };
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
  SEND_QUIT: 1, LOOK_PLAYER: 2, CHANGE_URL: 3, SPELL_SCHOOLS: 4, REST: 5, STAND: 6, REQ_PREFERENCES: 7, SUICIDE: 8, SEND_PREFERENCES: 9,
  REQ_GUILDINFO: 10, GUILDINFO: 11, INVITE: 12, EXILE: 13, RENOUNCE: 14, ABDICATE: 15, VOTE: 16, SET_RANK: 17, GUILD_ASK: 18,
  GUILD_CREATE: 19, DISBAND: 20, REQ_GUILD_LIST: 21, GUILD_LIST: 22, MAKE_ALLIANCE: 23, END_ALLIANCE: 24, MAKE_ENEMY: 25,
  END_ENEMY: 26, GUILD_HALLS: 27, ABANDON_GUILD_HALL: 28, GUILD_RENT: 29, GUILD_SET_PASSWORD: 30, GUILD_SHIELD: 31,
  GUILD_SHIELDS: 32, CLAIM_SHIELD: 33, RECEIVE_PREFERENCES: 34, DEPOSIT: 35, WITHDRAW: 36, BALANCE: 37, APPEAL: 40,
  REQ_RESCUE: 41, MINIGAME_START: 45, MINIGAME_STATE: 46, MINIGAME_MOVE: 47, MINIGAME_PLAYER: 48, MINIGAME_RESET_PLAYERS: 49,
  REQ_TIME: 60,
} as const;

/** UC_APPEAL: a message to the game's staff (merintr.h RequestAppeal). */
export function buildAppeal(text: string): Uint8Array {
  return new ByteWriter().u8(BP.USERCOMMAND).u8(UC.APPEAL).string(text).finish();
}

/** command.c user actions for BP_ACTION (UA_*): moods change your face, the rest animate you. */
export const UA = { NORMAL: 1, HAPPY: 2, SAD: 3, WRY: 4, WAVE: 8, POINT: 9, DANCE: 10 } as const;

/** BP_ACTION (protocol.h RequestAction): one UA_* byte. */
export const buildAction = (action: number): Uint8Array => Uint8Array.of(BP.ACTION, action);

/** BP_SAY_BLOCKED (msgfiltr.c): we hid a tell from this ignored player. */
export const buildSayBlocked = (id: number): Uint8Array => new ByteWriter().u8(BP.SAY_BLOCKED).u32(objId(id)).finish();

/** BP_CHANGE_PASSWORD (maindlg.c PasswordDialogProc): the old and the new password's digests (passwordDigest). */
export function buildChangePassword(oldDigest: Uint8Array, newDigest: Uint8Array): Uint8Array {
  return new ByteWriter().u8(BP.CHANGE_PASSWORD).string(oldDigest).string(newDigest).finish();
}

/** BP_REQ_INVENTORY_MOVE (inventry.c): move the first item to where the second is. */
export function buildReqInventoryMove(id: number, before: number): Uint8Array {
  return new ByteWriter().u8(BP.REQ_INVENTORY_MOVE).u32(objId(id)).u32(objId(before)).finish();
}

/**
 * The game options the server keeps for each player (include/proto.h CF_*): sent with
 * UC_SEND_PREFERENCES, read back with UC_REQ_PREFERENCES / UC_RECEIVE_PREFERENCES.
 */
export const CF = {
  SAFETY_OFF: 0x0001, TEMPSAFE: 0x0002, GROUPING: 0x0004, AUTOLOOT: 0x0008, AUTOCOMBINE: 0x0010, BAGS: 0x0020, SPELLPOWER: 0x0040,
} as const;

/** UC_CHANGE_URL: a player's web page (dialog.c IDOK RequestChangeURL). */
export function buildChangeUrl(id: number, url: string): Uint8Array {
  return new ByteWriter().u8(BP.USERCOMMAND).u8(UC.CHANGE_URL).u32(objId(id)).string(url).finish();
}

/** BP_USERCOMMAND, the command type, then its int parameters (protocol.c ToServer). */
export function buildUserCommand(uc: number, ...ints: number[]): Uint8Array {
  const w = new ByteWriter().u8(BP.USERCOMMAND).u8(uc);
  for (const v of ints) w.i32(v);
  return w.finish();
}

// ---------------------------------------------------------------- room changes (server.c, roomanim.c)

/** Room animation actions when a wall's animation ends (include/proto.h RA_*). */
export const RA = { NONE: 0, PASSABLE_END: 1, IMPASSABLE_END: 2, INVISIBLE_END: 3 } as const;
/** BP_CHANGE_TEXTURE: which textures to change (include/proto.h CTF_*). */
export const CTF = { ABOVEWALL: 0x01, NORMALWALL: 0x02, BELOWWALL: 0x04, FLOOR: 0x08, CEILING: 0x10, RESET: 0x20 } as const;
/** BP_SECTOR_LIGHT (include/proto.h SL_*). */
export const SL = { FLICKER_ON: 1, FLICKER_OFF: 2 } as const;
/** BP_SECTOR_CHANGE: leave this value as it is (roomanim.h CHANGE_OVERRIDE). */
export const CHANGE_OVERRIDE = 4;

/**
 * A change the server makes to the room you're in. Walls and sectors are named by their
 * server id (the .roo's `serverId`); every wall or sector with that id changes.
 */
export type RoomChange =
  /** BP_SECTOR_MOVE (HandleSectorMove): a floor or ceiling to `height` (Kod units), at `speed` (Kod units/s; 0 = at once) */
  | { type: "sectorMove"; animation: number; sector: number; height: number; speed: number }
  /** BP_WALL_ANIMATE (HandleWallAnimate): show a wall's bitmap groups; `action` (RA_*) when it ends */
  | { type: "wallAnimate"; wall: number; animation: Animation; action: number }
  /** BP_SECTOR_ANIMATE (HandleSectorAnimate): likewise for floors and ceilings */
  | { type: "sectorAnimate"; sector: number; animation: Animation; action: number }
  /** BP_SECTOR_CHANGE (HandleSectorChange): depth and scroll speed, or CHANGE_OVERRIDE to keep */
  | { type: "sectorChange"; sector: number; depth: number; scroll: number }
  /** BP_CHANGE_TEXTURE (HandleChangeTexture): new grid texture on the parts named by `flags` (CTF_*) */
  | { type: "changeTexture"; id: number; texture: number; flags: number }
  /** BP_SECTOR_LIGHT (HandleSectorLight): flicker on or off (SL_*) */
  | { type: "sectorLight"; sector: number; light: number };

/** Reads one of the room-change messages, or null if `type` isn't one. */
export function readRoomChange(type: number, r: ByteReader): RoomChange | null {
  switch (type) {
    case BP.SECTOR_MOVE:
      return { type: "sectorMove", animation: r.u8(), sector: r.u16(), height: r.u16(), speed: r.u8() };
    case BP.WALL_ANIMATE:
      return { type: "wallAnimate", wall: r.u16(), animation: readAnimation(r), action: r.u8() };
    case BP.SECTOR_ANIMATE:
      return { type: "sectorAnimate", sector: r.u16(), animation: readAnimation(r), action: r.u8() };
    case BP.SECTOR_CHANGE:
      return { type: "sectorChange", sector: r.u16(), depth: r.u8(), scroll: r.u8() };
    case BP.CHANGE_TEXTURE:
      return { type: "changeTexture", id: r.u16(), texture: r.u16(), flags: r.u8() };
    case BP.SECTOR_LIGHT:
      return { type: "sectorLight", sector: r.u16(), light: r.u8() };
    default:
      return null;
  }
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

// ---------------------------------------------------------------- mail and news (module/mailnews)

/** news.h NEWS_READ, NEWS_POST: what BP_LOOK_NEWSGROUP lets us do */
export const NEWS = { READ: 0x01, POST: 0x02 } as const;

/**
 * BP_LOOK_NEWSGROUP (mailnews.c HandleLookNewsgroup): the newsgroup's id, our permissions
 * and the globe; its description follows as a server message (format resource and
 * parameters), which the caller formats.
 */
export function readLookNewsgroup(r: ByteReader): { newsgroup: number; permission: number; object: ObjectInfo } {
  const newsgroup = r.u16();
  const permission = r.u8();
  return { newsgroup, permission, object: readObject(r) };
}

export interface NewsArticle {
  /** The article's number in its newsgroup */
  num: number;
  /** Server time (see mailnews.c DateFromSeconds) */
  time: number;
  poster: string;
  title: string;
}

/** BP_ARTICLES (HandleArticles): one part of a newsgroup's index. */
export function readArticles(r: ByteReader): { newsgroup: number; part: number; maxPart: number; articles: NewsArticle[] } {
  const newsgroup = r.u16();
  const part = r.u8();
  const maxPart = r.u8();
  const n = r.u16();
  const articles: NewsArticle[] = [];
  for (let i = 0; i < n; i++) articles.push({ num: r.u32(), time: r.u32(), poster: r.string(), title: r.string() });
  return { newsgroup, part, maxPart, articles };
}

/**
 * BP_MAIL (HandleMail): one message, its index on the server, who sent it, when, and to
 * whom; the text follows as a server message, which the caller formats. No recipients
 * means there's no more mail.
 */
export function readMailHeader(r: ByteReader): { index: number; sender: string; time: number; recipients: string[] } {
  const index = r.u32();
  const sender = r.string();
  const time = r.u32();
  const n = r.u16();
  const recipients: string[] = [];
  for (let i = 0; i < n; i++) recipients.push(r.string());
  return { index, sender, time, recipients };
}

/** BP_LOOKUP_NAMES (HandleLookupNames): the recipients' object ids, 0 for a name that isn't a player. */
export function readLookupNames(r: ByteReader): number[] {
  const n = r.u16();
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(r.u32());
  return ids;
}

export const buildReqGetMail = (): Uint8Array => Uint8Array.of(BP.REQ_GET_MAIL);

/** BP_DELETE_MAIL: the server may forget the message (we've kept it) */
export const buildDeleteMail = (index: number): Uint8Array => new ByteWriter().u8(BP.DELETE_MAIL).u32(objId(index)).finish();

/** BP_SEND_MAIL (mailsend.c MailRecipientsReceived): PARAM_ID_ARRAY, then "Subject: ...\n" and the text */
export function buildSendMail(ids: readonly number[], text: string): Uint8Array {
  const w = new ByteWriter().u8(BP.SEND_MAIL).u16(ids.length);
  for (const id of ids) w.u32(id);
  return w.string(text).finish();
}

/** BP_REQ_LOOKUP_NAMES: how many names, then the names separated by commas */
export const buildReqLookupNames = (names: readonly string[]): Uint8Array =>
  new ByteWriter().u8(BP.REQ_LOOKUP_NAMES).u16(names.length).string(names.join(",")).finish();

export const buildReqArticles = (newsgroup: number): Uint8Array => new ByteWriter().u8(BP.REQ_ARTICLES).u16(newsgroup).finish();

export const buildReqArticle = (newsgroup: number, num: number): Uint8Array =>
  new ByteWriter().u8(BP.REQ_ARTICLE).u16(newsgroup).u32(objId(num)).finish();

export const buildPostArticle = (newsgroup: number, title: string, text: string): Uint8Array =>
  new ByteWriter().u8(BP.POST_ARTICLE).u16(newsgroup).string(title).string(text).finish();

export const buildDeleteNews = (newsgroup: number, num: number): Uint8Array =>
  new ByteWriter().u8(BP.DELETE_NEWS).u16(newsgroup).u32(objId(num)).finish();

// ---------------------------------------------------------------- stat reallocation (module/stats)

/**
 * BP_REQ_STAT_CHANGE (Kod BP_STAT_CHANGE, stats.c HandleStatChangeRequest): our six stats
 * (might, intellect, stamina, agility, mysticism, aim) and eight school levels (Shal'ille,
 * Qor, Kraanan, Faren, Riija, Jala, Weaponcraft, Crafting).
 */
export function readStatChange(r: ByteReader): { stats: number[]; levels: number[] } {
  const stats = Array.from({ length: 6 }, () => r.u8());
  const levels = Array.from({ length: 8 }, () => r.u8());
  return { stats, levels };
}

/** BP_CHANGED_STATS (stats.h SendNewCharInfo): the new stats and levels, a byte each */
export function buildChangedStats(stats: readonly number[], levels: readonly number[]): Uint8Array {
  return Uint8Array.of(BP.CHANGED_STATS, ...stats.slice(0, 6), ...levels.slice(0, 8));
}

// ---------------------------------------------------------------- guilds (merintr.c, guild*.c)

/** guild.h GC_*: what our rank lets us do in the guild */
export const GC = {
  INVITE: 0x1, EXILE: 0x2, RENOUNCE: 0x4, VOTE: 0x20, ABDICATE: 0x40, MAKE_ALLIANCE: 0x100, END_ALLIANCE: 0x200,
  DECLARE_ENEMY: 0x400, END_ENEMY: 0x800, SET_RANK: 0x1000, DISBAND: 0x2000, ABANDON: 0x4000,
} as const;

/** guild.h GUILD_MALE, GUILD_FEMALE */
export const GUILD_GENDER = { MALE: 1, FEMALE: 2 } as const;

export interface GuildMember {
  id: number;
  name: string;
  /** 1 (lowest) to 5 */
  rank: number;
  gender: number;
}

export interface GuildInfo {
  name: string;
  /** The guild hall's password, or null without a hall */
  password: string | null;
  flags: number;
  guildId: number;
  /** Rank names, lowest first */
  maleRanks: string[];
  femaleRanks: string[];
  /** Who we support for guildmaster (0 for nobody) */
  currentVote: number;
  members: GuildMember[];
}

/** UC_GUILDINFO (merintr.c HandleGuildInfo), after the command byte */
export function readGuildInfo(r: ByteReader): GuildInfo {
  const name = r.string();
  const password = r.u8() ? r.string() : null;
  const flags = r.u32();
  const guildId = r.u32();
  const maleRanks: string[] = [];
  const femaleRanks: string[] = [];
  for (let i = 0; i < 5; i++) {
    maleRanks.push(r.string());
    femaleRanks.push(r.string());
  }
  const currentVote = r.u32();
  const n = r.u16();
  const members: GuildMember[] = [];
  for (let i = 0; i < n; i++) members.push({ id: r.u32(), name: r.string(), rank: r.u8(), gender: r.u8() });
  return { name, password, flags, guildId, maleRanks, femaleRanks, currentVote, members };
}

/** UC_GUILD_LIST (HandleGuildList): every guild, then the ids of our allies and enemies, and who counts us as theirs */
export function readGuildList(r: ByteReader): {
  guilds: { id: number; name: string }[];
  allies: number[];
  enemies: number[];
  otherAllies: number[];
  otherEnemies: number[];
} {
  const n = r.u16();
  const guilds: { id: number; name: string }[] = [];
  for (let i = 0; i < n; i++) guilds.push({ id: r.u32(), name: r.string() });
  const ids = () => Array.from({ length: r.u16() }, () => r.u32());
  return { guilds, allies: ids(), enemies: ids(), otherAllies: ids(), otherEnemies: ids() };
}

/** UC_GUILD_SHIELD (HandleGuildShield): who has these colours and this pattern (0 for nobody) */
export function readGuildShield(r: ByteReader): { id: number; name: string; color1: number; color2: number; pattern: number } {
  return { id: r.u32(), name: r.string(), color1: r.u8(), color2: r.u8(), pattern: r.u8() };
}

/** UC_GUILD_SHIELDS (HandleGuildShields): the shield patterns' pictures */
export function readGuildShields(r: ByteReader): number[] {
  return Array.from({ length: r.u16() }, () => r.u32());
}

/** UC_GUILD_HALLS (HandleGuildHalls): the halls for rent */
export function readGuildHalls(r: ByteReader): { id: number; nameRes: number; cost: number; rent: number }[] {
  return Array.from({ length: r.u16() }, () => ({ id: r.u32(), nameRes: r.u32(), cost: r.i32(), rent: r.i32() }));
}

const userCommand = (uc: number) => new ByteWriter().u8(BP.USERCOMMAND).u8(uc);

/** UC_INVITE, UC_EXILE, UC_ABDICATE, UC_VOTE, alliances and enemies: a command naming one object */
export const buildGuildObjectCommand = (uc: number, id: number): Uint8Array => userCommand(uc).u32(objId(id)).finish();

/** UC_SET_RANK: the member and their new rank (1..5) */
export const buildSetRank = (id: number, rank: number): Uint8Array => userCommand(UC.SET_RANK).u32(objId(id)).u8(rank).finish();

/** UC_GUILD_CREATE (guildbuy.c): the name, the rank names (male then female, lowest first) and the secret flag */
export function buildGuildCreate(name: string, maleRanks: readonly string[], femaleRanks: readonly string[], secret: boolean): Uint8Array {
  const w = userCommand(UC.GUILD_CREATE).string(name);
  for (let i = 0; i < 5; i++) w.string(maleRanks[i] ?? "").string(femaleRanks[i] ?? "");
  return w.u8(secret ? 1 : 0).finish();
}

/** UC_CLAIM_SHIELD (guildshi.c): colours and pattern; claim false only asks who has it */
export const buildClaimShield = (color1: number, color2: number, pattern: number, claim: boolean): Uint8Array =>
  userCommand(UC.CLAIM_SHIELD).u8(color1).u8(color2).u8(pattern).u8(claim ? 1 : 0).finish();

/** UC_GUILD_RENT (guildhal.c): a hall and its password */
export const buildGuildRent = (hall: number, password: string): Uint8Array => userCommand(UC.GUILD_RENT).u32(objId(hall)).string(password).finish();

/** UC_GUILD_SET_PASSWORD (guildmtr.c) */
export const buildGuildPassword = (password: string): Uint8Array => userCommand(UC.GUILD_SET_PASSWORD).string(password).finish();
