// The friends relay (docs/adr/0005-friends.md section 1): a dumb message relay between players of
// this client. It knows nothing about the game. In memory only, it keeps who's connected, under
// which public key, with which character name and on which game server; it forwards JSON messages
// between keys, answers searches by name, and tells each side when the other is online, but only
// while both watch each other's keys (friends). A restart drops everyone; clients reconnect.
//
// A client proves its key by signing the relay's challenge (ECDSA P-256, WebCrypto), so the relay
// stamps every message it forwards with the sender's key and receivers may trust it. Names are
// only claims. Transport-agnostic: gateway.ts feeds it WebSocket text frames; the tests feed it
// directly. No dependencies but Node's WebCrypto.
//
// Pets (docs/adr/0006-pets.md 3): each connection may say which pet its character has; a client
// asks about the players it sees in its room by name, gets their pets, and hears of changes to
// those names until it asks about others. A name's pet is the first connection's to claim the name.

/** The longest message (bytes), and the most a connection may send a second (a burst of twice that) */
export const RELAY_MAX_MESSAGE = 4096;
export const RELAY_RATE = 20;
/** A connection that hasn't said who it is by then is closed (ms) */
const HELLO_TIMEOUT_MS = 10_000;
/** Search: at least this many letters, at most this many results */
const SEARCH_MIN = 2;
const SEARCH_MAX = 20;
/** Keys one connection may watch, and names one lookup may ask about */
const MAX_WATCH = 500;
const MAX_LOOKUP = 100;
const MAX_NAME = 40;
const MAX_SERVER = 200;
/** Names one pet query may ask about (the players in a room) */
const MAX_PET_QUERY = 60;
/** What the challenge signature covers, with the nonce, server and name (socialProtocol.ts helloText) */
const HELLO_PREFIX = "meridian-shards-social";

export interface RelayPeer {
  send(text: string): void;
  close(code: number, reason: string): void;
}

interface Conn {
  peer: RelayPeer;
  nonce: string;
  /** Set once the hello is checked */
  key: string | null;
  server: string;
  name: string;
  visible: boolean;
  watch: Set<string>;
  /** What we last told it about each watched key's presence */
  told: Map<string, boolean>;
  /** Its character's pet, as it said (checked for shape only), or null */
  pet: Json | null;
  /** The names (lower case) whose pets it wants to hear about */
  petNames: Set<string>;
  tokens: number;
  refilled: number;
  timer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

type Json = Record<string, unknown>;

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export class SocialRelay {
  /** Connections that said who they are, by server, then key */
  private readonly servers = new Map<string, Map<string, Conn>>();
  /** The connection whose pet a name has: the first to claim the name, by server, then name (lower case) */
  private readonly names = new Map<string, Map<string, Conn>>();
  private readonly now: () => number;
  private readonly log: (...a: unknown[]) => void;

  constructor(opts: { now?: () => number; log?: (...a: unknown[]) => void } = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  /** How many have said who they are (for the log) */
  get size(): number {
    let n = 0;
    for (const m of this.servers.values()) n += m.size;
    return n;
  }

  /** A new connection: it gets a challenge, and must answer with a signed hello. */
  connect(peer: RelayPeer): { receive: (text: string) => Promise<void>; closed: () => void } {
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(18)));
    const c: Conn = {
      peer, nonce, key: null, server: "", name: "", visible: true, watch: new Set(), told: new Map(), pet: null, petNames: new Set(),
      tokens: 2 * RELAY_RATE, refilled: this.now(), timer: null, closed: false,
    };
    c.timer = setTimeout(() => this.drop(c, 4001, "no hello"), HELLO_TIMEOUT_MS);
    this.send(c, { t: "challenge", nonce, time: this.now() });
    return { receive: (text) => this.receive(c, text), closed: () => this.closed(c) };
  }

  private send(c: Conn, msg: Json): void {
    if (!c.closed) c.peer.send(JSON.stringify(msg));
  }

  private drop(c: Conn, code: number, reason: string): void {
    if (c.closed) return;
    this.closed(c);
    c.peer.close(code, reason);
  }

