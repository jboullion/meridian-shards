// A scripted player for trying the arenas' mock bouts (docs/adr/0019-arena-bouts.md) without the
// browser: it enters the game, then runs a list of steps, printing what the server says (chat
// lines and UC_ARENA).
//
//   node tools/headless/arena.ts --user shardbot --pass shardbot --do "tp 60; join; wait 12; fight 60"
//
// Steps, separated by ";":
//   tp <rid>            TeleportTo that room, on the maintenance port (60 the Arena of Kraanan, 79 the Arena of Death)
//   status | join | leave
//                       the arena command
//   pvp <word>          arena pvp <traditional|lastman|guild|royale|champion|challenge|accept|renege>
//   fight <seconds>     attack the nearest standing opponent once it comes within reach (we stand still: the
//                       bot can't see walls), for that long or until the bout ends
//   lose                set our health to 1 and be hit: the beaten player wakes in the stands (a dev server only!)
//   killfoes            kill our standing opponents on the maintenance port, as if we had: a win
//   health              print our health
//   cmd <line>          any UC_SHARDS line
//   maint <command>     a maintenance command, $me standing for our object
//   wait <seconds>
// It stays --stay seconds after the last step, then leaves.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseRsb } from "../../packages/formats/src/rsb.ts";
import { BOUT_STATE, GameSession, type ArenaStatus } from "../../packages/world/src/index.ts";
import { maint } from "../maint/maintClient.ts";

const { values: opt } = parseArgs({
  options: {
    user: { type: "string", default: "shardbot" },
    pass: { type: "string", default: "shardbot" },
    gateway: { type: "string", default: "ws://localhost:8059" },
    rsb: { type: "string", default: "server/src/run/server/rsc/rsc0000.rsb" },
    do: { type: "string", default: "status" },
    stay: { type: "string", default: "3" },
  },
});

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const cfg = readFileSync("server/config/blakserv.cfg", "utf8");
const secretKey = /^SecretKey\s+(\S+)/m.exec(cfg)?.[1] ?? "";
const rsb = parseRsb(readFileSync(opt.rsb!));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** client units per square */
const SQUARE = 1024;

let status: ArenaStatus | null = null;
let lastLine = "";

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
    arena: (s) => {
      status = s;
      const opps = s.opponents.map((o) => `${o.name} (${o.kindName}) ${o.id ? `${o.hp}/${o.maxHp}` : "down"}`).join(", ");
      const line = `arena ${s.arena} state ${s.state} place ${s.place}/${s.queueLength} floor ${s.floor} ${s.secondsLeft}s flags ${s.flags}${opps ? ` | ${opps}` : ""} | ${s.records.map((r) => `${r.wins}-${r.losses} streak ${r.streak} best ${r.best}`).join(" / ")} | ${s.title}${s.ended ? ` | ended ${s.ended}` : ""}`;
      // Every second of a bout: only the changes
      if (line !== lastLine) log(line);
      lastLine = line;
    },
  },
);

const nameOf = (res: number) => session.resource(res) ?? "";
const health = () => session.world.stats.get(1);

async function fight(seconds: number): Promise<void> {
  const until = Date.now() + seconds * 1000;
  let lastAttack = 0;
  let lastReport = 0;
  while (Date.now() < until) {
    const s = status as ArenaStatus | null;
    if (!s || (s.state !== BOUT_STATE.FIGHTING && s.state !== BOUT_STATE.COUNTDOWN)) {
      log("no bout of ours");
      return;
    }
    const self = session.world.self;
    const foes = s.opponents.map((o) => (o.id ? session.world.objects.get(o.id) : undefined)).filter((o) => !!o);
    if (!self || !foes.length || s.state === BOUT_STATE.COUNTDOWN) {
      await sleep(250);
      continue;
    }
    const foe = foes.reduce((a, b) => (Math.hypot(a.x - self.x, a.y - self.y) <= Math.hypot(b.x - self.x, b.y - self.y) ? a : b));
    const dx = foe.x - self.x,
      dy = foe.y - self.y;
    const d = Math.hypot(dx, dy);
    if (Date.now() - lastReport > 3000) {
      log(`at ${Math.round(self.x)},${Math.round(self.y)}; ${nameOf(foe.info.nameRes)} at ${Math.round(foe.x)},${Math.round(foe.y)}, ${(d / SQUARE).toFixed(1)} squares`);
      lastReport = Date.now();
    }
    if (d <= SQUARE * 1.5 && Date.now() - lastAttack > 1000) {
      // Face it (BP_REQ_TURN; angles are 4096 to the circle, 0 east, clockwise as y runs south)
      session.requestTurn(Math.round((Math.atan2(dy, dx) * 4096) / (2 * Math.PI) + 4096) % 4096);
      session.attack(foe.id);
      lastAttack = Date.now();
    }
    await sleep(250);
  }
}

async function run(): Promise<void> {
  while (!session.world.self || !nameOf(session.world.self.info.nameRes)) await sleep(100);
  await sleep(1000);
  log(`in the game as ${nameOf(session.world.self.info.nameRes)}, object ${session.world.self.id}`);
  for (const raw of opt.do!.split(";")) {
    const [verb = "", ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(" ");
    log(">", raw.trim());
    const me = String(session.world.self!.id);
    if (verb === "status" || verb === "join" || verb === "leave") session.shardsCommand(`arena ${verb}`);
    else if (verb === "pvp") session.shardsCommand(`arena pvp ${arg}`);
    else if (verb === "tp") log("maint:", ((await maint(`send object ${me} TeleportTo RID int ${arg}`))[0] ?? "").trim());
    else if (verb === "fight") await fight(Number(arg) || 60);
    else if (verb === "killfoes") {
      for (const o of (status as ArenaStatus | null)?.opponents ?? []) if (o.id) log("maint:", ((await maint(`send object ${o.id} Killed what object ${me}`))[0] ?? "").trim().split("\n")[0]);
    } else if (verb === "lose") log("maint:", ((await maint(`send object ${me} SetHealth amount int 1`))[0] ?? "").trim());
    else if (verb === "health") log("health:", JSON.stringify(health()));
    else if (verb === "cmd") session.shardsCommand(arg);
    else if (verb === "maint") log("maint:", ((await maint(arg.replace(/\$me/g, me)))[0] ?? "").trim());
    else if (verb === "wait") await sleep(Number(arg) * 1000);
    else if (verb) log(`unknown step ${verb}`);
    await sleep(600);
  }
  await sleep(Number(opt.stay) * 1000);
  log("done");
  session.close();
  process.exit(0);
}
