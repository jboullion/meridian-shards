// The arena's feed (docs/adr/0007-arena.md; docs/adr/0015-social-on-our-server.md 3): anyone in
// the arena's room watches its fights, which this gateway runs (arena.ts), one sim per game
// server. No sign-in: a connection says which server and room it's in and gets the fights, then
// the changes, until it stops. (It was the friends relay once; our server keeps friends and pets
// now, shards-server util/shardssocial.kod.) Transport-agnostic: gateway.ts feeds it WebSocket text frames; the tests feed it directly.

import type { ArenaHost, ArenaWatcher } from "./arena.ts";

/** The longest message (bytes), and the most a connection may send a second (a burst of twice that) */
export const FEED_MAX_MESSAGE = 4096;
export const FEED_RATE = 20;
const MAX_SERVER = 200;

export interface FeedPeer {
  send(text: string): void;
  close(code: number, reason: string): void;
}

interface Conn {
  peer: FeedPeer;
  /** The game server it watches the arena of, once it asks, and the arena's room */
  server: string;
  room: string;
  /** Watching its server's arena, as this */
  arena: ArenaWatcher | null;
  tokens: number;
  refilled: number;
  closed: boolean;
}

type Json = Record<string, unknown>;

export class ArenaFeed {
  private readonly now: () => number;
  private readonly log: (...a: unknown[]) => void;
  private readonly arena: ArenaHost | null;
  private conns = 0;

  constructor(opts: { now?: () => number; log?: (...a: unknown[]) => void; arena?: ArenaHost | null } = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.arena = opts.arena ?? null;
  }

  /** Connections open now (for the log) */
  get size(): number {
    return this.conns;
  }

  connect(peer: FeedPeer): { receive: (text: string) => Promise<void>; closed: () => void } {
    const c: Conn = { peer, server: "", room: "", arena: null, tokens: 2 * FEED_RATE, refilled: this.now(), closed: false };
    this.conns++;
    return { receive: async (text) => this.receive(c, text), closed: () => this.closed(c) };
  }

  private send(c: Conn, msg: Json): void {
    if (!c.closed) c.peer.send(JSON.stringify(msg));
  }

  private closed(c: Conn): void {
    if (c.closed) return;
    c.closed = true;
    this.conns--;
    this.leaveArena(c);
  }

  /** The token bucket: false when this message is over the rate (it's dropped) */
  private allowed(c: Conn): boolean {
    const now = this.now();
    c.tokens = Math.min(2 * FEED_RATE, c.tokens + ((now - c.refilled) * FEED_RATE) / 1000);
    c.refilled = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  private receive(c: Conn, text: string): void {
    if (c.closed) return;
    if (text.length > FEED_MAX_MESSAGE) {
      this.closed(c);
      return c.peer.close(1009, "too big");
    }
    if (!this.allowed(c)) return;
    let m: Json;
    try {
      const v: unknown = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) return;
      m = v as Json;
    } catch {
      return;
    }
    switch (m.t) {
      case "arenaWatch":
        return this.watchArena(c, m);
      case "arenaLeave":
        return this.leaveArena(c);
      case "arenaHour":
        if (c.arena) this.arena?.setHour(c.server, ArenaFeed.readHour(m.hour));
        return;
      case "arenaBusy":
        // A player's mock bout holds the floor (docs/adr/0019-arena-bouts.md): anyone watching may
        // say so, and it lapses by itself (ArenaSim.setBusy)
        if (c.arena && typeof m.busy === "boolean") this.arena?.setBusy(c.server, c.room, m.busy);
        return;
    }
  }

  /** Watch a server's arena: everything now, then the ticks; "arenaOff" when there's none here */
  private watchArena(c: Conn, m: Json): void {
    if (c.arena) this.leaveArena(c);
    const server = m.server;
    if (typeof server !== "string" || !server || server.length > MAX_SERVER) return this.send(c, { t: "arenaOff" });
    const room = m.room;
    if (!this.arena || typeof room !== "string" || !this.arena.rooms.includes(room)) return this.send(c, { t: "arenaOff" });
    const w: ArenaWatcher = { send: (text) => void (!c.closed && c.peer.send(text)) };
    if (!this.arena.watch(server, w, ArenaFeed.readHour(m.hour), room)) return this.send(c, { t: "arenaOff" });
    c.server = server;
    c.room = room;
    c.arena = w;
    this.log(`arena: a watcher on ${server}`);
  }

  /** A game hour (0-23) a watcher says its sun shows, or null */
  private static readHour(v: unknown): number | null {
    return Number.isInteger(v) && (v as number) >= 0 && (v as number) < 24 ? (v as number) : null;
  }

  private leaveArena(c: Conn): void {
    if (!c.arena) return;
    this.arena?.leave(c.server, c.arena);
    c.arena = null;
  }
}
