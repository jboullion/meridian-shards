// Milestone 5 messages: stats, spells, trade, user commands and sounds, checked against
// the byte layouts in module/merintr/merintr.c, clientd3d/server.c and protocol.c.

import { describe, expect, test } from "vitest";
import {
  BP, ByteReader, ByteWriter, STATS, STAT_TAG, UC, buildReqBuyItems, buildReqCast, buildReqLook, buildReqOffer,
  buildSayGroup, buildUserCommand, CF, readBuyList, readPlayWave, readSpells, readStat, readStatGroup,
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
