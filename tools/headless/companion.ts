// A scripted player for trying companions (docs/adr/0010-followers.md) without the browser: it
// enters the game, then runs a list of steps, printing what the server says (chat lines and
// UC_COMPANION).
//
//   node tools/headless/companion.ts --user shardbot --pass shardbot --do "ask; status; give feather; take feather"
//
// Steps, separated by ";":
//   ask | status | follow | defend | stay | passive | dismiss | forever | confirm | come | pay
//                       the companion command (forever: dismiss forever; confirm: dismiss forever confirm)
//   look <10 numbers>   companion look <gender hair eyes nose mouth beard hair-colour skin c1 c2>
//   give <name>         deposit the inventory item whose name starts with <name> (all of a stack)
//   take <name>         withdraw the pack item whose name starts with <name> (all of a stack)
//   cmd <line>          any UC_SHARDS line
//   maint <command>     a maintenance command, $me standing for our object, $comp for our companion
//   walk row,col        walk to a square (Kod rows and columns), a short step every 250 ms
//   wait <seconds>
// It stays --stay seconds after the last step, then leaves.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseRsb } from "../../packages/formats/src/rsb.ts";
import { GameSession, type CompanionStatus, type TradeList } from "../../packages/world/src/index.ts";
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

let status: CompanionStatus | null = null;
let vault: TradeList | null = null;

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
    companion: (e) => {
      if (e.type === "status") status = e.status;
      else if (e.type === "none") status = null;
      const { look, palette, ...rest } = e.type === "status" ? e.status : { look: null, palette: null, ...e };
      log("companion:", JSON.stringify(rest), look ? `look ${JSON.stringify(look)} palette ${JSON.stringify(palette)}` : "");
    },
    trade: (t) => {
      vault = t;
      log(`${t.kind}:`, t.items.map((i) => `${i.object.amount > 1 ? `${i.object.amount} ` : ""}${nameOf(i.object.nameRes)}`).join(", ") || "nothing");
    },
  },
);

const nameOf = (res: number) => session.resource(res) ?? "";
const starts = (res: number, arg: string) => nameOf(res).toLowerCase().startsWith(arg.toLowerCase());

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

const WORDS: Record<string, string> = {
  ask: "ask", status: "status", follow: "follow", defend: "defend", stay: "stay", passive: "passive",
  dismiss: "dismiss", forever: "dismiss forever", confirm: "dismiss forever confirm", come: "come", pay: "pay",
};

async function run(): Promise<void> {
  while (!session.world.self || !nameOf(session.world.self.info.nameRes)) await sleep(100);
  await sleep(1000);
  log(`in the game as ${nameOf(session.world.self.info.nameRes)}, object ${session.world.self.id}`);
  for (const raw of opt.do!.split(";")) {
    const [verb = "", ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(" ");
    log(">", raw.trim());
    const comp = (status as CompanionStatus | null)?.id ?? 0;
    if (WORDS[verb]) session.shardsCommand(`companion ${WORDS[verb]}`);
    else if (verb === "look") session.shardsCommand(`companion look ${arg}`);
    else if (verb === "give") {
      const item = [...session.world.inventory.values()].find((o) => starts(o.nameRes, arg));
      if (!comp) log("no companion here to give to");
      else if (!item) log(`no ${arg} in the inventory`);
      else session.depositItems(comp, [{ id: item.id, amount: item.amount > 1 ? item.amount : undefined }]);
    } else if (verb === "take") {
      if (!comp) log("no companion here to take from");
      else {
        vault = null;
        session.requestWithdrawal(comp);
        for (let n = 0; n < 20 && !vault; n++) await sleep(100);
        const item = (vault as TradeList | null)?.items.find((i) => starts(i.object.nameRes, arg));
        if (!item) log(`no ${arg} in its pack`);
        else session.withdrawItems(comp, [{ id: item.object.id, amount: item.object.amount > 1 ? item.object.amount : undefined }]);
      }
    } else if (verb === "cmd") session.shardsCommand(arg);
    else if (verb === "maint") log("maint:", ((await maint(arg.replace(/\$me/g, String(session.world.self!.id)).replace(/\$comp/g, String(comp))))[0] ?? "").trim());
    else if (verb === "walk") {
      const [row, col] = arg.split(",").map(Number);
      await walk(row!, col!);
    } else if (verb === "wait") await sleep(Number(arg) * 1000);
    else if (verb) log(`unknown step ${verb}`);
    await sleep(600);
  }
  await sleep(Number(opt.stay) * 1000);
  log("done");
  session.close();
  process.exit(0);
}
