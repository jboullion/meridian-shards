// The admin dashboard's calls: the dev server's /__admin endpoints (tools/dev/adminApi.ts),
// recipes on the maintenance port built from them, and the HMR link to the game tabs.

import { useEffect, useState } from "react";
import type { DevState, GameReport } from "../game/devBridge.ts";

export type { DevState, GameReport };

/** Ours: the admin test room (shards-server room/provgrnd.kod) */
export const PROVING_GROUNDS_RID = 4300;

export interface CatalogEntry {
  className: string;
  name: string;
  icon: string | null;
}
export interface ItemEntry extends CatalogEntry {
  stack: boolean;
}
export interface SpellEntry extends CatalogEntry {
  sid: number;
}
export interface Catalog {
  monsters: CatalogEntry[];
  items: ItemEntry[];
  spells: SpellEntry[];
}

async function post<T>(url: string, data: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", body: JSON.stringify(data) });
  const out = (await res.json()) as T & { error?: string };
  if (!res.ok || out.error) throw new Error(out.error ?? `${url}: HTTP ${res.status}`);
  return out;
}

/** Commands on the maintenance port, in order; each one's output */
export async function maint(...commands: string[]): Promise<string[]> {
  return (await post<{ outputs: string[] }>("/__admin/maint", { commands })).outputs;
}

export const returnedObject = (out: string): number | null => (/^: OBJECT (\d+)/m.exec(out) ? Number(/^: OBJECT (\d+)/m.exec(out)![1]) : null);
export const returnedInt = (out: string): number | null => (/^: INT (-?\d+)/m.exec(out) ? Number(/^: INT (-?\d+)/m.exec(out)![1]) : null);

export async function loadCatalog(): Promise<Catalog> {
  const res = await fetch("/__admin/catalog");
  const out = (await res.json()) as Catalog & { error?: string };
  if (out.error) throw new Error(out.error);
  return out;
}

export const buildKod = () => post<{ ok: boolean; tail: string }>("/__admin/kod/build");

/** A fast travel point (shards-server util/travelnet.kod GetPoints), as tools/dev/travelPoints.ts reads it */
export interface TravelPoint {
  id: string;
  name: string;
  ridName: string;
  rid: number | null;
  row: number;
  col: number;
  arrivalRow: number;
  arrivalCol: number;
  angle: string;
  fineRow: number | null;
  fineCol: number | null;
  /** A historic portal's other end, by its name resource (GetHistoricLinks) */
  leadsTo?: string;
}
export interface TravelHere {
  rid: number;
  row: number;
  col: number;
  angle: string;
  /** The room's travel points (the museum has five) */
  points: TravelPoint[];
}
export const travelHere = (playerId: number) => post<TravelHere>("/__admin/travel/here", { playerId });
/** Moves one of the room's portals, or its arrival square and facing, to where the player stands */
export const travelMove = (playerId: number, id: string, part: "portal" | "arrival") =>
  post<{ point: TravelPoint; steps: string[] }>("/__admin/travel/move", { playerId, id, part });
export const saveTuning = (values: DevState["tuning"]) => post<{ written: string[] }>("/__admin/tuning/save", { values });

/** The room object for a room number (object numbers change at every save, so always asked) */
export async function findRoom(rid: number): Promise<number> {
  const [out] = await maint(`send object 0 FindRoomByNum num int ${rid}`);
  const room = returnedObject(out ?? "");
  if (room === null) throw new Error(`RID ${rid} isn't loaded on the server`);
  return room;
}

/** A Proving Grounds helper (provgrnd.kod): SpawnMonster, ClearMonsters, ClearItems, ResetDummies; what it returned */
export async function provingGrounds(message: string, args = ""): Promise<number | null> {
  const room = await findRoom(PROVING_GROUNDS_RID);
  const [out] = await maint(`send object ${room} ${message}${args ? ` ${args}` : ""}`);
  return returnedInt(out ?? "");
}

/** Monsters of a class on the square beside us, wherever we are; how many were made */
export async function spawnBeside(className: string, me: GameReport, count: number): Promise<number> {
  const [owner] = await maint(`send object ${me.playerId} GetOwner`);
  const room = returnedObject(owner ?? "");
  if (room === null) throw new Error("Couldn't find the room we're in");
  let made = 0;
  for (let i = 0; i < count; i++) {
    const [created] = await maint(`create object ${className}`);
    const id = /Created object (\d+)/.exec(created ?? "")?.[1];
    if (!id) throw new Error(`create object ${className}: ${created}`);
    await maint(
      `send object ${id} SetDontDispose`,
      `send object ${room} NewHold what object ${id} new_row int ${me.row} new_col int ${me.col + 1} fine_row int ${8 + ((i * 13) % 48)} fine_col int ${8 + ((i * 29) % 48)}`,
    );
    made++;
  }
  return made;
}

