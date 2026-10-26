// Ours (docs/adr/0025-achievements.md): what our client knows of the character's achievements, from
// UC_ACHIEVEMENTS (shards-server util/achievements.kod), and the catalogue of them: the server only
// says which ids are earned and when; the names, descriptions and icons are achievements.json
// (apps/client/tables, served with the game's files; clientTables.ts loads it). Kept from logon.

import { useEffect, useState } from "react";
import type { AchievementsEvent } from "@shards/world";

/** One of the catalogue's categories ("Bosses", "Factions", ...) */
export type AchievementCategory = string;

export interface AchievementInfo {
  /** The server's ACH_* id (blakston.khd); a boss's is its guild trophy's */
  id: number;
  category: AchievementCategory;
  name: string;
  description: string;
  /** The game's own picture: a .bgf, as its monster draws it; none: the game's logo */
  sprite?: string;
  /** The title it adds to the character's look, when it adds one */
  title?: string;
}

/** achievements.json: the categories in the window's order, and every achievement */
export interface AchievementsTable {
  categories: AchievementCategory[];
  achievements: AchievementInfo[];
}

let table: AchievementsTable = { categories: [], achievements: [] };
let byId = new Map<number, AchievementInfo>();

/** The catalogue, from the game's files (clientTables.ts) */
export function setAchievementsTable(t: AchievementsTable): void {
  table = t;
  byId = new Map(t.achievements.map((a) => [a.id, a]));
}

/** The categories, in the window's order */
export const achievementCategories = (): readonly AchievementCategory[] => table.categories;

/** Every achievement, in the window's order */
export const achievementList = (): readonly AchievementInfo[] => table.achievements;

export const achievementInfo = (id: number): AchievementInfo | undefined => byId.get(id);

/** How long a toast stays up, ms */
export const TOAST_MS = 5000;

export class AchievementsStore {
  /** id -> when it was earned, ms since the epoch */
  earned = new Map<number, number>();
  /** Whether the server has sent the list yet */
  loaded = false;
  /** Just earned and not yet shown, oldest first */
  toasts: number[] = [];
  /** Goes up with every change */
  version = 0;
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  handle(e: AchievementsEvent, nowMs = Date.now()): void {
    if (e.type === "all") {
      this.earned = new Map(e.earned.map((a) => [a.id, nowMs - Math.max(0, e.now - a.when) * 1000]));
      this.loaded = true;
    } else if (!this.earned.has(e.id)) {
      this.earned.set(e.id, nowMs);
      if (achievementInfo(e.id)) this.toasts.push(e.id);
    }
    this.changed();
  }

  /** The toast on screen has had its time */
  shiftToast(): void {
    this.toasts.shift();
    this.changed();
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** How many of the catalogue are earned */
  count(): number {
    let n = 0;
    for (const a of table.achievements) if (this.earned.has(a.id)) n++;
    return n;
  }
}

/** Re-renders on every change; returns the store's version */
export function useAchievements(store: AchievementsStore | null): number {
  const [, setVersion] = useState(0);
  useEffect(() => store?.onChange(() => setVersion(store.version)), [store]);
  return store?.version ?? 0;
}
