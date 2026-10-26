// The user commands GameSession reads with userCommands.ts, written as shards-server sends them:
// user.kod SendTravelList and SendPvPUntil, shardssocial.kod, questbook.kod SendOffers, SendBoard,
// SendLog, SendProgress and SendSignets, and system.kod SendSeason.

import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter, UC } from "@shards/protocol";
import { readPvpUntil, readQuestLog, readQuestOffers, readQuestProgress, readSeason, readSignets, readSocial, readTravelList } from "../src/userCommands.ts";
import { fixture, userCommand } from "../../protocol/test/fixture.ts";

const SOURCE = "packages/world/src/userCommands.ts";
const names: Record<number, string> = { 31: "Barloque", 32: "Tos", 40: "Ann", 41: "the Barloque Inn", 50: "BARLOQUE.ROO", 51: "Tos.roo" };
const resource = (id: number) => names[id];
const read = (w: ByteWriter) => new ByteReader(w.finish());

describe("UC_TRAVEL_LIST and UC_PVP_UNTIL (user.kod)", () => {
  it("reads the places, last sent first, naming the unknown by number", () => {
    const w = new ByteWriter().u32(2).i32(90).u8(3).u32(1).u32(31).u32(3).u32(32).u32(4).u32(99);
    expect(fixture(userCommand(UC.TRAVEL_LIST, SOURCE), readTravelList, read(w), resource)).toEqual({
      type: "list", here: 2, pvpSeconds: 90, places: [{ id: 4, name: "#4" }, { id: 3, name: "Tos" }, { id: 1, name: "Barloque" }],
    });
  });

  it("reads the PvP lockout's seconds", () => {
    expect(fixture(userCommand(UC.PVP_UNTIL, SOURCE), readPvpUntil, read(new ByteWriter().i32(42)))).toEqual({ type: "pvp", seconds: 42 });
  });
});

describe("UC_FRIENDS, UC_PETS and UC_AMBIENT (shardssocial.kod)", () => {
  const friends = (w: ByteWriter) => fixture(userCommand(UC.FRIENDS, SOURCE), readSocial, UC.FRIENDS, read(w), resource);

  it("reads the list (SendList)", () => {
    const w = new ByteWriter().u8(1).u8(5).u16(2).string("Shardpal").u8(1).u32(0).string("Ann").u8(0).u32(100);
    w.u16(1).string("Bob").u16(0).u8(1).string("Shardpal").u16(2).string("Cy").string("Dee");
    expect(friends(w)).toEqual({
      type: "friends", flags: 5,
      friends: [{ name: "Shardpal", online: true, lastSeen: 0 }, { name: "Ann", online: false, lastSeen: 100 }],
      incoming: ["Bob"], outgoing: [], following: "Shardpal", followers: ["Cy", "Dee"],
    });
  });

  it("reads where a friend is, or that they don't say (SendLocation)", () => {
    expect(friends(new ByteWriter().u8(2).string("Ann").u8(1).u32(102).u32(50).u16(12).u16(30))).toEqual({
      type: "location", name: "Ann", shown: true, rid: 102, room: "barloque.roo", at: [12, 30],
    });
    expect(friends(new ByteWriter().u8(2).string("Ann").u8(0).u32(0).u32(0).u16(0).u16(0))).toEqual({
      type: "location", name: "Ann", shown: false, rid: 0, room: "", at: [0, 0],
    });
  });

  it("reads a friend's health, the exit a leader took and search results", () => {
    expect(friends(new ByteWriter().u8(3).string("Ann").u8(64))).toEqual({ type: "health", name: "Ann", pct: 64 });
    expect(friends(new ByteWriter().u8(4).string("Ann").u32(50).u32(51).u16(7).u16(9))).toEqual({
      type: "exit", name: "Ann", from: "barloque.roo", to: "tos.roo", at: [7, 9],
    });
    expect(friends(new ByteWriter().u8(5).u16(2).string("Ash").string("Shardpal"))).toEqual({ type: "search", names: ["Ash", "Shardpal"] });
    expect(friends(new ByteWriter().u8(9))).toBeNull();
  });

  it("reads the room's pets, pet or none (SendPets)", () => {
    const w = new ByteWriter().u16(2).u32(6981).u8(1).string("cat").u8(3).string("Tibbles").u32(6982).u8(0);
    expect(fixture(userCommand(UC.PETS, SOURCE), readSocial, UC.PETS, read(w), resource)).toEqual({
      type: "pets", pets: [{ id: 6981, pet: { kind: "cat", colour: 3, name: "Tibbles" } }, { id: 6982, pet: null }],
    });
  });

  it("reads the shared crowd, with no hour past 23 (SendAmbient)", () => {
    const ambient = (hour: number) => fixture(userCommand(UC.AMBIENT, SOURCE), readSocial, UC.AMBIENT, read(new ByteWriter().u32(0xdeadbeef).i32(-5000).u8(hour)), resource);
    expect(ambient(14)).toEqual({ type: "ambient", seed: 0xdeadbeef, elapsed: -5000, hour: 14 });
    expect(ambient(255)).toEqual({ type: "ambient", seed: 0xdeadbeef, elapsed: -5000, hour: null });
  });
});

