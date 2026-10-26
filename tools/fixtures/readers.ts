// Writes packages/protocol/fixtures/readers.json: every reader call the protocol and world tests
// make through fixture() (packages/protocol/test/fixture.ts), with the bytes and the reader's own
// result, for other clients' ports of our readers (meridian-godot's reader_test).
//
//   npm run fixtures
//
// It runs those tests with SHARDS_FIXTURES_OUT set, gathers the cases in test order, and rewrites
// the file only when a case changed. Without it, the tests check their cases against the file.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ReaderCase } from "../../packages/protocol/test/fixture.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = join(ROOT, "packages/protocol/fixtures/readers.json");
mkdirSync(dirname(OUT), { recursive: true });
const TESTS = ["packages/protocol/test", "packages/world/test"];

const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
const dir = mkdtempSync(join(tmpdir(), "shards-fixtures-"));
try {
  const run = spawnSync(process.execPath, [vitest, "run", ...TESTS], { cwd: ROOT, stdio: "inherit", env: { ...process.env, SHARDS_FIXTURES_OUT: dir } });
  if (run.status !== 0) throw new Error("the tests failed: fixtures not written");

  const found: { file: string; seq: number; case: ReaderCase }[] = [];
  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) if (line) found.push(JSON.parse(line));
  }
  found.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.seq - b.seq));
  const cases = found.map((f) => f.case);
  const names = new Set<string>();
  for (const c of cases) {
    if (names.has(c.name)) throw new Error(`two cases are named "${c.name}": rename a test`);
    names.add(c.name);
  }

  const old = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as { cases: ReaderCase[] }) : null;
  if (old && JSON.stringify(old.cases) === JSON.stringify(cases)) {
    console.log(`${OUT}: up to date (${cases.length} cases)`);
  } else {
    const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" });
    const commit = git.status === 0 ? git.stdout.trim() : "";
    const head = `{"commit": ${JSON.stringify(commit)}, "generated": ${JSON.stringify(new Date().toISOString())},\n "cases": [\n`;
    writeFileSync(OUT, head + cases.map((c) => "  " + JSON.stringify(c)).join(",\n") + "\n]}\n");
    console.log(`${OUT}: ${cases.length} cases written`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
