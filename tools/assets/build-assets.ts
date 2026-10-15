// Builds dist/assets-101: the original game files the browser loads, served as-is at /assets.
// Raw art never goes in git; this folder is git-ignored and rebuilt any time. (dist/ is shared
// with main's build, whose dist/assets is the 104 server's.)
//
//   node tools/assets/build-assets.ts [--client <dir>] [--standin <dir>] [--force]
//
// Sources, first match wins per (lower-cased) file name:
//   1. our 101 server build (server/src-101): run/server/rsc0000.rsb (rscmerge, server\build.cmd)
//      and resource/rooms/*.roo. These MUST match the running server (redbook token, room
//      checksums), so they always win.
//   2. the installed original client's resource folder (%LOCALAPPDATA%\Meridian 59\resource,
//      install.nsi:90, or the Steam install's): the art, sounds and music
//   3. the server's resource tree in server/src-101/resource (rooms, a few bitmaps, audio)
//   4. a stand-in for the art while no original client is installed: the installed 104 client's
//      resource folder (%LOCALAPPDATA%\Meridian-104\resource), its .bgf, .ogg and .mp3 only (never
//      its strings or rooms). Its art is mostly the original's, by the same names.
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
// the client can load the rooms next to yours ahead of time, and roomexits.json, where each
// room's doors are, for the ambient townsfolk (ours) to walk between, and nav/<room>.nav, where
// they can walk in each room that has them (navGrid.ts), and roomterrain.json, each room's
// terrain (viTerrain_type), for what critters scurry about there, and watertextures.json, floor
// textures that are water even where the sector has no depth (waterTextures.ts), and
// floortextures.json, which floors are grass, earth or rock, for Ground Detail (floorTextures.ts),
// and rooms.json, every room by number and name, for the admin console's Travel list.
// And our ambient sounds that aren't the game's (dist/sounds/amb_*.ogg, from fetch-sounds.ts),
// and the login screen's backgrounds (login/*.webp and login/backgrounds.json, from the
// screenshot tour's ReferenceImages/login-backgrounds).
//
// Output: dist/assets/<name> and dist/assets/manifest.json:
//   { generated, rsbHash, files: { name: { size, hash } } }
// Files are copied only when size or mtime changed (use --force to recopy).

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildItemSlots, buildItemTypes } from "./itemSlots.ts";
import { buildSpellTimes } from "./spellTimes.ts";
import { buildRoomExits, buildRoomLinks, buildRoomList, buildRoomTerrain } from "./roomLinks.ts";
import { parseRoo } from "../../packages/formats/src/index.ts";
import { buildNavGrid, encodeNavGrid } from "../../packages/world/src/navGrid.ts";
import { findWaterTextures } from "./waterTextures.ts";
import { averageColor, classifyFloor, isCobbled } from "./floorTextures.ts";
import { gridTextureName, parseBgf } from "../../packages/formats/src/index.ts";
import { AMBIENT_ROOMS } from "../../packages/world/src/ambient/ambientRooms.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({
  options: {
    client: { type: "string", default: join(process.env.LOCALAPPDATA ?? "", "Meridian 59", "resource") },
    standin: { type: "string", default: join(process.env.LOCALAPPDATA ?? "", "Meridian-104", "resource") },
    force: { type: "boolean", default: false },
  },
});

