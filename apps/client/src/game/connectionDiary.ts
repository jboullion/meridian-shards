// Why a connection dropped (ours). The server hangs up a session it hasn't heard from for 30 minutes
// (blakserv.cfg [Inactive] Game; game.c GameProcessSessionTimer). The page pings every 5 s from
// a worker (pingWorker.ts), so silence means the page itself stopped: hidden on a phone, frozen in
// the background by the browser, or the computer asleep. The diary keeps the page's hidden,
// frozen and silent spells, logs them to the console, and keeps the last ones in localStorage
// (`meridian.connectionDiary`) so a disconnect can still be read after a reload.

export type DiaryKind = "hidden" | "visible" | "frozen" | "resumed" | "gap" | "closed";

export interface DiaryEntry {
  /** Date.now(): wall time, so a sleeping computer shows as a gap */
  at: number;
  kind: DiaryKind;
  /** For a gap, its length in ms */
  ms?: number;
}

/** Ticks are 5 s apart: one this late means the page didn't run in between */
export const GAP_MS = 10_000;
const KEEP = 40;
const STORE_KEY = "meridian.connectionDiary";

export class ConnectionDiary {
  entries: DiaryEntry[] = [];
  private lastTick = 0;
  private hiddenAt: number | null = null;
  private readonly store: Pick<Storage, "getItem" | "setItem"> | null;

  constructor(store: Pick<Storage, "getItem" | "setItem"> | null = null) {
    this.store = store;
    try {
      const old = store?.getItem(STORE_KEY);
      if (old) this.entries = JSON.parse(old) as DiaryEntry[];
    } catch {
      // a fresh diary then
    }
  }

  /** A new connection: its ticks start afresh */
  restart(): void {
    this.lastTick = 0;
  }

  /** The ping worker's tick */
  tick(now = Date.now()): void {
    if (this.lastTick && now - this.lastTick >= GAP_MS) this.add({ at: now, kind: "gap", ms: now - this.lastTick });
    this.lastTick = now;
  }

  note(kind: Exclude<DiaryKind, "gap">, now = Date.now()): void {
    if (kind === "hidden") this.hiddenAt = now;
    else if (kind === "visible") this.hiddenAt = null;
    this.add({ at: now, kind });
  }

  /**
   * Said with "Disconnected from the server." when the page went quiet in the last few minutes:
   * the longest gap, and whether the page was hidden. Null when nothing points at the page.
   */
  explain(now = Date.now()): string | null {
    const recent = this.entries.filter((e) => now - e.at < 5 * 60_000);
    // A page waking up may hear the socket close before its next tick: the silence so far counts
    const silent = this.lastTick ? now - this.lastTick : 0;
    const longest = Math.max(silent, ...recent.filter((e) => e.kind === "gap").map((e) => e.ms ?? 0));
    let hiddenFor = this.hiddenAt === null ? 0 : now - this.hiddenAt;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i]!.kind === "visible" && recent[i - 1]!.kind === "hidden") hiddenFor = Math.max(hiddenFor, recent[i]!.at - recent[i - 1]!.at);
    }
    if (longest < 60_000 && hiddenFor < 60_000) return null;
    const secs = Math.round(Math.max(longest, hiddenFor) / 1000);
    return hiddenFor >= 60_000
      ? `The game was in the background, and the browser paused it for ${secs} s, so the server stopped hearing from it.`
      : `The page stopped running for ${secs} s (the computer asleep, or the browser froze the tab), so the server stopped hearing from it.`;
  }

  private add(e: DiaryEntry): void {
    this.entries.push(e);
    if (this.entries.length > KEEP) this.entries.splice(0, this.entries.length - KEEP);
    const ms = e.ms === undefined ? "" : ` ${Math.round(e.ms / 1000)} s`;
    console.info(`[connection] ${new Date(e.at).toISOString()} ${e.kind}${ms}`);
    try {
      this.store?.setItem(STORE_KEY, JSON.stringify(this.entries));
    } catch {
      // storage full or blocked: the console has it
    }
  }
}
