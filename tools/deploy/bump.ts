// One button for a release: ships first (tools/deploy/ship.ts: build, check, commit, push,
// deploy, rebuild changed rooms), then releases the next version with tools/deploy/release.ts,
// which tags it and follows the Desktop builds workflow until the release is published.
//
//   npm run release:patch -- -m "What changed"   0.12.0 -> 0.12.1 (an incremental release)
//   npm run release:minor -- -m "What changed"   0.12.0 -> 0.13.0
//   node tools/deploy/bump.ts major              0.12.0 -> 1.0.0
//
// --skip-ship releases what's already deployed and pushed. --no-wait pushes the tag and leaves.
// ship.ts's options pass through: -m/--message, --message-file, --skip-build, --skip-checks,
// --dry-run (which also only prints the version it would release).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    message: { type: "string", short: "m" },
    "message-file": { type: "string" },
    "skip-build": { type: "boolean", default: false },
    "skip-checks": { type: "boolean", default: false },
    "skip-ship": { type: "boolean", default: false },
    "no-wait": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const part = positionals[0];
if (part !== "patch" && part !== "minor" && part !== "major") {
  console.error('usage: node tools/deploy/bump.ts <patch|minor|major> [-m "message"] [--skip-ship] [--no-wait] [--dry-run]');
  process.exit(2);
}

const current = (JSON.parse(readFileSync(join(ROOT, "apps", "desktop", "package.json"), "utf8")) as { version: string }).version;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!m) {
  console.error(`apps/desktop/package.json has version "${current}", not x.y.z`);
  process.exit(1);
}
const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
const next = part === "major" ? `${major + 1}.0.0` : part === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
console.log(`Release ${current} -> ${next} (${part})`);

function run(script: string, args: string[]) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!opt["skip-ship"]) {
  const shipArgs: string[] = [];
  if (opt.message) shipArgs.push("--message", opt.message);
  if (opt["message-file"]) shipArgs.push("--message-file", opt["message-file"]);
  if (opt["skip-build"]) shipArgs.push("--skip-build");
  if (opt["skip-checks"]) shipArgs.push("--skip-checks");
  if (opt["dry-run"]) shipArgs.push("--dry-run");
  run("tools/deploy/ship.ts", shipArgs);
}

if (opt["dry-run"]) {
  console.log(`\nWould release v${next} (dry run).`);
  process.exit(0);
}
run("tools/deploy/release.ts", [next, ...(opt["no-wait"] ? ["--no-wait"] : [])]);
