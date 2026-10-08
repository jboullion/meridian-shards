// Milestone 5 messages: stats, spells, trade, user commands and sounds, checked against
// the byte layouts in module/merintr/merintr.c, clientd3d/server.c and protocol.c.

import { describe, expect, test } from "vitest";
import {
  BP, ByteReader, ByteWriter, STATS, STAT_TAG, UC, buildReqBuyItems, buildReqCast, buildReqCounteroffer, buildReqLook, readRoomChange, buildReqOffer,
  buildSayGroup, buildUserCommand, CF, buildChangeDescription, buildChangeUrl, buildReqApply, buildReqGetFromContainer, buildReqObjectContents, buildReqPut, readBgOverlay, ANIMATE, readBuyList, readPlayWave, readSpells, readStat, readStatGroup,
} from "../src/index.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const NUMBER = 0x10000000; // CLIENT_TAG_NUMBER in the top bits

/** server.c ExtractObject for a plain object with no light, animation NONE group 1, no overlays. */
function object(w: ByteWriter, id: number, nameRes: number, amount?: number): ByteWriter {
  w.u32(id);
  if (amount !== undefined) w.u32(amount);
  return w.u32(100).u32(nameRes).u32(0).u8(0).u32(0).u32(0).u8(0).u8(0).u16(0).u8(1).u16(1).u8(0);
}

describe("stats (merintr.c ExtractStatistic)", () => {
  test("a numeric stat with limits", () => {
    const r = new ByteReader(new ByteWriter().u8(1).u8(3).u32(555).u8(STATS.NUMERIC).u8(STAT_TAG.INT).i32(100).i32(0).i32(200).i32(80).finish());
    expect(readStat(r)).toEqual({
      group: 1,
      stat: { num: 3, nameRes: 555, type: STATS.NUMERIC, numeric: { tag: STAT_TAG.INT, value: 100, min: 0, max: 200, currentMax: 80 } },
    });
    expect(r.remaining).toBe(0);
  });

  test("a group mixing a resource stat and a list stat", () => {
    const w = new ByteWriter().u8(5).u8(2);
    w.u8(1).u32(10).u8(STATS.NUMERIC).u8(STAT_TAG.RES).i32(77);
    w.u8(2).u32(11).u8(STATS.LIST).u32(9319).i32(-1).u32(32343);
    const r = new ByteReader(w.finish());
    const g = readStatGroup(r);
    expect(g.group).toBe(5);
    expect(g.stats[0].numeric).toEqual({ tag: STAT_TAG.RES, value: 77, min: 0, max: 0, currentMax: 0 });
    expect(g.stats[1].list).toEqual({ id: 9319, value: -1, icon: 32343 });
    expect(r.remaining).toBe(0);
  });

  test("spells carry targets and a 1-based school", () => {
    const w = new ByteWriter().u16(1);
    object(w, 5569, 30558).u8(1).u8(3);
    const [sp] = readSpells(new ByteReader(w.finish()));
    expect(sp.object.id).toBe(5569);
    expect(sp.numTargets).toBe(1);
    expect(sp.school).toBe(2);
  });
});

describe("trade", () => {
  test("a buy list: seller, count, objects with costs", () => {
    const w = object(new ByteWriter(), 2650, 1);
    w.u16(2);
    object(w, 9001, 2).u32(36);
    object(w, NUMBER | 9002, 3, 50).u32(5);
    const { seller, items } = readBuyList(new ByteReader(w.finish()));
    expect(seller.id).toBe(2650);
    expect(items.map((i) => [i.object.id >>> 0, i.object.amount, i.cost])).toEqual([
      [9001, 0, 36],
      [(NUMBER | 9002) >>> 0, 50, 5],
    ]);
  });

  test("plain ids lose the number tag (PARAM_ID: GetObjId); object lists keep it with the amount", () => {
    expect(hex(buildReqLook(NUMBER | 0x2485))).toBe(hex(new ByteWriter().u8(BP.REQ_LOOK).u32(0x2485).finish()));
    expect(hex(buildReqBuyItems(NUMBER | 2650, [{ id: 9001 }, { id: NUMBER | 9002, amount: 7 }, { id: NUMBER | 9003, amount: 0 }]))).toBe(
      hex(new ByteWriter().u8(BP.REQ_BUY_ITEMS).u32(2650).u16(2).u32(9001).u32(NUMBER | 9002).u32(7).finish()),
    );
    expect(hex(buildReqOffer(2650, [{ id: 7 }]))).toBe(hex(new ByteWriter().u8(BP.REQ_OFFER).u32(2650).u16(1).u32(7).finish()));
    // offer.c RcvOfferDialogProc IDOK: RequestCounteroffer, an object list (empty for "Offer nothing")
    expect(hex(buildReqCounteroffer([]))).toBe(hex(new ByteWriter().u8(BP.REQ_COUNTEROFFER).u16(0).finish()));
    expect(hex(buildReqCounteroffer([{ id: 7 }, { id: 9 | NUMBER, amount: 3 }]))).toBe(
      hex(new ByteWriter().u8(BP.REQ_COUNTEROFFER).u16(2).u32(7).u32(9 | NUMBER).u32(3).finish()),
    );
    expect(hex(buildReqCast(5569, []))).toBe(hex(new ByteWriter().u8(BP.REQ_CAST).u32(5569).u16(0).finish()));
  });

  test("user commands: type, command, int parameters", () => {
    expect(hex(buildUserCommand(UC.DEPOSIT, 100))).toBe(hex(new ByteWriter().u8(BP.USERCOMMAND).u8(35).i32(100).finish()));
    expect(hex(buildUserCommand(UC.BALANCE))).toBe(hex(Uint8Array.of(BP.USERCOMMAND, 37)));
    // UC_SEND_PREFERENCES with the CF_* flags (merintr.h SendPreferences)
    expect(hex(buildUserCommand(UC.SEND_PREFERENCES, CF.AUTOLOOT | CF.TEMPSAFE))).toBe(hex(new ByteWriter().u8(BP.USERCOMMAND).u8(9).i32(0x0a).finish()));
  });
});

