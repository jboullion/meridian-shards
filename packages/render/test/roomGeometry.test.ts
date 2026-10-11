// Builds every room of the asset build (the Shards server's, upstream's rooms) from the real
// files in dist/assets (skipped without them).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { gridTextureName, parseBgf, parseRoo } from "@shards/formats";
import { buildRoomGeometry, type TextureInfo } from "../src/roomGeometry.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "manifest.json"));
const ROOMS: string[] = have
  ? Object.keys(JSON.parse(readFileSync(join(ASSETS, "manifest.json"), "utf8")).files as object)
      .filter((f) => f.endsWith(".roo"))
      .map((f) => f.slice(0, -4))
  : [];

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

describe.skipIf(!have)("room geometry", () => {
  test("every room builds with finite coordinates; nearly every texture is in the build", async () => {
    let missing = 0,
      total = 0,
      cycles = 0,
      scrolls = 0,
      sky = 0;
    for (const name of ROOMS) {
      const { ids, info, geometry } = await build(name);
      total += ids.size;
      missing += ids.size - info.size;
      let tris = 0;
      for (const b of geometry.batches.values()) {
        expect(b.positions.length % 9, name).toBe(0);
        expect(b.positions.every(Number.isFinite), name).toBe(true);
        expect(b.uvs.every(Number.isFinite), name).toBe(true);
        tris += b.positions.length / 9;
        if (b.animation?.kind === "cycle") cycles++;
        if (b.animation?.kind === "scroll") scrolls++;
      }
      if (geometry.skySectors.size) sky++;
      expect(tris, name).toBeGreaterThan(0);
    }
    expect(ROOMS.length).toBeGreaterThan(250);
    expect(missing).toBeLessThan(total * 0.01);
    // animated (cycling) textures, scrolling walls or floors, and outdoor rooms with sky
    expect(cycles).toBeGreaterThan(0);
    expect(scrolls).toBeGreaterThan(0);
    expect(sky).toBeGreaterThan(10);
  }, 120_000);

  test("the Raza Inn (guest1.roo) builds with every texture", async () => {
    const { ids, info } = await build("guest1");
    expect(info.size).toBe(ids.size);
  });
});
