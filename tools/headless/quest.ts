// A scripted player for trying quests (docs/adr/0009-quests.md) without the browser: it enters
// the game, then runs a list of steps, printing what the server says (chat lines and UC_QUEST_*).
//
//   node tools/headless/quest.ts --user shardbot --pass shardbot --do "talk Paddock; accept 1; log"
//
// Steps, separated by ";":
//   walk row,col        walk to a square (Kod rows and columns), a short step every 250 ms
//   talk <name>         activate the NPC in our room whose name starts with <name>
//   accept <id>         quest accept <id> (with the NPC we last talked to)
//   turnin <id>         quest turnin <id>
//   abandon <id>        quest abandon <id>
//   log                 quest log
//   offers              quest offers (the NPC we last talked to)
//   cmd <line>          any UC_SHARDS line
//   maint <command>     a maintenance command, $me standing for our object ("maint send object $me TeleportTo rid int 52")
//   wait <seconds>
// It stays --stay seconds after the last step, then leaves.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseRsb } from "../../packages/formats/src/rsb.ts";
import { GameSession } from "../../packages/world/src/index.ts";
import { maint } from "../maint/maintClient.ts";

const { values: opt } = parseArgs({
  options: {
    user: { type: "string", default: "shardbot" },
    pass: { type: "string", default: "shardbot" },
    gateway: { type: "string", default: "ws://localhost:8059" },
    rsb: { type: "string", default: "server/src/run/server/rsc/rsc0000.rsb" },
    do: { type: "string", default: "log" },
    stay: { type: "string", default: "3" },
  },
});

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const cfg = readFileSync("server/config/blakserv.cfg", "utf8");
const secretKey = /^SecretKey\s+(\S+)/m.exec(cfg)?.[1] ?? "";
const rsb = parseRsb(readFileSync(opt.rsb!));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const session = new GameSession(
  { url: opt.gateway!, username: opt.user!, password: opt.pass!, secretKey, lookupResource: (id, lang) => rsb.get(id, lang) },
  {
    phase: (p) => {
      if (p === "characters") {
        const c = session.characters.find((x) => x.flags !== 1);
        if (c) session.useCharacter(c.id);
        else log("no character to play");
      }
      if (p === "game") void run();
      if (p === "closed") process.exit(0);
    },
    chat: (l) => log("chat:", l.spans.map((s) => s.text).join("")),
    error: (e) => log("error:", e),
    quest: (e) => log("quest:", JSON.stringify(e)),
  },
);

const nameOf = (res: number) => session.resource(res) ?? "";

async function walk(row: number, col: number): Promise<void> {
  const tx = (col - 0.5) * 1024,
    ty = (row - 0.5) * 1024;
  for (let n = 0; n < 400; n++) {
    const self = session.world.self;
    if (!self) return;
    const dx = tx - self.x,
      dy = ty - self.y;
    const d = Math.hypot(dx, dy);
    if (d < 32) break;
    const step = Math.min(d, 256);
    self.x += (dx / d) * step;
    self.y += (dy / d) * step;
    session.requestMove(self.x, self.y, 25);
    await sleep(250);
  }
  log(`at ${row},${col}`);
}

async function run(): Promise<void> {
  while (!session.world.self || !nameOf(session.world.self.info.nameRes)) await sleep(100);
  await sleep(1000);
  log(`in the game as ${nameOf(session.world.self.info.nameRes)}, object ${session.world.self.id}`);
  for (const raw of opt.do!.split(";")) {
    const [verb = "", ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(" ");
    log(">", raw.trim());
    if (verb === "walk") {
      const [row, col] = arg.split(",").map(Number);
      await walk(row!, col!);
    } else if (verb === "talk") {
      const npc = [...session.world.objects.values()].find((o) => nameOf(o.info.nameRes).toLowerCase().startsWith(arg.toLowerCase()));
      if (!npc) log(`no ${arg} here; the room has: ${[...session.world.objects.values()].map((o) => nameOf(o.info.nameRes)).filter(Boolean).join(", ")}`);
      else {
        log(`${nameOf(npc.info.nameRes)} is object ${npc.id}, minimap flags 0x${npc.info.minimapFlags.toString(16)}`);
        session.activate(npc.id);
      }
    } else if (["accept", "turnin", "abandon", "log", "offers"].includes(verb)) session.shardsCommand(`quest ${verb}${arg ? ` ${arg}` : ""}`);
    else if (verb === "cmd") session.shardsCommand(arg);
    else if (verb === "maint") log("maint:", ((await maint(arg.replace(/\$me/g, String(session.world.self!.id))))[0] ?? "").trim());
    else if (verb === "wait") await sleep(Number(arg) * 1000);
    else if (verb) log(`unknown step ${verb}`);
    await sleep(600);
  }
  await sleep(Number(opt.stay) * 1000);
  log("done");
  session.close();
  process.exit(0);
}
