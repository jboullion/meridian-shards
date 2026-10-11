// The original protocol (the Meridian: Shards server, ADR 0005): the layouts that differ from
// Server 104's, checked against upstream clientd3d/server.c, protocol.c, color.c, map.c and
// module/merintr, module/char. See the server repo's docs/protocol-dialect.md.

import { describe, expect, test } from "vitest";
import {
  AP, BP, ByteReader, ByteWriter, buildLogin, buildReqDrop, buildReqInventoryMove, normalizeFlags, readCharInfo, readObject,
  readShardsInfo,
} from "../src/index.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const NUMBER = 0x10000000;

describe("object flags (include/proto.h OF_*, unpacked like the original client)", () => {
  test("a plain item: nothing set", () => {
    expect(normalizeFlags(0x10)).toEqual({ flags: 0x10, drawingType: 0, minimapFlags: 0, nameColor: 0xffffff, objectType: 0, moveOnType: 0, safety: false });
  });

  test("moveon type, drawing effect and the shared bits", () => {
    // OF_MOVEON_TELEPORTER, OF_ACTIVATABLE, OF_INVISIBLE (effect 5 << 20)
    const u = normalizeFlags(0x2 | 0x800 | (5 << 20));
    expect(u.moveOnType).toBe(2);
    expect(u.drawingType).toBe(5);
    expect(u.flags).toBe(0x800);
  });

  test("a killer: player type, red name, a player dot with an enemy ring; names drawn", () => {
    // OF_PLAYER | OF_ATTACKABLE | PF_KILLER | OF_ENEMY
    const u = normalizeFlags(0x4 | 0x8 | 0x4000 | 0x02000000);
    expect(u.objectType).toBe(1);
    expect(u.nameColor).toBe(0xff0000);
    expect(u.minimapFlags).toBe(0x1 | 0x2);
    expect(u.flags & 0x1).toBe(0x1); // our OF_DISPLAY_NAME: names over players
    expect(u.flags & 0x4000).toBe(0); // the player-type bits never reach our layout
  });

  test("0x10000 is PF_CREATOR on players and OF_HANGING on everything else", () => {
    expect(normalizeFlags(0x4 | 0x10000).objectType).toBe(4);
    expect(normalizeFlags(0x4 | 0x10000).flags & 0x100).toBe(0);
    expect(normalizeFlags(0x10000).flags & 0x100).toBe(0x100); // our OF_HANGING
    expect(normalizeFlags(0x10000).flags & 0x10000).toBe(0); // not our OF_BOUNCING
  });

  test("both light bits mean bouncing; one is just flickering or flashing", () => {
    expect(normalizeFlags(0x60000).flags).toBe(0x10000);
    expect(normalizeFlags(0x20000).flags).toBe(0x20000);
    expect(normalizeFlags(0x40000).flags).toBe(0x40000);
  });

  test("safety (OF_SAFETY, our own object) and black names (OF_BLACK)", () => {
    expect(normalizeFlags(0x4 | 0x2000).safety).toBe(true);
    expect(normalizeFlags(0x4 | 0x2000).flags & 0x2000).toBe(0); // not our OF_NPC
    expect(normalizeFlags(0x4 | 0xc000 | (4 << 20)).nameColor).toBe(0); // a DM drawn black: black
  });

  test("monsters get the red dot, players the blue one, things that can't be attacked none", () => {
    expect(normalizeFlags(0x8).minimapFlags).toBe(0x20);
    expect(normalizeFlags(0x4 | 0x8).minimapFlags).toBe(0x1);
    expect(normalizeFlags(0x4).minimapFlags).toBe(0);
  });
});

test("an object: id, amount, icon, name, flags, rarity, light, translation, animation, overlays", () => {
  const w = new ByteWriter().u32(NUMBER | 5).u32(12).u32(100).u32(200).u32(0x8).u32(2).u16(0).u8(1).u16(1).u8(0);
  const r = new ByteReader(w.finish());
  const o = readObject(r);
  expect(o.amount).toBe(12);
  expect(o.rarity).toBe(2);
  expect(o.sentFlags).toBe(0x8);
  expect(o.minimapFlags).toBe(0x20);
  expect(r.remaining).toBe(0);
});

test("AP_LOGIN ends after the password: no secret key", () => {
  const digest = new Uint8Array(16).fill(1);
  const b = buildLogin({ username: "shardbot", passwordDigest: digest });
  expect(b[0]).toBe(AP.LOGIN);
  // the type, then 38 fixed bytes (blakserv/synched.c checks len >= 39 with the type), then the two strings
  expect(b.length).toBe(1 + 2 + 36 + 2 + 8 + 2 + 16);
});

test("AP_SHARDS_INFO: version, then the server's name", () => {
  const r = new ByteReader(new ByteWriter().i32(1).string("Meridian: Shards").finish());
  expect(readShardsInfo(r)).toEqual({ version: 1, serverName: "Meridian: Shards" });
  expect(AP.SHARDS_INFO).toBe(60);
});

test("ids that moved: BP_REQ_GET_FROM_CONTAINER is 239", () => {
  expect(BP.REQ_GET_FROM_CONTAINER).toBe(239);
});

test("BP_REQ_DROP is an object list (count, then id and amount for number items)", () => {
  expect(hex(buildReqDrop([{ id: NUMBER | 9, amount: 3 }]))).toBe(hex(new ByteWriter().u8(BP.REQ_DROP).u16(1).u32(NUMBER | 9).u32(3).finish()));
  expect(hex(buildReqDrop([{ id: 7 }]))).toBe(hex(new ByteWriter().u8(BP.REQ_DROP).u16(1).u32(7).finish()));
});

test("BP_REQ_INVENTORY_MOVE: positions from the end of the list, 1-based, the target one further down", () => {
  // inventry.c: 5 items, the first (0) dropped on the fourth (3): pos_target 3 > 0, so 4; then 5 - 0 and 5 - 4 + 1
  expect(hex(buildReqInventoryMove({ from: 0, to: 3, length: 5 }))).toBe(hex(new ByteWriter().u8(BP.REQ_INVENTORY_MOVE).u16(5).u16(2).finish()));
  // the fourth dropped on the second: 5 - 3 and 5 - 1 + 1
  expect(hex(buildReqInventoryMove({ from: 3, to: 1, length: 5 }))).toBe(hex(new ByteWriter().u8(BP.REQ_INVENTORY_MOVE).u16(2).u16(5).finish()));
});

test("BP_CHARINFO: spells carry a school byte, skills have none (module/char char.c)", () => {
  const w = new ByteWriter().u8(0).u8(0); // no hair or face translations
  for (let g = 0; g < 2; g++) w.i32(0).u32(1).i32(0).i32(0).i32(0); // each gender: no hair, a head, no eyes, noses or mouths
  w.i32(1).i32(5).u32(10).u32(11).i32(20).u8(2); // one spell, school 2
  w.i32(1).i32(6).u32(12).u32(13).i32(30); // one skill
  const r = new ByteReader(w.finish());
  const info = readCharInfo(r);
  expect(info.spells).toEqual([{ id: 5, nameRes: 10, descRes: 11, cost: 20, school: 2 }]);
  expect(info.skills).toEqual([{ id: 6, nameRes: 12, descRes: 13, cost: 30, school: 0 }]);
  expect(r.remaining).toBe(0);
});
