import assert from "node:assert/strict";
import { test } from "vitest";
import { ByteReader, ByteWriter, buildNewCharInfo, readCharInfo } from "../src/index.ts";

/** A BP_CHARINFO body (system.kod SendCharInfo), with our trailing facial hair lists when given. */
function charInfoBody(beards?: [number[], number[]]): Uint8Array {
  const w = new ByteWriter();
  const bytes = (a: number[]) => {
    w.u8(a.length);
    for (const v of a) w.u8(v);
  };
  const ids = (a: number[]) => {
    w.i32(a.length);
    for (const v of a) w.u32(v);
  };
  bytes([0, 10, 45]); // hair colours
  bytes([1, 2]); // skin tones
  for (const base of [100, 200]) {
    ids([base + 1, base + 2]); // hair
    w.u32(base); // head
    ids([base + 10]); // eyes
    ids([base + 20]); // noses
    ids([base + 30]); // mouths
  }
  for (let list = 0; list < 2; list++) {
    w.i32(1); // one spell, then one skill
    w.i32(7).u32(500).u32(501).i32(10).u8(1);
  }
  if (beards) for (const b of beards) ids(b);
  return w.finish();
}

test("the creator's options read our facial hair lists after the skills", () => {
  const info = readCharInfo(new ByteReader(charInfoBody([[300, 301, 302], []])));
  assert.deepEqual(info.hairTranslations, [0, 10, 45]);
  assert.deepEqual(info.parts[0].beards, [300, 301, 302]);
  assert.deepEqual(info.parts[1].beards, []);
  assert.equal(info.skills.length, 1);
});

test("a server that sends no facial hair lists offers none", () => {
  const info = readCharInfo(new ByteReader(charInfoBody()));
  assert.deepEqual(info.parts[0].beards, []);
  assert.deepEqual(info.parts[1].beards, []);
  assert.equal(info.parts[1].mouths[0], 230);
});

test("a new character sends a 6th face part only with facial hair", () => {
  const faceParts = (parts: number[]) => {
    const r = new ByteReader(
      buildNewCharInfo({
        id: 9, name: "Tester", description: "", gender: 0, faceParts: parts,
        hairTranslation: 45, skinTranslation: 2, stats: [50, 50, 50, 30, 20, 20], spells: [], skills: [],
      }),
    );
    r.u8();
    r.u8();
    r.u32();
    r.string();
    r.string();
    r.u8();
    const n = r.u16();
    return Array.from({ length: n }, () => r.i32());
  };
  assert.deepEqual(faceParts([100, 101, 110, 120, 130]), [100, 101, 110, 120, 130]);
  assert.deepEqual(faceParts([100, 101, 110, 120, 130, 300]), [100, 101, 110, 120, 130, 300]);
});
