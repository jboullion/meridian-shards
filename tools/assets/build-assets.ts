// Builds dist/assets: the original game files the browser loads, served as-is.
// Raw art never goes in git; this folder is git-ignored and rebuilt any time.
//
//   node tools/assets/build-assets.ts [--art <dir>] [--force]
//
// Everything comes from the Meridian: Shards server repo (tools/shardsServer.ts), except the
// art. First match wins per (lower-cased) file name:
//   1. rsc0000.rsb, merged here from the server build's .rsc files (run\server\rsc, as
//      util/rscmerge.c does), and the rooms the server reads (resource\rooms). These MUST
//      match the running server (redbook token, room checksums), so they always win.
//   2. the art from an installed original client (--art, MERIDIAN_ART_DIR; the Steam
//      install by default): .bgf, .ogg, .wav, .mp3, .bsf. Its rsc0000.rsb and rooms are
//      never taken: they come from someone else's build.
//   3. the art upstream keeps in its own resource tree
// Plus the palette (blakston.pal, parsed to a 768-byte binary palette.bin), and the
// bitmaps compiled into the client and its modules (clientd3d/bitmap and
// module/{merintr,mailnews,chess}/bitmap: backgrounds, stat tab buttons, the toolbar's
// buttons, the map paper, the chess pieces) as ui/<name>.bmp, the profanity filter's
// terms (ui/profane.dat), the login dialog's icon (ui/icon1.ico), the view's cursors
// (ui/*.cur), the Heidelberg title font (ui/heidelb1.ttf, font.c FONT_TITLES) and the snow
// texture (ui/weather_snow.png, d3dparticle.c).
// And itemslots.json, where each worn item goes on the Modern interface's paper doll, from the
// Kod item classes (itemSlots.ts), and spelltimes.json, each spell's post-cast delay for the
// quick slots' cooldowns (spellTimes.ts).
// And roomlinks.json, which rooms connect to which, from the Kod source (roomLinks.ts), so
// the client can load the rooms next to yours ahead of time.
//
// Output: dist/assets/<name> and dist/assets/manifest.json:
//   { generated, rsbHash, files: { name: { size, hash } } }
// Files are copied only when size or mtime changed (use --force to recopy).

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildItemSlots } from "./itemSlots.ts";
import { buildSpellTimes } from "./spellTimes.ts";
import { buildRoomLinks } from "./roomLinks.ts";
import { ART_DIR, SERVER_BUILD, SERVER_KOD, SHARDS_SERVER_DIR } from "../shardsServer.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({
  options: {
    art: { type: "string", default: ART_DIR },
    force: { type: "boolean", default: false },
  },
});

const OUT = join(ROOT, "dist", "assets");
const SERVER = SHARDS_SERVER_DIR;
const EXTS = new Set([".bgf", ".roo", ".rsb", ".ogg", ".wav", ".mp3", ".bsf"]);
/** Art only: an installed client's rooms and strings must never replace our server's */
const ART = new Set([".bgf", ".ogg", ".wav", ".mp3", ".bsf"]);
const ROO = new Set([".roo"]);