  private closed(c: Conn): void {
    if (c.closed) return;
    c.closed = true;
    if (c.timer) clearTimeout(c.timer);
    const peers = c.key ? this.servers.get(c.server) : undefined;
    if (!peers || !c.key || peers.get(c.key) !== c) return;
    peers.delete(c.key);
    if (!peers.size) this.servers.delete(c.server);
    this.presenceChanged(c.server, c.key);
    // The name's pet goes with it, or passes to another connection claiming the name
    const names = this.names.get(c.server);
    const lc = c.name.toLowerCase();
    if (names?.get(lc) === c) {
      names.delete(lc);
      const next = [...peers.values()].find((p) => p.name.toLowerCase() === lc);
      if (next) names.set(lc, next);
      if (!names.size) this.names.delete(c.server);
      this.petChanged(c.server, lc);
    }
  }

  /** The token bucket: false when this message is over the rate (it's dropped) */
  private allowed(c: Conn): boolean {
    const now = this.now();
    c.tokens = Math.min(2 * RELAY_RATE, c.tokens + ((now - c.refilled) * RELAY_RATE) / 1000);
    c.refilled = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  private async receive(c: Conn, text: string): Promise<void> {
    if (c.closed) return;
    if (text.length > RELAY_MAX_MESSAGE) return this.drop(c, 1009, "too big");
    if (!this.allowed(c)) return;
    let m: Json;
    try {
      const v: unknown = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) return;
      m = v as Json;
    } catch {
      return;
    }
    if (!c.key) {
      if (m.t === "hello") await this.hello(c, m);
      return;
    }
    switch (m.t) {
      case "send":
        return this.forward(c, m);
      case "search":
        return this.search(c, m);
      case "lookup":
        return this.lookup(c, m);
      case "watch":
        return this.setWatch(c, m);
      case "visible":
        c.visible = m.on === true;
        return;
      case "time":
        return this.send(c, { t: "time", id: m.id, time: this.now() });
      case "pet":
        return this.setPet(c, m.pet);
      case "petQuery":
        return this.petQuery(c, m);
    }
  }

