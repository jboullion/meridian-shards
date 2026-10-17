// The admin dashboard's server side (apps/client/admin.html), on the client's Vite dev server
// only (devTools.ts, `vite serve`): blakserv's maintenance port, the server's Kod read for lists,
// saving live tuning back to the source, and a hub between the dashboard and the game tabs.
//
//   POST /__admin/maint          { commands: string[] } -> { outputs: string[] }
//   GET  /__admin/catalog        the server's monsters, items and spells, from its Kod
//   POST /__admin/kod/build      server\build.cmd Bkod -> { ok, tail }
//   POST /__admin/tuning/save    { values: { <table id>: { <key>: number } } } -> { written }
//   POST /__admin/travel/here    { playerId } -> where they stand, and the room's travel points
//   /__admin/quests/...          the quests (tools/dev/questApi.ts)
//   /__admin/companions/...      trying companions out (tools/dev/companionApi.ts)
//   /__admin/sprites/...         the sprite editor's files (tools/dev/spriteApi.ts)
//   POST /__admin/travel/move    { playerId, id, part: "portal" | "arrival" } -> point id moved there:
//                                travelnet.kod rewritten, the Kod built, reload system, and for
//                                the portal the room recreated (it places its portals when built)
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
import { descendants, lookup, readClasses } from "../assets/kodClasses.ts";
import type { KodFile } from "../assets/roomLinks.ts";
import { maint } from "../maint/maintClient.ts";
import { questApi } from "./questApi.ts";
import { companionApi } from "./companionApi.ts";
import { spriteApi } from "./spriteApi.ts";
import { movePoint, nearestAngle, readHistoricLinks, readPoints, readRids, strayLines, withLinks, type TravelPoint } from "./travelPoints.ts";

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

function kodFiles(dir: string): KodFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".kod"))
    .map((e) => join(e.parentPath, e.name))
    .map((path) => ({ path, text: readFileSync(path, "latin1") }));
}

const readKod = (dirs: string[]) => readClasses(dirs.flatMap((d) => kodFiles(join(KOD, d))));

function catalog(): { monsters: CatalogEntry[]; items: ItemEntry[]; spells: SpellEntry[] } {
  const battlers = readKod(["object/active/holder/nomoveon/battler"]);
  const monsters = descendants(battlers, "Monster")
    .map((c) => ({ className: c, name: lookup(battlers, c, "vrname") ?? "", icon: lookup(battlers, c, "vricon") }))
    .filter((m) => m.name && m.icon);
  const passives = readKod(["object/passive", "object/item"]);
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

// ---------------------------------------------------------------- the Kod build

/**
 * The environment for build.cmd: PATH without entries that aren't paths. A terminal's startup
 * warning (Git Bash's "Found ~\.bashrc but no ~\.bash_profile", colours and newlines) can end
 * up in it, and VsDevCmd.bat fails on that ("\NVIDIA was unexpected at this time").
 */
function buildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    // eslint-disable-next-line no-control-regex
    if (/^path$/i.test(k)) env[k] = (env[k] ?? "").split(";").filter((e) => e && !/[\x00-\x1f"]/.test(e)).join(";");
  }
  return env;
}

function buildKod(): { ok: boolean; tail: string } {
  // A hidden window: without one, cmd.exe started from the dev server can die at startup (0xC0000142)
  const r = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/c", join(ROOT, "server", "build.cmd"), "Bkod"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: buildEnv(),
  });
  if (r.error) return { ok: false, tail: `server\\build.cmd didn't start: ${r.error.message}` };
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.split(/\r?\n/).filter((l) => l.trim() && !/Need to recompile|^\s+\w+(\s+\w+)*\s*$/.test(l));
  const tail = out.slice(-25).join("\n");
  return { ok: r.status === 0, tail: tail || `server\\build.cmd ended with ${r.status} and said nothing` };
}

// ---------------------------------------------------------------- moving fast travel portals

const TRAVELNET = join(KOD, "util", "travelnet.kod");

const answer = (out: string | undefined, kind: "OBJECT" | "INT"): number | null => {
  const m = (kind === "OBJECT" ? /^: OBJECT (\d+)/m : /^: INT (-?\d+)/m).exec(out ?? "");
  return m ? Number(m[1]) : null;
};

const travelPoints = (): TravelPoint[] => {
  const kod = readFileSync(TRAVELNET, "latin1");
  return withLinks(readPoints(kod, readRids(readFileSync(join(KOD, "include", "blakston.khd"), "latin1"))), readHistoricLinks(kod));
};