describe("quests (questbook.kod)", () => {
  it("reads an NPC's offers, and the guild window's board (SendOffers, SendBoard)", () => {
    const offers = (w: ByteWriter) => fixture(userCommand(UC.QUEST_OFFERS, SOURCE), readQuestOffers, read(w));
    expect(offers(new ByteWriter().u32(0x10000000 | 2650).u8(2).u32(301).u8(2).u8(3).u32(305).u8(1).u8(1))).toEqual({
      type: "offers", npc: 2650, offers: [{ id: 301, state: 2, step: 3 }, { id: 305, state: 1, step: 1 }],
    });
    expect(offers(new ByteWriter().u32(0).u8(1).u32(320).u8(1).u8(1))).toEqual({ type: "board", offers: [{ id: 320, state: 1, step: 1 }] });
  });

  it("reads the log (SendLog)", () => {
    const w = new ByteWriter().u32(0xcafe1234).u8(2).u32(301).u8(2).u16(4).i32(-1).u32(305).u8(1).u16(0).i32(3600);
    w.u16(1).u32(300).u16(3);
    expect(fixture(userCommand(UC.QUEST_LOG, SOURCE), readQuestLog, read(w))).toEqual({
      type: "log", hash: 0xcafe1234,
      active: [{ id: 301, step: 2, count: 4, secondsLeft: -1 }, { id: 305, step: 1, count: 0, secondsLeft: 3600 }],
      done: [{ id: 300, times: 3 }],
    });
  });

  it("reads a step's progress (SendProgress)", () => {
    expect(fixture(userCommand(UC.QUEST_PROGRESS, SOURCE), readQuestProgress, read(new ByteWriter().u32(301).u8(2).u16(5)))).toEqual({
      type: "progress", id: 301, step: 2, count: 5,
    });
  });

  it("reads the signet rings we carry, and their owners standing nowhere (SendSignets)", () => {
    const w = new ByteWriter().u8(2).u32(0x10000000 | 7001).u32(40).u32(41).u32(102).u32(7002).u32(40).u32(98).u32(0);
    expect(fixture(userCommand(UC.SIGNETS, SOURCE), readSignets, read(w), resource)).toEqual({
      type: "signets", rings: [{ id: 7001, owner: "Ann", room: "the Barloque Inn", rid: 102 }, { id: 7002, owner: "Ann", room: "", rid: 0 }],
    });
  });
});

describe("UC_SEASON (system.kod SendSeason)", () => {
  it("reads the season, the year and the day", () => {
    expect(fixture(userCommand(UC.SEASON, SOURCE), readSeason, read(new ByteWriter().u8(2).u16(7).u16(213)))).toEqual({ season: 2, year: 7, day: 213 });
  });
});
