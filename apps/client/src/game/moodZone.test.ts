// Reads the real rooms from dist/assets (skipped without them).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseRoo } from "@shards/formats";
import { skyFraction, zoneKind } from "./moodZone.ts";

const ASSETS = join(import.meta.dirname, "../../../../dist/assets");
const room = (file: string) => parseRoo(new Uint8Array(readFileSync(join(ASSETS, file))));
const terrain = (): Record<string, string[]> =>
  existsSync(join(ASSETS, "roomterrain.json")) ? JSON.parse(readFileSync(join(ASSETS, "roomterrain.json"), "utf8")) : {};

describe.skipIf(!existsSync(join(ASSETS, "raza.roo")))("which mood a room gets", () => {
  test.each([
    ["raza.roo", "outdoor"],
    ["tos.roo", "outdoor"],
    ["marion.roo", "outdoor"],
    ["razainn.roo", "inn"],
    ["razasmith.roo", "interior"],
    ["razacrypt.roo", "underground"],
    ["uworld.roo", "underworld"],
  ])("%s is %s", (file, kind) => {
    expect(zoneKind(room(file), file, terrain()[file])).toBe(kind);
  });

  test("a town is mostly sky, a shop mostly roofed", () => {
    expect(skyFraction(room("raza.roo"))).toBeGreaterThan(0.5);
    expect(skyFraction(room("razasmith.roo"))).toBeLessThan(0.5);
  });
});
