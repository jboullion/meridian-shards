// Ours (docs/adr/0005-friends.md, 0006-pets.md, moved onto our server by
// docs/adr/0015-social-on-our-server.md): friends, pets and the shared crowd in the game. One
// SocialLink per character in the game: its friends (packages/world friends.ts FriendsService),
// whose state our server keeps (shards-server util/shardssocial.kod, over UC_SHARDS and
// UC_FRIENDS); the pets of the players in our room (UC_PETS); our room's crowd (UC_AMBIENT); and
// the arena's fights, which the gateway still runs (arenaClient.ts).

import { STAT_GROUP } from "@shards/protocol";
import { OF } from "@shards/render";
import {
  ArenaClient, FriendsService, exitTaken, friendsStorageKey, readPetChoice,
  type AmbientExits, type AmbientSeed, type ArenaMessage, type Friend, type GameSession, type PetChoice, type SocialEvent,
} from "@shards/world";
import type { AssetStore } from "../assets.ts";
import { gameSocketUrl, socialSocketUrl } from "../host.ts";

/** Health's stat in the main group (merintr stats.c), as Sidebar.tsx STAT_HP */
const STAT_HP = 1;
/** FriendsService.tick: our health to friends in the room */
const TICK_MS = 250;
/** How long the server has to say our room's crowd (ms) */
const AMBIENT_WAIT_MS = 2500;

/** The character in the game's link, for the minimap's pins (MiniMap.tsx), or null */
let active: SocialLink | null = null;
export const currentSocial = (): SocialLink | null => active;

export interface RoomInfo {
  rid: number;
  name: string;
}

export class SocialLink {
  readonly friends: FriendsService;
  readonly character: string;
  /** rooms.json: names by RID, and each file's rooms (several rooms share a file: tos.roo is four) */
  private roomNames = new Map<number, string>();
  private roomsByFile = new Map<string, RoomInfo[]>();
  /** roomexits.json, for which way a leader left a room */
  exits: Record<string, AmbientExits> = {};
  /** The room's size (fine units), from the scene, for working out which edge a leader left by */
  private roomSize: () => { width: number; height: number } | null = () => null;
  /** Friends whose characters the server shows in our room, by object id */
  friendIds = new Map<number, Friend>();
  private readonly session: GameSession;
  private readonly arena: ArenaClient;
  private readonly offs: (() => void)[] = [];
  private disposed = false;
  private version = 0;
  /** The pets of the players in our room, by object id (UC_PETS); ours is among them */
  private pets = new Map<number, PetChoice>();
  /** Our own pet as the server has it, once it has said (undefined: not yet) */
  private serverPet: PetChoice | null | undefined = undefined;
  /** The pet we last asked the server to keep, as JSON, to send only changes */
  private petSent: string | undefined = undefined;
  private readonly petListeners = new Set<(pet: PetChoice | null) => void>();
  /** Waiting for our room's crowd (UC_AMBIENT) */
  private ambientWaiting: ((s: SocialEvent & { type: "ambient" }) => void) | null = null;
  private readonly versionListeners = new Set<() => void>();
  /** docs/adr/0007-arena.md: who hears the arena's messages (the scene), while it watches */
  private arenaListener: ((m: ArenaMessage | null) => void) | null = null;

