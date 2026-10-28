// Ours (docs/adr/0005-friends.md, moved onto our server by docs/adr/0015-social-on-our-server.md):
// a character's friends as our server keeps them (shards-server util/shardssocial.kod). The
// server holds the friends, the requests either way, who's in the game, where friends are, and
// who follows whom; this keeps its latest word for the interface, sends its commands (UC_SHARDS
// "friend ..."), and keeps what's only for this screen: each friend's Locate and Map marker, and
// health bars. Friends are known by name: `key` is the name in lower case. Plain logic, tested in
// Node (packages/world/test/friends.test.ts).

import type { ServerFriend, SocialEvent } from "../session.ts";

/** Health goes to friends in our room on change, at most this often, and at least this often (ms) */
const HEALTH_MIN_MS = 250;
const HEALTH_EVERY_MS = 5000;
/** A friend's health we haven't heard again for this long isn't shown (ms) */
const HEALTH_STALE_MS = 12_000;
/** A search the server hasn't answered by then found nobody (ms) */
const SEARCH_TIMEOUT_MS = 5000;
/** Kod time is Unix time less this (mailbox.ts KOD_TIME_BASE) */
const KOD_TIME_BASE = 1760000000;
const SAVE_VERSION = 2;

/** Kod squares (1-based row and column) */
export type KodSquare = [row: number, col: number];

/**
 * 4.3: the leader left a room, from where (their last square), and how: a door's square or an
 * edge's side; neither when it wasn't a known exit (a teleport, a portal, death)
 */
export interface ExitBody {
  type: "exit";
  from: string;
  to: string;
  at: KodSquare;
  door?: KodSquare;
  edge?: "N" | "S" | "E" | "W";
}

export interface Friend {
  name: string;
  /** The name in lower case: how everything here knows them */
  key: string;
  /** Show which room they're in (the list, and a hint on the full map) */
  locate: boolean;
  /** Their pin on the minimap and full map while they're in our room */
  marker: boolean;
  /** When they last left the game (ms since 1970), or never */
  lastSeen: number | null;
}

/** The friends window's switches for everyone. All but healthBars are kept by the server. */
export interface FriendOptions {
  shareLocation: boolean;
  healthBars: boolean;
  /** Show me in search */
  visible: boolean;
  /** Turn away anyone who tries to follow us */
  refuseFollows: boolean;
}

export const DEFAULT_FRIEND_OPTIONS: FriendOptions = { shareLocation: true, healthBars: true, visible: true, refuseFollows: false };

/** util/shardssocial.kod SF_*: the server's options, off by default */
const SF = { HIDE_LOCATION: 1, HIDE_SEARCH: 2, REFUSE_FOLLOW: 4 } as const;

export interface FriendRequest {
  key: string;
  name: string;
}

/** Where a friend is, as the server last said: a room, or that they don't say */
export type FriendLocation = { room: string; rid: number; at: KodSquare; time: number } | { hidden: true; time: number };

/** What the client's follow controller needs to hear about */
export type FriendsEvent =
  /** The server says we follow this friend now: start walking after them */
  | { type: "startFollowing"; key: string; name: string }
  /** The friend we follow left their room (4.3) */
  | { type: "exit"; key: string; exit: ExitBody }
  /** We don't follow them any more (we stopped, they turned us away, went or aren't friends): stop */
  | { type: "stopFollowing"; key: string; why: string };

export interface FriendsHost {
  /** A UC_SHARDS command line to our server */
  command(line: string): void;
  /** A line in the chat, from the client */
  message(text: string): void;
  now(): number;
  /** The exit the leader took, from their last square (follow.ts exitTaken over our roomexits.json) */
  exitTaken(from: string, to: string, at: KodSquare): ExitBody;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** shards.friends.<game socket url>.<character> */
  storageKey: string;
}

/** What this screen keeps: each friend's display switches by key, and health bars */
interface SavedFriends {
  version: number;
  prefs: Record<string, { locate: boolean; marker: boolean }>;
  healthBars: boolean;
}

export function friendsStorageKey(server: string, character: string): string {
  return `shards.friends.${server}.${character.toLowerCase()}`;
}

const keyOf = (name: string) => name.toLowerCase();

