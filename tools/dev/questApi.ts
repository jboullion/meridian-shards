// The admin dashboard's quests (docs/adr/0009-quests.md; apps/client/src/admin/QuestsTab.tsx):
// writing shards-server's quests/*.json and givers.json, then the same route as moving a portal:
// the generator, server\build.cmd Bkod, reload system, and the rooms whose placed givers changed
// rebuilt. Open game tabs are told (shards:quests) to read the catalogue again.
//
//   GET  /__admin/quests                 the quests, givers and retired ids as files hold them; the
//                                        problems the generator finds; NPCs and rooms to pick from
//   POST /__admin/quests/save            { quest, apply? } -> written (a new quest gets the next id)
//   POST /__admin/quests/retire          { id } -> its file goes, its id is never used again; applied
//   POST /__admin/quests/apply           generate, build, reload system
//   POST /__admin/quests/giver           { giver, playerId?, place? } -> written; with place, where
//                                        playerId stands; applied
//   POST /__admin/quests/giver/delete    { key } -> gone, if no quest names it; applied
//   POST /__admin/quests/player          { playerId, action, id?, step? } -> QuestBook's Admin*
//                                        message, then the player's quests
//
// Every write goes back as it was if the generator or the Kod build fails.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { ViteDevServer } from "vite";
import { maint } from "../maint/maintClient.ts";
import { generate, readSources, SERVER_ROOT, writeCatalog } from "../quests/generate.ts";
import { ANGLES, type Giver, type Quest } from "../quests/schema.ts";
import { iconOf, isNpc, loadWorld, nameOf, type World } from "../quests/world.ts";

const QUESTS = join(SERVER_ROOT, "quests");
const QUESTDEFS = join(SERVER_ROOT, "kod", "util", "questdefs.kod");
const GIVERS = join(QUESTS, "givers.json");
const RETIRED = join(QUESTS, "retired.json");

export interface QuestDeps {
  buildKod: () => { ok: boolean; tail: string };
  /** Where a player stands, asked of the server */
  standing: (playerId: number) => Promise<{ rid: number; row: number; col: number; angle: string }>;
}

type Route = (req: IncomingMessage) => Promise<unknown>;

