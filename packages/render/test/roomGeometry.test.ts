// Builds Tos's rooms from the real files in dist/assets-101 (skipped without them).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { gridTextureName, parseBgf, parseRoo } from "@shards/formats";
import { buildRoomGeometry, type TextureInfo } from "../src/roomGeometry.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets-101");
const have = existsSync(join(ASSETS, "manifest.json"));
const SLICE = ["tos", "tosinn", "tossmith", "tosapoth", "tosbank", "toshall", "tostavern", "jas-east", "jas-west", "barln"];

async function build(name: string) {
  const room = parseRoo(new Uint8Array(readFileSync(join(ASSETS, `${name}.roo`))));
  const info = new Map<number, TextureInfo>();
  const ids = new Set<number>();
  for (const s of room.sectors) ids.add(s.floorType).add(s.ceilingType);
  for (const s of room.sidedefs) ids.add(s.normalType).add(s.aboveType).add(s.belowType);
  ids.delete(0);
  for (const id of ids) {
    const f = join(ASSETS, gridTextureName(id));
    if (!existsSync(f)) continue;
    const b = await parseBgf(new Uint8Array(readFileSync(f)));
    info.set(id, { width: b.bitmaps[0].width, height: b.bitmaps[0].height, shrink: b.shrink });
  }
  return { ids, info, geometry: buildRoomGeometry(room, (id) => info.get(id) ?? null) };
}

describe.skipIf(!have)("slice room geometry", () => {
  test.each(SLICE)("%s builds with every texture and finite coordinates", async (name) => {
    const { ids, info, geometry } = await build(name);
    expect(info.size).toBe(ids.size);
    let tris = 0;
    for (const b of geometry.batches.values()) {
      expect(b.positions.length % 9).toBe(0);
      expect(b.positions.every(Number.isFinite)).toBe(true);
      expect(b.uvs.every(Number.isFinite)).toBe(true);
      tris += b.positions.length / 9;
    }
    expect(tris).toBeGreaterThan(50);
  });

  test("textures cycle and scroll (Cor Noth), and the streets have sky", async () => {
    const cornoth = await build("cornoth");
    expect([...cornoth.geometry.batches.values()].some((b) => b.animation?.kind === "cycle")).toBe(true);
    expect([...cornoth.geometry.batches.values()].some((b) => b.animation?.kind === "scroll")).toBe(true);
    expect((await build("tos")).geometry.skySectors.size).toBeGreaterThan(0);
  });
});