export class FriendsService {
  friends: Friend[] = [];
  options: FriendOptions = { ...DEFAULT_FRIEND_OPTIONS };
  /** Requests to us, and ours waiting for an answer */
  incoming: FriendRequest[] = [];
  outgoing: FriendRequest[] = [];
  /** Friends in the game */
  readonly online = new Set<string>();
  readonly locations = new Map<string, FriendLocation>();
  /** Whom we follow, and who follows us (4) */
  following: string | null = null;
  readonly followers = new Set<string>();
  /** Whether the server has sent the list yet */
  ready = false;
  private prefs: SavedFriends["prefs"] = {};
  private readonly health = new Map<string, { pct: number; time: number }>();
  /** Our own health, which friends in our room hear (5) */
  private ownHealth: number | null = null;
  private roomFriends = new Set<string>();
  private healthSent: { pct: number; time: number } | null = null;
  private searching: { resolve: (names: string[]) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly changeListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(e: FriendsEvent) => void>();
  private readonly host: FriendsHost;

  constructor(host: FriendsHost) {
    this.host = host;
    this.load();
  }

  /** Ask the server for the list (and, through it, where friends are) */
  start(): void {
    this.host.command("friend list");
  }

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onEvent(fn: (e: FriendsEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.changeListeners) fn();
  }

  private emit(e: FriendsEvent): void {
    for (const fn of this.eventListeners) fn(e);
  }

  // ---- storage ----

  private load(): void {
    try {
      const raw = this.host.storage?.getItem(this.host.storageKey);
      if (!raw) return;
      const s = JSON.parse(raw) as Record<string, unknown>;
      if (s.prefs && typeof s.prefs === "object")
        for (const [k, v] of Object.entries(s.prefs as Record<string, { locate?: unknown; marker?: unknown }>))
          this.prefs[k] = { locate: v?.locate !== false, marker: v?.marker !== false };
      this.options.healthBars = s.healthBars !== false;
    } catch {
      // A broken save: start with the defaults
    }
  }

  private save(): void {
    const s: SavedFriends = { version: SAVE_VERSION, prefs: this.prefs, healthBars: this.options.healthBars };
    try {
      this.host.storage?.setItem(this.host.storageKey, JSON.stringify(s));
    } catch {
      // Storage full or gone: kept for this session
    }
  }

  friendByKey(key: string): Friend | undefined {
    return this.friends.find((f) => f.key === key);
  }

  friendByName(name: string): Friend | undefined {
    return this.friendByKey(keyOf(name));
  }

  /** A friend's health, if they've said lately (5) */
  healthOf(key: string): number | null {
    const h = this.health.get(key);
    return h && this.host.now() - h.time < HEALTH_STALE_MS ? h.pct : null;
  }

  // ---- what the server says ----

  handle(e: SocialEvent): void {
    switch (e.type) {
      case "friends":
        return this.listed(e);
      case "location": {
        const key = keyOf(e.name);
        if (!this.friendByKey(key)) return;
        this.locations.set(key, e.shown ? { room: e.room, rid: e.rid, at: e.at, time: this.host.now() } : { hidden: true, time: this.host.now() });
        return this.changed();
      }
      case "health": {
        const key = keyOf(e.name);
        if (!this.friendByKey(key)) return;
        this.health.set(key, { pct: Math.max(0, Math.min(100, e.pct)), time: this.host.now() });
        return this.changed();
      }
      case "exit": {
        const key = keyOf(e.name);
        if (this.following === key && e.from && e.to) this.emit({ type: "exit", key, exit: this.host.exitTaken(e.from, e.to, e.at) });
        return;
      }
      case "search": {
        const s = this.searching;
        if (!s) return;
        this.searching = null;
        clearTimeout(s.timer);
        s.resolve([...e.names].sort((a, b) => a.localeCompare(b)));
        return;
      }
    }
  }

  private listed(e: Extract<SocialEvent, { type: "friends" }>): void {
    const lastSeen = (f: ServerFriend) => (f.lastSeen > 0 ? (f.lastSeen + KOD_TIME_BASE) * 1000 : null);
    this.friends = e.friends
      .map((f) => {
        const key = keyOf(f.name);
        const p = this.prefs[key];
        return { name: f.name, key, locate: p?.locate ?? true, marker: p?.marker ?? true, lastSeen: lastSeen(f) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    this.online.clear();
    for (const f of e.friends) if (f.online) this.online.add(keyOf(f.name));
    for (const k of [...this.locations.keys()]) if (!this.online.has(k)) this.locations.delete(k);
    for (const k of [...this.health.keys()]) if (!this.online.has(k)) this.health.delete(k);
    this.incoming = e.incoming.map((name) => ({ key: keyOf(name), name }));
    this.outgoing = e.outgoing.map((name) => ({ key: keyOf(name), name }));
    this.options = {
      ...this.options,
      shareLocation: !(e.flags & SF.HIDE_LOCATION),
      visible: !(e.flags & SF.HIDE_SEARCH),
      refuseFollows: !!(e.flags & SF.REFUSE_FOLLOW),
    };
    this.followers.clear();
    for (const name of e.followers) this.followers.add(keyOf(name));
    // Following, as the server has it: start walking, or stop
    const now = e.following ? keyOf(e.following) : null;
    if (now !== this.following) {
      const before = this.following;
      this.following = now;
      if (before) this.emit({ type: "stopFollowing", key: before, why: "" });
      if (now) this.emit({ type: "startFollowing", key: now, name: e.following! });
    }
    this.ready = true;
    this.changed();
  }

  // ---- requests ----

  /** Ask someone to be our friend, by name; an error to show, or null */
  add(name: string, self = ""): string | null {
    const clean = name.trim();
    if (!clean) return "Whom?";
    if (self && keyOf(self) === keyOf(clean)) return "That's you.";
    const f = this.friendByName(clean);
    if (f) return `${f.name} is already your friend.`;
    if (this.outgoing.some((r) => r.key === keyOf(clean))) return `You've already asked ${clean}.`;
    this.host.command(`friend request ${clean}`);
    return null;
  }

  private byKey(list: FriendRequest[], key: string): string | null {
    return list.find((r) => r.key === key)?.name ?? null;
  }

  accept(key: string): void {
    const name = this.byKey(this.incoming, key);
    if (name) this.host.command(`friend accept ${name}`);
  }

  decline(key: string): void {
    const name = this.byKey(this.incoming, key);
    if (name) this.host.command(`friend decline ${name}`);
  }

  cancel(key: string): void {
    const name = this.byKey(this.outgoing, key);
    if (name) this.host.command(`friend cancel ${name}`);
  }

  remove(key: string): void {
    const f = this.friendByKey(key);
    if (f) this.host.command(`friend remove ${f.name}`);
  }

  /** Players in the game whose names hold `q` (at least two letters), but those who hide */
  search(q: string): Promise<string[]> {
    if (this.searching) {
      clearTimeout(this.searching.timer);
      this.searching.resolve([]);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.searching?.timer === timer) this.searching = null;
        resolve([]);
      }, SEARCH_TIMEOUT_MS);
      this.searching = { resolve, timer };
      this.host.command(`friend search ${q.trim()}`);
    });
  }

