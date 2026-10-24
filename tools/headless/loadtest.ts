// Load test: runs many headless clients (client.ts) at once against one server and
// reports how many got in, stayed in and left cleanly.
//
//   node tools/headless/loadtest.ts --url wss://<site>/ws --pass <password>
//        [--count 50] [--prefix loadbot] [--ramp 1] [--stay 600] [--say-every 30]
//        [--walk "3,8 4,8"] [--origin https://<site>]
//        [--spread "50,52,101" --ssh shards@<host> --ssh-key <key>]
//
// Bot accounts are <prefix>aa, <prefix>ab, ... (letters only, so the character names
// pass the name check), all with --pass. Create them on the server first, e.g.
//   maint "create automated loadbotaa <password> none"
// Each bot walks --walk back and forth and says a line every --say-every seconds.
// Status lines every 15 s include the bots' ping round trips since the last one.
// The gateway allows 4 connections per address (GATEWAY_MAX_PER_IP): raise it for the test.
// A gateway with GATEWAY_ORIGINS set turns away connections without an allowed --origin.
//
// --spread "50,52,101,..." takes room numbers (RIDs) and teleports each bot to one of them
// in turn once it's in the game, through the server's admin console over SSH (--ssh
// user@host, --ssh-key; the VM layout in deploy/README.md). Spread bots --wander where
// they land instead of walking --walk.

import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    url: { type: "string" },
    pass: { type: "string", default: process.env.LOADTEST_PASS },
    count: { type: "string", default: "50" },
    prefix: { type: "string", default: "loadbot" },
    ramp: { type: "string", default: "1" },
    stay: { type: "string", default: "600" },
    "say-every": { type: "string", default: "30" },
    walk: { type: "string", default: "3,8 4,8" },
    origin: { type: "string" },
    spread: { type: "string" },
    ssh: { type: "string" },
    "ssh-key": { type: "string" },
  },
});