  private async hello(c: Conn, m: Json): Promise<void> {
    const { key, server, name, sig } = m;
    if (typeof key !== "string" || typeof server !== "string" || typeof name !== "string" || typeof sig !== "string") return this.drop(c, 4002, "bad hello");
    if (!name.trim() || name.length > MAX_NAME || !server || server.length > MAX_SERVER) return this.drop(c, 4002, "bad hello");
    let ok: boolean;
    try {
      const raw = Buffer.from(key, "base64url");
      if (raw.length !== 65) throw new Error("key length");
      const pub = await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const signed = new TextEncoder().encode(`${HELLO_PREFIX}\n${c.nonce}\n${server}\n${name}`);
      ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, Buffer.from(sig, "base64url"), signed);
    } catch {
      ok = false;
    }
    if (c.closed) return;
    if (!ok) return this.drop(c, 4003, "bad signature");
    if (c.timer) clearTimeout(c.timer);
    c.timer = null;
    c.key = key;
    c.server = server;
    c.name = name.trim();
    c.visible = m.visible !== false;
    let peers = this.servers.get(server);
    if (!peers) this.servers.set(server, (peers = new Map()));
    // One connection per key: the newer one wins (a reload, a second window)
    const old = peers.get(key);
    if (old) {
      peers.delete(key);
      this.drop(old, 4004, "replaced");
    }
    peers.set(key, c);
    this.log(`social: ${c.name} on ${server} (${this.size} connected)`);
    this.send(c, { t: "welcome", time: this.now(), key });
    if (Array.isArray(m.watch)) this.setWatch(c, { watch: m.watch });
    this.presenceChanged(server, key);
    let names = this.names.get(server);
    if (!names) this.names.set(server, (names = new Map()));
    // The first to claim the name keeps its pet; a connection this one replaced (the same key) hands it on
    const claimed = names.get(c.name.toLowerCase());
    if (!claimed || claimed.closed) names.set(c.name.toLowerCase(), c);
    if ("pet" in m) this.setPet(c, m.pet);
  }

  /** A pet's shape: a kind, a colour, a name; anything else is no pet */
  private static readPet(v: unknown): Json | null {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const p = v as Json;
    if (typeof p.kind !== "string" || !p.kind || p.kind.length > 24) return null;
    const colour = Number.isInteger(p.colour) && (p.colour as number) >= 0 && (p.colour as number) < 16 ? p.colour : 0;
    const name = typeof p.name === "string" ? p.name.slice(0, 16) : "";
    return { kind: p.kind, colour, name };
  }

  private setPet(c: Conn, v: unknown): void {
    c.pet = SocialRelay.readPet(v);
    const lc = c.name.toLowerCase();
    if (this.names.get(c.server)?.get(lc) === c) this.petChanged(c.server, lc);
  }

  /** Whose pets a client wants to hear about (the players in its room): they're answered now, and changes later */
  private petQuery(c: Conn, m: Json): void {
    const names = (Array.isArray(m.names) ? m.names : []).slice(0, MAX_PET_QUERY).filter((n): n is string => typeof n === "string").map((n) => n.toLowerCase());
    c.petNames = new Set(names);
    const owners = this.names.get(c.server);
    const pets: Json[] = [];
    for (const lc of c.petNames) {
      const o = owners?.get(lc);
      if (o?.pet && o !== c) pets.push({ name: o.name, key: o.key, pet: o.pet });
    }
    this.send(c, { t: "pets", pets });
  }

  /** A name's pet changed (or went): everyone asking about the name hears */
  private petChanged(server: string, lc: string): void {
    const o = this.names.get(server)?.get(lc);
    const entry = { name: o?.name ?? lc, key: o?.key ?? null, pet: o?.pet ?? null };
    for (const p of this.servers.get(server)?.values() ?? []) if (p !== o && p.petNames.has(lc)) this.send(p, { t: "pets", pets: [entry] });
  }

  private forward(c: Conn, m: Json): void {
    const to = m.to;
    const body = m.body;
    if (typeof to !== "string" || !body || typeof body !== "object" || Array.isArray(body)) return;
    const target = this.servers.get(c.server)?.get(to);
    if (!target) return this.send(c, { t: "undeliverable", to, ref: m.ref });
    this.send(target, { t: "msg", from: c.key, name: c.name, body });
  }

  private search(c: Conn, m: Json): void {
    const q = typeof m.q === "string" ? m.q.trim().toLowerCase() : "";
    const players: { name: string; key: string }[] = [];
    if (q.length >= SEARCH_MIN)
      for (const p of this.servers.get(c.server)?.values() ?? []) {
        if (p === c || !p.visible || !p.name.toLowerCase().startsWith(q)) continue;
        players.push({ name: p.name, key: p.key! });
      }
    players.sort((a, b) => a.name.localeCompare(b.name));
    this.send(c, { t: "results", id: m.id, players: players.slice(0, SEARCH_MAX) });
  }

  /** Which of these names are online, under which keys (to spot a friend with a new key) */
  private lookup(c: Conn, m: Json): void {
    const names = new Set((Array.isArray(m.names) ? m.names : []).slice(0, MAX_LOOKUP).filter((n): n is string => typeof n === "string").map((n) => n.toLowerCase()));
    const found: { name: string; key: string }[] = [];
    for (const p of this.servers.get(c.server)?.values() ?? []) if (p !== c && p.visible && names.has(p.name.toLowerCase())) found.push({ name: p.name, key: p.key! });
    this.send(c, { t: "lookup", id: m.id, found });
  }

  private setWatch(c: Conn, m: Json): void {
    const keys = (Array.isArray(m.watch) ? m.watch : Array.isArray(m.keys) ? m.keys : []).slice(0, MAX_WATCH).filter((k): k is string => typeof k === "string");
    const before = c.watch;
    c.watch = new Set(keys);
    for (const k of c.told.keys()) if (!c.watch.has(k)) c.told.delete(k);
    this.refresh(c);
    // Whoever we started or stopped watching may now see us, or not
    const peers = this.servers.get(c.server);
    for (const k of new Set([...before, ...c.watch])) {
      if (before.has(k) === c.watch.has(k)) continue;
      const p = peers?.get(k);
      if (p && p !== c) this.refresh(p);
    }
  }

  /** Online for `c` means connected on its server and watching `c` back */
  private refresh(c: Conn): void {
    if (!c.key) return;
    const peers = this.servers.get(c.server);
    for (const k of c.watch) {
      const p = peers?.get(k);
      const online = !!p && p.watch.has(c.key);
      if ((c.told.get(k) ?? false) === online) continue;
      c.told.set(k, online);
      this.send(c, { t: "presence", key: k, online, name: p?.name ?? null });
    }
  }

  private presenceChanged(server: string, key: string): void {
    for (const p of this.servers.get(server)?.values() ?? []) if (p.watch.has(key) || p.key === key) this.refresh(p);
  }
}
