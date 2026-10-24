// Ours (docs/adr/0022-guilds.md decision 32): what our client knows of the Fallen Halls, from
// UC_FALLEN_HALLS (shards-server util/fallenhalls.kod: asked for with "halls" as the guild window
// opens, and sent to every guild member whenever a hall changes), and the guild window's own
// quests (the board: UC_QUEST_OFFERS with no NPC, asked for with "quest board"). Kept from logon,
// as the Faction War's is (factionWar.ts); the countdowns run from when each came.

import { useEffect, useState } from "react";
import type { FallenHall, FallenHallsStatus, QuestOffer } from "@shards/world";

export class FallenHallsStore {
  status: FallenHallsStatus | null = null;
  statusAt = 0;
  /** The board's quests we may take now (QO_OFFER or QO_SOON) */
  board: QuestOffer[] | null = null;
  /** Goes up with every change */
  version = 0;
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  handle(s: FallenHallsStatus, now = Date.now()): void {
    this.status = s;
    this.statusAt = now;
    this.changed();
  }

  handleBoard(offers: QuestOffer[]): void {
    this.board = offers;
    this.changed();
  }

  private since(now: number): number {
    return Math.floor((now - this.statusAt) / 1000);
  }

  /** Seconds to the halls' reset, now */
  resetSeconds(now = Date.now()): number {
    return this.status ? Math.max(0, this.status.resetSeconds - this.since(now)) : 0;
  }

  /** Seconds until a done daily is offered again, now */
  dailySeconds(h: FallenHall, now = Date.now()): number {
    return Math.max(0, h.dailySeconds - this.since(now));
  }

  /** Every hall's daily quest id: the Guild Quests tab lists the board's others */
  dailyIds(): Set<number> {
    return new Set((this.status?.halls ?? []).map((h) => h.dailyQuest).filter((id) => id > 0));
  }
}

/** Re-renders on every change; returns the store's version */
export function useFallenHalls(store: FallenHallsStore | null): number {
  const [, setVersion] = useState(0);
  useEffect(() => store?.onChange(() => setVersion(store.version)), [store]);
  return store?.version ?? 0;
}
