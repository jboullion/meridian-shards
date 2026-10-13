// Ours (docs/adr/0005-friends.md): the friends feature in the game. One SocialLink per character
// in the game: its relay connection (packages/world socialClient.ts), its friends
// (friends.ts FriendsService), and the game around them: the friend request's tell (sent through
// GameSession, hidden when it comes), where we are, our health, which friends are in our room, and
// which way we left a room (for followers). Without the relay, nothing breaks: friends show offline.

import { STAT_GROUP } from "@shards/protocol";
import { OF } from "@shards/render";
import {
  FriendsService, SocialClient, exitTaken, friendsStorageKey, isFriendRequestTell, readPetChoice, slotSeed, squareOf,
  type AmbientExits, type ArenaMessage, type PetChoice, type AmbientSeed, type Friend, type GameSession, type SocialStatus,
} from "@shards/world";
import type { AssetStore } from "../assets.ts";
import { gameSocketUrl, socialSocketUrl } from "../host.ts";
import { characterKeys } from "./socialKeys.ts";

/** Health's stat in the main group (merintr stats.c), as Sidebar.tsx STAT_HP */
const STAT_HP = 1;
/** FriendsService.tick: health to friends, requests that went stale */
const TICK_MS = 250;
/** Shared ambient life: wait this long for the relay's clock, and for a friend in the room to say their seed (ms) */
const CLOCK_WAIT_MS = 2500;
const ASK_WAIT_MS = 1500;

/** The friend request's tell (and the server's echo of it to us) is never shown, whoever's in the game */
export function hideFriendTells(session: GameSession): void {
  session.lineFilter = (text) => isFriendRequestTell(text);
}

/** The character in the game's link, for the minimap's pins (MiniMap.tsx), or null */
let active: SocialLink | null = null;
export const currentSocial = (): SocialLink | null => active;

export interface RoomInfo {
  rid: number;
  name: string;
}

export class SocialLink {
  readonly friends: FriendsService;
  readonly client: SocialClient;
  readonly character: string;
  /** rooms.json: names by RID, and each file's rooms (several rooms share a file: tos.roo is four) */
  private roomNames = new Map<number, string>();
  private roomsByFile = new Map<string, RoomInfo[]>();
  /** roomexits.json, for which way we left a room */
  exits: Record<string, AmbientExits> = {};
  /** The room's size (fine units), from the scene, for working out which edge we left by */
  private roomSize: () => { width: number; height: number } | null = () => null;
  /** Friends whose characters the server shows in our room, by object id */
  friendIds = new Map<number, Friend>();
  private readonly session: GameSession;
  private readonly offs: (() => void)[] = [];
  private roomFile = "";
  private disposed = false;
  /** The crowd we see (6), to tell friends who ask, and the answers we're waiting for */
  private ambientNow: { room: string; seed: AmbientSeed } | null = null;
  private ambientWaiting = new Map<string, (s: AmbientSeed) => void>();
  private version = 0;
  /** docs/adr/0006-pets.md 3: the pets of the players in our room, by name (lower case), and whose we asked */
  private pets = new Map<string, { key: string | null; pet: PetChoice }>();
  private petQuery = "";
  private readonly versionListeners = new Set<() => void>();
  /** docs/adr/0007-arena.md: who hears the arena's messages (the scene), while it watches */
  private arenaListener: ((m: ArenaMessage | null) => void) | null = null;

