// Ships everything in one go: builds, checks, commits and pushes both repositories, deploys to
// the VM, and rebuilds the rooms whose maps changed since the last ship:
//   1. server\build.cmd (the quests, the Kod, the server) and the asset build
//   2. npm run check (typecheck, lint, tests)
//   3. commit whatever is changed in meridian-browser and shards-server (server/src), and push
//      both
//   4. on the VM: save the game, then tools/deploy/push.ts (the game files only when they
//      changed since the last ship)
//   5. wait for blakserv to listen again, then Recreate every room built from a .roo that
//      changed (rooms.json maps files to rooms; Marion's file is RID 200 and its Death Realm
//      copy)
//   6. remember what was shipped in ~/.meridian-shards/last-ship.json
//
//   npm run ship -- -m "What changed"
//   npm run ship -- --message-file msg.txt [--skip-build] [--skip-checks] [--no-deploy] [--dry-run]
//
// The VM comes from .env: SHARDS_DEPLOY_HOST (user@ip) and SHARDS_DEPLOY_KEY (an ssh key;
// %USERPROFILE% and ~ are expanded). Releases (tools/deploy/bump.ts) run this first.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER = realpathSync(join(ROOT, "server", "src"));
const ASSETS = join(ROOT, "dist", "assets");
const STATE_DIR = join(homedir(), ".meridian-shards");
const STATE = join(STATE_DIR, "last-ship.json");
const COMPOSE = "sudo docker compose -f deploy/docker-compose.yml";
const READY_TIMEOUT_MS = 6 * 60_000;

