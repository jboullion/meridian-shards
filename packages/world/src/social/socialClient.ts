// Ours (docs/adr/0005-friends.md section 1): the client's end of the friends relay. It connects,
// proves its key, keeps the relay's clock, and reconnects with backoff when dropped; without the
// relay nothing breaks, friends just show offline. Transport-agnostic like GameSession: any
// WebSocket-like socket (Node 24 has one).

import type { ArenaMessage } from "../arena/arenaWire.ts";
import { publicKeyString, signHello, type FriendBody, type RelayMessage, type RelayPlayer } from "./socialProtocol.ts";

export type SocialStatus = "connecting" | "online" | "offline" | "replaced";

/** Reconnect after this long at first, doubling to the most (ms) */
const BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
/** A search or lookup the relay hasn't answered by then answers nothing (ms) */
const REQUEST_TIMEOUT_MS = 5000;

/** What FriendsService needs of the relay (a fake in the tests) */
export interface RelayLink {
  /** Our public key, once known */
  readonly key: string;
  readonly status: SocialStatus;
  send(to: string, body: FriendBody): void;
  watch(keys: readonly string[]): void;
  setVisible(on: boolean): void;
  search(q: string): Promise<RelayPlayer[]>;
  lookup(names: readonly string[]): Promise<RelayPlayer[]>;
}

export interface SocialClientOptions {
  url: string;
  /** The game server we play on (its game socket URL): friends don't cross servers */
  server: string;
  /** Our character's name (only a claim to the relay) */
  name: string;
  keys: CryptoKeyPair;
  /** Show me in search */
  visible: boolean;
  createSocket?: (url: string) => WebSocket;
}

export interface SocialClientEvents {
  status?: (s: SocialStatus) => void;
  message?: (from: string, name: string, body: unknown) => void;
  presence?: (key: string, online: boolean, name: string | null) => void;
  undeliverable?: (to: string) => void;
  /** Pets of the names asked about (docs/adr/0006-pets.md 3), now and as they change */
  pets?: (pets: { name: string; key: string | null; pet: unknown }[]) => void;
  /** The arena we watch (docs/adr/0007-arena.md), or null when the relay has none */
  arena?: (m: ArenaMessage | null) => void;
}