/** An item into a player's inventory (a number item as `amount` of them) */
export async function giveItem(className: string, playerId: number, amount: number, stack: boolean): Promise<void> {
  const [created] = await maint(stack ? `create object ${className} number int ${Math.max(1, amount)}` : `create object ${className}`);
  const id = /Created object (\d+)/.exec(created ?? "")?.[1];
  if (!id) throw new Error(`create object ${className}: ${created}`);
  await maint(`send object ${playerId} NewHold what object ${id}`);
}

/** A spell cast by `caster` at `target` (claude-testbench mcp_blakserv.py t_cast's recipe) */
export async function castSpell(sid: number, caster: number, target: number, power: number): Promise<string> {
  const [found] = await maint(`send object 0 FindSpellByNum num int ${sid}`);
  const spell = returnedObject(found ?? "");
  if (spell === null) throw new Error(`No spell ${sid} on the server`);
  const [list] = await maint(`create listnode object ${target} nil 0`);
  const node = /Created list node (\d+)/i.exec(list ?? "")?.[1];
  if (!node) throw new Error(`create listnode: ${list}`);
  const [out] = await maint(`send object ${spell} CastSpell who object ${caster} lTargets list ${node} iSpellPower int ${power}`);
  return out ?? "";
}

/** The objects in the room we're in: id and class, from `show object` on the room's active list */
export async function objectsHere(me: GameReport): Promise<{ id: number; className: string }[]> {
  const [owner] = await maint(`send object ${me.playerId} GetOwner`);
  const room = returnedObject(owner ?? "");
  if (room === null) return [];
  const [active] = await maint(`send object ${room} GetHolderActive`);
  const list = /^: LIST (\d+)/m.exec(active ?? "")?.[1];
  if (!list) return [];
  const [shown] = await maint(`show list ${list}`);
  const ids = [...new Set([...(shown ?? "").matchAll(/OBJECT (\d+)/g)].map((m) => Number(m[1])))].filter((id) => id !== me.playerId);
  const classes = await maint(...ids.map((id) => `show object ${id}`));
  return ids.map((id, i) => ({ id, className: /CLASS (\w+)/.exec(classes[i] ?? "")?.[1] ?? "?" }));
}

// ---------------------------------------------------------------- the game tabs, over Vite's HMR socket

export function useDevLink(): { state: DevState; game: GameReport | null; set: (s: Partial<DevState>) => void } {
  const [state, setState] = useState<DevState>({ tuning: {}, scene: {} });
  const [game, setGame] = useState<GameReport | null>(null);
  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;
    const onState = (s: DevState) => setState(s);
    const onGame = (g: GameReport) => setGame(g);
    hot.on("shards:state", onState);
    hot.on("shards:game", onGame);
    hot.send("shards:dash-hello", {});
    return () => {
      hot.off("shards:state", onState);
      hot.off("shards:game", onGame);
    };
  }, []);
  const set = (s: Partial<DevState>) => {
    setState((old) => ({ ...old, ...s }));
    import.meta.hot?.send("shards:set", s);
  };
  return { state, game, set };
}

// ---------------------------------------------------------------- quests (tools/dev/questApi.ts)

export type NpcRef = { class: string } | { placed: string };

/** A quest as its file in shards-server quests/ holds it (tools/quests/schema.ts Quest) */
export type QuestTierName = "main" | "story" | "errand";

export type SchoolName = "shalille" | "qor" | "kraanan" | "faren" | "riija" | "jala";
export type InsigniaName = SchoolName | "duke" | "princess" | "rebel";
export type FactionName = "neutral" | "duke" | "princess" | "rebel" | "any";

export interface QuestRewardsFile {
  xp?: number;
  /** More XP: worth this many points of health at the quest's band minimum */
  xpPoints?: number;
  shillings?: number;
  trainingPoints?: number;
  items?: { class: string; count?: number; school?: SchoolName }[];
  oneOf?: { class: string; count?: number; school?: SchoolName }[];
  joinFaction?: "duke" | "princess" | "rebel";
  insignia?: InsigniaName;
  /** Renown with the player's faction, 1 to 100 (ADR 0021) */
  renown?: number;
  /** War effort for the player's liege's next battle, 1 to 4 (ADR 0021) */
  warEffort?: number;
  /** Prestige for the player's guild, 1 to 20 (ADR 0022) */
  prestige?: number;
}