if (!opt.url || !opt.pass) {
  console.error("usage: loadtest.ts --url wss://<site>/ws --pass <password> (or LOADTEST_PASS)");
  process.exit(2);
}
const rooms = (opt.spread ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
if (rooms.length && !opt.ssh) {
  console.error("--spread needs --ssh user@host (and usually --ssh-key) to teleport the bots");
  process.exit(2);
}

const count = Number(opt.count);
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(4);
const log = (...a: unknown[]) => console.log(`[${secs()}s]`, ...a);

type Bot = { user: string; state: "starting" | "login" | "in game" | "done" | "failed"; joinMs?: number; last: string };
const bots: Bot[] = [];
/** Ping round trips (BP_PING to BP_ECHO_PING, every 5 s per bot): since the last status line, and all of them */
let windowPings: number[] = [];
const allPings: number[] = [];

function pingSummary(pings: number[]): string {
  if (!pings.length) return "no pings";
  const s = [...pings].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `ping median ${at(0.5)} ms, 95th ${at(0.95)} ms, worst ${s[s.length - 1]} ms`;
}

/** --spread: "send object" commands waiting to go out, and whether an SSH call is running */
let teleports: string[] = [];
let teleporting = false;
let teleported = 0;

/** Sends the waiting teleports in one maint call (about 0.5 s a command). */
function flushTeleports(): void {
  if (teleporting || !teleports.length) return;
  const batch = teleports;
  teleports = [];
  teleporting = true;
  const maint = batch.map((c) => `"${c}"`).join(" ");
  const child = spawn("ssh", [
    "-o", "BatchMode=yes", ...(opt["ssh-key"] ? ["-i", opt["ssh-key"]] : []), opt.ssh!,
    `cd ~/meridian-shards && sudo docker compose -f deploy/docker-compose.yml exec -T blakserv maint ${maint}`,
  ]);
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr.on("data", (d: Buffer) => (out += d.toString()));
  child.on("exit", (code) => {
    teleporting = false;
    // TeleportTo returns TRUE (1) when it moved the bot; anything else is a bad RID or a logged-off bot
    const ok = (out.match(/INT 1\b|TRUE/gi) ?? []).length;
    teleported += ok;
    if (code !== 0 || ok < batch.length) log(`teleport batch: ${ok} of ${batch.length} moved (ssh exit ${code}): ${out.replace(/\s+/g, " ").slice(0, 300)}`);
  });
}
if (rooms.length) setInterval(flushTeleports, 2000);

/** aa, ab, ... az, ba, ...: letters only. */
function suffix(i: number): string {
  const a = "abcdefghijklmnopqrstuvwxyz";
  return a[Math.floor(i / 26) % 26] + a[i % 26];
}

function start(i: number): void {
  const bot: Bot = { user: opt.prefix + suffix(i), state: "starting", last: "" };
  bots.push(bot);
  const startedAt = Date.now();
  const child = spawn(
    process.execPath,
    [
      "tools/headless/client.ts", "--url", opt.url!, "--user", bot.user, "--pass", opt.pass!,
      ...(rooms.length ? ["--wander"] : ["--walk", opt.walk!, "--loop"]), "--stay", opt.stay!,
      "--say", `${bot.user} checking in`, "--say-every", opt["say-every"]!,
      ...(opt.origin ? ["--origin", opt.origin] : []),
      "--ping-log",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const onLine = (line: string) => {
    if (!line.trim()) return;
    const ping = /ping (\d+) ms/.exec(line);
    if (ping) {
      windowPings.push(Number(ping[1]));
      allPings.push(Number(ping[1]));
      return;
    }
    bot.last = line.trim();
    if (/login ok/.test(line)) bot.state = "login";
    const me = /BP_PLAYER: I am \S+ #(\d+)/.exec(line);
    if (me && rooms.length && bot.state !== "in game") {
      teleports.push(`send object ${me[1]} teleportto rid int ${rooms[i % rooms.length]}`);
    }
    if (/BP_ROOM_CONTENTS/.test(line) && bot.state !== "in game") {
      bot.state = "in game";
      bot.joinMs = Date.now() - startedAt;
    }
  };
  let buf = "";
  const feed = (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop()!;
    lines.forEach(onLine);
  };
  child.stdout.on("data", feed);
  child.stderr.on("data", feed);
  child.on("exit", (code) => {
    bot.state = code === 0 && bot.joinMs !== undefined ? "done" : "failed";
    if (bot.state === "failed") log(`${bot.user} failed (exit ${code}): ${bot.last}`);
  });
}

function tally(): Record<Bot["state"], number> {
  const t = { starting: 0, login: 0, "in game": 0, done: 0, failed: 0 };
  for (const b of bots) t[b.state]++;
  return t;
}

log(`starting ${count} bots against ${opt.url}, one every ${opt.ramp}s, ${opt.stay}s each`);
for (let i = 0; i < count; i++) setTimeout(() => start(i), i * Number(opt.ramp) * 1000);

const status = setInterval(() => {
  const t = tally();
  const spread = rooms.length ? `, teleported ${teleported}` : "";
  log(`in game ${t["in game"]}, logging in ${t.starting + t.login}, done ${t.done}, failed ${t.failed}${spread}; ${pingSummary(windowPings)}`);
  windowPings = [];
  if (bots.length === count && t.done + t.failed === count) finish();
}, 15000);

function finish(): void {
  clearInterval(status);
  const t = tally();
  const joins = bots.filter((b) => b.joinMs !== undefined).map((b) => b.joinMs!).sort((a, b) => a - b);
  const pct = (p: number) => (joins.length ? (joins[Math.min(joins.length - 1, Math.floor(p * joins.length))] / 1000).toFixed(1) : "-");
  log(`finished: ${t.done} clean, ${t.failed} failed of ${count}`);
  log(`whole run: ${pingSummary(allPings)}`);
  log(`time from connect to in game: median ${pct(0.5)}s, 90th ${pct(0.9)}s, worst ${pct(1)}s`);
  process.exit(t.failed ? 1 : 0);
}
