// The admin dashboard's sprite editor (apps/client/src/admin/SpritesTab.tsx): its files, on the
// client's Vite dev server only.
//
//   GET  /__admin/sprites/list            every .bgf in dist/assets: { name, size, hash, override, original }
//                                         (override: there's a copy in shards-server's resource/graphics/shards;
//                                          original: a classic copy exists that a revert would bring back)
//   GET  /__admin/sprites/file?name=      a .bgf's bytes, as dist/assets serves it
//   POST /__admin/sprites/save            { name, data (base64) } -> { hash, backup }: written to
//                                         resource/graphics/shards (where tools/assets/build-assets.ts looks
//                                         first), the copy it replaces kept in shards-server build/spriteforge,
//                                         and copied into dist/assets with its manifest entry, as a full
//                                         `npm run assets` would
//   POST /__admin/sprites/revert          { name } -> { hash }: the shards copy deleted (backed up), the
//                                         classic one copied back into dist/assets
//   POST /__admin/sprites/register        { kind: "hair" | "beard", file, label } -> { resource, ok, tail, steps }:
//                                         the style listed in kod/util/system.kod (its resource, and
//                                         GetAllowedHairIcons or GetAllowedBeardIcons), the Kod built, reload
//                                         system, and the new rsc0000.rsb copied into dist/assets
//   GET  /__admin/sprites/registered      { hair: string[], beard: string[], hairColours: { name, id }[] }: the
//                                         style files system.kod lists, and GetHairTranslations
//
// Over Vite's HMR socket, after a save or revert:
//   shards:sprite     here -> everyone: { name, hash }, for game tabs to load the sprite again

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import { parseBgf } from "../../packages/formats/src/index.ts";
import { maint } from "../maint/maintClient.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const SERVER = join(ROOT, "server", "src");
const ASSETS = join(ROOT, "dist", "assets");
const MANIFEST = join(ASSETS, "manifest.json");
const SHARDS = process.env.ICONFORGE_DIR ?? join(SERVER, "resource", "graphics", "shards");
const BACKUPS = join(SERVER, "build", "spriteforge", "backups");
const SYSTEM_KOD = join(SERVER, "kod", "util", "system.kod");
const RSB = join(SERVER, "run", "server", "rsc", "rsc0000.rsb");
/** The classic copies, in build-assets.ts's order: the installed 104 client, then the server's resource tree */
const CLASSIC_DIRS = [join(process.env.LOCALAPPDATA ?? "", "Meridian-104", "resource"), join(SERVER, "resource")];

type Deps = {
  buildKod: () => { ok: boolean; tail: string };
  route: (fn: (req: IncomingMessage) => Promise<unknown>) => (req: IncomingMessage, res: ServerResponse) => void;
  body: (req: IncomingMessage) => Promise<string>;
};

type Manifest = { generated: string; rsbHash: string; files: Record<string, { size: number; hash: string; mtime?: number }> };

const sha = (data: Uint8Array) => createHash("sha1").update(data).digest("hex").slice(0, 16);
const readManifest = (): Manifest => JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;

/** A sprite's file name: lower case, no folders */
function spriteName(name: unknown): string {
  if (typeof name !== "string" || !/^[a-z0-9_-]{1,24}\.bgf$/.test(name)) throw new Error("name: a .bgf file name, lower case, no folders (e.g. ptsa.bgf)");
  return name;
}

/** Copies a file into dist/assets under `name` and records it as build-assets.ts would (so its next run leaves it be) */
function publish(name: string, from: string, manifest = readManifest()): string {
  copyFileSync(from, join(ASSETS, name));
  const hash = sha(new Uint8Array(readFileSync(join(ASSETS, name))));
  manifest.files[name] = { size: statSync(from).size, hash, mtime: statSync(from).mtimeMs };
  if (name === "rsc0000.rsb") manifest.rsbHash = hash;
  writeFileSync(MANIFEST, JSON.stringify({ ...manifest, generated: new Date().toISOString() }, null, 0));
  return hash;
}

let classic: Map<string, string> | null = null;
/** The classic copy of each .bgf (lower-cased name -> path), not counting the shards folder */
function classicCopies(): Map<string, string> {
  if (classic) return classic;
  classic = new Map();
  const shards = resolve(SHARDS).toLowerCase();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (resolve(p).toLowerCase() !== shards) walk(p);
      } else if (e.name.toLowerCase().endsWith(".bgf") && !classic!.has(e.name.toLowerCase())) classic!.set(e.name.toLowerCase(), p);
    }
  };
  for (const d of CLASSIC_DIRS) if (existsSync(d)) walk(d);
  return classic;
}