const { values: opt } = parseArgs({
  options: {
    message: { type: "string", short: "m" },
    "message-file": { type: "string" },
    "skip-build": { type: "boolean", default: false },
    "skip-checks": { type: "boolean", default: false },
    "no-deploy": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});
const dry = opt["dry-run"];

interface ShipState {
  browser: string;
  server: string;
  assets: string;
  at: string;
}

function step(title: string) {
  console.log(`\n== ${title}`);
}
function fail(msg: string): never {
  console.error(`\n!! ${msg}`);
  process.exit(1);
}
/** Runs a command, showing its output; stops the ship if it fails. */
function run(cmd: string, args: string[], cwd = ROOT) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  if (dry) return;
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed (${r.error ? r.error.message : `exit ${r.status ?? r.signal}`})`);
}
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function readEnv(): Record<string, string> {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}
const expandHome = (p: string) => p.replace(/%USERPROFILE%/gi, homedir()).replace(/^~(?=[\\/])/, homedir());

function readState(): ShipState | null {
  try {
    return JSON.parse(readFileSync(STATE, "utf8")) as ShipState;
  } catch {
    return null;
  }
}
const assetsHash = () =>
  existsSync(join(ASSETS, "manifest.json"))
    ? createHash("sha1").update(JSON.stringify((JSON.parse(readFileSync(join(ASSETS, "manifest.json"), "utf8")) as { files: unknown }).files)).digest("hex")
    : "";

/** The shards-server commit the last ship left on the VM; without a record, the one current at the last release tag. */
function lastShippedServer(state: ShipState | null): string | null {
  if (state?.server) return state.server;
  try {
    const tag = git(ROOT, "describe", "--tags", "--abbrev=0", "--match", "v*");
    const when = git(ROOT, "log", "-1", "--format=%cI", tag);
    return git(SERVER, "log", "-1", `--before=${when}`, "--format=%H") || null;
  } catch {
    return null;
  }
}

/** The rooms built from the .roo files that changed in shards-server since `from`. */
function changedRooms(from: string | null): { files: string[]; rids: number[] } {
  if (!from) return { files: [], rids: [] };
  const files = git(SERVER, "diff", "--name-only", from, "HEAD", "--", "resource/rooms/*.roo")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((f) => basename(f).toLowerCase());
  if (!files.length) return { files, rids: [] };
  const rooms = JSON.parse(readFileSync(join(ASSETS, "rooms.json"), "utf8")) as { rid: number; roo: string }[];
  const rids = rooms.filter((r) => files.includes(r.roo.toLowerCase())).map((r) => r.rid);
  return { files, rids: [...new Set(rids)] };
}

function commitAndPush(cwd: string, name: string, message: string | null) {
  const status = git(cwd, "status", "--porcelain");
  if (status) {
    console.log(`${name}: changes to commit\n${status}`);
    if (!message) fail(`${name} has changes: give a commit message (-m "..." or --message-file)`);
    run("git", ["add", "-A"], cwd);
    run("git", ["commit", "-q", "-m", message], cwd);
  } else {
    console.log(`${name}: nothing to commit`);
  }
  const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  const upstream = spawnSync("git", ["rev-parse", "--abbrev-ref", "@{u}"], { cwd, encoding: "utf8" });
  if (upstream.status !== 0) {
    run("git", ["push", "-u", "origin", branch], cwd);
    return;
  }
  const ahead = Number(git(cwd, "rev-list", "--count", "@{u}..HEAD") || "0");
  if (ahead > 0 || dry) run("git", ["push"], cwd);
  else console.log(`${name}: ${branch} is already on GitHub`);
}

/** Runs a command on the VM; returns its output (empty on a dry run). */
function remote(host: string, sshArgs: string[], command: string, allowFail = false): string {
  console.log(`> ssh ${host} ${command}`);
  if (dry) return "";
  const r = spawnSync("ssh", [...sshArgs, host, `cd ~/meridian-shards && ${command}`], { encoding: "utf8" });
  if (r.status !== 0 && !allowFail) fail(`on the VM: ${command}\n${r.stderr}`);
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------

const message = opt["message-file"] ? readFileSync(opt["message-file"], "utf8").trim() : (opt.message ?? null);
const state = readState();

if (!opt["skip-build"]) {
  step("Build the server (quests, Kod, blakserv) and the game files");
  run("cmd", ["/c", join("server", "build.cmd")]);
  run(process.execPath, ["tools/assets/build-assets.ts"]);
}

if (!opt["skip-checks"]) {
  step("Check (typecheck, lint, tests)");
  // Node won't spawn npm.cmd without a shell on Windows
  if (process.platform === "win32") run("cmd", ["/c", "npm", "run", "check"]);
  else run("npm", ["run", "check"]);
}

step("Commit and push");
commitAndPush(SERVER, "shards-server", message);
commitAndPush(ROOT, "meridian-browser", message);

if (opt["no-deploy"]) {
  console.log("\nNot deployed (--no-deploy).");
  process.exit(0);
}

step("Deploy to the VM");
const env = { ...readEnv(), ...process.env } as Record<string, string | undefined>;
const host = env.SHARDS_DEPLOY_HOST;
if (!host) fail("SHARDS_DEPLOY_HOST isn't set (.env)");
const key = env.SHARDS_DEPLOY_KEY ? expandHome(env.SHARDS_DEPLOY_KEY) : undefined;
const sshArgs = key ? ["-i", key] : [];

const rooms = changedRooms(lastShippedServer(state));
const assets = assetsHash();
const sameAssets = !!state && state.assets === assets;

// The run book: save before a redeploy (blakserv saves only every 30 minutes)
remote(host, sshArgs, `${COMPOSE} exec -T blakserv maint "save game"`, true);
run(process.execPath, ["tools/deploy/push.ts", "--host", host, ...(key ? ["--key", key] : []), ...(sameAssets ? ["--skip-assets"] : [])]);

step("Wait for blakserv");
if (!dry) {
  // Never send maintenance commands while it loads (deploy/README.md): wait for the game port
  const start = Date.now();
  await sleep(20_000);
  for (;;) {
    const r = spawnSync("ssh", [...sshArgs, host, `cd ~/meridian-shards && ${COMPOSE} exec -T blakserv nc -z 127.0.0.1 5959`]);
    if (r.status === 0) break;
    if (Date.now() - start > READY_TIMEOUT_MS) fail("blakserv didn't start listening in 6 minutes: look at the logs on the VM");
    await sleep(10_000);
  }
  await sleep(10_000);
  console.log(`blakserv is up (${Math.round((Date.now() - start) / 1000)} s)`);
}

if (rooms.rids.length) {
  step(`Rebuild changed rooms: ${rooms.files.join(", ")} (RID ${rooms.rids.join(", ")})`);
  for (const rid of rooms.rids) {
    const found = remote(host, sshArgs, `${COMPOSE} exec -T blakserv maint "send object 0 FindRoomByNum num int ${rid}"`, true);
    // The answer's last line is ": OBJECT <id>" (or ": $ 0" when the room isn't loaded)
    const obj = /^:\s*OBJECT\s+(\d+)\s*$/m.exec(found)?.[1];
    if (!obj) {
      if (!dry) console.log(`RID ${rid}: not loaded on the server, nothing to rebuild`);
      continue;
    }
    remote(host, sshArgs, `${COMPOSE} exec -T blakserv maint "send object ${obj} Recreate"`);
    console.log(`RID ${rid}: rebuilt (object ${obj})`);
  }
} else {
  console.log("\nNo room files changed since the last ship.");
}

if (!dry) {
  mkdirSync(STATE_DIR, { recursive: true });
  const shipped: ShipState = { browser: git(ROOT, "rev-parse", "HEAD"), server: git(SERVER, "rev-parse", "HEAD"), assets, at: new Date().toISOString() };
  writeFileSync(STATE, JSON.stringify(shipped, null, 2));
}
console.log("\nShipped.");
