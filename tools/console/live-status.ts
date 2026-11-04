// The live server at a glance, for the Shards Console (ADR 0031 decision 2): one ssh round trip
// to the VM reads the blakserv container (state, start, restarts), `who`
// through its maintenance port, and the tail of channel/error.txt. Prints one JSON object;
// a failure is a field in it, never a crash.
//
//   node tools/console/live-status.ts          (npm run console:status)
//
// Maintenance commands are skipped while the container is under 90 seconds old: commands sent
// while blakserv loads have hung it (deploy/README.md).
//
// The file ~/.meridian-shards/live-paused stops the checks (every session's), for a VM that is
// struggling: on 2026-11-04 the checks' docker commands piled up on a thrashing e2-micro.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPOSE, deployTarget, ssh } from "../deploy/remote.ts";
import { inGame, parseStatus, parseWho, type ServerStatus, type Session } from "./blakserv.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ERROR_TAIL = 20;
const SETTLE_SEC = 90;
const PAUSE_FILE = join(homedir(), ".meridian-shards", "live-paused");

export interface LiveStatus {
  at: string;
  /** The ssh round trip worked */
  reachable: boolean;
  error?: string;
  container: { state: string; startedAt: string; restarts: number; ageSec: number } | null;
  /** Why the maintenance commands weren't sent, when they weren't */
  skipped?: "starting" | "not running";
  /** blakserv answered show status on its maintenance port. False: the port took the commands and
   *  nothing came back, so its main loop may be hung (logins and the account service fail too) */
  answering?: boolean;
  server: ServerStatus | null;
  /** Characters in the game */
  players: { account: string; room: string; rid: number }[];
  sessions: Session[];
  errors: { lines: number; tail: string[] } | null;
  /** The size of each of blakserv's logs (channel/*.txt), largest first: they grow until deploy/logrotate.conf trims them */
  logs: { name: string; bytes: number }[];
  lastShip: { at: string | null; version: string; tag: string | null };
}

// Sections start with "@@name"; bash on the VM
const SCRIPT = `
C="${COMPOSE}"
id=$($C ps -q blakserv </dev/null 2>/dev/null)
[ -z "$id" ] && { echo "@@container"; echo "missing"; exit 0; }
echo "@@container"
sudo docker inspect -f '{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}' "$id"
started=$(sudo docker inspect -f '{{.State.StartedAt}}' "$id")
age=$(( $(date +%s) - $(date -d "$started" +%s) ))
echo "@@age"; echo "$age"
# From the volume itself, so they show while blakserv is down too
echo "@@logs"
sudo sh -c 'cd "$(docker volume inspect -f "{{.Mountpoint}}" meridian-shards_channel)" && wc -c *.txt' 2>/dev/null
state=$(sudo docker inspect -f '{{.State.Status}}' "$id")
[ "$state" != "running" ] && exit 0
echo "@@errors"
$C exec -T blakserv sh -c 'wc -l < channel/error.txt 2>/dev/null || echo 0; tail -n ${ERROR_TAIL} channel/error.txt 2>/dev/null' </dev/null
[ "$age" -lt ${SETTLE_SEC} ] && exit 0
echo "@@maint"
$C exec -T blakserv maint "who" </dev/null
`;

function sections(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name = "";
  for (const line of output.split(/\r?\n/)) {
    const m = /^@@(\w+)$/.exec(line);
    if (m) name = m[1]!;
    else if (name) out[name] = (out[name] ? `${out[name]}\n` : "") + line;
  }
  return out;
}

function lastShip(): LiveStatus["lastShip"] {
  const version = (JSON.parse(readFileSync(join(ROOT, "apps", "desktop", "package.json"), "utf8")) as { version: string }).version;
  let at: string | null = null;
  try {
    at = (JSON.parse(readFileSync(join(homedir(), ".meridian-shards", "last-ship.json"), "utf8")) as { at: string }).at;
  } catch {
    // never shipped from this machine
  }
  let tag: string | null = null;
  try {
    tag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // no release tag yet
  }
  return { at, version, tag };
}

/** wc -c's lines ("  39697880 admin.txt"), the total left out, largest first */
export function parseLogs(output: string): LiveStatus["logs"] {
  return output
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\S+\.txt)\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ name: m[2]!, bytes: Number(m[1]) }))
    .sort((a, b) => b.bytes - a.bytes);
}

/** Reads the answer of the VM script */
export function readLive(output: string): Omit<LiveStatus, "at" | "reachable" | "lastShip"> {
  const s = sections(output);
  const live: Omit<LiveStatus, "at" | "reachable" | "lastShip"> = { container: null, server: null, players: [], sessions: [], errors: null, logs: parseLogs(s.logs ?? "") };
  const c = s.container?.trim();
  if (!c || c === "missing") return { ...live, skipped: "not running" };
  const [state = "", startedAt = "", restarts = "0"] = c.split("|");
  const ageSec = Number(s.age?.trim() ?? 0);
  live.container = { state, startedAt, restarts: Number(restarts), ageSec };
  if (state !== "running") return { ...live, skipped: "not running" };
  if (s.errors !== undefined) {
    const [count = "0", ...tail] = s.errors.split("\n");
    live.errors = { lines: Number(count.trim()) || 0, tail: tail.filter((l) => l.trim()) };
  }
  if (s.maint === undefined) return { ...live, skipped: "starting" };
  live.server = parseStatus(s.maint);
  live.answering = /^Name\s+Act\s+Ver/m.test(s.maint);
  live.sessions = parseWho(s.maint);
  live.players = inGame(live.sessions).map((p) => ({ account: p.account, room: p.room!, rid: p.rid! }));
  return live;
}

export function liveStatus(): LiveStatus {
  const base = { at: new Date().toISOString(), lastShip: lastShip() };
  if (existsSync(PAUSE_FILE)) return { ...base, reachable: false, error: `paused (delete ${PAUSE_FILE} to resume)`, container: null, server: null, players: [], sessions: [], errors: null, logs: [] };
  const target = deployTarget();
  if (!target) return { ...base, reachable: false, error: "SHARDS_DEPLOY_HOST isn't set (.env)", container: null, server: null, players: [], sessions: [], errors: null, logs: [] };
  const r = ssh(target, "bash -s", { input: SCRIPT, timeoutMs: 45_000 });
  if (r.status !== 0 && !r.stdout.includes("@@container")) {
    return { ...base, reachable: false, error: (r.stderr.trim() || `ssh exited ${r.status}`).split("\n").slice(-3).join(" "), container: null, server: null, players: [], sessions: [], errors: null, logs: [] };
  }
  return { ...base, reachable: true, ...readLive(r.stdout) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(liveStatus(), null, 2));
}