/** The shards copy of a sprite, whatever its case on disk */
function shardsCopy(name: string): string | null {
  if (!existsSync(SHARDS)) return null;
  const f = readdirSync(SHARDS).find((n) => n.toLowerCase() === name);
  return f ? join(SHARDS, f) : null;
}

/** Moves (or copies) a shards copy aside before it's replaced; returns where it went */
function backUp(path: string, move: boolean): string {
  mkdirSync(BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const to = join(BACKUPS, `${basename(path, ".bgf")}.${stamp}.bgf`);
  if (move) renameSync(path, to);
  else copyFileSync(path, to);
  return to;
}

// ---------------------------------------------------------------- system.kod: the styles offered

type Kind = "hair" | "beard";
const RESOURCE = { hair: /^(\s*)charinfo_hair_s([a-z])_icon = (\S+)[^\n]*$/gm, beard: /^(\s*)charinfo_beard_([a-z])_icon = (\S+)[^\n]*$/gm };
const resourceName = (kind: Kind, letter: string) => (kind === "hair" ? `charinfo_hair_s${letter}_icon` : `charinfo_beard_${letter}_icon`);

/** The method's text range in system.kod: from its name to its closing brace */
function method(kod: string, name: string): { start: number; end: number } {
  const start = kod.search(new RegExp(`^\\s*${name}\\(`, "m"));
  if (start < 0) throw new Error(`system.kod has no ${name}: list the style by hand`);
  const open = kod.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < kod.length; i++) {
    if (kod[i] === "{") depth++;
    else if (kod[i] === "}" && --depth === 0) return { start, end: i + 1 };
  }
  throw new Error(`${name} in system.kod doesn't end`);
}

/** The hair colours the character creator offers (GetHairTranslations), as names and xlat numbers */
function hairColours(): { name: string; id: number }[] {
  const kod = readFileSync(SYSTEM_KOD, "latin1");
  const m = method(kod, "GetHairTranslations");
  const list = /return\s*\[([^\]]*)\]/.exec(kod.slice(m.start, m.end))?.[1] ?? "0";
  const khd = readFileSync(join(SERVER, "kod", "include", "blakston.khd"), "latin1");
  const value = (c: string) => /^\d+$/.test(c) ? Number(c) : Number(new RegExp(`^\\s*${c}\\s*=\\s*(0x[0-9a-f]+|\\d+)`, "im").exec(khd)?.[1] ?? NaN);
  return list
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => ({ name: c === "0" ? "grey (none)" : c.replace(/^PT_(GRAY_TO_|HAIR_)/, "").toLowerCase(), id: value(c) }))
    .filter((c) => Number.isFinite(c.id));
}

function registered(kod = readFileSync(SYSTEM_KOD, "latin1")): Record<Kind, string[]> {
  // every style, the classic ones too
  const files = (kind: Kind) => [...kod.matchAll(new RegExp(`^\\s*charinfo_${kind}_\\w+_icon = (\\S+)`, "gm"))].map((m) => m[1]!.toLowerCase());
  return { hair: files("hair"), beard: files("beard") };
}

/** system.kod with a new style: its resource line after the last of its kind, and in the list the character creator offers */
export function addStyle(kod: string, kind: Kind, file: string, label: string): { kod: string; resource: string } {
  const lines = [...kod.matchAll(RESOURCE[kind])];
  if (!lines.length) throw new Error(`system.kod has no ${kind} styles of ours to add after: list the style by hand`);
  if (lines.some((m) => m[3]!.toLowerCase() === file)) throw new Error(`${file} is already in system.kod`);
  const used = new Set(lines.map((m) => m[2]!));
  const letter = [..."abcdefghijklmnopqrstuvwxyz"].find((l) => !used.has(l));
  if (!letter) throw new Error(`every ${kind} letter is used: list the style by hand`);
  const resource = resourceName(kind, letter);
  const last = lines[lines.length - 1]!;
  const at = last.index! + last[0].length;
  const clean = label.replace(/[\r\n]+/g, " ").trim();
  kod = `${kod.slice(0, at)}\n${last[1]!.replace(/^\n+/, "")}${resource} = ${file}${clean ? `  // ${clean}` : ""}${kod.slice(at)}`;

  // The method's code lines only: its comment string can name resources too
  const inLists = (name: string, edit: (line: string) => string, problem: string) => {
    const m = method(kod, name);
    let changed = 0;
    const body = kod
      .slice(m.start, m.end)
      .split("\n")
      .map((line) => {
        if (line.includes('"')) return line;
        const next = edit(line);
        if (next !== line) changed++;
        return next;
      })
      .join("\n");
    if (!changed) throw new Error(problem);
    kod = kod.slice(0, m.start) + body + kod.slice(m.end);
  };
  if (kind === "hair") {
    // Each gender's list, before bald
    inLists(
      "GetAllowedHairIcons",
      (line) => line.replace(/charinfo_hair_bald_icon/g, `${resource}, charinfo_hair_bald_icon`),
      "GetAllowedHairIcons has no charinfo_hair_bald_icon to add before: list the style by hand",
    );
  } else {
    inLists(
      "GetAllowedBeardIcons",
      (line) => line.replace(/(charinfo_beard_\w+_icon)\];/, `$1, ${resource}];`),
      "GetAllowedBeardIcons offers no facial hair now: offer the beards again first, or list the style by hand",
    );
  }
  return { kod, resource };
}

