// Ours (docs/adr/0021-factions-and-the-faction-war.md, phase 5): what our client knows of the
// Faction War, from UC_FACTION_WAR (shards-server util/factionwar.kod): the battle for the banner
// (sent to everyone as it's called, opens, ends, and every few seconds of a fight), and all of it
// for the War window (asked for with "war"). Kept from logon, as the arena's is (arenaBouts.ts).

import { useEffect, useState } from "react";
import { WAR_STATE, type FactionWarEvent, type WarBattle, type WarStatus } from "@shards/world";

export class FactionWarStore {
  /** The last of all of it (the War window asks again as it opens) */
  status: WarStatus | null = null;
  /** The battle, and when it came (its seconds count down from then) */
  battle: WarBattle | null = null;
  battleAt = 0;
  statusAt = 0;
  /** Goes up with every change */
  version = 0;
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  handle(e: FactionWarEvent, now = Date.now()): void {
    if (e.type === "all") {
      this.status = e.status;
      this.statusAt = now;
      this.battle = e.status.battle;
    } else {
      this.battle = e.battle;
      if (this.status) this.status = { ...this.status, battle: e.battle };
    }
    this.battleAt = now;
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** The battle's seconds to the clash or left of the fight, now */
  secondsLeft(now = Date.now()): number {
    if (!this.battle || this.battle.state === WAR_STATE.NONE) return 0;
    return Math.max(0, this.battle.secondsLeft - Math.floor((now - this.battleAt) / 1000));
  }

  /** Seconds since all of it came (the last battles' times count up from then) */
  secondsSinceStatus(now = Date.now()): number {
    return Math.max(0, Math.floor((now - this.statusAt) / 1000));
  }

  /** Seconds to the next battle called, now; null when not known */
  nextSeconds(now = Date.now()): number | null {
    if (!this.battle || !this.battle.nextSeconds) return null;
    return Math.max(0, this.battle.nextSeconds - Math.floor((now - this.battleAt) / 1000));
  }
}

/** Re-renders on every change; returns the store's version */
export function useFactionWar(store: FactionWarStore | null): number {
  const [, setVersion] = useState(0);
  useEffect(() => store?.onChange(() => setVersion(store.version)), [store]);
  return store?.version ?? 0;
}

/** Re-renders every second while on (for the countdowns) */
export function useSecondTick(on: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