export class SocialClient implements RelayLink {
  key = "";
  status: SocialStatus = "offline";
  /** Our clock minus the relay's (ms), once a round trip has measured it */
  private offset: number | null = null;
  private ws: WebSocket | null = null;
  private backoff = BACKOFF_MS;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private watching: string[] = [];
  /** Our character's pet, and the names whose pets we asked about (both sent again on reconnecting) */
  private pet: unknown = null;
  private petNames: string[] = [];
  /** The arena's room we watch (asked again on reconnecting), or null */
  private arenaRoom: string | null = null;
  /** The game hour we last told the relay */
  private hour: number | null = null;
  private visible: boolean;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: RelayPlayer[]) => void; timer: ReturnType<typeof setTimeout> }>();
  private timeAsked = new Map<number, number>();
  private readonly opts: SocialClientOptions;
  private readonly events: SocialClientEvents;

  constructor(opts: SocialClientOptions, events: SocialClientEvents = {}) {
    this.opts = opts;
    this.events = events;
    this.visible = opts.visible;
  }

  /** Connect (and keep reconnecting until closed) */
  async start(): Promise<void> {
    this.key = await publicKeyString(this.opts.keys.publicKey);
    if (!this.closed) this.open();
  }

  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
    this.ws = null;
    this.setStatus("offline");
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve([]);
    }
    this.pending.clear();
  }

  /** The relay's time now (ms since 1970), or our own clock's before it has said */
  now(): number {
    return Date.now() - (this.offset ?? 0);
  }

  /** Whether `now()` is the relay's (shared ambient life needs it, docs/adr/0005-friends.md 6.1) */
  get clockKnown(): boolean {
    return this.offset !== null;
  }

  send(to: string, body: FriendBody): void {
    this.raw({ t: "send", to, body });
  }

  watch(keys: readonly string[]): void {
    this.watching = [...new Set(keys)];
    this.raw({ t: "watch", keys: this.watching });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.raw({ t: "visible", on });
  }

  /** docs/adr/0006-pets.md 3.1: our character's pet (null for none) */
  setPet(pet: unknown): void {
    if (JSON.stringify(pet) === JSON.stringify(this.pet)) return;
    this.pet = pet;
    this.raw({ t: "pet", pet });
  }

  /** 3.2: the players in our room, by name: their pets come back, and changes to them */
  queryPets(names: readonly string[]): void {
    this.petNames = [...names];
    this.raw({ t: "petQuery", names: this.petNames });
  }

  /**
   * docs/adr/0007-arena.md: watch the arena in this room (null: stop), telling the relay the game
   * hour our sun shows (null: not known), which the arena keeps its opening hours by
   */
  watchArena(room: string | null, hour: number | null = null): void {
    if (room === this.arenaRoom) return this.arenaHour(hour);
    if (this.arenaRoom) this.raw({ t: "arenaLeave" });
    this.arenaRoom = room;
    this.hour = hour;
    if (room) this.raw({ t: "arenaWatch", room, hour });
  }

  /** The game hour changed while we watch (the sun moved, or an admin set the time) */
  arenaHour(hour: number | null): void {
    if (hour === this.hour) return;
    this.hour = hour;
    if (this.arenaRoom && hour !== null) this.raw({ t: "arenaHour", hour });
  }

  search(q: string): Promise<RelayPlayer[]> {
    return this.ask({ t: "search", q });
  }

  lookup(names: readonly string[]): Promise<RelayPlayer[]> {
    return this.ask({ t: "lookup", names });
  }

  private ask(msg: Record<string, unknown>): Promise<RelayPlayer[]> {
    if (this.status !== "online") return Promise.resolve([]);
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve([]);
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      this.raw({ ...msg, id });
    });
  }

  private raw(msg: Record<string, unknown>): void {
    if (this.status === "online" && this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private setStatus(s: SocialStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.events.status?.(s);
  }

  private open(): void {
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = (this.opts.createSocket ?? ((u) => new WebSocket(u)))(this.opts.url);
    } catch {
      return this.again();
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") void this.receive(ws, ev.data);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      // Another window took this character's key, or the relay refused our signature: stay away
      if (ev.code === 4004 || ev.code === 4003) {
        this.closed = true;
        this.setStatus(ev.code === 4004 ? "replaced" : "offline");
        return;
      }
      this.again();
    };
    ws.onerror = () => {
      // onclose follows
    };
  }

  private again(): void {
    if (this.closed) return;
    this.setStatus("offline");
    const wait = this.backoff * (0.75 + Math.random() / 2);
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    this.retry = setTimeout(() => this.open(), wait);
  }

  private async receive(ws: WebSocket, text: string): Promise<void> {
    let m: RelayMessage;
    try {
      m = JSON.parse(text) as RelayMessage;
    } catch {
      return;
    }
    switch (m.t) {
      case "challenge": {
        const { server, name, keys } = this.opts;
        const sig = await signHello(keys.privateKey, m.nonce, server, name);
        if (this.ws !== ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ t: "hello", key: this.key, server, name, sig, visible: this.visible, watch: this.watching, pet: this.pet }));
        break;
      }
      case "welcome": {
        this.backoff = BACKOFF_MS;
        this.setStatus("online");
        // The welcome's time is a first guess; a round trip measures it (1.5)
        if (this.petNames.length) this.raw({ t: "petQuery", names: this.petNames });
        if (this.arenaRoom) this.raw({ t: "arenaWatch", room: this.arenaRoom, hour: this.hour });
        const id = this.nextId++;
        this.timeAsked.set(id, Date.now());
        this.raw({ t: "time", id });
        break;
      }
      case "time": {
        const sent = this.timeAsked.get(m.id);
        if (sent === undefined) break;
        this.timeAsked.delete(m.id);
        const now = Date.now();
        this.offset = (sent + now) / 2 - m.time;
        break;
      }
      case "results":
      case "lookup": {
        const p = this.pending.get(m.id);
        if (!p) break;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        const list = m.t === "results" ? m.players : m.found;
        p.resolve(Array.isArray(list) ? list : []);
        break;
      }
      case "msg":
        this.events.message?.(m.from, m.name, m.body);
        break;
      case "presence":
        this.events.presence?.(m.key, m.online, m.name);
        break;
      case "undeliverable":
        this.events.undeliverable?.(m.to);
        break;
      case "pets":
        if (Array.isArray(m.pets)) this.events.pets?.(m.pets);
        break;
      case "arenaState":
      case "arenaTick":
        if (this.arenaRoom) this.events.arena?.(m);
        break;
      case "arenaOff":
        this.events.arena?.(null);
        break;
    }
  }
}