// ---------------------------------------------------------------- the routes

export function spriteApi(server: ViteDevServer, { buildKod, route, body }: Deps): void {
  const announce = (name: string, hash: string) => server.ws.send("shards:sprite", { name, hash });

  server.middlewares.use(
    "/__admin/sprites/list",
    route(async () => {
      const files = readManifest().files;
      const originals = classicCopies();
      const overrides = new Set(existsSync(SHARDS) ? readdirSync(SHARDS).map((n) => n.toLowerCase()) : []);
      return Object.entries(files)
        .filter(([name]) => name.endsWith(".bgf") && !name.includes("/"))
        .map(([name, f]) => ({ name, size: f.size, hash: f.hash, override: overrides.has(name), original: originals.has(name) }));
    }),
  );

  server.middlewares.use("/__admin/sprites/file", (req, res) => {
    try {
      const name = spriteName(new URL(req.url ?? "", "http://x").searchParams.get("name"));
      const path = join(ASSETS, name);
      if (!existsSync(path)) throw new Error(`${name} isn't in dist/assets`);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.end(readFileSync(path));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  server.middlewares.use(
    "/__admin/sprites/save",
    route(async (req) => {
      const { name, data } = JSON.parse(await body(req)) as { name: unknown; data: unknown };
      const file = spriteName(name);
      if (typeof data !== "string") throw new Error("data: the .bgf, base64");
      const bytes = new Uint8Array(Buffer.from(data, "base64"));
      const bgf = await parseBgf(bytes); // refuses anything that isn't one
      if (!bgf.bitmaps.length) throw new Error("a sprite needs at least one frame");
      mkdirSync(SHARDS, { recursive: true });
      const existing = shardsCopy(file);
      const backup = existing ? backUp(existing, false) : null;
      const path = existing ?? join(SHARDS, file);
      writeFileSync(path, bytes);
      const hash = publish(file, path);
      announce(file, hash);
      return { hash, backup, path };
    }),
  );

  server.middlewares.use(
    "/__admin/sprites/revert",
    route(async (req) => {
      const file = spriteName((JSON.parse(await body(req)) as { name: unknown }).name);
      const original = classicCopies().get(file);
      if (!original) throw new Error(`${file} has no classic copy to go back to`);
      const existing = shardsCopy(file);
      if (!existing) throw new Error(`${file} isn't one of ours`);
      const backup = backUp(existing, true);
      const hash = publish(file, original);
      announce(file, hash);
      return { hash, backup };
    }),
  );

  server.middlewares.use(
    "/__admin/sprites/registered",
    route(async () => ({ ...registered(), hairColours: hairColours() })),
  );

  server.middlewares.use(
    "/__admin/sprites/register",
    route(async (req) => {
      const { kind, file, label } = JSON.parse(await body(req)) as { kind: unknown; file: unknown; label: unknown };
      if (kind !== "hair" && kind !== "beard") throw new Error('kind: "hair" or "beard"');
      const name = spriteName(file);
      if (!shardsCopy(name)) throw new Error(`save ${name} first: it isn't in resource/graphics/shards`);
      const before = readFileSync(SYSTEM_KOD, "latin1");
      const { kod, resource } = addStyle(before, kind, name, typeof label === "string" ? label : "");
      writeFileSync(SYSTEM_KOD, kod, "latin1");
      const built = buildKod();
      if (!built.ok) {
        writeFileSync(SYSTEM_KOD, before, "latin1");
        return { resource, ok: false, tail: built.tail, steps: ["the Kod build failed, so system.kod is back as it was"] };
      }
      const steps = [`${resource} = ${name} added to system.kod`, "built"];
      try {
        await maint("reload system");
        steps.push("reload system");
      } catch (e) {
        steps.push(`reload system didn't happen (${(e as Error).message}): restart the server`);
      }
      if (existsSync(RSB)) {
        publish("rsc0000.rsb", RSB);
        steps.push("rsc0000.rsb copied to dist/assets: reload game tabs");
      }
      return { resource, ok: true, tail: built.tail, steps };
    }),
  );
}
