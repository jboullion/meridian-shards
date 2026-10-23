// Ours (docs/adr/0021-factions-and-the-faction-war.md, phase 5): the Faction War as our server
// tells us (UC_FACTION_WAR, shards-server util/factionwar.kod SendWar and SendBattle), for the
// War window and the battle banner, and the command that asks for it (UC_SHARDS "war").

import type { ByteReader } from "@shards/protocol";

/** The lieges (FACTION_* in blakston.khd); NEUTRAL is nobody's */
export const FACTION = { NEUTRAL: 0, DUKE: 1, PRINCESS: 2, REBEL: 3 } as const;

export const LIEGE_NAMES: Readonly<Record<number, string>> = {
  [FACTION.DUKE]: "Duke Akardius",
  [FACTION.PRINCESS]: "Princess Kateriina",
  [FACTION.REBEL]: "Jonas D'Accor",
};

/** Short, for the banner and the map */
export const LIEGE_SHORT: Readonly<Record<number, string>> = {
  [FACTION.NEUTRAL]: "No liege",
  [FACTION.DUKE]: "the Duke",
  [FACTION.PRINCESS]: "the Princess",
  [FACTION.REBEL]: "Jonas",
};

/** A battle's state (STATE_* in factionwar.kod) */
export const WAR_STATE = { NONE: 0, MUSTER: 1, FIGHT: 2 } as const;
export type WarState = (typeof WAR_STATE)[keyof typeof WAR_STATE];

/** The battle's flags */
export const BATTLE_FLAG = { SIEGE: 1, SPAWNED: 2, OPEN_GROUND: 4 } as const;

/** How a battle was decided (HOW_* in factionwar.kod) */
export const BATTLE_HOW = { FIELD: 1, TIME: 2, UNWATCHED: 3 } as const;

/** A flag room's flags */
export const POLE_FLAG = { TOWN: 1, HALF_STAFF: 2, BATTLE: 4 } as const;

/** Our flags */
export const SOLDIER_FLAG = { SHIELD: 1, REGROUPING: 2 } as const;

export interface WarBattle {
  state: WarState;
  attacker: number;
  defender: number;
  flags: number;
  rid: number;
  room: string;
  /** To the clash (muster) or left of the fight, when it was sent */
  secondsLeft: number;
  attackersLeft: number;
  defendersLeft: number;
  attackersRaised: number;
  defendersRaised: number;
  /** To the next battle called, when it was sent; 0 when not known */
  nextSeconds: number;
}

export interface WarPole {
  rid: number;
  name: string;
  owner: number;
  flags: number;
}

export interface WarTown {
  rid: number;
  name: string;
  owner: number;
  /** The liege celebrating there, or NEUTRAL */
  celebrating: number;
}

export interface WarHistoryEntry {
  rid: number;
  name: string;
  attacker: number;
  defender: number;
  winner: number;
  how: number;
  secondsAgo: number;
}

export interface LedgerEntry {
  name: string;
  rank: string;
  kills: number;
  won: number;
  fought: number;
}

export interface WarStatus {
  faction: number;
  renown: number;
  rank: string;
  kills: number;
  deaths: number;
  fought: number;
  won: number;
  flags: number;
  battle: WarBattle;
  /** War effort for the Duke, the Princess, Jonas */
  effort: [number, number, number];
  poles: WarPole[];
  towns: WarTown[];
  history: WarHistoryEntry[];
  ledger: LedgerEntry[];
}

export type FactionWarEvent = { type: "all"; status: WarStatus } | { type: "battle"; battle: WarBattle };

function readBattle(r: ByteReader): WarBattle {
  return {
    state: r.u8() as WarState,
    attacker: r.u8(),
    defender: r.u8(),
    flags: r.u8(),
    rid: r.u32(),
    room: r.string(),
    secondsLeft: r.u16(),
    attackersLeft: r.u8(),
    defendersLeft: r.u8(),
    attackersRaised: r.u8(),
    defendersRaised: r.u8(),
    nextSeconds: r.u32(),
  };
}

/** UC_FACTION_WAR's body (after the UC byte) */
export function readFactionWar(r: ByteReader): FactionWarEvent | null {
  const kind = r.u8();
  if (kind === 2) return { type: "battle", battle: readBattle(r) };
  if (kind !== 1) return null;
  const faction = r.u8();
  const renown = r.u8();
  const rank = r.string();
  const kills = r.u16();
  const deaths = r.u16();
  const fought = r.u16();
  const won = r.u16();
  const flags = r.u8();
  const battle = readBattle(r);
  const effort: [number, number, number] = [r.u8(), r.u8(), r.u8()];
  const poles: WarPole[] = [];
  for (let n = r.u8(); n > 0; n--) poles.push({ rid: r.u32(), name: r.string(), owner: r.u8(), flags: r.u8() });
  const towns: WarTown[] = [];
  for (let n = r.u8(); n > 0; n--) towns.push({ rid: r.u32(), name: r.string(), owner: r.u8(), celebrating: r.u8() });
  const history: WarHistoryEntry[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const rid = r.u32();
    const name = r.string();
    history.push({ rid, name, attacker: r.u8(), defender: r.u8(), winner: r.u8(), how: r.u8(), secondsAgo: r.u32() });
  }
  const ledger: LedgerEntry[] = [];
  for (let n = r.u8(); n > 0; n--) ledger.push({ name: r.string(), rank: r.string(), kills: r.u16(), won: r.u16(), fought: r.u16() });
  return { type: "all", status: { faction, renown, rank, kills, deaths, fought, won, flags, battle, effort, poles, towns, history, ledger } };
}

export function warCommand(): string {
  return "war";
}

/**
 * Where a flag room sits on the realm's grid of outdoor rooms: their RIDs are 500 + 10 times the
 * column's letter (A is 1) + the row (RID_D4 = 544), and the towns and Raza's are placed by
 * hand, beside their capture points. null for a room off the grid.
 */
export function gridCell(rid: number): { col: number; row: number } | null {
  const TOWNS: Record<number, { col: number; row: number }> = {
    50: { col: 9, row: 5 }, // Tos, by H5, H6, I6
    101: { col: 9, row: 2 }, // North Barloque, above H3, I3, J3
    150: { col: 7, row: 3 }, // Cor Noth, above G4, G5
    200: { col: 2, row: 4 }, // Marion, left of C4, C5
    300: { col: 11, row: 5 }, // Raza, east
    330: { col: 10, row: 6 }, // the Raza forest
    331: { col: 10, row: 5 }, // west of Farol
    382: { col: 5, row: 8 }, // Jasper, by D7, E7, F8
    550: { col: 5, row: 6 }, // the D6/E6 room
  };
  if (TOWNS[rid]) return TOWNS[rid];
  if (rid < 511 || rid > 619) return null;
  const col = Math.floor((rid - 500) / 10);
  const row = (rid - 500) % 10;
  return row >= 1 && row <= 9 && col >= 1 && col <= 11 ? { col, row } : null;
}

/** "D4" for a grid room, "" otherwise */
export function gridName(rid: number): string {
  if (rid < 511 || rid > 619) return "";
  const col = Math.floor((rid - 500) / 10);
  const row = (rid - 500) % 10;
  return row >= 1 && col >= 1 && col <= 11 ? `${String.fromCharCode(64 + col)}${row}` : "";
}
