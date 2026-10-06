// Builds dist/assets: the original game files the browser loads, served as-is.
// Raw art never goes in git; this folder is git-ignored and rebuilt any time.
//
//   node tools/assets/build-assets.ts [--client <dir>] [--force]
//
// Sources, first match wins per (lower-cased) file name:
//   1. our server build: rsc/rsc0000.rsb and rooms/*.roo. These MUST match the
//      running server (redbook token, room checksums), so they always win.
//   2. the Server 104 resource tree in server/src/resource (104-only additions)
//   3. the installed 104 client's resource folder (%LOCALAPPDATA%\Meridian-104\resource)
// Plus the palette (blakston.pal, parsed to a 768-byte binary palette.bin).
//
// Output: dist/assets/<name> and dist/assets/manifest.json:
//   { generated, rsbHash, files: { name: { size, hash } } }
// Files are copied only when size or mtime changed (use --force to recopy).

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({
  options: {
    client: { type: "string", default: join(process.env.LOCALAPPDATA ?? "", "Meridian-104", "resource") },
    force: { type: "boolean", default: false },
  },
});

const OUT = join(ROOT, "dist", "assets");
const SERVER = join(ROOT, "server", "src");
const RUN = join(SERVER, "run", "server");
const EXTS = new Set([".bgf", ".roo", ".rsb", ".ogg", ".wav", ".mp3", ".bsf"]);

type Source = { label: string; dir: string; recursive: boolean; filter?: (name: string) => boolean };
const sources: Source[] = [
  { label: "server rsb", dir: join(RUN, "rsc"), recursive: false, filter: (n) => n === "rsc0000.rsb" },
  { label: "server rooms", dir: join(RUN, "rooms"), recursive: false },
  { label: "installed client", dir: opt.client!, recursive: true },
  { label: "server resource tree", dir: join(SERVER, "resource"), recursive: true },
];

function* walk(dir: string, recursive: boolean): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive) yield* walk(p, recursive);
    } else yield p;
  }
}

const chosen = new Map<string, { path: string; source: string }>();
for (const s of sources) {
  if (!existsSync(s.dir)) {
    console.warn(`!! missing source (${s.label}): ${s.dir}`);
    continue;
  }
  let n = 0;
  for (const p of walk(s.dir, s.recursive)) {
    const base = basename(p).toLowerCase();
    if (!EXTS.has(extname(base))) continue;
    if (s.filter && !s.filter(base)) continue;
    if (chosen.has(base)) continue;
    chosen.set(base, { path: p, source: s.label });
    n++;
  }
  console.log(`${s.label}: ${n} files`);
}
if (!chosen.has("rsc0000.rsb")) {
  console.error("!! no rsc0000.rsb from the server build; run server\\build.cmd first");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, "manifest.json");
const old: Record<string, { size: number; hash: string; mtime?: number }> = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8")).files
  : {};

const files: Record<string, { size: number; hash: string; mtime: number }> = {};
let copied = 0;
let bytes = 0;
for (const [name, { path }] of [...chosen].sort(([a], [b]) => a.localeCompare(b))) {
  const st = statSync(path);
  const dest = join(OUT, name);
  const prev = old[name];
  if (!opt.force && prev && prev.size === st.size && prev.mtime === st.mtimeMs && existsSync(dest)) {
    files[name] = { size: prev.size, hash: prev.hash, mtime: prev.mtime };
  } else {
    copyFileSync(path, dest);
    const hash = createHash("sha1").update(readFileSync(dest)).digest("hex").slice(0, 16);
    files[name] = { size: st.size, hash, mtime: st.mtimeMs };
    copied++;
  }
  bytes += st.size;
}

// Palette: blakston.pal is 256 lines of "r g b".
const pal = readFileSync(join(SERVER, "blakston.pal"), "latin1")
  .split(/\r?\n/)
  .map((l) => l.trim().split(/\s+/).map(Number))
  .filter((v) => v.length >= 3 && v.every((x) => Number.isFinite(x)));
if (pal.length !== 256) throw new Error(`blakston.pal has ${pal.length} entries, expected 256`);
const palBin = Uint8Array.from(pal.flatMap((v) => v.slice(0, 3)));
writeFileSync(join(OUT, "palette.bin"), palBin);
files["palette.bin"] = {
  size: palBin.length,
  hash: createHash("sha1").update(palBin).digest("hex").slice(0, 16),
  mtime: 0,
};

writeFileSync(
  manifestPath,
  JSON.stringify({ generated: new Date().toISOString(), rsbHash: files["rsc0000.rsb"].hash, files }, null, 0),
);
console.log(`dist/assets: ${Object.keys(files).length} files, ${(bytes / 2 ** 20).toFixed(0)} MB, ${copied} copied`);
