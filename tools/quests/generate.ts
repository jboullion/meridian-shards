// The quest generator (docs/adr/0009-quests.md 6): reads shards-server's quests/ (through the
// server/src junction), checks it against the Kod, and writes kod/util/questdefs.kod. The asset
// build (tools/assets/build-assets.ts) writes the catalogue, dist/assets/quests.json, with the
// same code.
//
//   npm run quests            check, write questdefs.kod (only when it changes) and the catalogue
//   npm run quests -- --check check only
//
// server\build.cmd runs it before every build, so the Kod always matches the quests.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { QuestCatalog } from "../../packages/world/src/quests.ts";
import { buildCatalog, catalogHash } from "./catalog.ts";
import { writeQuestDefs } from "./kodWriter.ts";
import { checkAll, type Checked } from "./validate.ts";
import { loadWorld, type World } from "./world.ts";

export const SERVER_ROOT = resolve(import.meta.dirname, "../../server/src");
const ASSETS = resolve(import.meta.dirname, "../../dist/assets");

export interface QuestSources {
  questFiles: { file: string; data: unknown }[];
  givers: unknown;
  retired: unknown;
  /** Files that weren't JSON */
  errors: string[];
}

const readJson = (path: string, errors: string[], fallback: unknown): unknown => {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "latin1"));
  } catch (e) {
    errors.push(`${path.replace(/^.*[\\/]quests[\\/]/, "")}: ${(e as Error).message}`);
    return fallback;
  }
};

/** quests/*.json, givers.json and retired.json */
export function readSources(questDir: string): QuestSources {
  const errors: string[] = [];
  const special = new Set(["givers.json", "retired.json"]);
  const names = existsSync(questDir) ? readdirSync(questDir).filter((f) => f.endsWith(".json") && !special.has(f)).sort() : [];
  const questFiles = names.flatMap((file) => {
    const data = readJson(join(questDir, file), errors, undefined);
    return data === undefined ? [] : [{ file, data }];
  });
  return { questFiles, givers: readJson(join(questDir, "givers.json"), errors, []), retired: readJson(join(questDir, "retired.json"), errors, []), errors };
}

export interface Generated extends Checked {
  kod: string;
  catalog: QuestCatalog;
}

export function generateFrom(src: QuestSources, w: World): Generated {
  const checked = checkAll(src.questFiles, src.givers, src.retired, w);
  checked.errors.unshift(...src.errors);
  const quests = buildCatalog(checked.quests, checked.givers, w);
  const hash = catalogHash(quests, checked.givers);
  return { ...checked, kod: writeQuestDefs(checked.quests, checked.givers, hash), catalog: { hash, quests } };
}

/** Everything from the server's files */
export function generate(serverRoot = SERVER_ROOT): Generated {
  return generateFrom(readSources(join(serverRoot, "quests")), loadWorld(join(serverRoot, "kod")));
}

/** Writes questdefs.kod when it differs; true when written */
export function writeKod(g: Generated, serverRoot = SERVER_ROOT): boolean {
  const path = join(serverRoot, "kod", "util", "questdefs.kod");
  const before = existsSync(path) ? readFileSync(path, "latin1") : "";
  if (before === g.kod) return false;
  writeFileSync(path, g.kod, "latin1");
  return true;
}

/**
 * Writes the catalogue, dist/assets/quests.json, and its line in manifest.json (as the asset
 * build does), without a whole asset build: for the admin dashboard. The manifest keeps its
 * "generated" time, so open game tabs aren't told to reload; they refresh the one file.
 */
export function writeCatalog(g: Generated, assets = ASSETS): boolean {
  const manifestPath = join(assets, "manifest.json");
  if (!existsSync(manifestPath)) return false;
  const json = Buffer.from(JSON.stringify(g.catalog));
  writeFileSync(join(assets, "quests.json"), json);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: Record<string, { size: number; hash: string; mtime: number }> };
  manifest.files["quests.json"] = { size: json.length, hash: createHash("sha1").update(json).digest("hex").slice(0, 16), mtime: 0 };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return true;
}

if (process.argv[1]?.endsWith("generate.ts")) {
  const g = generate();
  if (g.errors.length) {
    console.error(`quests: ${g.errors.length} problem(s); questdefs.kod left as it was:`);
    for (const e of g.errors) console.error(`  ${e}`);
    process.exit(1);
  }
  if (process.argv.includes("--check")) console.log(`quests: ${g.quests.length} quests, ${g.givers.length} givers, all good`);
  else {
    const kod = writeKod(g) ? "written" : "unchanged";
    const catalog = writeCatalog(g) ? "dist/assets/quests.json written" : "no dist/assets yet (npm run assets)";
    console.log(`quests: ${g.quests.length} quests, ${g.givers.length} givers; questdefs.kod ${kod}; ${catalog} (hash ${g.catalog.hash})`);
  }
}
