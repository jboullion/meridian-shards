import { describe, expect, test } from "vitest";
import type { CharacterSlot } from "@shards/protocol";
import { sortCharacters } from "../CharacterSelect.tsx";
import { fixCmapLanguages } from "./font.ts";
import { graphFraction, graphValueAt } from "./graph.ts";

describe("BlakGraph maths (graphctl.c)", () => {
  test("the bar's reach is clamped to the range", () => {
    expect(graphFraction(25, 1, 50)).toBeCloseTo(24 / 49);
    expect(graphFraction(70, 0, 70)).toBe(1);
    expect(graphFraction(-5, 0, 70)).toBe(0);
    expect(graphFraction(3, 3, 3)).toBe(1);
  });

  test("GraphCtlMoveBar: clicks at the ends give min and max, inside is proportional", () => {
    // a 102 px slider control: 3 px side borders, the frame's 1 px on each side
    expect(graphValueAt(0, 102, 1, 50, true)).toBe(1);
    expect(graphValueAt(4, 102, 1, 50, true)).toBe(1);
    expect(graphValueAt(101, 102, 1, 50, true)).toBe(50);
    expect(graphValueAt(51, 102, 1, 50, true)).toBe(1 + Math.trunc((47 * 49) / 94));
  });
});

describe("charpick.c character order", () => {
  const slot = (id: number, name: string, flags = 0): CharacterSlot => ({ id, name, flags }) as CharacterSlot;

  test("names sort case-insensitively, free slots last in server order", () => {
    const sorted = sortCharacters([slot(1, "", 1), slot(2, "zed"), slot(3, "", 1), slot(4, "Alva"), slot(5, "bran")]);
    expect(sorted.map((c) => c.id)).toEqual([4, 5, 2, 1, 3]);
  });
});

describe("title font cmap fix", () => {
  test("zeroes the language of 16-bit and 32-bit cmap subtables only", () => {
    // offset table with one record (cmap at 28), then a cmap with a format 4 and a format 12 subtable
    const b = new Uint8Array(28 + 4 + 16 + 6 + 12);
    const dv = new DataView(b.buffer);
    dv.setUint16(4, 1);
    b.set([..."cmap"].map((c) => c.charCodeAt(0)), 12);
    dv.setUint32(20, 28);
    dv.setUint16(28 + 2, 2);
    dv.setUint32(28 + 4 + 4, 20); // subtable 1 at cmap + 20
    dv.setUint32(28 + 12 + 4, 26); // subtable 2 at cmap + 26
    dv.setUint16(48, 4);
    dv.setUint16(48 + 4, 1);
    dv.setUint16(54, 12);
    dv.setUint32(54 + 8, 7);
    const fixed = new DataView(fixCmapLanguages(b).buffer);
    expect(fixed.getUint16(48 + 4)).toBe(0);
    expect(fixed.getUint32(54 + 8)).toBe(0);
    expect(dv.getUint16(48 + 4)).toBe(1); // the input is left alone
  });
});
