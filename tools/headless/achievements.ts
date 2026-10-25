// A scripted player for trying the achievements (docs/adr/0025-achievements.md) without the browser:
// it enters the game, then runs a list of steps, printing what the server says (chat lines and
// UC_ACHIEVEMENTS).
//
//   node tools/headless/achievements.ts --user shardbot --pass shardbot --do "list; maint send object $me AdminAchieve id int 82; list"
//
// Steps, separated by ";":
//   list                the achievements command: the whole list comes back
//   maint <command>     a maintenance command, $me standing for our object
//   cmd <line>          any UC_SHARDS line
//   wait <seconds>

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
    do: { type: "string", default: "list" },
    stay: { type: "string", default: "2" },
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
    achievements: (e) =>
      log(e.type === "all" ? `achievements: ${e.earned.length} earned [${e.earned.map((a) => a.id).join(",")}] (server clock ${e.now})` : `achievement UNLOCKED: ${e.id}`),
  },
);

const nameOf = (res: number) => session.resource(res) ?? "";

async function run(): Promise<void> {
  while (!session.world.self || !nameOf(session.world.self.info.nameRes)) await sleep(100);
  await sleep(1000);
  log(`in the game as ${nameOf(session.world.self.info.nameRes)}, object ${session.world.self.id}`);
  for (const raw of opt.do!.split(";")) {
    const [verb = "", ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(" ");
    log(">", raw.trim());
    const me = String(session.world.self!.id);
    if (verb === "list") session.shardsCommand("achievements");
    else if (verb === "cmd") session.shardsCommand(arg);
    else if (verb === "maint") log("maint:", ((await maint(arg.replace(/\$me/g, me)))[0] ?? "").trim().replace(/\n/g, " | "));
    else if (verb === "wait") await sleep(Number(arg) * 1000);
    else if (verb) log(`unknown step ${verb}`);
    await sleep(800);
  }
  await sleep(Number(opt.stay) * 1000);
  log("done");
  session.close();
  process.exit(0);
}
