// Parses the real game files from dist/assets-101 (built by `npm run assets` from the 101 server).
// Skipped when the assets aren't there, since they're never in git.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { gridTextureName, leafAt, parseBgf, parseRoo, parseRsb, TRANSPARENT_INDEX } from "../src/index.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets-101");
const have = existsSync(join(ASSETS, "manifest.json"));
const read = (name: string) => new Uint8Array(readFileSync(join(ASSETS, name)));

describe.skipIf(!have)("original game files", () => {
  test("every room parses and its checksum matches", () => {
    const rooms = readdirSync(ASSETS).filter((f) => f.endsWith(".roo"));
    expect(rooms.length).toBeGreaterThan(250); // the 101 server has 265
    const bad: string[] = [];
    for (const f of rooms) {
      const room = parseRoo(read(f));
      if (!room.securityOk) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  test("both room versions: v12 (int coordinates) and v13 (floats)", () => {
    const versions = new Set(readdirSync(ASSETS).filter((f) => f.endsWith(".roo")).map((f) => parseRoo(read(f)).version));
    expect([...versions].sort()).toEqual([12, 13]);
    // Tos's inn (v12): the square in front of the bar is inside a sector
    const inn = parseRoo(read("tosinn.roo"));
    expect(inn.securityOk).toBe(true);
    const leaf = leafAt(inn, (6 - 1) * 1024 + 512, (6 - 1) * 1024 + 512);
    expect(leaf?.sector).toBeGreaterThan(0);
  });

  test("Tos's textures all load", async () => {
    const room = parseRoo(read("tos.roo"));
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
    // config.c:196 RedbookRsc: system_success_rsc, numbered by the Kod build
    const rsb = parseRsb(read("rsc0000.rsb"));
    expect([...rsb.entries.values()].some((langs) => langs.get(0) === "Success.")).toBe(true);
  });
});
