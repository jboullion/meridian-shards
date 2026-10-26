// Ours: the readers of our server's user commands that have no module of their own: travel
// (shards-server user.kod), friends, pets and the shared crowd (util/shardssocial.kod), quests and
// signet rings (util/questbook.kod) and the season (util/system.kod). Each takes the bytes after
// the UC byte, as GameSession hands them over.

import { objId, UC, type ByteReader } from "@shards/protocol";
import type { QuestEvent, QuestLogEntry, QuestOffer, ServerFriend, ServerPet, SignetRing, SocialEvent, TravelEvent, TravelPlace } from "./session.ts";

/** A resource's text, or nothing when we don't have it */
type Lookup = (id: number) => string | null | undefined;

/** UC_TRAVEL_LIST (user.kod SendTravelList): this point, the lockout's seconds, then id and name each */
export function readTravelList(r: ByteReader, resource: Lookup): TravelEvent {
  const here = r.u32();
  const pvpSeconds = r.i32();
  const n = r.u8();
  const places: TravelPlace[] = [];
  for (let i = 0; i < n; i++) {
    const id = r.u32();
    places.push({ id, name: resource(r.u32()) ?? `#${id}` });
  }
  return { type: "list", here, pvpSeconds, places: places.reverse() };
}

/** UC_PVP_UNTIL (user.kod SendPvPUntil): the seconds the PvP lockout has left */
export function readPvpUntil(r: ByteReader): TravelEvent {
  return { type: "pvp", seconds: r.i32() };
}

/** UC_FRIENDS, UC_PETS or UC_AMBIENT (shardssocial.kod), as an event; rooms are their files, lower case */
export function readSocial(uc: number, r: ByteReader, resource: Lookup): SocialEvent | null {
  const room = (rsc: number) => (resource(rsc) ?? "").toLowerCase();
  const names = () => {
    const out: string[] = [];
    for (let n = r.u16(); n > 0; n--) out.push(r.string());
    return out;
  };
  if (uc === UC.AMBIENT) {
    const seed = r.u32();
    const elapsed = r.i32();
    const hour = r.u8();
    return { type: "ambient", seed, elapsed, hour: hour < 24 ? hour : null };
  }
  if (uc === UC.PETS) {
    const pets: { id: number; pet: ServerPet | null }[] = [];
    for (let n = r.u16(); n > 0; n--) {
      const id = r.u32();
      if (!r.u8()) {
        pets.push({ id, pet: null });
        continue;
      }
      const kind = r.string();
      const colour = r.u8();
      pets.push({ id, pet: { kind, colour, name: r.string() } });
    }
    return { type: "pets", pets };
  }
  switch (r.u8()) {
    // FR_LIST
    case 1: {
      const flags = r.u8();
      const friends: ServerFriend[] = [];
      for (let n = r.u16(); n > 0; n--) friends.push({ name: r.string(), online: r.u8() !== 0, lastSeen: r.u32() });
      const incoming = names();
      const outgoing = names();
      const following = r.u8() ? r.string() : null;
      return { type: "friends", flags, friends, incoming, outgoing, following, followers: names() };
    }
    // FR_LOC
    case 2: {
      const name = r.string();
      const shown = r.u8() !== 0;
      const rid = r.u32();
      const file = room(r.u32());
      const row = r.u16();
      return { type: "location", name, shown, rid, room: file, at: [row, r.u16()] };
    }
    // FR_HP
    case 3:
      return { type: "health", name: r.string(), pct: r.u8() };
    // FR_EXIT
    case 4: {
      const name = r.string();
      const from = room(r.u32());
      const to = room(r.u32());
      const row = r.u16();
      return { type: "exit", name, from, to, at: [row, r.u16()] };
    }
    // FR_SEARCH
    case 5:
      return { type: "search", names: names() };
  }
  return null;
}

/** UC_QUEST_OFFERS (questbook.kod SendOffers): the NPC, then id, state and step each; no NPC is the guild window's board (SendBoard) */
export function readQuestOffers(r: ByteReader): QuestEvent {
  const npc = objId(r.u32());
  const offers: QuestOffer[] = [];
  for (let i = r.u8(); i > 0; i--) offers.push({ id: r.u32(), state: r.u8(), step: r.u8() });
  return npc === 0 ? { type: "board", offers } : { type: "offers", npc, offers };
}

/** UC_QUEST_LOG (questbook.kod SendLog): the catalogue's hash, the active quests, the quests done */
export function readQuestLog(r: ByteReader): QuestEvent {
  const hash = r.u32();
  const active: QuestLogEntry[] = [];
  for (let i = r.u8(); i > 0; i--) active.push({ id: r.u32(), step: r.u8(), count: r.u16(), secondsLeft: r.i32() });
  const done: { id: number; times: number }[] = [];
  for (let i = r.u16(); i > 0; i--) done.push({ id: r.u32(), times: r.u16() });
  return { type: "log", hash, active, done };
}

/** UC_QUEST_PROGRESS (questbook.kod SendProgress): a quest's id, step and count */
export function readQuestProgress(r: ByteReader): QuestEvent {
  return { type: "progress", id: r.u32(), step: r.u8(), count: r.u16() };
}

/** UC_SIGNETS (questbook.kod SendSignets): each ring, its owner's name, their room's name and number */
export function readSignets(r: ByteReader, resource: Lookup): QuestEvent {
  const rings: SignetRing[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const id = objId(r.u32());
    const owner = resource(r.u32()) ?? "";
    const room = resource(r.u32()) ?? "";
    rings.push({ id, owner, room, rid: r.u32() });
  }
  return { type: "signets", rings };
}

/** UC_SEASON (system.kod SendSeason): the season (WEATHER_SEASON_*), the year, the day of the year */
export function readSeason(r: ByteReader): { season: number; year: number; day: number } {
  return { season: r.u8(), year: r.u16(), day: r.u16() };
}