export interface TravelHere {
  rid: number;
  row: number;
  col: number;
  /** The way we face, as the nearest ANGLE_ constant */
  angle: string;
  /** The room's travel points (the museum has five) */
  points: TravelPoint[];
}

/** Where a player stands, asked of the server (its rows and columns are Kod's own) */
async function travelHere(playerId: number): Promise<TravelHere> {
  if (!Number.isInteger(playerId)) throw new Error("playerId: a number");
  const [owner, row, col, angle] = await maint(
    `send object ${playerId} GetOwner`,
    `send object ${playerId} GetRow`,
    `send object ${playerId} GetCol`,
    `send object ${playerId} GetAngle`,
  );
  const room = answer(owner, "OBJECT");
  if (room === null) throw new Error(`Object ${playerId} isn't in a room (a save may have renumbered it: wait for the game tab's next report)`);
  const [num] = await maint(`send object ${room} GetRoomNum`);
  const rid = answer(num, "INT");
  const r = answer(row, "INT");
  const c = answer(col, "INT");
  if (rid === null || r === null || c === null) throw new Error("The server didn't say where we are");
  const points = travelPoints().filter((p) => p.rid === rid);
  return { rid, row: r, col: c, angle: nearestAngle(answer(angle, "INT") ?? 0), points };
}

async function travelMove(playerId: number, id: string, part: "portal" | "arrival"): Promise<{ point: TravelPoint; steps: string[] }> {
  const here = await travelHere(playerId);
  const p = here.points.find((x) => x.id === id);
  if (!p) throw new Error(`Point ${id} isn't in RID ${here.rid}: stand in its room (a new point needs an id and a name: add it by hand)`);
  const onPortal = here.row === p.row && here.col === p.col;
  const onArrival = here.row === p.arrivalRow && here.col === p.arrivalCol;
  if (part === "portal" && onArrival) throw new Error("That's the arrival square: move the arrival first");
  if (part === "arrival" && onPortal) throw new Error("That's the portal's square: nobody can stand there");
  const before = readFileSync(TRAVELNET, "latin1");
  // A half-done edit would fail the build, and failed builds can leave stale .bof files: not tried
  const stray = strayLines(before);
  if (stray.length) throw new Error(`GetPoints has lines that aren't points; fix travelnet.kod first: ${stray.join(" | ")}`);
  const change = part === "portal" ? { portal: { row: here.row, col: here.col } } : { arrival: { row: here.row, col: here.col, angle: here.angle } };
  writeFileSync(TRAVELNET, movePoint(before, p.id, change), "latin1");
  const steps = [part === "portal" ? `portal to row ${here.row}, col ${here.col}` : `arrival to row ${here.row}, col ${here.col}, facing ${here.angle}`];
  const built = buildKod();
  if (!built.ok) {
    // Left as the server has it: the change waits for a build that works
    writeFileSync(TRAVELNET, before, "latin1");
    throw new Error(`the Kod build failed, so travelnet.kod is back as it was:\n${built.tail}`);
  }
  steps.push("built");
  await maint("reload system");
  steps.push("reload system");
  if (part === "portal") {
    // The reload's save renumbered every object: the room is looked up again
    const [found] = await maint(`send object 0 FindRoomByNum num int ${here.rid}`);
    const room = answer(found, "OBJECT");
    if (room === null) throw new Error(`RID ${here.rid} wasn't found after the reload: Rebuild it from the Rooms tab`);
    await maint(`send object ${room} Recreate`);
    steps.push("room recreated");
  }
  return { point: travelPoints().find((x) => x.id === p.id) ?? p, steps };
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
  questApi(server, { buildKod, standing: travelHere }, route, body);
  companionApi(server, route, body);
  spriteApi(server, { buildKod, route, body });
  server.middlewares.use(
    "/__admin/kod/build",
    route(async () => buildKod()),
  );
  server.middlewares.use(
    "/__admin/travel/here",
    route(async (req) => travelHere((JSON.parse(await body(req)) as { playerId: number }).playerId)),
  );
  server.middlewares.use(
    "/__admin/travel/move",
    route(async (req) => {
      const { playerId, id, part } = JSON.parse(await body(req)) as { playerId: number; id: string; part: string };
      if (part !== "portal" && part !== "arrival") throw new Error('part: "portal" or "arrival"');
      if (typeof id !== "string" || !/^\w+$/.test(id)) throw new Error("id: the point's id as GetPoints writes it");
      return travelMove(playerId, id, part);
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
