// Parses the real game files from dist/assets (built by `npm run assets`).
// Skipped when the assets aren't there, since they're never in git.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { gridTextureName, leafAt, parseBgf, parseRoo, parseRsb, TRANSPARENT_INDEX } from "../src/index.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "manifest.json"));
const read = (name: string) => new Uint8Array(readFileSync(join(ASSETS, name)));

describe.skipIf(!have)("original game files", () => {
  test("every room parses and its checksum matches", () => {
    const rooms = readdirSync(ASSETS).filter((f) => f.endsWith(".roo"));
    expect(rooms.length).toBeGreaterThan(300);
    const bad: string[] = [];
    for (const f of rooms) {
      const room = parseRoo(read(f));
      if (!room.securityOk) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  test("Raza inn: security matches what the server sent in BP_PLAYER", () => {
    // The value goes through a 28-bit Kod integer, so the client compares the low
    // 28 bits only (clientd3d/game.c GetObjId(player.room_security)).
    const low28 = (v: number) => v & 0x0fffffff;
    const inn = parseRoo(read("razainn.roo"));
    expect(low28(inn.security)).toBe(low28(4188566272));
    expect(low28(parseRoo(read("raza.roo")).security)).toBe(low28(4192869060));
    // the bot spawned at row 3, col 8: that point must be inside a sector
    const leaf = leafAt(inn, (8 - 1) * 1024 + 512, (3 - 1) * 1024 + 512);
    expect(leaf?.sector).toBeGreaterThan(0);
  });

  test("Raza's textures all load", async () => {
    const room = parseRoo(read("raza.roo"));
    const ids = new Set<number>();
    for (const s of room.sectors) ids.add(s.floorType).add(s.ceilingType);
    for (const s of room.sidedefs) ids.add(s.normalType).add(s.aboveType).add(s.belowType);
    ids.delete(0);
    let loaded = 0;
    for (const id of ids) {
      const name = gridTextureName(id);
      if (!existsSync(join(ASSETS, name))) continue;
      const bgf = await parseBgf(read(name));
      const b = bgf.bitmaps[0];
      expect(b.pixels.length).toBe(b.width * b.height);
      loaded++;
    }
    expect(loaded).toBeGreaterThan(ids.size * 0.9);
  });

  test("a sprite has groups and transparency", async () => {
    const bgf = await parseBgf(read("bunnyg.bgf"));
    expect(bgf.groups.length).toBeGreaterThan(0);
    expect(bgf.bitmaps[0].pixels.includes(TRANSPARENT_INDEX)).toBe(true);
  });

  test("rsb has the redbook string", () => {
    expect(parseRsb(read("rsc0000.rsb")).get(20147)).toBe("Success.");
  });
});
