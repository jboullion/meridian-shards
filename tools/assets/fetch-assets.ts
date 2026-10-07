// Copies a server's game files (its /assets/, made by build-assets.ts) into dist/assets, so
// a machine without our server build can still package the desktop app with the files that
// server uses. CI does this before building the installers (.github/workflows/desktop.yml).
//
//   node tools/assets/fetch-assets.ts --from https://35-206-75-121.sslip.io [--out dist/assets]
//
// Files already there with the right content hash are kept; the rest are downloaded and
// checked against the manifest's hash. manifest.json is written last.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({
  options: {
    from: { type: "string" },
    out: { type: "string", default: join(ROOT, "dist", "assets") },
  },
});
if (!opt.from) {
  console.error("usage: node tools/assets/fetch-assets.ts --from <server origin> [--out <dir>]");
  process.exit(2);
}
const origin = opt.from.replace(/\/+$/, "");
const out = resolve(opt.out!);
const PARALLEL = 8;

const hashOf = (b: Uint8Array) => createHash("sha1").update(b).digest("hex").slice(0, 16);

const manifestBytes = new Uint8Array(await (await fetch(`${origin}/assets/manifest.json`, { cache: "no-store" })).arrayBuffer());
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as { files: Record<string, { size: number; hash: string }> };
const entries = Object.entries(manifest.files);
for (const [name] of entries)
  if (name.split("/").some((p) => !p || p === "." || p === "..") || name.includes("\\")) throw new Error(`bad file name in manifest: ${name}`);

const todo = entries.filter(([name, f]) => {
  const p = join(out, name);
  return !existsSync(p) || hashOf(readFileSync(p)) !== f.hash;
});
const mb = (n: number) => (n / 2 ** 20).toFixed(0);
console.log(`${entries.length} files; ${todo.length} to download (${mb(todo.reduce((s, [, f]) => s + f.size, 0))} MB) from ${origin}`);

let done = 0;
let failed = 0;
const worker = async () => {
  for (let next = todo.shift(); next; next = todo.shift()) {
    const [name, f] = next;
    try {
      const res = await fetch(`${origin}/assets/${name}?v=${f.hash}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (hashOf(bytes) !== f.hash) throw new Error(`hash ${hashOf(bytes)}, expected ${f.hash}`);
      mkdirSync(dirname(join(out, name)), { recursive: true });
      writeFileSync(join(out, name), bytes);
      if (++done % 500 === 0) console.log(`${done} downloaded`);
    } catch (e) {
      failed++;
      console.error(`!! ${name}: ${(e as Error).message}`);
    }
  }
};
await Promise.all(Array.from({ length: PARALLEL }, worker));
if (failed) {
  console.error(`!! ${failed} files failed; not writing manifest.json`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "manifest.json"), manifestBytes);
console.log(`dist/assets matches ${origin} (${done} downloaded)`);