  private constructor(session: GameSession, character: string, keys: CryptoKeyPair) {
    this.session = session;
    this.character = character;
    const world = session.world;
    this.client = new SocialClient(
      { url: socialSocketUrl(), server: gameSocketUrl(), name: character, keys, visible: true },
      {
        status: (s: SocialStatus) => this.friends.setRelayStatus(s),
        message: (from, name, body) => void this.friends.relayMessage(from, name, body),
        presence: (key, online) => this.friends.relayPresence(key, online),
        undeliverable: (to) => this.friends.relayUndeliverable(to),
        pets: (list) => this.petsHeard(list),
        arena: (m) => this.arenaListener?.(m),
      },
    );
    const byName = (name: string) => [...world.players.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
    this.friends = new FriendsService(this.client, {
      tell: (name, text) => {
        const p = byName(name);
        if (!p) return false;
        session.sayTo([p.id], text);
        return true;
      },
      inGame: (name) => !!byName(name),
      message: (text) => session.localMessage(text),
      now: () => Date.now(),
      storage: typeof localStorage === "undefined" ? null : localStorage,
      storageKey: friendsStorageKey(gameSocketUrl(), character),
    });
    this.offs.push(
      this.friends.onChange(() => {
        // A friend added or removed changes who in the room is one
        this.friendIds = this.friendObjects();
        this.bump();
      }),
    );
    // 2.4.2: the tell that proves a request; it (and its echo to us) never reaches the chat
    session.lineFilter = (text, sender) => this.friends.tellReceived(sender?.name ?? "", text, !sender || sender.id === world.player?.id);
    this.offs.push(
      world.on((e) => {
        switch (e.type) {
          case "player":
            if (e.roomChanged) this.roomChanged();
            break;
          case "roomContents":
            this.sayWhere();
            this.roomFriendsChanged();
            break;
          case "objectAdded":
          case "objectRemoved":
          case "players":
          case "idsStale":
            this.roomFriendsChanged();
            break;
          case "stats":
            if (e.group === STAT_GROUP.MAIN) this.healthChanged();
            break;
        }
      }),
    );
    // 6: friends ask which crowd we see in their room, and tell us theirs
    this.offs.push(
      this.friends.onEvent((e) => {
        if (e.type === "ambientAsk" && this.ambientNow?.room === e.room)
          this.friends.sendAmbient(e.key, { type: "ambient", room: e.room, ...this.ambientNow.seed });
        else if (e.type === "ambient") this.ambientWaiting.get(e.room)?.({ seed: e.seed, since: e.since, hour: e.hour });
      }),
    );
    const tick = setInterval(() => this.friends.tick(), TICK_MS);
    this.offs.push(() => clearInterval(tick));
    this.roomFile = this.currentRoomFile();
  }

  /** Our character's link: its key (made the first time), the relay, its friends */
  static async start(session: GameSession, assets: AssetStore, character: string): Promise<SocialLink> {
    const keys = await characterKeys(gameSocketUrl(), character);
    const link = new SocialLink(session, character, keys);
    // Rooms' names and numbers and their exits first (the asset store has them by now, mostly)
    await Promise.all([
      assets.roomList().then(
        (list) => {
          for (const r of list) {
            link.roomNames.set(r.rid, r.name);
            const file = r.roo.toLowerCase();
            link.roomsByFile.set(file, [...(link.roomsByFile.get(file) ?? []), { rid: r.rid, name: r.name }]);
          }
        },
        () => {},
      ),
      assets.roomExits().then(
        (e) => void (link.exits = e),
        () => {},
      ),
    ]);
    if (link.disposed) return link;
    await link.client.start();
    if (link.disposed) {
      link.client.close();
      return link;
    }
    active = link;
    await link.friends.init();
    link.friends.setRelayStatus(link.client.status);
    link.healthChanged();
    link.sayWhere();
    link.roomFriendsChanged();
    return link;
  }

  setRoomSize(fn: () => { width: number; height: number } | null): void {
    this.roomSize = fn;
  }

  dispose(): void {
    this.disposed = true;
    if (active === this) active = null;
    this.friends.stopFollowing(null);
    for (const off of this.offs.splice(0)) off();
    this.client.close();
    hideFriendTells(this.session);
  }

  /**
   * 6: the crowd to see in a room: a friend's already there, else the room's for this slot of the
   * relay's clock (the same for everyone who comes in it). Null without the relay: a crowd of our own.
   */
  async ambientSeed(room: string, hour: number | null): Promise<AmbientSeed | null> {
    const until = Date.now() + CLOCK_WAIT_MS;
    while (!this.disposed && !this.client.clockKnown && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    if (this.disposed || !this.client.clockKnown) return null;
    const here = [...this.friendIds.values()].filter((f) => this.friends.online.has(f.key));
    if (here.length) {
      const theirs = await new Promise<AmbientSeed | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ASK_WAIT_MS);
        this.ambientWaiting.set(room, (s) => {
          clearTimeout(timer);
          resolve(s);
        });
        for (const f of here) this.friends.sendAmbient(f.key, { type: "ambient-ask", room });
      });
      this.ambientWaiting.delete(room);
      if (theirs) return theirs;
    }
    return { ...slotSeed(room, this.client.now()), hour };
  }

  /**
   * docs/adr/0007-arena.md: watch the arena of our game server, in this room (null: stop). The
   * listener hears everything, then what changed; null when the relay has no arena (or none yet).
   */
  watchArena(room: string | null, listener: ((m: ArenaMessage | null) => void) | null, hour: number | null = null): void {
    this.arenaListener = room ? listener : null;
    this.client.watchArena(room, hour);
  }

  /** The game hour our sun shows, for the arena's opening hours (sent only when it changes) */
  arenaHour(hour: number | null): void {
    this.client.arenaHour(hour);
  }

  /** Whether the relay's connection is up (the arena falls back to our own without it) */
  get relayOnline(): boolean {
    return this.client.status === "online";
  }

  /** The relay's time (ms), for the shared crowd's ticks */
  relayNow(): number {
    return this.client.now();
  }

  /** The crowd we see in our room now (null: none, or our own), for friends who ask */
  setAmbient(room: string, seed: AmbientSeed | null): void {
    this.ambientNow = seed ? { room, seed } : null;
  }

  /** For React: a number that changes whenever anything shown does */
  get changes(): number {
    return this.version;
  }

  onChange(fn: () => void): () => void {
    this.versionListeners.add(fn);
    return () => this.versionListeners.delete(fn);
  }

  private bump(): void {
    this.version++;
    for (const fn of this.versionListeners) fn();
  }

  private currentRoomFile(): string {
    const p = this.session.world.player;
    return p ? (this.session.resource(p.roomRes) ?? "").toLowerCase() : "";
  }

  /** A room's name (rooms.json), by its number, else the likeliest of its file's */
  roomName(file: string, rid = 0): string {
    return this.roomNames.get(rid) ?? this.likeliestRoom(file)?.name ?? file;
  }

  /** Of a file's rooms, the first with a real name (not "Room", nor a Death Realm copy) */
  private likeliestRoom(file: string): RoomInfo | undefined {
    const rooms = this.roomsByFile.get(file.toLowerCase()) ?? [];
    return rooms.find((r) => !/^(new )?room$|^death realm$/i.test(r.name)) ?? rooms[0];
  }

  /** Our room's number: the one of its file's rooms whose name the server gives it */
  private ourRid(file: string): number {
    const p = this.session.world.player;
    const name = p ? (this.session.englishResource(p.roomNameRes) ?? "") : "";
    const rooms = this.roomsByFile.get(file) ?? [];
    return (rooms.find((r) => r.name === name) ?? this.likeliestRoom(file))?.rid ?? 0;
  }

  /**
   * BP_PLAYER for a new room. Our object is still the old room's (BP_ROOM_CONTENTS comes next), so
   * its square is where we left from: followers hear which way (4.3).
   */
  private roomChanged(): void {
    const from = this.roomFile;
    const to = this.currentRoomFile();
    this.roomFile = to;
    const self = this.session.world.self;
    if (!from || !to || from === to || !self || !this.friends.followers.size) return;
    this.friends.leftRoom(exitTaken(this.exits[from], from, to, squareOf(self), this.roomSize()));
  }

  /** 3: where we are, to friends (if we share), once we know our square in the new room */
  private sayWhere(): void {
    const self = this.session.world.self;
    const room = this.currentRoomFile();
    if (!self || !room) return;
    this.friends.setLocation({ room, rid: this.ourRid(room), at: squareOf(self) });
  }

  private healthChanged(): void {
    const hp = this.session.world.stats.get(STAT_GROUP.MAIN)?.find((s) => s.num === STAT_HP)?.numeric;
    this.friends.setHealth(hp && hp.currentMax > 0 ? (100 * hp.value) / hp.currentMax : null);
  }

  /** Friends whose characters are in our room, by object id */
  friendObjects(): Map<number, Friend> {
    const out = new Map<number, Friend>();
    const world = this.session.world;
    if (!this.friends.friends.length) return out;
    for (const o of world.objects.values()) {
      if (!(o.info.flags & OF.PLAYER) || o.id === world.player?.id) continue;
      const f = this.friends.friendByName(this.session.resource(o.info.nameRes) ?? "");
      if (f) out.set(o.id, f);
    }
    return out;
  }

  private roomFriendsChanged(): void {
    this.askPets();
    const ids = this.friendObjects();
    const before = [...this.friendIds].map(([id, f]) => `${id}:${f.key}`).join();
    this.friendIds = ids;
    this.friends.setRoomFriends([...ids.values()].map((f) => f.key));
    // Only a change in who's here is news (monsters come and go all the time)
    if ([...ids].map(([id, f]) => `${id}:${f.key}`).join() !== before) this.bump();
  }

  // ---- pets (docs/adr/0006-pets.md 3) ----

  /** Our character's pet, for everyone else (null for none) */
  setPet(pet: PetChoice | null): void {
    this.client.setPet(pet);
  }

  /**
   * A player's pet, if the relay knows one. A friend's only from their key (3.4): anyone could
   * connect calling themselves our friend.
   */
  petOf(name: string): PetChoice | null {
    const e = this.pets.get(name.toLowerCase());
    if (!e) return null;
    const f = this.friends.friendByName(name);
    return f && e.key !== f.key ? null : e.pet;
  }

  private petsHeard(list: { name: string; key: string | null; pet: unknown }[]): void {
    for (const e of list) {
      if (typeof e?.name !== "string") continue;
      const pet = readPetChoice(e.pet);
      if (pet) this.pets.set(e.name.toLowerCase(), { key: e.key, pet });
      else this.pets.delete(e.name.toLowerCase());
    }
  }

  /** 3.2: ask about the players in our room (only names we can already see), when that changes */
  private askPets(): void {
    const world = this.session.world;
    const names = [...world.objects.values()]
      .filter((o) => o.info.flags & OF.PLAYER && o.id !== world.player?.id)
      .map((o) => (this.session.resource(o.info.nameRes) ?? "").toLowerCase())
      .filter(Boolean)
      .sort();
    const key = names.join("|");
    if (key === this.petQuery) return;
    this.petQuery = key;
    for (const n of [...this.pets.keys()]) if (!names.includes(n)) this.pets.delete(n);
    this.client.queryPets(names);
  }

  /** Friends in our room whose pin is on (3, Map marker), by object id */
  markerIds(): Set<number> {
    const out = new Set<number>();
    for (const [id, f] of this.friendIds) if (f.marker) out.add(id);
    return out;
  }

  /** A friend's object in our room, by their key */
  objectOf(key: string): number | null {
    for (const [id, f] of this.friendIds) if (f.key === key) return id;
    return null;
  }
}
