// Ours (docs/adr/0022-guilds.md decisions 30 and 32): the Fallen Halls as our server tells us
// (UC_FALLEN_HALLS, shards-server util/fallenhalls.kod SendHalls), for the guild window, and the
// commands that ask for them and take a hall's daily quest. The guild window's own quests come as
// UC_QUEST_OFFERS with no NPC (QuestBook.SendBoard): the session's "board" quest event.

import type { ByteReader } from "@shards/protocol";

/** A hall's state (FallenHall STATE_* in fallenhall.kod) */
export const HALL_STATE = { READY: 0, HELD: 1, SANCTUM: 2, CLEARED: 3 } as const;

/** A daily quest's state for us (QuestBook.BoardState) */
export const DAILY_STATE = { NOT_OFFERED: 0, OFFERED: 1, TAKEN: 2, DONE: 3 } as const;

export interface FallenHall {
  rid: number;
  /** 1 (the Den of Shadows) to 8 (the Wetland Fortress) */
  rank: number;
  /** The base health its daily quest asks */
  minHealth: number;
  name: string;
  /** Where its door is ("the Lake of Jala's Song") */
  door: string;
  state: number;
  /** Who cleared it since the reset: a guild's name, else a player's; "" for nobody */
  clearedBy: string;
  /** Its daily quest's id (0: none), its state for us, and the seconds until it's offered again, when it was sent */
  dailyQuest: number;
  dailyState: number;
  dailySeconds: number;
}

export interface FallenHallsStatus {
  /** To the next reset (a Meridian day, two real hours), when it was sent */
  resetSeconds: number;
  halls: FallenHall[];
}

/** UC_FALLEN_HALLS's body (after the UC byte) */
export function readFallenHalls(r: ByteReader): FallenHallsStatus {
  const resetSeconds = r.u32();
  const halls: FallenHall[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const rid = r.u32();
    const rank = r.u8();
    const minHealth = r.u16();
    const name = r.string();
    const door = r.string();
    const state = r.u8();
    const clearedBy = r.string();
    halls.push({ rid, rank, minHealth, name, door, state, clearedBy, dailyQuest: r.u32(), dailyState: r.u8(), dailySeconds: r.u32() });
  }
  return { resetSeconds, halls };
}

/** A rank as the halls show it: I to VIII */
export function rankNumeral(rank: number): string {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][rank] ?? String(rank);
}

/** How a hall stands, in a few words */
export function hallStateText(h: FallenHall): string {
  if (h.state === HALL_STATE.CLEARED) return h.clearedBy ? `Cleared by ${h.clearedBy}` : "Cleared";
  if (h.state === HALL_STATE.SANCTUM) return "Its sanctum is open";
  return "Held by the Order";
}

export const hallsCommand = (): string => "halls";
export const boardCommand = (): string => "quest board";
export const boardAcceptCommand = (id: number): string => `quest board-accept ${id}`;
