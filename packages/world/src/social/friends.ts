// Ours (docs/adr/0005-friends.md): friends, kept per character per server, paired through the
// relay and one in-game tell, and what friends tell each other: online or not, where they are,
// their health, and following. The game and the relay come in through FriendsHost and RelayLink,
// so this is plain logic, tested in Node (packages/world/test/friends.test.ts). Following itself
// (walking after the leader) is the client's (apps/client follow.ts); this only carries its messages.

import type { RelayLink, SocialStatus } from "./socialClient.ts";
import {
  FRIEND_REQUEST_MS, fingerprint, friendRequestTell, isFriendRequestTell, newCode, parseFriendRequestTell, readFriendBody,
  type FriendBody, type RelayPlayer, type KodSquare,
} from "./socialProtocol.ts";

/** Health goes to friends in our room on change, at most this often, and at least this often (ms) */
const HEALTH_MIN_MS = 250;
const HEALTH_EVERY_MS = 5000;
/** A friend's health we haven't heard again for this long isn't shown (ms) */
const HEALTH_STALE_MS = 12_000;
/** Look for friends playing under a new key this often (ms) */
const REKEY_CHECK_MS = 30_000;
const SAVE_VERSION = 1;

export interface Friend {
  name: string;
  key: string;
  /** Show which room they're in (the list, and a hint on the full map) */
  locate: boolean;
  /** Their pin on the minimap and full map while they're in our room */
  marker: boolean;
  /** When we last saw them online (ms since 1970), or never */
  lastSeen: number | null;
}

/** The friends window's switches for everyone */
export interface FriendOptions {
  shareLocation: boolean;
  healthBars: boolean;
  /** Show me in search */
  visible: boolean;
  /** Turn away anyone who tries to follow us */
  refuseFollows: boolean;
}

export const DEFAULT_FRIEND_OPTIONS: FriendOptions = { shareLocation: true, healthBars: true, visible: true, refuseFollows: false };

export interface FriendRequest {
  key: string;
  name: string;
  /** When it was made or proven (ms) */
  at: number;
}

/** Where a friend is, as they last said: a room, or that they don't say */
export type FriendLocation = { room: string; rid: number; at: KodSquare; time: number } | { hidden: true; time: number };

export type ExitBody = Extract<FriendBody, { type: "exit" }>;

/** What the client's follow controller needs to hear about */
export type FriendsEvent =
  /** The friend we follow left their room (4.3) */
  | { type: "exit"; key: string; exit: ExitBody }
  /** The friend we follow turned us away, went offline or isn't our friend any more: stop, saying why */
  | { type: "stopFollowing"; key: string; why: string }
  /** 6: a friend asks which crowd we see in a room, or tells us theirs */
  | { type: "ambientAsk"; key: string; room: string }
  | { type: "ambient"; key: string; room: string; seed: number; since: number; hour: number | null };

export interface FriendsHost {
  /** Send the friend request's tell to this character; false when they aren't in the game */
  tell(name: string, text: string): boolean;
  /** Whether a character with this name is in the game (the server's online list) */
  inGame(name: string): boolean;
  /** A line in the chat, from the client */
  message(text: string): void;
  now(): number;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** shards.friends.<game socket url>.<character> */
  storageKey: string;
}

