// Parses the real game files from dist/assets (built by `npm run assets`).
// Skipped when the assets aren't there, since they're never in git.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { gridTextureName, leafAt, parseBgf, parseRoo, parseRsb, TRANSPARENT_INDEX } from "../src/index.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "manifest.json"));
const read = (name: string) => new Uint8Array(readFileSync(join(ASSETS, name)));
/** The files of the current build (the folder can hold files left over from an older one) */
const built = (): string[] => (have ? Object.keys(JSON.parse(readFileSync(join(ASSETS, "manifest.json"), "utf8")).files) : []);

describe.skipIf(!have)("original game files", () => {
  test("every room parses and its checksum matches", () => {
    // The Shards server's rooms (upstream resource/rooms): versions 12 and 13
    const rooms = built().filter((f) => f.endsWith(".roo"));
    expect(rooms.length).toBeGreaterThan(250);
    const bad: string[] = [];
    for (const f of rooms) {
      const room = parseRoo(read(f));
      if (!room.securityOk) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  test("Raza Inn (the newbie area) parses", () => {
    const inn = parseRoo(read("guest1.roo")); // upstream's "Raza Inn" (kod room/guest1/newb1.kod)
    expect(inn.securityOk).toBe(true);
    // some square of it is inside a sector
    let inside = false;
    for (let row = 0; row < inn.rows && !inside; row++)
      for (let col = 0; col < inn.cols && !inside; col++) inside = (leafAt(inn, col * 1024 + 512, row * 1024 + 512)?.sector ?? 0) > 0;
    expect(inside).toBe(true);
  });

  test("the Raza Inn's textures all load", async () => {
    const room = parseRoo(read("guest1.roo"));
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
    const bgf = await parseBgf(read("bunny.bgf"));
    expect(bgf.groups.length).toBeGreaterThan(0);
    expect(bgf.bitmaps[0].pixels.includes(TRANSPARENT_INDEX)).toBe(true);
  });

  test("rsb (RSC v4) has the redbook string", () => {
    // RedbookRsc defaults to system_success_rsc (blakserv/config.c); its id depends on the Kod build
    const rsb = parseRsb(read("rsc0000.rsb"));
    expect(rsb.entries.size).toBeGreaterThan(10000);
    expect([...rsb.entries.values()]).toContain("Success.");
  });
});