export interface QuestFile {
  id: number;
  key: string;
  name: string;
  tier?: QuestTierName;
  replaces?: string[];
  /** Left out only for a quest taken from the guild window (start "guild") */
  giver?: NpcRef;
  band: { min: number; max: number };
  requires?: {
    quests?: number[];
    notQuests?: number[];
    /** Offered only while base health is under this (tools/quests/schema.ts) */
    healthBelow?: number;
    karmaMin?: number | null;
    karmaMax?: number | null;
    faction?: FactionName;
    intriguing?: boolean;
    guildMaster?: boolean;
    guildShield?: boolean;
    noGuild?: boolean;
    /** In any guild (ADR 0022) */
    inGuild?: boolean;
  };
  repeat?: { cooldownHours: number } | null;
  timeLimitMinutes?: number | null;
  /** Not offered for now; one going can be finished (tools/quests/schema.ts) */
  paused?: boolean;
  /** "death": starts by itself on a death, never from its giver. "guild": taken from the guild window, with no giver */
  start?: "death" | "guild";
  text: { offer: string; progress?: string; complete: string };
  steps: QuestStepFile[];
  rewards: QuestRewardsFile;
}

export interface QuestStepFile {
  kind: "kill" | "collect" | "talk" | "deliver" | "visit" | "cast" | "deposit" | "stash" | "buy" | "equip" | "health" | "hometown" | "nodes" | "companion" | "convey" | "learn" | "attune" | "arena" | "train" | "node" | "claim" | "battle" | "siege" | "fallen" | "shrine";
  auto?: boolean;
  rewards?: QuestRewardsFile;
  spell?: string;
  with?: string;
  amount?: number;
  items?: string[];
  /** learn: skill classes */
  skills?: string[];
  /** learn: spell classes, the same way */
  spells?: string[];
  /** attune: the travel point */
  point?: number;
  /** node: the mana node's NODE_ constant */
  node?: string;
  /** arena: whose mock bouts count, and whether only a bout won does (docs/adr/0019-arena-bouts.md) */
  arena?: "kraanan" | "death";
  win?: boolean;
  against?: "duke" | "princess" | "rebel";
  /** fallen: the Fallen Hall, as its RID_ name or number (ADR 0022) */
  hall?: string | number;
  /** shrine: the offering's school; left out, any (docs/adr/0027) */
  school?: "shalille" | "qor" | "kraanan" | "faren" | "riija" | "jala";
  objective?: string;
  brief?: string;
  target?: string;
  exact?: boolean;
  /** kill: only kills in the step's rooms count */
  inRooms?: boolean;
  item?: string;
  count?: number;
  rooms?: (string | number)[];
  exclude?: (string | number)[];
  parcel?: string;
  turnin?: NpcRef;
}

export interface GiverFile {
  key: string;
  id: number;
  name: string;
  look: string;
  rid: string | number;
  row: number;
  col: number;
  fineRow?: number;
  fineCol?: number;
  angle: string;
  desc?: string;
  /** Ours (docs/adr/0012-cosmetics.md): it also cuts hair or dyes clothes */
  service?: "tailor" | "barber";
}

export interface QuestNpc {
  className: string;
  name: string;
  icon: string | null;
  rooms: { rid: number; name: string }[];
}

export interface QuestList {
  quests: QuestFile[];
  givers: GiverFile[];
  retired: number[];
  errors: string[];
  /** Each step's area on the map (room names), by quest id */
  areas: Record<number, string[][]>;
  nextId: number;
  npcs: QuestNpc[];
  rooms: { rid: number; name: string; ridName: string | null }[];
}

export interface PlayerQuests {
  log: { id: number; step: number; count: number; deadline: number }[];
  done: { id: number; times: number; last: number }[];
}

export async function loadQuests(): Promise<QuestList> {
  const res = await fetch("/__admin/quests");
  const out = (await res.json()) as QuestList & { error?: string };
  if (out.error) throw new Error(out.error);
  return out;
}
export const saveQuest = (quest: QuestFile, apply: boolean) => post<{ id: number; steps: string[] }>("/__admin/quests/save", { quest, apply });
export const retireQuest = (id: number) => post<{ steps: string[] }>("/__admin/quests/retire", { id });
export const applyQuests = () => post<{ steps: string[] }>("/__admin/quests/apply");
/** A placed giver changed; with place, moved to where the player stands (a new one must be placed) */
export const saveGiver = (giver: Partial<GiverFile> & { key: string }, playerId?: number, place = false) =>
  post<{ giver: GiverFile; steps: string[] }>("/__admin/quests/giver", { giver, playerId, place });