interface SavedFriends {
  version: number;
  friends: Friend[];
  options: FriendOptions;
  /** Friends we removed while they were offline: they're told when next seen */
  removed: string[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function friendsStorageKey(server: string, character: string): string {
  return `shards.friends.${server}.${character.toLowerCase()}`;
}

export class FriendsService {
  friends: Friend[] = [];
  options: FriendOptions = { ...DEFAULT_FRIEND_OPTIONS };
  /** Proven requests to us (2.4.2), and ours waiting for an answer */
  incoming: FriendRequest[] = [];
  outgoing: (FriendRequest & { code: string })[] = [];
  /** Friends' keys the relay says are online */
  readonly online = new Set<string>();
  readonly locations = new Map<string, FriendLocation>();
  /** Friends seen online under another key: they need pairing again (2.5) */
  readonly rekeyed = new Set<string>();
  /** Whom we follow, and who follows us (4) */
  following: string | null = null;
  readonly followers = new Set<string>();
  relayStatus: SocialStatus = "offline";
  /** Our key's fingerprint, for the tell */
  private ownFp = "";
  private removed: string[] = [];
  /** Relay requests and tells waiting for each other (2.4.2), up to FRIEND_REQUEST_MS */
  private unprovenRequests: { key: string; name: string; fp: string; at: number }[] = [];
  private unmatchedTells: { sender: string; code: string; fp: string; at: number }[] = [];
  /** Incoming requests' codes, to send back on accepting */
  private codes = new Map<string, string>();
  private readonly health = new Map<string, { pct: number; time: number }>();
  /** Our own: where we are, our health, and which friends are in our room */
  private location: { room: string; rid: number; at: KodSquare } | null = null;
  private ownHealth: number | null = null;
  private roomFriends = new Set<string>();
  private healthSent = new Map<string, { pct: number; time: number }>();
  private lastRekeyCheck = 0;
  private readonly changeListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(e: FriendsEvent) => void>();
  private readonly relay: RelayLink;
  private readonly host: FriendsHost;

  constructor(relay: RelayLink, host: FriendsHost) {
    this.relay = relay;
    this.host = host;
    this.load();
  }

  /** Once the relay knows our key: the fingerprint for our tells */
  async init(): Promise<void> {
    if (this.relay.key) this.ownFp = await fingerprint(this.relay.key);
    this.relay.setVisible(this.options.visible);
    this.watch();
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
      const s = JSON.parse(raw) as Partial<SavedFriends>;
      this.friends = (Array.isArray(s.friends) ? s.friends : [])
        .filter((f) => f && typeof f.name === "string" && typeof f.key === "string")
        .map((f) => ({ name: f.name, key: f.key, locate: f.locate !== false, marker: f.marker !== false, lastSeen: typeof f.lastSeen === "number" ? f.lastSeen : null }));
      this.options = { ...DEFAULT_FRIEND_OPTIONS, ...(s.options ?? {}) };
      this.removed = Array.isArray(s.removed) ? s.removed.filter((k) => typeof k === "string") : [];
    } catch {
      // A broken save: start with no friends
    }
  }

  private save(): void {
    const s: SavedFriends = { version: SAVE_VERSION, friends: this.friends, options: this.options, removed: this.removed };
    try {
      this.host.storage?.setItem(this.host.storageKey, JSON.stringify(s));
    } catch {
      // Storage full or gone: kept for this session
    }
  }

  /** Friends, and those we removed while they were away (to tell them when they're back) */
  private watch(): void {
    this.relay.watch([...this.friends.map((f) => f.key), ...this.removed]);
  }

  friendByKey(key: string): Friend | undefined {
    return this.friends.find((f) => f.key === key);
  }

  friendByName(name: string): Friend | undefined {
    return this.friends.find((f) => same(f.name, name));
  }

  /** A friend's health, if they've said lately (5) */
  healthOf(key: string): number | null {
    const h = this.health.get(key);
    return h && this.host.now() - h.time < HEALTH_STALE_MS ? h.pct : null;
  }

  // ---- the relay ----

  setRelayStatus(s: SocialStatus): void {
    this.relayStatus = s;
    if (s !== "online") {
      // Gone from the relay: nobody can be seen online, and following can't carry on
      this.online.clear();
      this.followers.clear();
      if (this.following) this.stopFollowing("You lost touch with the Meridian Shards server");
    } else this.watch();
    this.changed();
  }

  relayPresence(key: string, online: boolean): void {
    if (this.removed.includes(key)) {
      // They come back still thinking us friends: tell them (3, Remove)
      if (online) {
        this.relay.send(key, { type: "remove" });
        this.removed = this.removed.filter((k) => k !== key);
        this.save();
        this.watch();
      }
      return;
    }
    const f = this.friendByKey(key);
    if (!f) return;
    if (online) {
      this.online.add(key);
      this.rekeyed.delete(key);
      f.lastSeen = this.host.now();
      this.save();
      this.sendLocation([key]);
    } else {
      this.online.delete(key);
      this.health.delete(key);
      this.followers.delete(key);
      f.lastSeen = this.host.now();
      this.save();
      if (this.following === key) this.stopFollowing(`${f.name} went offline`, false);
    }
    this.changed();
  }

  relayUndeliverable(to: string): void {
    const out = this.outgoing.find((r) => r.key === to);
    if (out) {
      this.outgoing = this.outgoing.filter((r) => r !== out);
      this.host.message(`${out.name} isn't online any more; the friend request was dropped.`);
    }
    if (this.incoming.some((r) => r.key === to)) this.incoming = this.incoming.filter((r) => r.key !== to);
    this.changed();
  }

  async relayMessage(from: string, claimedName: string, raw: unknown): Promise<void> {
    const body = readFriendBody(raw);
    if (!body) return;
    const friend = this.friendByKey(from);
    switch (body.type) {
      case "request":
        return this.requestArrived(from, claimedName);
      case "accept": {
        // 2.4.3: only the real character saw the code, so this proves them
        const out = this.outgoing.find((r) => r.key === from);
        if (!out || out.code !== body.code) return;
        this.outgoing = this.outgoing.filter((r) => r !== out);
        this.befriend(out.name, from);
        this.host.message(`${out.name} accepted: you're friends now.`);
        return this.changed();
      }
      case "decline": {
        const out = this.outgoing.find((r) => r.key === from);
        if (!out) return;
        this.outgoing = this.outgoing.filter((r) => r !== out);
        this.host.message(`${out.name} declined your friend request.`);
        return this.changed();
      }
      case "cancel":
        this.incoming = this.incoming.filter((r) => r.key !== from);
        this.unprovenRequests = this.unprovenRequests.filter((r) => r.key !== from);
        return this.changed();
      case "remove":
        if (!friend) return;
        this.forget(friend);
        this.host.message(`${friend.name} is no longer your friend.`);
        return this.changed();
    }
    // The rest only from friends
    if (!friend) return;
    switch (body.type) {
      case "loc":
        this.locations.set(from, "hidden" in body ? { hidden: true, time: this.host.now() } : { room: body.room, rid: body.rid, at: body.at, time: this.host.now() });
        return this.changed();
      case "hp":
        this.health.set(from, { pct: body.pct, time: this.host.now() });
        return this.changed();
      case "follow":
        if (!body.on) {
          if (this.followers.delete(from)) {
            this.host.message(`${friend.name} stopped following you.`);
            this.changed();
          }
          return;
        }
        // 4.6: no chains back to us; 3: or we turn everyone away
        if (this.following === from) return this.relay.send(from, { type: "follow-refused", why: "chain" });
        if (this.options.refuseFollows) return this.relay.send(from, { type: "follow-refused", why: "refused" });
        this.followers.add(from);
        this.host.message(`${friend.name} is following you.`);
        return this.changed();
      case "follow-refused":
        if (this.following !== from) return;
        return this.stopFollowing(
          body.why === "chain" ? `${friend.name} is following you: you can't follow them back` : body.why === "stopped" ? `${friend.name} stopped you following` : `${friend.name} doesn't take followers`,
          false,
        );
      case "exit":
        if (this.following === from) this.emit({ type: "exit", key: from, exit: body });
        return;
      case "ambient-ask":
        return this.emit({ type: "ambientAsk", key: from, room: body.room });
      case "ambient":
        return this.emit({ type: "ambient", key: from, room: body.room, seed: body.seed, since: body.since, hour: body.hour ?? null });
    }
  }

  // ---- pairing (2.4) ----

  /** The relay's half of a request: wait for the tell that proves the sender */
  private async requestArrived(key: string, name: string): Promise<void> {
    const fp = await fingerprint(key);
    const now = this.host.now();
    this.expire(now);
    if (this.incoming.some((r) => r.key === key)) return;
    this.unprovenRequests = [...this.unprovenRequests.filter((r) => r.key !== key), { key, name, fp, at: now }];
    this.match();
  }

  /**
   * A tell from a character (the server vouches for its name). True when it was a friend
   * request's (or its echo): it's never shown or put in a chat tab.
   */
  tellReceived(sender: string, text: string, fromSelf: boolean): boolean {
    if (!isFriendRequestTell(text)) return false;
    const t = parseFriendRequestTell(text);
    if (!t || fromSelf || !sender) return true;
    const now = this.host.now();
    this.expire(now);
    this.unmatchedTells = [...this.unmatchedTells, { sender, code: t.code, fp: t.fp, at: now }];
    this.match();
    return true;
  }

  private match(): void {
    let found = false;
    for (const r of [...this.unprovenRequests]) {
      const tell = this.unmatchedTells.find((t) => t.fp === r.fp && same(t.sender, r.name));
      if (!tell) continue;
      this.unprovenRequests = this.unprovenRequests.filter((x) => x !== r);
      this.unmatchedTells = this.unmatchedTells.filter((x) => x !== tell);
      // The server's name for them, whatever the relay was told
      this.codes.set(r.key, tell.code);
      this.incoming = [...this.incoming.filter((x) => x.key !== r.key), { key: r.key, name: tell.sender, at: this.host.now() }];
      const already = this.friendByKey(r.key);
      this.host.message(already ? `${tell.sender} wants to pair with you again (the Friends tab).` : `${tell.sender} wants to be your friend (the Friends tab).`);
      found = true;
    }
    if (found) this.changed();
  }

  /** 2.4.4: a relay request or tell that found no partner in time was a fake */
  private expire(now: number): void {
    this.unprovenRequests = this.unprovenRequests.filter((r) => now - r.at < FRIEND_REQUEST_MS);
    this.unmatchedTells = this.unmatchedTells.filter((t) => now - t.at < FRIEND_REQUEST_MS);
  }

  /** Ask someone from the search list (2.4.1); an error to show, or null */
  add(p: RelayPlayer): string | null {
    if (!p.key || p.key === this.relay.key) return "That's you.";
    const f = this.friendByKey(p.key);
    if (f) return `${f.name} is already your friend.`;
    if (this.outgoing.some((r) => r.key === p.key)) return `You've already asked ${p.name}.`;
    if (this.relayStatus !== "online" || !this.ownFp) return "The Meridian Shards server isn't answering; try again in a moment.";
    // One tell to the character in the game, the relay message to the key
    const code = newCode();
    if (!this.host.tell(p.name, friendRequestTell(code, this.ownFp))) return `${p.name} isn't in the game.`;
    this.relay.send(p.key, { type: "request" });
    this.outgoing = [...this.outgoing, { key: p.key, name: p.name, at: this.host.now(), code }];
    this.changed();
    return null;
  }

  accept(key: string): void {
    const r = this.incoming.find((x) => x.key === key);
    const code = this.codes.get(key);
    if (!r || !code) return;
    this.incoming = this.incoming.filter((x) => x !== r);
    this.codes.delete(key);
    this.relay.send(key, { type: "accept", code });
    // They may have asked us while we asked them
    this.outgoing = this.outgoing.filter((x) => x.key !== key);
    this.befriend(r.name, key);
    this.host.message(`You and ${r.name} are friends now.`);
    this.changed();
  }

  decline(key: string): void {
    if (!this.incoming.some((x) => x.key === key)) return;
    this.incoming = this.incoming.filter((x) => x.key !== key);
    this.codes.delete(key);
    this.relay.send(key, { type: "decline" });
    this.changed();
  }

  cancel(key: string): void {
    if (!this.outgoing.some((x) => x.key === key)) return;
    this.outgoing = this.outgoing.filter((x) => x.key !== key);
    this.relay.send(key, { type: "cancel" });
    this.changed();
  }

  private befriend(name: string, key: string): void {
    // A friend paired again under a new key replaces the old one
    const old = this.friends.find((f) => f.key === key || same(f.name, name));
    this.friends = [
      ...this.friends.filter((f) => f !== old),
      { name, key, locate: old?.locate ?? true, marker: old?.marker ?? true, lastSeen: this.host.now() },
    ].sort((a, b) => a.name.localeCompare(b.name));
    if (old) {
      this.rekeyed.delete(old.key);
      this.online.delete(old.key);
    }
    this.removed = this.removed.filter((k) => k !== key);
    this.save();
    this.watch();
  }

  /** Remove: tell them (or tell them when next seen) and forget them; they forget us too */
  remove(key: string): void {
    const f = this.friendByKey(key);
    if (!f) return;
    if (this.online.has(key)) this.relay.send(key, { type: "remove" });
    else this.removed = [...this.removed, key];
    this.forget(f);
    this.changed();
  }

  private forget(f: Friend): void {
    this.friends = this.friends.filter((x) => x !== f);
    this.online.delete(f.key);
    this.locations.delete(f.key);
    this.health.delete(f.key);
    this.rekeyed.delete(f.key);
    if (this.followers.delete(f.key)) this.host.message(`${f.name} stopped following you.`);
    if (this.following === f.key) this.stopFollowing(`${f.name} isn't your friend any more`, false);
    this.save();
    this.watch();
  }

  setFriend(key: string, patch: Partial<Pick<Friend, "locate" | "marker">>): void {
    const f = this.friendByKey(key);
    if (!f) return;
    Object.assign(f, patch);
    this.friends = [...this.friends];
    this.save();
    this.changed();
  }

  setOptions(patch: Partial<FriendOptions>): void {
    const before = this.options;
    this.options = { ...this.options, ...patch };
    this.save();
    if (before.visible !== this.options.visible) this.relay.setVisible(this.options.visible);
    // Sharing turned off stops location messages at once (and says so); on, they start again
    if (before.shareLocation !== this.options.shareLocation) this.sendLocation([...this.online]);
    if (this.options.refuseFollows && !before.refuseFollows) for (const k of [...this.followers]) this.stopFollower(k);
    this.changed();
  }

  // ---- location and health (3, 5) ----

  /** Our room changed (or we know our square in it now): friends hear, if we share */
  setLocation(loc: { room: string; rid: number; at: KodSquare } | null): void {
    this.location = loc;
    this.sendLocation([...this.online]);
  }

  private sendLocation(keys: string[]): void {
    for (const k of keys) {
      if (!this.friendByKey(k)) continue;
      if (!this.options.shareLocation) this.relay.send(k, { type: "loc", hidden: true });
      else if (this.location) this.relay.send(k, { type: "loc", ...this.location });
    }
  }

  setHealth(pct: number | null): void {
    this.ownHealth = pct === null ? null : Math.max(0, Math.min(100, Math.round(pct)));
  }

  /** Friends whose characters the server shows in our room */
  setRoomFriends(keys: Iterable<string>): void {
    this.roomFriends = new Set(keys);
    for (const k of [...this.healthSent.keys()]) if (!this.roomFriends.has(k)) this.healthSent.delete(k);
  }

  /** A few times a second: health to friends in our room, and checks */
  tick(): void {
    const now = this.host.now();
    if (this.ownHealth !== null)
      for (const k of this.roomFriends) {
        if (!this.online.has(k)) continue;
        const last = this.healthSent.get(k);
        const due = !last || (last.pct !== this.ownHealth && now - last.time >= HEALTH_MIN_MS) || now - last.time >= HEALTH_EVERY_MS;
        if (!due) continue;
        this.relay.send(k, { type: "hp", pct: this.ownHealth });
        this.healthSent.set(k, { pct: this.ownHealth, time: now });
      }
    // Outgoing requests live while both are in the game
    const gone = this.outgoing.filter((r) => !this.host.inGame(r.name));
    const goneIn = this.incoming.filter((r) => !this.host.inGame(r.name));
    if (gone.length || goneIn.length) {
      this.outgoing = this.outgoing.filter((r) => !gone.includes(r));
      this.incoming = this.incoming.filter((r) => !goneIn.includes(r));
      this.changed();
    }
    if (now - this.lastRekeyCheck >= REKEY_CHECK_MS && this.relayStatus === "online") {
      this.lastRekeyCheck = now;
      void this.checkRekeyed();
    }
  }

  /** 2.5: a friend in the game but not on the relay under their key may have a new one */
  private async checkRekeyed(): Promise<void> {
    const missing = this.friends.filter((f) => !this.online.has(f.key) && this.host.inGame(f.name));
    if (!missing.length) return;
    const found = await this.relay.lookup(missing.map((f) => f.name));
    let changed = false;
    for (const f of missing) {
      const p = found.find((x) => same(x.name, f.name));
      if (p && p.key !== f.key && !this.rekeyed.has(f.key)) {
        this.rekeyed.add(f.key);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** The new key a friend shows under, for pairing again from the friends list */
  async rekeyedPlayer(key: string): Promise<RelayPlayer | null> {
    const f = this.friendByKey(key);
    if (!f) return null;
    const found = await this.relay.lookup([f.name]);
    return found.find((x) => same(x.name, f.name) && x.key !== f.key) ?? null;
  }

  // ---- following (4) ----

  /** Start following a friend (the client checks they're in our room); an error, or null */
  startFollow(key: string): string | null {
    const f = this.friendByKey(key);
    if (!f) return "Only friends can be followed.";
    if (!this.online.has(key)) return `${f.name} isn't online.`;
    if (this.followers.has(key)) return `${f.name} is following you: you can't follow them back.`;
    if (this.following && this.following !== key) this.stopFollowing(null);
    this.following = key;
    this.relay.send(key, { type: "follow", on: true });
    this.host.message(`You follow ${f.name}.`);
    this.changed();
    return null;
  }

  /** Stop following, saying why in the chat (null: say nothing), and tell the leader */
  stopFollowing(why: string | null, tell = true): void {
    const key = this.following;
    if (!key) return;
    this.following = null;
    if (tell && this.online.has(key)) this.relay.send(key, { type: "follow", on: false });
    if (why) this.host.message(`You stop following: ${why}.`);
    this.emit({ type: "stopFollowing", key, why: why ?? "" });
    this.changed();
  }

  /** "Stop them": turn a follower away */
  stopFollower(key: string): void {
    if (!this.followers.delete(key)) return;
    this.relay.send(key, { type: "follow-refused", why: "stopped" });
    const f = this.friendByKey(key);
    if (f) this.host.message(`${f.name} no longer follows you.`);
    this.changed();
  }

  /** 6: ask a friend which crowd they see, or tell them ours (friends only) */
  sendAmbient(key: string, body: Extract<FriendBody, { type: "ambient" | "ambient-ask" }>): void {
    if (this.friendByKey(key) && this.online.has(key)) this.relay.send(key, body);
  }

  /** We left a room: followers hear which way (4.3) */
  leftRoom(exit: Omit<ExitBody, "type">): void {
    for (const k of this.followers) this.relay.send(k, { type: "exit", ...exit });
  }
}
