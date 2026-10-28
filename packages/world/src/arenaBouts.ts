// Ours (docs/adr/0019-arena-bouts.md): mock bouts in the arenas, as our server tells us (UC_ARENA,
// shards-server util/arenabouts.kod SendStatus), and the commands we send back (UC_SHARDS
// "arena ..."). The bouts are real fights on our server against its ArenaFighters; the gateway's
// show of NPCs (arena/) only gives up the floor while one is fought.

import { objId, type ByteReader } from "@shards/protocol";

/** The arenas with mock bouts (ARENA_KRAANAN, ARENA_DEATH in blakston.khd); 0 is neither */
export const ARENA = { NONE: 0, KRAANAN: 1, DEATH: 2 } as const;
export type ArenaId = (typeof ARENA)[keyof typeof ARENA];

/** Their rooms, by file */
export const ARENA_ROOMS: Readonly<Record<string, ArenaId>> = { "tosarena.roo": ARENA.KRAANAN, "tosarena_death.roo": ARENA.DEATH };

/** A bout's state, or ours in the status (QUEUED: waiting in line); ENDING: its player beaten, a moment before it ends */
export const BOUT_STATE = { IDLE: 0, QUEUED: 1, COUNTDOWN: 2, FIGHTING: 3, ENDING: 4 } as const;
export type BoutState = (typeof BOUT_STATE)[keyof typeof BOUT_STATE];

/** How our last bout ended (0: we haven't just fought one) */
export const BOUT_END = { NONE: 0, WON: 1, BEATEN: 2, FLED: 3, TIME: 4, CANCELLED: 5 } as const;
export type BoutEnd = (typeof BOUT_END)[keyof typeof BOUT_END];

/** Status flags */
export const ARENA_FLAG = { PVP_BUSY: 1 } as const;

/** The kinds of fighter (ARENA_FIGHTER_* in blakston.khd) */
export const ARENA_FIGHTER = { WARRIOR: 1, QOR: 2, FAREN: 3, RIIJA: 4, BRAWLER: 5, ADEPT: 6 } as const;

export interface ArenaOpponent {
  /** Its object, 0 once it's fallen */
  id: number;
  name: string;
  /** "a battle mage of Qor" */
  kindName: string;
  kind: number;
  hp: number;
  maxHp: number;
}

export interface BoutRecord {
  wins: number;
  losses: number;
  streak: number;
  best: number;
}

export interface ArenaStatus {
  /** The arena we're standing in */
  arena: ArenaId;
  /** Ours: idle, in line, or in the bout */
  state: BoutState;
  /** Our place in line (1 is next), 0 when not in it */
  place: number;
  queueLength: number;
  /** The floor's bout, ours or someone else's */
  floor: BoutState;
  /** Seconds left of its countdown or its fight */
  secondsLeft: number;
  flags: number;
  /** Who is fighting it (an object in our room), 0 for nobody */
  boutPlayer: number;
  opponents: ArenaOpponent[];
  /** The Arena of Kraanan's mock bouts, then the Arena of Death's */
  records: [BoutRecord, BoutRecord];
  /** From our mock wins in both */
  title: string;
  rank: number;
  /** How our bout ended, in the status sent as it ends */
  ended: BoutEnd;
}

/** UC_ARENA's body (after the UC byte) */
export function readArena(r: ByteReader, resource: (id: number) => string | null | undefined): ArenaStatus | null {
  if (r.u8() !== 1) return null;
  const arena = r.u8() as ArenaId;
  const state = r.u8() as BoutState;
  const place = r.u8();
  const queueLength = r.u8();
  const floor = r.u8() as BoutState;
  const secondsLeft = r.u16();
  const flags = r.u8();
  const boutPlayer = objId(r.u32());
  const opponents: ArenaOpponent[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const id = objId(r.u32());
    const name = resource(r.u32()) ?? "Fighter";
    const kindName = resource(r.u32()) ?? "";
    opponents.push({ id, name, kindName, kind: r.u8(), hp: r.u16(), maxHp: r.u16() });
  }
  const record = (): BoutRecord => ({ wins: r.u16(), losses: r.u16(), streak: r.u16(), best: r.u16() });
  const records: [BoutRecord, BoutRecord] = [record(), record()];
  const title = resource(r.u32()) ?? "";
  const rank = r.u8();
  const ended = r.u8() as BoutEnd;
  return { arena, state, place, queueLength, floor, secondsLeft, flags, boutPlayer, opponents, records, title, rank, ended };
}

/** Whether a bout holds the floor (the gateway's fighters give way to it) */
export function floorTaken(s: ArenaStatus | null): boolean {
  return !!s && s.floor !== BOUT_STATE.IDLE;
}

/** The watcher's match commands our Arena window gives (arenabouts.kod PlayerMatch, watcher.kod ArenaCommand) */
export const ARENA_PVP_WORDS = ["traditional", "lastman", "guild", "royale", "champion", "challenge", "accept", "renege"] as const;
export type ArenaPvpWord = (typeof ARENA_PVP_WORDS)[number];

export function arenaCommand(what: "status" | "join" | "leave" | { pvp: ArenaPvpWord }): string {
  return typeof what === "string" ? `arena ${what}` : `arena pvp ${what.pvp}`;
}

/** What our last bout's end says, for the window */
export function boutEndText(e: BoutEnd): string {
  switch (e) {
    case BOUT_END.WON:
      return "You won the bout.";
    case BOUT_END.BEATEN:
      return "You were beaten.";
    case BOUT_END.FLED:
      return "You left the bout, and lost it.";
    case BOUT_END.TIME:
      return "Time ran out, and the bout went against you.";
    case BOUT_END.CANCELLED:
      return "The bout was called off.";
    default:
      return "";
  }
}