const OUT = join(ROOT, "dist", "assets-101");
const SERVER = join(ROOT, "server", "src-101");
const RUN = join(SERVER, "run", "server");
const EXTS = new Set([".bgf", ".roo", ".rsb", ".ogg", ".wav", ".mp3", ".bsf"]);
const ART = new Set([".bgf", ".ogg", ".mp3", ".bsf"]);

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
const PNG = new Set([".png"]);
const sources: Source[] = [
  { label: "server rsb", dir: RUN, recursive: false, filter: (n) => n === "rsc0000.rsb" },
  { label: "server rooms", dir: join(SERVER, "resource", "rooms"), recursive: false, exts: new Set([".roo"]) },
  { label: "installed client", dir: opt.client!, recursive: true, filter: (n) => !n.endsWith(".rsb") && !n.endsWith(".roo") },
  { label: "server resource tree", dir: join(SERVER, "resource"), recursive: true, filter: (n) => !n.endsWith(".rsb") },
  { label: "stand-in art (the 104 client)", dir: opt.standin!, recursive: true, exts: ART },
  { label: "client UI bitmaps", dir: join(SERVER, "clientd3d", "bitmap"), recursive: false, prefix: "ui/", exts: BMP_ICO_CUR },
  { label: "interface UI bitmaps", dir: join(SERVER, "module", "merintr", "bitmap"), recursive: false, prefix: "ui/", exts: BMP },
  // mailnews.c mail_buttons: the toolbar's mailbox
  { label: "mail UI bitmaps", dir: join(SERVER, "module", "mailnews", "bitmap"), recursive: false, prefix: "ui/", exts: BMP },
  // chess board.c piece_bitmaps: the chess pieces
  { label: "chess bitmaps", dir: join(SERVER, "module", "chess", "bitmap"), recursive: false, prefix: "ui/", exts: BMP },
  // profane.c LoadProfaneTerms: the profanity filter's terms (mail\profane.dat beside the client)
  { label: "profanity terms", dir: join(SERVER, "resource", "misc"), recursive: false, prefix: "ui/", exts: new Set([".dat"]), filter: (n) => n === "ui/profane.dat" },
  // d3dparticle.c D3DParticleSystemInit: ./resource/weather_snow.png
  { label: "particle textures", dir: join(SERVER, "resource", "particles"), recursive: false, prefix: "ui/", exts: PNG },
  // server\setup-client.cmd puts the font in our client's run folder; the installed client has it beside its resource folder
  { label: "title font", dir: join(SERVER, "run", "localclient"), recursive: false, prefix: "ui/", exts: TTF },
  { label: "title font (installed client)", dir: dirname(opt.client!), recursive: false, prefix: "ui/", exts: TTF },
  // Ours: ambient sounds that aren't the game's (chatter, crowds, thunder), from npm run sounds
  { label: "ambient sounds (npm run sounds)", dir: join(ROOT, "dist", "sounds"), recursive: false, filter: (n) => n.startsWith("amb_") },
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
    const base = (s.prefix ?? "") + basename(p).toLowerCase();
    if (!(s.exts ?? EXTS).has(extname(base))) continue;
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
  console.warn("!! no clientd3d pal.c (build the client: server\\build.cmd Bclient); light-based xlats will be approximate");
}

// Room links from the Kod room classes and the RID_* constants
const KOD = join(SERVER, "kod");
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
  // Where each room's doors are, for the ambient townsfolk (ours)
  const exits = Buffer.from(JSON.stringify(buildRoomExits(kodFiles, khd)));
  writeFileSync(join(OUT, "roomexits.json"), exits);
  files["roomexits.json"] = { size: exits.length, hash: createHash("sha1").update(exits).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`roomexits.json: ${Object.keys(JSON.parse(exits.toString()) as object).length} rooms`);
  // Each room's terrain, for the ambient critters (ours)
  const terrain = Buffer.from(JSON.stringify(buildRoomTerrain(kodFiles, khd)));
  writeFileSync(join(OUT, "roomterrain.json"), terrain);
  files["roomterrain.json"] = { size: terrain.length, hash: createHash("sha1").update(terrain).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`roomterrain.json: ${Object.keys(JSON.parse(terrain.toString()) as object).length} rooms`);
  // Every room by number and name, for the admin console's Travel list (ours)
  const roomList = buildRoomList(kodFiles, khd);
  const rooms = Buffer.from(JSON.stringify(roomList));
  writeFileSync(join(OUT, "rooms.json"), rooms);
  files["rooms.json"] = { size: rooms.length, hash: createHash("sha1").update(rooms).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`rooms.json: ${roomList.length} rooms`);
  // Where worn items go on the Modern interface's paper doll, from the item classes' use types
  const slots = Buffer.from(JSON.stringify(buildItemSlots(kodFiles, khd)));
  writeFileSync(join(OUT, "itemslots.json"), slots);
  files["itemslots.json"] = { size: slots.length, hash: createHash("sha1").update(slots).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`itemslots.json: ${Object.keys(JSON.parse(slots.toString()) as object).length} pictures`);
  // What kind each item is, for sorting the inventory (ours)
  const types = Buffer.from(JSON.stringify(buildItemTypes(kodFiles)));
  writeFileSync(join(OUT, "itemtypes.json"), types);
  files["itemtypes.json"] = { size: types.length, hash: createHash("sha1").update(types).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`itemtypes.json: ${Object.keys(JSON.parse(types.toString()) as object).length} pictures`);
  // How long each spell keeps us from casting again, for the quick slots' cooldowns
  const times = Buffer.from(JSON.stringify(buildSpellTimes(kodFiles)));
  writeFileSync(join(OUT, "spelltimes.json"), times);
  files["spelltimes.json"] = { size: times.length, hash: createHash("sha1").update(times).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`spelltimes.json: ${Object.keys(JSON.parse(times.toString()) as object).length} spells`);
} else {
  console.warn("!! no Kod source in server/src-101/kod; the client won't load neighbouring rooms ahead");
}

// Floor textures that are water even on a dry floor (Raza's pool), for ambient life (ours)
const roomFiles = readdirSync(OUT).filter((f) => f.endsWith(".roo"));
const waterTextures = findWaterTextures(roomFiles.map((f) => parseRoo(new Uint8Array(readFileSync(join(OUT, f))))));
const waterJson = Buffer.from(JSON.stringify(waterTextures));
writeFileSync(join(OUT, "watertextures.json"), waterJson);
files["watertextures.json"] = { size: waterJson.length, hash: createHash("sha1").update(waterJson).digest("hex").slice(0, 16), mtime: 0 };
console.log(`watertextures.json: ${waterTextures.length} textures`);

