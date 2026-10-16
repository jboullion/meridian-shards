// The admin dashboard's server side (apps/client/admin.html), on the client's Vite dev server
// only (devTools.ts, `vite serve`): blakserv's maintenance port, the server's Kod read for lists,
// saving live tuning back to the source, and a hub between the dashboard and the game tabs.
//
//   POST /__admin/maint          { commands: string[] } -> { outputs: string[] }
//   GET  /__admin/catalog        the server's monsters, items and spells, from its Kod
//   POST /__admin/kod/build      server\build.cmd Bkod -> { ok, tail }
//   POST /__admin/tuning/save    { values: { <table id>: { <key>: number } } } -> { written }
//
// Over Vite's HMR socket:
//   shards:set        dashboard -> here: { tuning?, scene? } merged into the live state
//   shards:state      here -> everyone: the live state, applied by game tabs (game/devBridge.ts)
//   shards:game-hello a game tab started: it gets the state
//   shards:game       a game tab says where it is; passed on to everyone, for the dashboard
//   shards:dash-hello the dashboard started: it gets the state and the last game report

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { ViteDevServer } from "vite";
import { maint } from "../maint/maintClient.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const KOD = join(ROOT, "server", "src", "kod");

/** The tuning tables' files, by id (apps/client/src/game/tuning.ts TUNING_TABLES): the only files saving writes */
const TUNING_FILES: Record<string, string> = {
  ambient: "packages/world/src/ambient/tuning.ts",
  scene: "apps/client/src/game/sceneTuning.ts",
  render: "packages/render/src/tuning.ts",
};

type Values = Record<string, Record<string, number>>;

interface LiveState {
  tuning: Values;
  scene: Record<string, unknown>;
}

// ---------------------------------------------------------------- the server's Kod, as lists

export interface CatalogEntry {
  className: string;
  name: string;
  /** Its picture's file (a .bgf in the game files), if it has one */
  icon: string | null;
}

export interface ItemEntry extends CatalogEntry {
  /** A number item (shillings, arrows, reagents): made with `number int N` */
  stack: boolean;
}

export interface SpellEntry extends CatalogEntry {
  /** SID_ number, for FindSpellByNum */
  sid: number;
}

interface KodClassInfo {
  parent: string;
  props: Map<string, string>;
  rscs: Map<string, string>;
}

function kodFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".kod"))
    .map((e) => join(e.parentPath, e.name));
}

/** Every class under these folders: its parent, its `name = value` lines and its resources */
function readClasses(dirs: string[]): Map<string, KodClassInfo> {
  const out = new Map<string, KodClassInfo>();
  for (const file of dirs.flatMap((d) => kodFiles(join(KOD, d)))) {
    const text = readFileSync(file, "latin1").replace(/\/\/[^\n]*/g, "");
    const head = /^\s*(\w+)\s+is\s+(\w+)/m.exec(text);
    if (!head) continue;
    const props = new Map<string, string>();
    const rscs = new Map<string, string>();
    for (const m of text.matchAll(/^\s*(\w+)\s*=\s*(.+?)\s*$/gm)) {
      const [, k, v] = m as unknown as [string, string, string];
      props.set(k.toLowerCase(), v);
      if (/^".*"$/.test(v)) rscs.set(k.toLowerCase(), v.slice(1, -1));
      else if (/^[\w-]+\.bgf$/i.test(v)) rscs.set(k.toLowerCase(), v.toLowerCase());
    }
    out.set(head[1]!, { parent: head[2]!, props, rscs });
  }
  return out;
}

/** A property through the class's parents, and the resource it names */
function lookup(classes: Map<string, KodClassInfo>, cls: string, prop: string): string | null {
  for (let c: string | undefined = cls, n = 0; c && n < 30; n++) {
    const info = classes.get(c);
    if (!info) return null;
    const v = info.props.get(prop);
    if (v !== undefined) return info.rscs.get(v.toLowerCase()) ?? findRsc(classes, v.toLowerCase()) ?? null;
    c = info.parent;
  }
  return null;
}

function findRsc(classes: Map<string, KodClassInfo>, rsc: string): string | null {
  for (const info of classes.values()) {
    const v = info.rscs.get(rsc);
    if (v !== undefined) return v;
  }
  return null;
}

function descendants(classes: Map<string, KodClassInfo>, root: string): string[] {
  const isA = (c: string): boolean => {
    for (let x: string | undefined = c, n = 0; x && n < 30; n++) {
      if (x === root) return true;
      x = classes.get(x)?.parent;
    }
    return false;
  };
  return [...classes.keys()].filter((c) => c !== root && isA(c));
}

