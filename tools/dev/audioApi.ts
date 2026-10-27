// The admin dashboard's Music & Sounds tab (apps/client/src/admin/AudioTab.tsx): every track and
// sound in the asset build, who plays it, the original MIDI behind each track, and our own pieces
// (tools/music). On the client's Vite dev server only. Rendering runs in a child process
// (tools/music/render.ts, build.ts), so the dev server keeps answering meanwhile.
//
//   GET  /__admin/audio/list              { files: AudioFile[], pieces: PieceInfo[], banks: string[] }
//   POST /__admin/audio/original          { name, bank? } -> { url, midi, seconds }: the game track's XMI
//                                         (shards-server resource/audio/xmi) rendered as written, kept in
//                                         dist/music/originals
//   GET  /__admin/audio/file?name=        a file from dist/music (originals/castle.ogg, princess.mid, ...)
//   POST /__admin/audio/piece/build       { name } -> { file, seconds, hash, log }: tools/music/build.ts,
//                                         the OGG copied into dist/assets with its manifest entry
//
// Over Vite's HMR socket:
//   shards:music   dashboard -> game tabs: { file } a track to play in place of the room's (null: back)
//   shards:sound   dashboard -> game tabs: { file } a sound to play
//   shards:audio   here -> game tabs: { name } a file rebuilt, to be fetched anew (game/devBridge.ts)

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, relative, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import { xmiToMidi } from "../../packages/formats/src/index.ts";
import { publish } from "./spriteApi.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const SERVER = join(ROOT, "server", "src");
const KOD = join(SERVER, "kod");
const XMI = join(SERVER, "resource", "audio", "xmi");
const ASSETS = join(ROOT, "dist", "assets");
const MUSIC = join(ROOT, "dist", "music");
const ORIGINALS = join(MUSIC, "originals");
const CLIENT_SOURCES = [join(ROOT, "apps", "client", "src"), join(ROOT, "packages")];
const AUDIO = new Set([".ogg", ".wav", ".mp3"]);
const BANK_NAMES = ["gm", "generaluser"];

type Route = (fn: (req: IncomingMessage) => Promise<unknown>) => (req: IncomingMessage, res: ServerResponse) => void;
type Body = (req: IncomingMessage) => Promise<string>;

export interface AudioUse {
  /** "kod": a class's resource; "client": named in the browser client's source */
  where: "kod" | "client";
  /** The file, from shards-server's kod/ or this repository's root */
  path: string;
  /** The room's or object's name (its vrName), else the class */
  label: string;
  /** The Kod resource that names the file */
  resource?: string;
  /** A room's music (a *_music resource) */
  music?: boolean;
}

export interface AudioFile {
  name: string;
  kind: "music" | "sound" | "ambient";
  size: number;
  hash: string;
  seconds: number | null;
  /** The XMI it was recorded from (for game tracks): its file in resource/audio/xmi */
  xmi: string | null;
  /** Ours (tools/music/pieces): the piece's name */
  piece: string | null;
  users: AudioUse[];
}

export interface PieceInfo {
  name: string;
  file: string;
  title: string;
  about: string;
  bars: number;
  seconds: number;
  parts: string[];
  error?: string;
}

type Manifest = { files: Record<string, { size: number; hash: string }> };

function* walk(dir: string, ext: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) yield* walk(p, ext);
    } else if (e.name.endsWith(ext)) yield p;
  }
}

/** Every Kod resource that names an audio file, with its class's name */
function kodUses(): Map<string, AudioUse[]> {
  const uses = new Map<string, AudioUse[]>();
  const fileRe = /^[ \t]*(\w+)[ \t]*=[ \t]*([\w-]+\.(?:ogg|wav|mp3))\b/gim;
  for (const p of walk(KOD, ".kod")) {
    const src = readFileSync(p, "latin1");
    if (!/\.(ogg|wav|mp3)\b/i.test(src)) continue;
    const cls = /^(\w+)\s+is\s+\w+/m.exec(src)?.[1] ?? basename(p, ".kod");
    const nameRes = /^\s*vrName\s*=\s*(\w+)/m.exec(src)?.[1];
    const named = nameRes ? new RegExp(`^\\s*${nameRes}\\s*=\\s*"([^"]*)"`, "mi").exec(src)?.[1]?.trim() : undefined;
    for (const m of src.matchAll(fileRe)) {
      const file = m[2]!.toLowerCase();
      const resource = m[1]!;
      const music = /music/i.test(resource) || new RegExp(`prMusic\\s*=\\s*${resource}\\b`).test(src);
      const list = uses.get(file) ?? [];
      list.push({ where: "kod", path: relative(KOD, p).replaceAll("\\", "/"), label: named || cls, resource, music });
      uses.set(file, list);
    }
  }
  return uses;
}

