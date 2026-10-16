// Ours (docs/adr/0007-arena.md, docs/adr/0015-social-on-our-server.md 3): watching the arena's
// fights, which the gateway runs (tools/gateway/arena.ts) and streams to anyone in the arena's
// room, with no sign-in. Connected only while watching, and again with backoff when dropped.
// Transport-agnostic like GameSession: any WebSocket-like socket (Node 24 has one).

import type { ArenaMessage } from "./arenaWire.ts";

/** Reconnect after this long at first, doubling to the most (ms) */
const BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export interface ArenaClientOptions {
  /** The gateway's arena socket (/social) */
  url: string;
  /** The game server we play on (its game socket URL): each has its own arena */
  server: string;
  createSocket?: (url: string) => WebSocket;
}

export class ArenaClient {
  /** Whether the socket is up (the arena falls back to a local sim without it) */
  online = false;
  private ws: WebSocket | null = null;
  private room: string | null = null;
  private hour: number | null = null;
  private backoff = BACKOFF_MS;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: ArenaClientOptions;
  private readonly listener: (m: ArenaMessage | null) => void;

  /** The listener hears everything, then what changed; null when the gateway has no arena (or none yet) */
  constructor(opts: ArenaClientOptions, listener: (m: ArenaMessage | null) => void) {
    this.opts = opts;
    this.listener = listener;
  }

  /** Watch the arena in this room (null: stop), with the game hour our sun shows (null: not known) */
  watch(room: string | null, hour: number | null = null): void {
    if (room === this.room) return this.setHour(hour);
    this.room = room;
    this.hour = hour;
    if (!room) return this.disconnect();
    if (this.online) this.raw({ t: "arenaWatch", server: this.opts.server, room, hour });
    else if (!this.ws) this.open();
  }

  /** The game hour changed while we watch (the arena keeps its opening hours by it) */
  setHour(hour: number | null): void {
    if (hour === this.hour) return;
    this.hour = hour;
    if (this.room && hour !== null) this.raw({ t: "arenaHour", hour });
  }

  close(): void {
    this.room = null;
    this.disconnect();
  }

  private disconnect(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws;
    this.ws = null;
    this.online = false;
    ws?.close();
  }

  private raw(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = (this.opts.createSocket ?? ((u) => new WebSocket(u)))(this.opts.url);
    } catch {
      return this.again();
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.online = true;
      this.backoff = BACKOFF_MS;
      if (this.room) this.raw({ t: "arenaWatch", server: this.opts.server, room: this.room, hour: this.hour });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== "string") return;
      let m: { t?: unknown };
      try {
        m = JSON.parse(ev.data) as { t?: unknown };
      } catch {
        return;
      }
      if (m.t === "arenaState" || m.t === "arenaTick") {
        if (this.room) this.listener(m as ArenaMessage);
      } else if (m.t === "arenaOff") this.listener(null);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.online = false;
      this.again();
    };
    ws.onerror = () => {
      // onclose follows
    };
  }

  private again(): void {
    if (!this.room) return;
    const wait = this.backoff * (0.75 + Math.random() / 2);
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.room && !this.ws) this.open();
    }, wait);
  }
}
