// Ours (docs/adr/0019-arena-bouts.md): what our client knows of the arena's mock bouts, from
// UC_ARENA (shards-server util/arenabouts.kod): where we stand in them, the floor's bout and our
// records. Kept from logon, as the companion is (companion.ts).

import { useEffect, useState } from "react";
import type { ArenaStatus } from "@shards/world";

export class ArenaStore {
  status: ArenaStatus | null = null;
  /** Goes up with every change */
  version = 0;
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  handle(s: ArenaStatus): void {
    // The end of our bout comes once; later statuses keep saying how it went until we join again
    const ended = (s.ended || (this.status && s.state === 0 ? this.status.ended : 0)) as ArenaStatus["ended"];
    this.status = { ...s, ended };
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

/** Re-renders on every change; returns the store's version */
export function useArena(store: ArenaStore | null): number {
  const [, setVersion] = useState(0);
  useEffect(() => store?.onChange(() => setVersion(store.version)), [store]);
  return store?.version ?? 0;
}
