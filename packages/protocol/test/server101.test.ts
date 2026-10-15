// What the 101 server (the original Meridian 59 code) does differently from Server 104, checked
// against its byte layouts: clientd3d/server.c ExtractObject, protocol.c, include/proto.h,
// module/char/char.c and login.c.

import { describe, expect, test } from "vitest";
import {
  AP, BP, ByteReader, ByteWriter, CLIENT_MAJOR, CLIENT_MINOR, DOWNLOAD_TIME, buildLogin, buildReqDrop, buildReqGame,
  buildReqGetFromContainer, buildReqInventoryMove, passwordDigest, readCharInfo, readObject, unpackObjectFlags,
} from "../src/index.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const NUMBER = 0x10000000; // CLIENT_TAG_NUMBER in the top bits

describe("the object record (server.c:319-352)", () => {
  test("flags, then rarity, then the light", () => {
    const w = new ByteWriter().u32(7).u32(100).u32(200).u32(0x4 | 0x8).u32(2);
    w.u16(1).u8(200).u16(0x7fff); // light on
    w.u8(1).u16(3).u8(0); // no translation, animation NONE group 3, no overlays
    const o = readObject(new ByteReader(w.finish()));
    expect(o.rarity).toBe(2);
    expect(o.light).toEqual({ flags: 1, intensity: 200, color: 0x7fff });
    expect(o.animation).toEqual({ type: 1, group: 3 });
  });

  test("a player's kind, guild relations and safety come from the flags word", () => {
    // OF_PLAYER | OF_ATTACKABLE | PF_OUTLAW | OF_ENEMY | OF_SAFETY
    const outlaw = unpackObjectFlags(0x4 | 0x8 | 0x8000 | 0x02000000 | 0x2000);
    expect(outlaw.objectType).toBe(2);
    expect(outlaw.nameColor).toBe(0xfc8000);
    expect(outlaw.minimapFlags).toBe(0x1 | 0x2);
    expect(outlaw.safety).toBe(true);
    // the client's flags: player, attackable, and its name drawn; OF_SAFETY isn't OF_NPC
    expect(outlaw.flags).toBe(0x4 | 0x8 | 0x1);
    // PF_CREATOR shares its bit with OF_HANGING: a creator doesn't hang
    expect(unpackObjectFlags(0x4 | 0x10000).flags & 0x100).toBe(0);
    expect(unpackObjectFlags(0x4 | 0x10000).nameColor).toBe(0xffff00);
  });

  test("objects: moving on, hanging, bouncing, drawing effects", () => {
    const f = unpackObjectFlags(0x3 | 0x10000 | 0x60000 | 0x00500000);
    expect(f.moveOnType).toBe(3);
    expect(f.flags & 0x100).toBe(0x100); // hanging
    // OF_BOUNCING is OF_FLICKERING | OF_FLASHING together (object.c:78): bouncing only
    expect(f.flags & 0x70000).toBe(0x10000);
    expect(f.drawingType).toBe(5); // OF_INVISIBLE
    expect(f.minimapFlags).toBe(0); // not attackable
    // a monster gets the monster dot, unless it's invisible
    expect(unpackObjectFlags(0x8).minimapFlags).toBe(0x20);
    expect(unpackObjectFlags(0x8 | 0x00500000).minimapFlags).toBe(0);
    // drawn black: a black name
    expect(unpackObjectFlags(0x4 | 0x00400000).nameColor).toBe(0);
  });
});

describe("requests (protocol.c, include/proto.h)", () => {
  test("BP_REQ_DROP is an object list, with the amount for number items", () => {
    expect(hex(buildReqDrop(0x1234))).toBe(hex(new ByteWriter().u8(BP.REQ_DROP).u16(1).u32(0x1234).finish()));
    expect(hex(buildReqDrop(NUMBER | 0x99, 25))).toBe(hex(new ByteWriter().u8(BP.REQ_DROP).u16(1).u32(NUMBER | 0x99).u32(25).finish()));
  });

  test("BP_REQ_INVENTORY_MOVE is two WORDs; BP_REQ_GET_FROM_CONTAINER is 239", () => {
    expect(hex(buildReqInventoryMove(3, 1))).toBe(hex(Uint8Array.of(127, 3, 0, 1, 0)));
    expect(buildReqGetFromContainer(5)[0]).toBe(239);
  });

  test("AP_LOGIN: version 7.37, the name and the password digest, nothing more", () => {
    const digest = passwordDigest("shardbot");
    const m = buildLogin({ username: "shardbot", passwordDigest: digest, screenWidth: 800, screenHeight: 600 });
    expect([m[0], m[1], m[2]]).toEqual([AP.LOGIN, 7, 37]);
    const tail = new ByteWriter().string("shardbot").string(digest).finish();
    expect(hex(m.subarray(m.length - tail.length))).toBe(hex(tail));
    expect(m.length).toBe(3 + 36 + tail.length);
  });

  test("AP_REQ_GAME: the Steam download number and the catch (login.c:224)", () => {
    const m = new ByteReader(buildReqGame());
    expect(m.u8()).toBe(AP.REQ_GAME);
    expect(m.i32()).toBe(DOWNLOAD_TIME);
    expect(m.i32()).toBe((CLIENT_MAJOR * 100 + CLIENT_MINOR) * 3 + 3);
  });
});

test("BP_CHARINFO: spells end with their school, skills don't (char.c:200-228)", () => {
  const w = new ByteWriter().u8(1).u8(4).u8(1).u8(9);
  for (let g = 0; g < 2; g++) w.i32(1).u32(10).u32(11).i32(1).u32(12).i32(1).u32(13).i32(1).u32(14);
  w.i32(1).i32(100).u32(500).u32(501).i32(20).u8(3);
  w.i32(2).i32(200).u32(600).u32(601).i32(15).i32(201).u32(602).u32(603).i32(30);
  const r = new ByteReader(w.finish());
  const info = readCharInfo(r);
  expect(r.remaining).toBe(0);
  expect(info.spells).toEqual([{ id: 100, nameRes: 500, descRes: 501, cost: 20, school: 3 }]);
  expect(info.skills.map((s) => [s.id, s.cost])).toEqual([[200, 15], [201, 30]]);
});