  setFriend(key: string, patch: Partial<Pick<Friend, "locate" | "marker">>): void {
    const f = this.friendByKey(key);
    if (!f) return;
    Object.assign(f, patch);
    this.prefs[key] = { locate: f.locate, marker: f.marker };
    this.friends = [...this.friends];
    this.save();
    this.changed();
  }

  setOptions(patch: Partial<FriendOptions>): void {
    const before = this.options;
    this.options = { ...this.options, ...patch };
    if (before.healthBars !== this.options.healthBars) this.save();
    const o = this.options;
    const flags = (o.shareLocation ? 0 : SF.HIDE_LOCATION) | (o.visible ? 0 : SF.HIDE_SEARCH) | (o.refuseFollows ? SF.REFUSE_FOLLOW : 0);
    if (before.shareLocation !== o.shareLocation || before.visible !== o.visible || before.refuseFollows !== o.refuseFollows)
      this.host.command(`friend options ${flags}`);
    this.changed();
  }

  // ---- health (5) ----

  setHealth(pct: number | null): void {
    this.ownHealth = pct === null ? null : Math.max(0, Math.min(100, Math.round(pct)));
  }

  /** Friends whose characters the server shows in our room */
  setRoomFriends(keys: Iterable<string>): void {
    const before = this.roomFriends.size;
    this.roomFriends = new Set(keys);
    // Someone came in: they hear our health at once
    if (this.roomFriends.size > before) this.healthSent = null;
  }

  /** A few times a second: our health to friends in our room, when it changed (the server sends the true figure) */
  tick(): void {
    if (this.ownHealth === null || !this.roomFriends.size) return;
    const now = this.host.now();
    const last = this.healthSent;
    const due = !last || (last.pct !== this.ownHealth && now - last.time >= HEALTH_MIN_MS) || now - last.time >= HEALTH_EVERY_MS;
    if (!due) return;
    this.host.command("friend hp");
    this.healthSent = { pct: this.ownHealth, time: now };
  }

  // ---- following (4) ----

  /** Ask to follow a friend in our room; an error, or null (the server's list starts it) */
  startFollow(key: string): string | null {
    const f = this.friendByKey(key);
    if (!f) return "Only friends can be followed.";
    if (!this.online.has(key)) return `${f.name} isn't online.`;
    if (this.followers.has(key)) return `${f.name} is following you: you can't follow them back.`;
    this.host.command(`friend follow ${f.name}`);
    return null;
  }

  /** Stop following, saying why in the chat (null: say nothing); the server tells the leader */
  stopFollowing(why: string | null): void {
    const key = this.following;
    if (!key) return;
    this.following = null;
    this.host.command("friend unfollow");
    if (why) this.host.message(`You stop following: ${why}.`);
    this.emit({ type: "stopFollowing", key, why: why ?? "" });
    this.changed();
  }

  /** "Stop them": turn a follower away */
  stopFollower(key: string): void {
    const f = this.friendByKey(key);
    if (f && this.followers.has(key)) this.host.command(`friend stopfollower ${f.name}`);
  }
}
