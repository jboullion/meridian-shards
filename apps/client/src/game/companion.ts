// Ours (docs/adr/0010-followers.md 9): what our client knows of our companion, from UC_COMPANION
// (shards-server util/companionbook.kod). Kept from logon, before the game view is there to
// listen, as the quest log is (quests.ts). Also the character creator's lists (BP_CHARINFO),
// asked for in game when the companion's looks are edited.

import { useEffect, useState } from "react";
import type { CharInfo } from "@shards/protocol";
import type { CompanionEvent, CompanionStatus } from "@shards/world";

export class CompanionStore {
  status: CompanionStatus | null = null;
  /** The character creator's lists, once asked for (session.requestCharInfo) */
  charInfo: CharInfo | null = null;
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

  handle(e: CompanionEvent): void {
    if (e.type === "none") this.status = null;
    else if (e.type === "status") this.status = e.status;
    else if (this.status) this.status = { ...this.status, hp: e.hp, maxHp: e.maxHp };
    this.changed();
  }

  setCharInfo(info: CharInfo): void {
    this.charInfo = info;
    this.changed();
  }
}

/** Re-renders on every change; returns the store's version */
export function useCompanion(store: CompanionStore | null): number {
  const [, setVersion] = useState(0);
  useEffect(() => store?.onChange(() => setVersion(store.version)), [store]);
  return store?.version ?? 0;
}