// What each floor texture is (grass, earth, rocky) and its colour, for Ground Detail (ours)
{
  const palette = new Uint8Array(readFileSync(join(OUT, "palette.bin")));
  const used = new Set<number>();
  for (const f of roomFiles) for (const s of parseRoo(new Uint8Array(readFileSync(join(OUT, f)))).sectors) if (s.floorType) used.add(s.floorType);
  const kinds: Record<string, [string, number, number, number, number]> = {};
  for (const t of [...used].sort((a, b) => a - b)) {
    const name = gridTextureName(t);
    if (!existsSync(join(OUT, name))) continue;
    const bgf = await parseBgf(new Uint8Array(readFileSync(join(OUT, name))));
    if (!bgf.bitmaps[0]) continue;
    const [r, g, b] = averageColor(bgf.bitmaps[0].pixels, palette);
    const kind = classifyFloor(r, g, b);
    if (kind) kinds[t] = [kind, r, g, b, isCobbled(bgf.bitmaps[0].pixels, palette) ? 1 : 0];
  }
  const json = Buffer.from(JSON.stringify(kinds));
  writeFileSync(join(OUT, "floortextures.json"), json);
  files["floortextures.json"] = { size: json.length, hash: createHash("sha1").update(json).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`floortextures.json: ${Object.keys(kinds).length} of ${used.size} floor textures`);
}

// Where townsfolk can walk in the rooms that have them (ours: navGrid.ts), built once here for
// every player instead of in each client on entering
mkdirSync(join(OUT, "nav"), { recursive: true });
let navRooms = 0;
for (const roo of Object.keys(AMBIENT_ROOMS)) {
  if (!existsSync(join(OUT, roo))) continue;
  const room = parseRoo(new Uint8Array(readFileSync(join(OUT, roo))));
  const nav = encodeNavGrid(buildNavGrid(room, new Set(waterTextures)), room);
  const name = `nav/${basename(roo, ".roo")}.nav`;
  writeFileSync(join(OUT, name), nav);
  files[name] = { size: nav.length, hash: createHash("sha1").update(nav).digest("hex").slice(0, 16), mtime: 0 };
  navRooms++;
}
console.log(`nav/*.nav: ${navRooms} rooms`);

// The login screen's backgrounds (ours): the web copies of the screenshot tour's pictures
// (tools/screenshots/backgrounds.json, npm run shots:backgrounds), as login/<id>.<layout>.webp,
// and login/backgrounds.json listing them. Without the tour's pictures, the login screen keeps
// the original's splash.
const BACKGROUNDS = join(ROOT, "ReferenceImages", "login-backgrounds");
const backgroundIndex = join(BACKGROUNDS, "index.json");
if (existsSync(backgroundIndex)) {
  type Shot = { id: string; title: string; tags: string[]; time: string; web?: Record<string, string> };
  mkdirSync(join(OUT, "login"), { recursive: true });
  const list: { id: string; title: string; tags: string[]; time: string; files: Record<string, string> }[] = [];
  for (const shot of JSON.parse(readFileSync(backgroundIndex, "utf8")) as Shot[]) {
    const picked: Record<string, string> = {};
    for (const layout of ["modern", "mobile"]) {
      const from = shot.web?.[layout];
      if (!from || !existsSync(join(BACKGROUNDS, from))) continue;
      const name = `login/${shot.id}.${layout}.webp`;
      const data = readFileSync(join(BACKGROUNDS, from));
      writeFileSync(join(OUT, name), data);
      files[name] = { size: data.length, hash: createHash("sha1").update(data).digest("hex").slice(0, 16), mtime: 0 };
      bytes += data.length;
      picked[layout] = name;
    }
    if (Object.keys(picked).length) list.push({ id: shot.id, title: shot.title, tags: shot.tags, time: shot.time, files: picked });
  }
  const json = Buffer.from(JSON.stringify(list));
  writeFileSync(join(OUT, "login", "backgrounds.json"), json);
  files["login/backgrounds.json"] = { size: json.length, hash: createHash("sha1").update(json).digest("hex").slice(0, 16), mtime: 0 };
  console.log(`login/backgrounds.json: ${list.length} backgrounds`);
} else {
  console.warn(`!! no login backgrounds (npm run shots:backgrounds): ${backgroundIndex}`);
}

writeFileSync(
  manifestPath,
  JSON.stringify({ generated: new Date().toISOString(), rsbHash: files["rsc0000.rsb"].hash, files }, null, 0),
);
console.log(`dist/assets-101: ${Object.keys(files).length} files, ${(bytes / 2 ** 20).toFixed(0)} MB, ${copied} copied`);
