// The game files our own code names (ambient life, critters, pets, rocks, the arena) must be in
// the asset build: our server can drop a monster or restyle its art (iconforge) under us.
// Skipped when the assets aren't there, since they're never in git.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { parseBgf } from "../../packages/formats/src/index.ts";
import { SPECIES } from "../../packages/world/src/ambient/critters.ts";
import { PET_KINDS, type PetAnim } from "../../packages/world/src/pets.ts";

const ROOT = join(import.meta.dirname, "../..");
const ASSETS = join(ROOT, "dist/assets");
const have = existsSync(join(ASSETS, "manifest.json"));
const files = (): Record<string, unknown> =>
  (JSON.parse(readFileSync(join(ASSETS, "manifest.json"), "utf8")) as { files: Record<string, unknown> }).files;

/** Every "name.bgf" and "name.ogg" written in the client's sources, tests left out */
function namedInSource(): Map<string, string> {
  const named = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        for (const m of readFileSync(p, "utf8").matchAll(/"([\w-]+\.(?:bgf|ogg))"/g)) {
          named.set(m[1]!.toLowerCase(), relative(ROOT, p));
        }
      }
    }
  };
  for (const dir of ["packages/world/src", "packages/render/src", "apps/client/src"]) walk(join(ROOT, dir));
  return named;
}

describe.skipIf(!have)("art our code names", () => {
  test("every .bgf and .ogg named in the sources is in the asset build", () => {
    const manifest = files();
    const missing = [...namedInSource()].filter(([name]) => !(name in manifest)).map(([name, from]) => `${name} (${from})`);
    expect(missing).toEqual([]);
  });

  test("critters' and pets' walk cycles are within their art's groups", async () => {
    const counts = new Map<string, number>();
    const groups = async (icon: string) => {
      const key = icon.toLowerCase();
      if (!counts.has(key)) counts.set(key, (await parseBgf(new Uint8Array(readFileSync(join(ASSETS, key))))).groups.length);
      return counts.get(key)!;
    };
    const bad: string[] = [];
    const check = async (what: string, icon: string, anim: PetAnim) => {
      const n = await groups(icon);
      if (anim && n < anim.high) bad.push(`${what}: ${icon} has ${n} groups, the cycle needs ${anim.high}`);
    };
    for (const [name, s] of Object.entries(SPECIES)) await check(`critter ${name}`, s.icon, s.walk);
    for (const [name, k] of Object.entries(PET_KINDS)) {
      await check(`pet ${name} stand`, k.icon, k.stand);
      await check(`pet ${name} walk`, k.icon, k.walk);
      if (k.overlay) {
        await check(`pet ${name} overlay stand`, k.overlay.icon, k.overlay.stand);
        await check(`pet ${name} overlay walk`, k.overlay.icon, k.overlay.walk);
      }
    }
    expect(bad).toEqual([]);
  });
});