const answer = (out: string | undefined, kind: "OBJECT" | "INT"): number | null => {
  const m = (kind === "OBJECT" ? /^: OBJECT (\d+)/m : /^: INT (-?\d+)/m).exec(out ?? "");
  return m ? Number(m[1]) : null;
};

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "latin1")) as T) : fallback);
const writeJson = (path: string, data: unknown) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\r\n`.replace(/\r?\n/g, "\r\n"), "latin1");

/** Every file under quests/ and questdefs.kod, to put back after a failed build */
function snapshot(): Map<string, string | null> {
  const files = new Map<string, string | null>();
  for (const f of existsSync(QUESTS) ? readdirSync(QUESTS) : []) files.set(join(QUESTS, f), readFileSync(join(QUESTS, f), "latin1"));
  files.set(QUESTDEFS, existsSync(QUESTDEFS) ? readFileSync(QUESTDEFS, "latin1") : null);
  return files;
}

function restore(files: Map<string, string | null>): void {
  // Files written since go; the rest are as they were
  for (const f of existsSync(QUESTS) ? readdirSync(QUESTS) : []) if (!files.has(join(QUESTS, f))) rmSync(join(QUESTS, f));
  for (const [path, text] of files) {
    if (text === null) rmSync(path, { force: true });
    else writeFileSync(path, text, "latin1");
  }
}

/** A quest file's name for its key, refusing anything but the key's own characters */
function questPath(key: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key) || key === "givers" || key === "retired") throw new Error(`key "${key}": lower-case letters, digits and dashes`);
  return join(QUESTS, `${key}.json`);
}

/** The quests as files hold them, by file */
function questFiles(): { file: string; quest: Quest }[] {
  return readSources(QUESTS).questFiles.map(({ file, data }) => ({ file, quest: data as Quest }));
}

/** What the dashboard picks from: NPCs (with where they stand) and rooms */
function choices(w: World) {
  const npcs = [...w.classes.keys()]
    .filter((c) => isNpc(w, c) && c !== "QuestGiver")
    .map((c) => ({ className: c, name: nameOf(w, c), icon: iconOf(w, c), rooms: (w.npcRooms.get(c) ?? []).map((rid) => ({ rid, name: w.rooms.get(rid) ?? String(rid) })) }))
    .filter((n) => n.icon)
    .sort((a, b) => a.name.localeCompare(b.name));
  const rooms = [...w.rooms].map(([rid, name]) => ({ rid, name, ridName: [...w.rids].find(([, n]) => n === rid)?.[0] ?? null })).sort((a, b) => a.rid - b.rid);
  return { npcs, rooms };
}

/** A maintenance-port list (show list) as nested arrays of numbers and nulls */
export function parseShownList(out: string): unknown {
  const stack: unknown[][] = [[]];
  for (const line of out.split(/\r?\n/)) {
    const t = line.replace(/^:\s*/, "").trim();
    if (t === "[") {
      const list: unknown[] = [];
      stack[stack.length - 1]!.push(list);
      stack.push(list);
    } else if (/^\] length/.test(t)) stack.pop();
    else if (/^INT -?\d+$/.test(t)) stack[stack.length - 1]!.push(Number(t.slice(4)));
    else if (/^\$ /.test(t)) stack[stack.length - 1]!.push(null);
  }
  return stack[0]![0] ?? null;
}

export function questApi(server: ViteDevServer, deps: QuestDeps, route: (fn: Route) => (req: IncomingMessage, res: ServerResponse) => void, body: (req: IncomingMessage) => Promise<string>): void {
  let world: World | null = null;
  const getWorld = () => (world ??= loadWorld(join(SERVER_ROOT, "kod")));

  const questBook = async (): Promise<number> => {
    const [out] = await maint("send object 0 GetQuestBook");
    const qb = answer(out, "OBJECT");
    if (qb === null) throw new Error("The server has no QuestBook: build the Kod and reload system");
    return qb;
  };

  /** Generate, and if the Kod changed build it and reload; rebuild these rooms after. Puts files back on failure */
  async function apply(before: Map<string, string | null>, rooms: number[] = []): Promise<string[]> {
    world = null;
    const steps: string[] = [];
    const g = generate();
    if (g.errors.length) {
      restore(before);
      throw new Error(`the quests have problems, so nothing was changed:\n${g.errors.join("\n")}`);
    }
    const oldKod = before.get(QUESTDEFS) ?? null;
    if (oldKod !== g.kod) {
      writeFileSync(QUESTDEFS, g.kod, "latin1");
      const built = deps.buildKod();
      if (!built.ok) {
        restore(before);
        throw new Error(`the Kod build failed, so the quests are back as they were:\n${built.tail}`);
      }
      steps.push("built");
      await maint("reload system");
      steps.push("reload system");
      for (const rid of [...new Set(rooms)]) {
        const [found] = await maint(`send object 0 FindRoomByNum num int ${rid}`);
        const room = answer(found, "OBJECT");
        if (room === null) continue;
        await maint(`send object ${room} Recreate`);
        steps.push(`RID ${rid} rebuilt`);
      }
    } else steps.push("the Kod is unchanged (only text our client shows)");
    if (writeCatalog(g)) steps.push("catalogue written");
    server.ws.send("shards:quests", { hash: g.catalog.hash });
    return steps;
  }

  const playerState = async (qb: number, playerId: number) => {
    const [out] = await maint(`send object ${qb} AdminState who object ${playerId}`);
    const list = /^: LIST (\d+)/m.exec(out ?? "")?.[1];
    if (!list) throw new Error(`Object ${playerId} isn't a player (a save may have renumbered it: wait for the game tab's next report)`);
    const [shown] = await maint(`show list ${list}`);
    const [log, done] = (parseShownList(shown ?? "") as [number[][] | null, number[][] | null] | null) ?? [null, null];
    return {
      log: (log ?? []).map(([id, step, count, deadline]) => ({ id, step, count, deadline })),
      done: (done ?? []).map(([id, times, last]) => ({ id, times, last })),
    };
  };

  server.middlewares.use(
    "/__admin/quests/save",
    route(async (req) => {
      const { quest, apply: andApply } = JSON.parse(await body(req)) as { quest: Quest; apply?: boolean };
      const before = snapshot();
      const files = questFiles();
      const retired = readJson<number[]>(RETIRED, []);
      if (!quest.id) quest.id = Math.max(0, ...files.map((f) => f.quest.id), ...retired) + 1;
      const path = questPath(quest.key);
      // The same quest under a new key: its old file goes
      const old = files.find((f) => f.quest.id === quest.id && f.file !== `${quest.key}.json`);
      if (files.some((f) => f.file === `${quest.key}.json` && f.quest.id !== quest.id)) throw new Error(`key "${quest.key}" is another quest's`);
      writeJson(path, quest);
      if (old) rmSync(join(QUESTS, old.file));
      const g = generate();
      if (g.errors.length) {
        restore(before);
        throw new Error(`not saved:\n${g.errors.join("\n")}`);
      }
      const steps = [`${quest.key}.json written (id ${quest.id})`];
      if (andApply) steps.push(...(await apply(before)));
      return { id: quest.id, steps };
    }),
  );

  server.middlewares.use(
    "/__admin/quests/retire",
    route(async (req) => {
      const { id } = JSON.parse(await body(req)) as { id: number };
      const f = questFiles().find((x) => x.quest.id === id);
      if (!f) throw new Error(`no quest ${id}`);
      const before = snapshot();
      rmSync(join(QUESTS, f.file));
      writeJson(RETIRED, [...new Set([...readJson<number[]>(RETIRED, []), id])].sort((a, b) => a - b));
      return { steps: [`${f.file} retired`, ...(await apply(before))] };
    }),
  );

  server.middlewares.use(
    "/__admin/quests/apply",
    route(async () => ({ steps: await apply(snapshot()) })),
  );

  server.middlewares.use(
    "/__admin/quests/giver/delete",
    route(async (req) => {
      const { key } = JSON.parse(await body(req)) as { key: string };
      const givers = readJson<Giver[]>(GIVERS, []);
      const g = givers.find((x) => x.key === key);
      if (!g) throw new Error(`no giver ${key}`);
      const users = questFiles().filter((f) => JSON.stringify(f.quest).includes(`"placed":"${key}"`));
      if (users.length) throw new Error(`${users.map((u) => u.file).join(", ")} name ${key}: change them first`);
      const before = snapshot();
      writeJson(
        GIVERS,
        givers.filter((x) => x.key !== key),
      );
      const rid = typeof g.rid === "number" ? g.rid : (getWorld().rids.get(g.rid) ?? 0);
      return { steps: [`${key} removed`, ...(await apply(before, [rid]))] };
    }),
  );

  server.middlewares.use(
    "/__admin/quests/giver",
    route(async (req) => {
      const { giver, playerId, place } = JSON.parse(await body(req)) as { giver: Partial<Giver> & { key: string }; playerId?: number; place?: boolean };
      const givers = readJson<Giver[]>(GIVERS, []);
      const old = givers.find((x) => x.key === giver.key);
      const next: Giver = {
        key: giver.key,
        id: old?.id ?? Math.max(0, ...givers.map((x) => x.id)) + 1,
        name: giver.name ?? old?.name ?? giver.key,
        look: giver.look ?? old?.look ?? "TosInnKeeper",
        rid: old?.rid ?? 0,
        row: old?.row ?? 1,
        col: old?.col ?? 1,
        angle: old?.angle ?? "ANGLE_SOUTH",
        ...(giver.desc !== undefined || old?.desc ? { desc: giver.desc ?? old?.desc } : {}),
        // Ours: a barber or tailor stays one when it's moved (docs/adr/0012-cosmetics.md)
        ...(giver.service !== undefined || old?.service ? { service: giver.service ?? old?.service } : {}),
      };
      if (place) {
        if (!Number.isInteger(playerId)) throw new Error("playerId: a number");
        const at = await deps.standing(playerId!);
        Object.assign(next, { rid: at.rid, row: at.row, col: at.col, angle: ANGLES.includes(at.angle as never) ? at.angle : "ANGLE_SOUTH" });
        delete next.fineRow;
        delete next.fineCol;
      }
      if (!old && !place) throw new Error("A new giver is placed where you stand: use Place giver here");
      const before = snapshot();
      writeJson(GIVERS, [...givers.filter((x) => x.key !== giver.key), next].sort((a, b) => a.id - b.id));
      const w = getWorld();
      const ridOf = (r: string | number) => (typeof r === "number" ? r : (w.rids.get(r) ?? 0));
      const rooms = [ridOf(next.rid), ...(old ? [ridOf(old.rid)] : [])];
      return { giver: next, steps: [`${next.key} ${old ? "changed" : "added"}`, ...(await apply(before, rooms))] };
    }),
  );

  server.middlewares.use(
    "/__admin/quests/player",
    route(async (req) => {
      const { playerId, action, id, step } = JSON.parse(await body(req)) as { playerId: number; action: string; id?: number; step?: number };
      if (!Number.isInteger(playerId)) throw new Error("playerId: a number");
      const qb = await questBook();
      const who = `who object ${playerId}`;
      const q = `id int ${Number(id) || 0}`;
      const commands: Record<string, string> = {
        grant: `AdminGrant ${who} ${q}`,
        step: `AdminSetStep ${who} ${q} step int ${Number(step) || 1}`,
        finish: `AdminFinishStep ${who} ${q}`,
        complete: `AdminComplete ${who} ${q}`,
        reset: `AdminReset ${who} ${q}`,
        resetAll: `AdminReset ${who} id int 0`,
      };
      // Asked first, so a stale object number is refused before anything is sent to it
      await playerState(qb, playerId);
      if (action !== "state") {
        const cmd = commands[action];
        if (!cmd) throw new Error(`action: one of state, ${Object.keys(commands).join(", ")}`);
        const [out] = await maint(`send object ${qb} ${cmd}`);
        if (answer(out, "INT") !== 1) throw new Error(`the server said no (${action} ${id ?? ""}): is the quest there, and you in the game?`);
      }
      return playerState(qb, playerId);
    }),
  );

  server.middlewares.use(
    "/__admin/quests",
    route(async (req) => {
      if (req.method !== "GET") throw new Error("GET");
      const w = getWorld();
      const files = questFiles();
      const givers = readJson<Giver[]>(GIVERS, []);
      const retired = readJson<number[]>(RETIRED, []);
      const g = generate();
      return {
        quests: files.map((f) => f.quest).sort((a, b) => a.id - b.id),
        givers,
        retired,
        errors: g.errors,
        // Each step's area as the generator works it out (a kill's spawn rooms), by quest id
        areas: Object.fromEntries(g.catalog.quests.map((q) => [q.id, q.steps.map((s) => s.rooms.map((r) => r.name))])),
        nextId: Math.max(0, ...files.map((f) => f.quest.id), ...retired) + 1,
        ...choices(w),
      };
    }),
  );
}