export const deleteGiver = (key: string) => post<{ steps: string[] }>("/__admin/quests/giver/delete", { key });
/** QuestBook's admin messages on a player: state, grant, step, finish, complete, reset, resetAll */
export const questPlayer = (playerId: number, action: string, id?: number, step?: number) => post<PlayerQuests>("/__admin/quests/player", { playerId, action, id, step });

/** A player's companion as tools/dev/companionApi.ts reports it (util/companionbook.kod AdminState); state 0 is none */
export interface PlayerCompanion {
  state: number;
  kind: number;
  bond: number;
  tier: number;
  hp: number;
  maxHp: number;
  rid: number;
  pack: number;
}
export const companionPlayer = (playerId: number, action: string, extra: { kind?: number; points?: number } = {}) =>
  post<PlayerCompanion>("/__admin/companions/player", { playerId, action, ...extra });

// ---------------------------------------------------------------- sprites (tools/dev/spriteApi.ts)

export interface SpriteEntry {
  name: string;
  size: number;
  hash: string;
  /** A copy of ours in shards-server's resource/graphics/shards */
  override: boolean;
  /** A classic copy a revert brings back */
  original: boolean;
}
export interface SpriteStyles {
  hair: string[];
  beard: string[];
  hairColours: { name: string; id: number }[];
}

export async function loadSprites(): Promise<SpriteEntry[]> {
  const res = await fetch("/__admin/sprites/list");
  const out = (await res.json()) as SpriteEntry[] | { error: string };
  if (!Array.isArray(out)) throw new Error(out.error);
  return out;
}
/** A .bgf's bytes as dist/assets has them now (never cached) */
export async function spriteBytes(name: string): Promise<Uint8Array> {
  const res = await fetch(`/__admin/sprites/file?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
  return new Uint8Array(await res.arrayBuffer());
}
export async function loadSpriteStyles(): Promise<SpriteStyles> {
  const res = await fetch("/__admin/sprites/registered");
  const out = (await res.json()) as SpriteStyles & { error?: string };
  if (out.error) throw new Error(out.error);
  return out;
}
export function saveSprite(name: string, data: Uint8Array): Promise<{ hash: string; backup: string | null; path: string }> {
  let bin = "";
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return post("/__admin/sprites/save", { name, data: btoa(bin) });
}
export const revertSprite = (name: string) => post<{ hash: string; backup: string }>("/__admin/sprites/revert", { name });
export const registerStyle = (kind: "hair" | "beard", file: string, label: string) =>
  post<{ resource: string; ok: boolean; tail: string; steps: string[] }>("/__admin/sprites/register", { kind, file, label });

// ---------------------------------------------------------------- music and sounds (tools/dev/audioApi.ts)

export interface AudioUse {
  /** "kod": a class's resource in shards-server; "client": named in this repository's client */
  where: "kod" | "client";
  path: string;
  /** The room's or object's name, else its class */
  label: string;
  resource?: string;
  /** A room's music */
  music?: boolean;
}
export interface AudioFile {
  name: string;
  kind: "music" | "sound" | "ambient";
  size: number;
  hash: string;
  seconds: number | null;
  /** The game track's XMI in resource/audio/xmi */
  xmi: string | null;
  /** Ours: the piece in tools/music/pieces */
  piece: string | null;
  users: AudioUse[];
}
export interface PieceInfo {
  name: string;
  file: string;
  title: string;
  about: string;
  bars: number;
  seconds: number;
  parts: string[];
  error?: string;
}
export interface AudioList {
  files: AudioFile[];
  pieces: PieceInfo[];
  banks: string[];
}

export async function loadAudio(): Promise<AudioList> {
  const res = await fetch("/__admin/audio/list");
  const out = (await res.json()) as AudioList & { error?: string };
  if (out.error) throw new Error(out.error);
  return out;
}
/** A game track's XMI rendered as written: its OGG's and MIDI's URLs */
export const renderOriginal = (name: string, bank: string) => post<{ url: string; midi: string; seconds: number }>("/__admin/audio/original", { name, bank });
/** Builds one of our pieces and puts it in dist/assets (game tabs fetch it anew) */
export const buildPiece = (name: string) => post<{ file: string; seconds: number; hash: string; log: string }>("/__admin/audio/piece/build", { name });
/** Plays a track in the game tabs in place of the room's (null: the room's again) */
export function musicInGame(file: string | null): void {
  import.meta.hot?.send("shards:music", { file });
}
/** Plays a sound in the game tabs */
export function soundInGame(file: string): void {
  import.meta.hot?.send("shards:sound", { file });
}