type Source = {
  label: string;
  dir: string;
  recursive: boolean;
  filter?: (name: string) => boolean;
  /** Output name prefix (a sub-folder of dist/assets) */
  prefix?: string;
  exts?: Set<string>;
};
const BMP = new Set([".bmp"]);
const BMP_ICO_CUR = new Set([".bmp", ".ico", ".cur"]);
const TTF = new Set([".ttf"]);
const sources: Source[] = [
  { label: "server rooms", dir: join(SERVER, "resource", "rooms"), recursive: false, exts: ROO },
  { label: "installed client art", dir: opt.art!, recursive: false, exts: ART },
  { label: "server resource tree art", dir: join(SERVER, "resource"), recursive: true, exts: ART },
  { label: "client UI bitmaps", dir: join(SERVER, "clientd3d", "bitmap"), recursive: false, prefix: "ui/", exts: BMP_ICO_CUR },
  { label: "interface UI bitmaps", dir: join(SERVER, "module", "merintr", "bitmap"), recursive: false, prefix: "ui/", exts: BMP },
  // mailnews.c mail_buttons: the toolbar's mailbox
  { label: "mail UI bitmaps", dir: join(SERVER, "module", "mailnews", "bitmap"), recursive: false, prefix: "ui/", exts: BMP },
  // chess board.c piece_bitmaps: the chess pieces
  { label: "chess bitmaps", dir: join(SERVER, "module", "chess", "bitmap"), recursive: false, prefix: "ui/", exts: BMP },
  // profane.c LoadProfaneTerms: the profanity filter's terms (mail\profane.dat beside the client)
  { label: "profanity terms", dir: join(SERVER, "resource", "misc"), recursive: false, prefix: "ui/", exts: new Set([".dat"]), filter: (n) => n === "ui/profane.dat" },
  // font.c FONT_TITLES: upstream keeps Heidelb1.ttf in its client run folder; an installed client beside its resource folder.
  // (No snow texture: upstream's d3dparticle.c draws snow without one, and so does gameScene.ts.)
  { label: "title font", dir: join(SERVER, "run", "localclient"), recursive: false, prefix: "ui/", exts: TTF },
  { label: "title font (installed client)", dir: dirname(opt.art!), recursive: false, prefix: "ui/", exts: TTF },
];

/**
 * rsc0000.rsb from the server build's .rsc files, as util/rscmerge.c makes it: RSC version 4,
 * every resource of every file. Files are taken in name order so the hash changes only with the Kod.
 */
function mergeRsc(dir: string): Buffer {
  const entries: Buffer[] = [];
  let count = 0;
  for (const f of readdirSync(dir).filter((n) => extname(n).toLowerCase() === ".rsc").sort()) {
    const b = readFileSync(join(dir, f));
    if (b.readUInt32BE(0) !== 0x52534301) throw new Error(`${f}: not an .rsc file`);
    if (b.readInt32LE(4) !== 4) throw new Error(`${f}: RSC version ${b.readInt32LE(4)}, expected 4`);
    const n = b.readInt32LE(8);
    let pos = 12;
    for (let i = 0; i < n; i++) {
      const end = b.indexOf(0, pos + 4);
      entries.push(b.subarray(pos, end + 1));
      pos = end + 1;
    }
    count += n;
  }
  const head = Buffer.alloc(12);
  head.writeUInt32BE(0x52534301, 0);
  head.writeInt32LE(4, 4);
  head.writeInt32LE(count, 8);
  return Buffer.concat([head, ...entries]);
}

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
    const base = (s.prefix ?? "") + basename(p).toLowerCase();
    if (!(s.exts ?? EXTS).has(extname(base))) continue;
    if (s.filter && !s.filter(base)) continue;
    if (chosen.has(base)) continue;
    chosen.set(base, { path: p, source: s.label });
    n++;
  }
  console.log(`${s.label}: ${n} files`);
}
const RSC_DIR = join(SERVER_BUILD, "rsc");
if (!existsSync(RSC_DIR) || !readdirSync(RSC_DIR).some((n) => n.toLowerCase().endsWith(".rsc"))) {
  console.error(`!! no .rsc files in ${RSC_DIR}; build the Shards server's Kod first (${join(SERVER, "tools", "build.cmd")})`);
  process.exit(1);
}

mkdirSync(join(OUT, "ui"), { recursive: true });
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

// rsc0000.rsb, merged from the server's .rsc files
const rsbBin = mergeRsc(RSC_DIR);
writeFileSync(join(OUT, "rsc0000.rsb"), rsbBin);
files["rsc0000.rsb"] = { size: rsbBin.length, hash: createHash("sha1").update(rsbBin).digest("hex").slice(0, 16), mtime: 0 };
bytes += rsbBin.length;
console.log(`rsc0000.rsb: merged from ${RSC_DIR}`);

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