  private constructor(session: GameSession, character: string, onSocial: (fn: (e: SocialEvent) => void) => () => void) {
    this.session = session;
    this.character = character;
    const world = session.world;
    this.arena = new ArenaClient({ url: socialSocketUrl(), server: gameSocketUrl() }, (m) => this.arenaListener?.(m));
    this.friends = new FriendsService({
      command: (line) => session.shardsCommand(line),
      message: (text) => session.localMessage(text),
      now: () => Date.now(),
      exitTaken: (from, to, at) => exitTaken(this.exits[from], from, to, at, this.roomSize()),
      storage: typeof localStorage === "undefined" ? null : localStorage,
      storageKey: friendsStorageKey(gameSocketUrl(), character),
    });
    this.offs.push(
      this.friends.onChange(() => {
        // A friend added or removed changes who in the room is one (and who hears our health)
        this.roomFriendsChanged();
        this.bump();
      }),
      onSocial((e) => this.heard(e)),
      world.on((e) => {
        switch (e.type) {
          case "roomContents":
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
    const tick = setInterval(() => this.friends.tick(), TICK_MS);
    this.offs.push(() => clearInterval(tick));
  }

  /** Our character's link: the room data it needs, then the server's friends and our room's pets */
  static async start(session: GameSession, assets: AssetStore, character: string, onSocial: (fn: (e: SocialEvent) => void) => () => void): Promise<SocialLink> {
    const link = new SocialLink(session, character, onSocial);
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
    active = link;
    link.friends.start();
    session.shardsCommand("pet list");
    link.healthChanged();
    link.roomFriendsChanged();
    forgetRelayKeys();
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
    this.arena.close();
  }

  private heard(e: SocialEvent): void {
    if (e.type === "pets") return this.petsHeard(e.pets);
    if (e.type === "ambient") {
      const wait = this.ambientWaiting;
      this.ambientWaiting = null;
      wait?.(e);
      return;
    }
    this.friends.handle(e);
  }

  /**
   * The crowd to see in our room (docs/adr/0015-social-on-our-server.md): the room's, as the
   * server keeps it, the same for everyone in it. Null when the server doesn't say: one of our own.
   */
  async ambientSeed(_room: string, hour: number | null): Promise<AmbientSeed | null> {
    const asked = Date.now();
    const e = await new Promise<(SocialEvent & { type: "ambient" }) | null>((resolve) => {
      const timer = setTimeout(() => {
        this.ambientWaiting = null;
        resolve(null);
      }, AMBIENT_WAIT_MS);
      this.ambientWaiting = (m) => {
        clearTimeout(timer);
        resolve(m);
      };
      this.session.shardsCommand("ambient");
    });
    if (!e || this.disposed) return null;
    // Half the round trip went by after the server measured
    const since = Date.now() - e.elapsed - (Date.now() - asked) / 2;
    return { seed: e.seed >>> 0, since, hour: e.hour ?? hour };
  }

  /**
   * docs/adr/0007-arena.md: watch the arena of our game server, in this room (null: stop). The
   * listener hears everything, then what changed; null when the gateway has no arena (or none yet).
   */
  watchArena(room: string | null, listener: ((m: ArenaMessage | null) => void) | null, hour: number | null = null): void {
    this.arenaListener = room ? listener : null;
    this.arena.watch(room, hour);
  }

  /** The game hour our sun shows, for the arena's opening hours (sent only when it changes) */
  arenaHour(hour: number | null): void {
    this.arena.setHour(hour);
  }

  /** Whether the arena's connection is up (the arena falls back to our own without it) */
  get relayOnline(): boolean {
    return this.arena.online;
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

  /** A room's name (rooms.json), by its number, else the likeliest of its file's */
  roomName(file: string, rid = 0): string {
    return this.roomNames.get(rid) ?? this.likeliestRoom(file)?.name ?? file;
  }

  /** Of a file's rooms, the first with a real name (not "Room", nor a Death Realm copy) */
  private likeliestRoom(file: string): RoomInfo | undefined {
    const rooms = this.roomsByFile.get(file.toLowerCase()) ?? [];
    return rooms.find((r) => !/^(new )?room$|^death realm$/i.test(r.name)) ?? rooms[0];
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
    const ids = this.friendObjects();
    const before = [...this.friendIds].map(([id, f]) => `${id}:${f.key}`).join();
    this.friendIds = ids;
    this.friends.setRoomFriends([...ids.values()].map((f) => f.key));
    // Players who left the room take their pets with them
    for (const id of [...this.pets.keys()]) if (!this.session.world.objects.has(id) && id !== this.session.world.player?.id) this.pets.delete(id);
    // Only a change in who's here is news (monsters come and go all the time)
    if ([...ids].map(([id, f]) => `${id}:${f.key}`).join() !== before) this.bump();
  }

  // ---- pets (docs/adr/0006-pets.md) ----

  /** Our character's pet as the server keeps it, now and when it first says (null for none) */
  onOwnPet(fn: (pet: PetChoice | null) => void): () => void {
    this.petListeners.add(fn);
    if (this.serverPet !== undefined) fn(this.serverPet);
    return () => this.petListeners.delete(fn);
  }

  /** Whether the server has said our pet yet (until then, setPet waits) */
  get petKnown(): boolean {
    return this.serverPet !== undefined;
  }

  /** Our character's pet, kept by the server and shown to everyone in our room (null for none) */
  setPet(pet: PetChoice | null): void {
    if (this.serverPet === undefined) return;
    const json = JSON.stringify(pet);
    if (json === this.petSent || json === JSON.stringify(this.serverPet)) return;
    this.petSent = json;
    this.session.shardsCommand(pet ? `pet set ${pet.kind} ${pet.colour}${pet.name ? ` ${pet.name}` : ""}` : "pet clear");
  }

  /** A player's pet, by their name, if they're in our room with one */
  petOf(name: string): PetChoice | null {
    const lc = name.toLowerCase();
    for (const [id, pet] of this.pets) {
      const o = this.session.world.objects.get(id);
      if (o && (this.session.resource(o.info.nameRes) ?? "").toLowerCase() === lc) return pet;
    }
    return null;
  }

  private petsHeard(list: { id: number; pet: { kind: string; colour: number; name: string } | null }[]): void {
    const self = this.session.world.player?.id;
    for (const e of list) {
      const pet = e.pet ? readPetChoice(e.pet) : null;
      if (pet) this.pets.set(e.id, pet);
      else this.pets.delete(e.id);
      // Ours comes in the room's list (always, pet or none: SendRoomPets) and whenever it changes
      if (e.id === self) {
        this.serverPet = pet;
        this.petSent = JSON.stringify(pet);
        for (const fn of this.petListeners) fn(pet);
      }
    }
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

/** 0015 4: the relay's keys (socialKeys.ts, IndexedDB shards-social) aren't needed any more */
function forgetRelayKeys(): void {
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase("shards-social");
  } catch {
    // Not there, or not allowed: nothing to forget
  }
}
