// What happened in the game, for the agent (docs/adr/0020-ai-playtester.md): a numbered ring of
// one-line entries (chat, combat, quests, rooms, errors) that `wait_events` reads from a sequence
// number on, waiting for the next when there's nothing new. Pure, tested in journal.test.ts.

export type EntryKind =
  /** Players speaking: say, yell, tell, broadcast, emote, guild */
  | "chat"
  /** The server's messages that aren't fights */
  | "server"
  | "combat"
  | "quest"
  | "room"
  | "look"
  | "trade"
  | "companion"
  | "arena"
  | "travel"
  | "health"
  | "error"
  /** The agent's own doings (tools that walked, fought, said) */
  | "self";

export interface Entry {
  seq: number;
  /** Date.now() */
  time: number;
  kind: EntryKind;
  text: string;
  /** Who said it (chat) */
  from?: string;
}

/** How many entries are kept */
const KEEP = 500;

export class Journal {
  private readonly entries: Entry[] = [];
  private next = 1;
  private waiters: (() => void)[] = [];
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** The sequence number the next entry will get */
  get head(): number {
    return this.next;
  }

  add(kind: EntryKind, text: string, from?: string): Entry {
    const e: Entry = { seq: this.next++, time: this.now(), kind, text, ...(from ? { from } : {}) };
    this.entries.push(e);
    if (this.entries.length > KEEP) this.entries.splice(0, this.entries.length - KEEP);
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
    return e;
  }

  /** Entries from `seq` on (those still kept), of these kinds (all when empty) */
  since(seq: number, kinds: readonly EntryKind[] = []): Entry[] {
    return this.entries.filter((e) => e.seq >= seq && (!kinds.length || kinds.includes(e.kind)));
  }

  /** The last `n` entries */
  last(n: number): Entry[] {
    return this.entries.slice(-n);
  }

  /**
   * Entries from `seq` on; when there are none (of these kinds), waits up to `waitMs` for one.
   * Resolves early when one arrives, or when `signal` aborts.
   */
  async wait(seq: number, waitMs: number, kinds: readonly EntryKind[] = [], signal?: AbortSignal): Promise<Entry[]> {
    const deadline = this.now() + waitMs;
    for (;;) {
      const found = this.since(seq, kinds);
      const left = deadline - this.now();
      if (found.length || left <= 0 || signal?.aborted) return found;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, left);
        signal?.addEventListener("abort", done, { once: true });
        this.waiters.push(done);
        function done() {
          clearTimeout(timer);
          resolve();
        }
      });
    }
  }
}

/** One entry as a line: "#12 14:03:07 chat Shardpal: hello" */
export function entryLine(e: Entry): string {
  const t = new Date(e.time).toISOString().slice(11, 19);
  return `#${e.seq} ${t} ${e.kind}${e.from ? ` ${e.from}:` : ""} ${e.text}`;
}