/** Audio files named in the browser client's source ("amb_inn_talk.ogg", "firework.ogg") */
function clientUses(): Map<string, AudioUse[]> {
  const uses = new Map<string, AudioUse[]>();
  for (const dir of CLIENT_SOURCES) {
    for (const ext of [".ts", ".tsx"]) {
      for (const p of walk(dir, ext)) {
        if (p.includes(".test.")) continue;
        const src = readFileSync(p, "utf8");
        const seen = new Set<string>();
        for (const m of src.matchAll(/"([\w-]+\.(?:ogg|wav|mp3))"/gi)) {
          const file = m[1]!.toLowerCase();
          if (seen.has(file)) continue;
          seen.add(file);
          const list = uses.get(file) ?? [];
          list.push({ where: "client", path: relative(ROOT, p).replaceAll("\\", "/"), label: basename(p) });
          uses.set(file, list);
        }
      }
    }
  }
  return uses;
}

/** The start and end of a file, without reading it all */
function ends(path: string, head: number, tail: number): { head: Buffer; tail: Buffer; size: number } {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const h = Buffer.alloc(Math.min(head, size));
    readSync(fd, h, 0, h.length, 0);
    const t = Buffer.alloc(Math.min(tail, size));
    readSync(fd, t, 0, t.length, size - t.length);
    return { head: h, tail: t, size };
  } finally {
    closeSync(fd);
  }
}

const lengths = new Map<string, number | null>();
/** How long a file plays: an OGG's last granule over its rate, a WAV's data over its byte rate */
function seconds(name: string, hash: string): number | null {
  const key = `${name}:${hash}`;
  if (lengths.has(key)) return lengths.get(key)!;
  let s: number | null = null;
  try {
    const path = join(ASSETS, name);
    if (name.endsWith(".ogg")) {
      const { head, tail } = ends(path, 64, 65536);
      const rate = head.readUInt32LE(40);
      const at = tail.lastIndexOf("OggS");
      if (rate > 0 && at >= 0 && at + 14 <= tail.length) s = Number(tail.readBigInt64LE(at + 6)) / rate;
    } else if (name.endsWith(".wav")) {
      const { head } = ends(path, 4096, 0);
      let byteRate = 0;
      for (let i = 12; i + 8 <= head.length; ) {
        const id = head.toString("latin1", i, i + 4);
        const n = head.readUInt32LE(i + 4);
        if (id === "fmt ") byteRate = head.readUInt32LE(i + 16);
        if (id === "data" && byteRate) {
          s = n / byteRate;
          break;
        }
        i += 8 + n + (n & 1);
      }
    }
  } catch {
    s = null;
  }
  lengths.set(key, s);
  return s;
}

/** Runs a script of ours in its own node; resolves with what it printed */
function run(args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    const p = spawn(process.execPath, args, { cwd: ROOT });
    let out = "";
    p.stdout.on("data", (b: Buffer) => (out += b.toString()));
    p.stderr.on("data", (b: Buffer) => (out += b.toString()));
    p.on("error", fail);
    p.on("close", (code) => (code === 0 ? done(out) : fail(new Error(out.trim().split("\n").slice(-6).join("\n") || `exit ${code}`))));
  });
}

async function pieces(): Promise<PieceInfo[]> {
  return JSON.parse(await run(["tools/music/build.ts", "--list"])) as PieceInfo[];
}

function xmiFiles(): Map<string, string> {
  const m = new Map<string, string>();
  if (existsSync(XMI)) for (const f of readdirSync(XMI)) if (f.toLowerCase().endsWith(".xmi")) m.set(basename(f, extname(f)).toLowerCase(), f);
  return m;
}