test("BP_PLAY_WAVE: resource, object, flags, row, col, radius, volume", () => {
  const r = new ByteReader(new ByteWriter().u32(21447).u32(0).u8(1).i32(1).i32(1).i32(300).i32(100).finish());
  expect(readPlayWave(r)).toEqual({ resource: 21447, object: 0, flags: 1, row: 1, col: 1, radius: 300, maxVolume: 100 });
});

describe("say group", () => {
  test("is BP_SAY_GROUP, a u16 count, the plain ids, then the text (protocol.c PARAM_ID_LIST)", () => {
    const tagged = (2 << 28) | 7; // number items carry a tag; players don't, but ids go out plain either way
    expect(hex(buildSayGroup([42, tagged], "hi"))).toBe(hex(new ByteWriter().u8(BP.SAY_GROUP).u16(2).u32(42).u32(7).string("hi").finish()));
  });
});

describe("looking (dialog.c IDOK, gameuser.c ApplyCallback)", () => {
  test("BP_CHANGE_DESCRIPTION is the plain id and the text", () => {
    expect(hex(buildChangeDescription(NUMBER | 9, "hello"))).toBe(hex(new ByteWriter().u8(BP.CHANGE_DESCRIPTION).u32(9).string("hello").finish()));
  });
  test("UC_CHANGE_URL is a user command with the id and the URL (protocol.c user_msg_table)", () => {
    expect(hex(buildChangeUrl(42, "http://x"))).toBe(hex(new ByteWriter().u8(BP.USERCOMMAND).u8(UC.CHANGE_URL).u32(42).string("http://x").finish()));
  });
  test("BP_REQ_APPLY is two plain ids", () => {
    expect(hex(buildReqApply(NUMBER | 5, 6))).toBe(hex(new ByteWriter().u8(BP.REQ_APPLY).u32(5).u32(6).finish()));
  });
});

describe("containers (protocol.c PARAM_OBJECT, PARAM_ID)", () => {
  test("BP_SEND_OBJECT_CONTENTS is the plain id", () => {
    expect(hex(buildReqObjectContents(9673))).toBe(hex(new ByteWriter().u8(BP.SEND_OBJECT_CONTENTS).u32(9673).finish()));
  });
  test("BP_REQ_GET_FROM_CONTAINER keeps the number tag and adds the amount", () => {
    expect(hex(buildReqGetFromContainer(NUMBER | 5, 4))).toBe(hex(new ByteWriter().u8(BP.REQ_GET_FROM_CONTAINER).u32(NUMBER | 5).u32(4).finish()));
    expect(hex(buildReqGetFromContainer(77))).toBe(hex(new ByteWriter().u8(BP.REQ_GET_FROM_CONTAINER).u32(77).finish()));
  });
  test("BP_REQ_PUT is the object, then the plain container id", () => {
    expect(hex(buildReqPut(NUMBER | 5, 10, NUMBER | 9))).toBe(hex(new ByteWriter().u8(BP.REQ_PUT).u32(NUMBER | 5).u32(10).u32(9).finish()));
  });
});

describe("background overlays (server.c ExtractNewBackgroundOverlay)", () => {
  test("id, icon, name, animation, then the angle and height as WORDs", () => {
    const w = new ByteWriter().u32(5809).u32(100).u32(200).u8(ANIMATE.NONE).u16(1).u16(1690).u16(65508);
    expect(readBgOverlay(new ByteReader(w.finish()))).toEqual({
      id: 5809, iconRes: 100, nameRes: 200, translation: 0, effect: 0, animation: { type: ANIMATE.NONE, group: 1 }, angle: 1690, height: 65508,
    });
  });
});

describe("room changes (server.c HandleSectorMove and the rest)", () => {
  test("byte layouts", () => {
    const rc = (type: number, w: ByteWriter) => readRoomChange(type, new ByteReader(w.finish()));
    // type, sector WORD, height WORD, speed BYTE
    expect(rc(BP.SECTOR_MOVE, new ByteWriter().u8(5).u16(3).u16(172).u8(16))).toEqual({ type: "sectorMove", animation: 5, sector: 3, height: 172, speed: 16 });
    // wall WORD, ExtractAnimation, action BYTE
    expect(rc(BP.WALL_ANIMATE, new ByteWriter().u16(1).u8(ANIMATE.NONE).u16(7).u8(0))).toEqual({
      type: "wallAnimate", wall: 1, animation: { type: ANIMATE.NONE, group: 7 }, action: 0,
    });
    expect(rc(BP.SECTOR_CHANGE, new ByteWriter().u16(9).u8(0).u8(4))).toEqual({ type: "sectorChange", sector: 9, depth: 0, scroll: 4 });
    expect(rc(BP.CHANGE_TEXTURE, new ByteWriter().u16(15).u16(61016).u8(8))).toEqual({ type: "changeTexture", id: 15, texture: 61016, flags: 8 });
    expect(rc(BP.SECTOR_LIGHT, new ByteWriter().u16(2).u8(1))).toEqual({ type: "sectorLight", sector: 2, light: 1 });
    expect(rc(BP.SAID, new ByteWriter())).toBeNull();
  });
});