function catalog(): { monsters: CatalogEntry[]; items: ItemEntry[]; spells: SpellEntry[] } {
  const battlers = readClasses(["object/active/holder/nomoveon/battler"]);
  const monsters = descendants(battlers, "Monster")
    .map((c) => ({ className: c, name: lookup(battlers, c, "vrname") ?? "", icon: lookup(battlers, c, "vricon") }))
    .filter((m) => m.name && m.icon);
  const passives = readClasses(["object/passive", "object/item"]);
  const stacks = new Set(descendants(passives, "NumberItem"));
  const items = descendants(passives, "Item")
    .map((c) => ({ className: c, name: lookup(passives, c, "vrname") ?? "", icon: lookup(passives, c, "vricon"), stack: stacks.has(c) }))
    .filter((i) => i.name && i.icon);
  const khd = readFileSync(join(KOD, "include", "blakston.khd"), "latin1");
  const sids = new Map([...khd.matchAll(/^\s*(SID_\w+)\s*=\s*(\d+)/gm)].map((m) => [m[1]!.toUpperCase(), Number(m[2])]));
  const spells = descendants(passives, "Spell").flatMap((c) => {
    const sid = sids.get((passives.get(c)?.props.get("vispell_num") ?? "").toUpperCase());
    const name = lookup(passives, c, "vrname");
    return sid && name ? [{ className: c, name, icon: lookup(passives, c, "vricon"), sid }] : [];
  });
  const byName = (a: CatalogEntry, b: CatalogEntry) => a.name.localeCompare(b.name);
  return { monsters: monsters.sort(byName), items: items.sort(byName), spells: spells.sort(byName) };
}

// ---------------------------------------------------------------- saving tuning to the source

/** Rewrites `key: { value: N,` in each table's file; returns the files written */
function saveTuning(values: Values): string[] {
  const written: string[] = [];
  for (const [id, entries] of Object.entries(values)) {
    const rel = TUNING_FILES[id];
    if (!rel) continue;
    const path = join(ROOT, rel);
    let text = readFileSync(path, "utf8");
    const before = text;
    for (const [key, value] of Object.entries(entries)) {
      if (!/^\w+$/.test(key) || typeof value !== "number" || !Number.isFinite(value)) continue;
      text = text.replace(new RegExp(`^(\\s*${key}: \\{ value: )(-?[\\d.e+-]+)(,)`, "m"), `$1${Number(value.toPrecision(6))}$3`);
    }
    if (text !== before) {
      writeFileSync(path, text);
      written.push(rel);
    }
  }
  return written;
}

// ---------------------------------------------------------------- the plugin's half

function body(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

function reply(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function route(fn: (req: IncomingMessage) => Promise<unknown>) {
  return (req: IncomingMessage, res: ServerResponse) => {
    void fn(req).then(
      (v) => reply(res, 200, v),
      (e: unknown) => reply(res, 500, { error: (e as Error).message }),
    );
  };
}

export function adminApi(server: ViteDevServer): void {
  const state: LiveState = { tuning: {}, scene: {} };
  let lastGame: unknown = null;
  const broadcast = () => server.ws.send("shards:state", state);

  server.middlewares.use(
    "/__admin/maint",
    route(async (req) => {
      const { commands } = JSON.parse(await body(req)) as { commands: string[] };
      if (!Array.isArray(commands) || !commands.every((c) => typeof c === "string")) throw new Error("commands: a list of strings");
      return { outputs: await maint(...commands) };
    }),
  );
  server.middlewares.use("/__admin/catalog", route(async () => catalog()));
  server.middlewares.use(
    "/__admin/kod/build",
    route(async () => {
      const r = spawnSync("cmd", ["/c", join(ROOT, "server", "build.cmd"), "Bkod"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.split(/\r?\n/).filter((l) => l.trim() && !/Need to recompile|^\s+\w+(\s+\w+)*\s*$/.test(l));
      return { ok: r.status === 0, tail: out.slice(-25).join("\n") };
    }),
  );
  server.middlewares.use(
    "/__admin/tuning/save",
    route(async (req) => {
      const { values } = JSON.parse(await body(req)) as { values: Values };
      const written = saveTuning(values);
      // Saved as the source's own values now: nothing left to override
      state.tuning = {};
      broadcast();
      return { written };
    }),
  );

  server.ws.on("shards:set", (data: Partial<LiveState>) => {
    if (data.tuning) state.tuning = data.tuning;
    if (data.scene) state.scene = data.scene;
    broadcast();
  });
  server.ws.on("shards:game-hello", (_data: unknown, client) => client.send("shards:state", state));
  server.ws.on("shards:dash-hello", (_data: unknown, client) => {
    client.send("shards:state", state);
    if (lastGame) client.send("shards:game", lastGame);
  });
  server.ws.on("shards:game", (data: unknown) => {
    lastGame = data;
    server.ws.send("shards:game", data);
  });
}