// Light palettes (65 x 256): light_palettes[level][index] = the palette index closest
// to `index` at that light level; row 64 is the inverted palette. The client build
// generates them with makepal into clientd3d/<debug|release>/pal.c; the light-based
// xlats (xlat.c CalcLightXlat) need them.
const palC = ["debug", "release"].map((d) => join(SERVER, "clientd3d", d, "pal.c")).find((p) => existsSync(p));
if (palC) {
  const src = readFileSync(palC, "latin1");
  const start = src.indexOf("light_palettes[NUM_PALETTES][NUM_COLORS]");
  const body = src.slice(src.indexOf("{", start), src.indexOf("};", start));
  const nums = (body.replace(/\/\/.*$/gm, "").match(/\d+/g) ?? []).map(Number);
  if (nums.length !== 65 * 256) throw new Error(`pal.c light_palettes has ${nums.length} entries, expected ${65 * 256}`);
  const lightPal = Uint8Array.from(nums);
  writeFileSync(join(OUT, "lightpal.bin"), lightPal);
  files["lightpal.bin"] = { size: lightPal.length, hash: createHash("sha1").update(lightPal).digest("hex").slice(0, 16), mtime: 0 };
} else {
  console.warn(`!! no clientd3d pal.c (build the Shards server's client: ${join(SERVER, "tools", "build.cmd")} Bclient); light-based xlats will be approximate`);
}

// Room links from the Kod room classes and the RID_* constants
const KOD = SERVER_KOD;
if (existsSync(join(KOD, "object")) && existsSync(join(KOD, "include"))) {
  const kodFiles = [...walk(join(KOD, "object"), true)]
    .filter((p) => extname(p).toLowerCase() === ".kod")
    .map((path) => ({ path, text: readFileSync(path, "latin1") }));
  const khd = readdirSync(join(KOD, "include"))
    .filter((f) => extname(f).toLowerCase() === ".khd")
    .map((f) => readFileSync(join(KOD, "include", f), "latin1"))
    .join("\n");
  const links = buildRoomLinks(kodFiles, khd);
  const json = Buffer.from(JSON.stringify(links));
  writeFileSync(join(OUT, "roomlinks.json"), json);
  files["roomlinks.json"] = { size: json.length, hash: createHash("sha1").update(json).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`roomlinks.json: ${Object.keys(links).length} rooms`);
  // Where worn items go on the Modern interface's paper doll, from the item classes' use types
  const slots = Buffer.from(JSON.stringify(buildItemSlots(kodFiles, khd)));
  writeFileSync(join(OUT, "itemslots.json"), slots);
  files["itemslots.json"] = { size: slots.length, hash: createHash("sha1").update(slots).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`itemslots.json: ${Object.keys(JSON.parse(slots.toString()) as object).length} pictures`);
  // How long each spell keeps us from casting again, for the quick slots' cooldowns
  const times = Buffer.from(JSON.stringify(buildSpellTimes(kodFiles)));
  writeFileSync(join(OUT, "spelltimes.json"), times);
  files["spelltimes.json"] = { size: times.length, hash: createHash("sha1").update(times).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`spelltimes.json: ${Object.keys(JSON.parse(times.toString()) as object).length} spells`);
} else {
  console.warn(`!! no Kod source in ${KOD}; the client won't load neighbouring rooms ahead`);
}

writeFileSync(
  manifestPath,
  JSON.stringify({ generated: new Date().toISOString(), rsbHash: files["rsc0000.rsb"].hash, files }, null, 0),
);

// Files an older build left (a different server's rooms, say) would still be served and
// read by the format tests: dist/assets holds this build's files only.
let pruned = 0;
for (const dir of [OUT, join(OUT, "ui")]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const name = (dir === OUT ? "" : "ui/") + e.name;
    if (name === "manifest.json" || files[name.toLowerCase()]) continue;
    rmSync(join(dir, e.name));
    pruned++;
  }
}
if (pruned) console.log(`removed ${pruned} files left from an older build`);
console.log(`dist/assets: ${Object.keys(files).length} files, ${(bytes / 2 ** 20).toFixed(0)} MB, ${copied} copied`);