async function list() {
  const manifest = JSON.parse(readFileSync(join(ASSETS, "manifest.json"), "utf8")) as Manifest;
  const kod = kodUses();
  const client = clientUses();
  const xmis = xmiFiles();
  const ours = await pieces();
  const byFile = new Map(ours.map((p) => [p.file, p.name]));
  const files: AudioFile[] = [];
  for (const [name, e] of Object.entries(manifest.files)) {
    if (name.includes("/") || !AUDIO.has(extname(name))) continue;
    const users = [...(kod.get(name) ?? []), ...(client.get(name) ?? [])];
    const stem = basename(name, extname(name));
    const xmi = xmis.get(stem) ?? null;
    const piece = byFile.get(name) ?? null;
    const kind = name.startsWith("amb_") ? "ambient" : xmi || piece || users.some((u) => u.music) ? "music" : "sound";
    files.push({ name, kind, size: e.size, hash: e.hash, seconds: seconds(name, e.hash), xmi, piece, users });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { files, pieces: ours, banks: BANK_NAMES };
}

const renders = new Map<string, Promise<{ url: string; midi: string; seconds: number }>>();
/** A game track's XMI, rendered as written (once a bank, kept until the XMI changes) */
function original(name: string, bank: string) {
  const stem = basename(name.toLowerCase(), extname(name));
  const xmi = xmiFiles().get(stem);
  if (!xmi) throw new Error(`${name}: no ${stem}.xmi in resource/audio/xmi`);
  if (!BANK_NAMES.includes(bank)) throw new Error(`bank: one of ${BANK_NAMES.join(", ")}`);
  const src = join(XMI, xmi);
  const out = join(ORIGINALS, `${stem}-${bank}.ogg`);
  const key = out;
  let p = renders.get(key);
  if (!p) {
    p = (async () => {
      mkdirSync(ORIGINALS, { recursive: true });
      const { midi, seconds } = xmiToMidi(new Uint8Array(readFileSync(src)));
      writeFileSync(join(ORIGINALS, `${stem}.mid`), midi);
      if (!existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs) await run(["tools/music/render.ts", src, out, "--bank", bank]);
      const v = Math.round(statSync(out).mtimeMs);
      return { url: `/__admin/audio/file?name=originals/${stem}-${bank}.ogg&v=${v}`, midi: `/__admin/audio/file?name=originals/${stem}.mid`, seconds };
    })();
    renders.set(key, p);
    p.catch(() => renders.delete(key));
  }
  return p;
}

const TYPES: Record<string, string> = { ".ogg": "audio/ogg", ".mid": "audio/midi", ".wav": "audio/wav" };

export function audioApi(server: ViteDevServer, route: Route, body: Body): void {
  server.middlewares.use("/__admin/audio/list", route(async () => list()));
  server.middlewares.use(
    "/__admin/audio/original",
    route(async (req) => {
      const { name, bank } = JSON.parse(await body(req)) as { name: string; bank?: string };
      if (typeof name !== "string" || !/^[\w-]+\.\w+$/.test(name)) throw new Error("name: a track's file name (castle.ogg)");
      return original(name, bank ?? "gm");
    }),
  );
  server.middlewares.use("/__admin/audio/file", (req, res) => {
    const name = new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "";
    const path = resolve(MUSIC, name);
    if (!/^[\w/-]+\.(ogg|mid)$/.test(name) || !path.startsWith(MUSIC) || !existsSync(path)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    if (name.endsWith(".mid")) res.setHeader("Content-Disposition", `attachment; filename="${basename(path)}"`);
    const data = readFileSync(path);
    // Ranges, for the player to seek and to know the length without the whole file
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      if (start > end || start >= data.length) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${data.length}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${data.length}`);
      res.end(data.subarray(start, end + 1));
      return;
    }
    res.end(data);
  });
  server.middlewares.use(
    "/__admin/audio/piece/build",
    route(async (req) => {
      const { name } = JSON.parse(await body(req)) as { name: string };
      if (typeof name !== "string" || !/^[\w-]+$/.test(name)) throw new Error("name: a piece's file name in tools/music/pieces, without .ts");
      const log = await run(["tools/music/build.ts", name]);
      const info = (await pieces()).find((p) => p.name === name);
      if (!info) throw new Error(`no piece ${name}`);
      const hash = publish(info.file, join(MUSIC, info.file));
      server.ws.send("shards:audio", { name: info.file });
      return { file: info.file, seconds: info.seconds, hash, log: log.trim() };
    }),
  );
  server.ws.on("shards:music", (data: { file: string | null }) => server.ws.send("shards:music", data));
  server.ws.on("shards:sound", (data: { file: string }) => server.ws.send("shards:sound", data));
}
