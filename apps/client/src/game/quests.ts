// Ours (docs/adr/0009-quests.md 3, 4): what our client knows of our quests. The server sends only
// ids and numbers (UC_QUEST_LOG, UC_QUEST_PROGRESS: session.ts QuestEvent); the names, stories and
// objectives are in the catalogue (dist/assets/quests.json). The log carries the catalogue's hash:
// when it isn't ours, the catalogue is fetched again (the dashboard changed the quests), and if it
// still isn't, the game data is out of date and the page must reload.
//
// Which quests the tracker shows (up to TRACK_MAX) is ours alone, kept in localStorage.

import { useEffect, useState } from "react";
import { EMPTY_CATALOG, questById, type CatalogQuest, type QuestCatalog, type QuestEvent, type QuestLogEntry } from "@shards/world";

export const TRACK_MAX = 3;

const TRACK_KEY = "shards.quests.tracked";

export interface CatalogSource {
  questCatalog(): Promise<QuestCatalog>;
  /** Reads the manifest again, forgetting changed files */
  refresh(): Promise<string[]>;
}

export interface ActiveQuest extends QuestLogEntry {
  quest: CatalogQuest | undefined;
}

export class QuestStore {
  catalog: QuestCatalog = EMPTY_CATALOG;
  active: QuestLogEntry[] = [];
  done: { id: number; times: number }[] = [];
  /** The server's quests aren't the catalogue we have, even fetched again: reload the page */
  stale = false;
  /** When the log arrived (performance.now()), for its seconds left */
  private logAt = 0;
  private tracked: number[] = [];
  private listeners = new Set<() => void>();
  private refreshing: Promise<void> | null = null;
  private readonly source: CatalogSource;
  /** Says a line in the chat: a step's brief as the quest moves on to it */
  private readonly say: (text: string) => void;

  constructor(source: CatalogSource, say: (text: string) => void = () => {}) {
    this.source = source;
    this.say = say;
    try {
      this.tracked = (JSON.parse(localStorage.getItem(TRACK_KEY) ?? "[]") as number[]).filter(Number.isInteger);
    } catch {
      this.tracked = [];
    }
    void this.loadCatalog(false);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Goes up with every change, for what's worked out from the quests (questWays.ts) */
  version = 0;

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  async loadCatalog(refresh: boolean): Promise<void> {
    try {
      if (refresh) await this.source.refresh();
      this.catalog = await this.source.questCatalog();
    } catch (e) {
      console.warn("quests.json:", e);
    }
    this.changed();
  }

  handle(e: QuestEvent): void {
    if (e.type === "log") {
      const before = new Set(this.active.map((a) => a.id));
      const stepWas = new Map(this.active.map((a) => [a.id, a.step]));
      const first = this.logAt === 0;
      this.active = e.active;
      this.done = e.done;
      this.logAt = performance.now();
      // A quest just taken on is tracked, while there's room (not the ones we had at logon: the
      // tracker kept what we chose)
      if (!first) for (const a of e.active) if (!before.has(a.id) && this.tracked.length < TRACK_MAX && !this.tracked.includes(a.id)) this.tracked.push(a.id);
      // A quest moved on to a step (often by itself, the guide chains' travel and actions): its brief, as the old guide quests said theirs
      if (!first)
        for (const a of e.active) {
          const was = stepWas.get(a.id);
          const brief = was !== undefined && a.step > was ? this.quest(a.id)?.steps[a.step - 1]?.brief : undefined;
          if (brief) this.say(`${this.quest(a.id)!.name}: ${brief}`);
        }
      this.tracked = this.tracked.filter((id) => e.active.some((a) => a.id === id));
      this.saveTracked();
      if (e.hash && e.hash !== this.catalog.hash) void this.catchUp(e.hash);
      this.changed();
    } else if (e.type === "progress") {
      this.active = this.active.map((a) => (a.id === e.id ? { ...a, step: e.step, count: e.count } : a));
      this.changed();
    }
  }

  /** The server has other quests than our catalogue: fetch it again, once at a time */
  private catchUp(hash: number): void {
    this.refreshing ??= this.loadCatalog(true).finally(() => {
      this.refreshing = null;
      this.stale = this.catalog.hash !== hash;
      this.changed();
    });
  }

  quest(id: number): CatalogQuest | undefined {
    return questById(this.catalog, id);
  }

  activeQuests(): ActiveQuest[] {
    return this.active.map((a) => ({ ...a, quest: this.quest(a.id) }));
  }

  /** Seconds left on a quest now, or -1 for no limit */
  secondsLeft(a: QuestLogEntry): number {
    if (a.secondsLeft < 0) return -1;
    return Math.max(0, a.secondsLeft - Math.floor((performance.now() - this.logAt) / 1000));
  }

  isTracked(id: number): boolean {
    return this.tracked.includes(id);
  }

  trackedQuests(): ActiveQuest[] {
    return this.activeQuests().filter((a) => this.tracked.includes(a.id));
  }

  /** Tracks a quest (dropping the oldest past TRACK_MAX), or stops */
  setTracked(id: number, on: boolean): void {
    this.tracked = this.tracked.filter((x) => x !== id);
    if (on) this.tracked = [...this.tracked, id].slice(-TRACK_MAX);
    this.saveTracked();
    this.changed();
  }

  private saveTracked(): void {
    try {
      localStorage.setItem(TRACK_KEY, JSON.stringify(this.tracked));
    } catch {
      // Not kept: the tracker starts over next time
    }
  }
}

/** Re-render whenever the quests change */
export function useQuests(store: QuestStore | null): number {
  const [v, setV] = useState(0);
  useEffect(() => store?.onChange(() => setV((n) => n + 1)), [store]);
  return v;
}
