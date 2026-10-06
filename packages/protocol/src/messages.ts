// Builders for client -> server messages and parsers for server -> client ones.
// Formats follow clientd3d/protocol.c (client tables), blakserv/sprocket.c (how the
// server parses them) and clientd3d/server.c (how the client reads replies).

import { ByteReader, ByteWriter } from "./bytes.ts";
import { AP, ANIMATE, BP, CLIENT_MAJOR, CLIENT_MINOR, CLIENT_TAG_NUMBER, objTag } from "./constants.ts";

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
  return new ByteWriter().u8(BP.REQ_TURN).u32(id).u16(angle).finish();
}

/** Say types (include/proto.h SAY_*). */
export const SAY = { NORMAL: 1, YELL: 2, EVERYONE: 3, GROUP: 4, RESOURCE: 5, EMOTE: 6, MESSAGE: 7, DM: 9, GUILD: 10 } as const;

export function buildSay(text: string, info: number = SAY.NORMAL): Uint8Array {
  return new ByteWriter().u8(BP.SAY_TO).u8(info).string(text).finish();
}

export function buildReqLook(id: number): Uint8Array {
  return new ByteWriter().u8(BP.REQ_LOOK).u32(id).finish();
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

export interface CharacterSlot {
  id: number;
  name: string;
  /** 1 = the slot still needs character creation (Kod IsFirstTime). */
  flags: number;
}

/** BP_CHARACTERS (module/char/char.c HandleCharacters). */
export function readCharacters(r: ByteReader): { characters: CharacterSlot[]; motd: string } {
  const n = r.u16();
  const characters: CharacterSlot[] = [];
  for (let i = 0; i < n; i++) characters.push({ id: r.u32(), name: r.string(), flags: r.u8() });
  const motd = r.string();
  return { characters, motd };
}

export { AP, BP };
