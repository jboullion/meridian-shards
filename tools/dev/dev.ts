// One command for the local dev stack:
//   1. blakserv: started (detached) if nothing listens on 5959 yet; left running on exit,
//      because killing it skips the save. Stop it from its own window.
//   2. dist/assets: built if missing (npm run assets).
//   3. the gateway (ws://localhost:8059) and Vite (http://localhost:5173), with prefixed output.
//   4. with --desktop (npm run desktop): the Electron app (apps/desktop) on the Vite server;
//      closing its window stops what this script started.
//   5. with --editor: the room editor's web build (../meridian-editor, http://127.0.0.1:5174).
//
// Before starting, it says what's out of date: Kod or rooms edited since the last server build,
// or a server build or the client's tables (apps/client/tables) newer than dist/assets. With
// --rebuild it builds them instead
// (serveruild.cmd Bresource Bkod, then npm run assets).
//
//   npm run dev [-- --no-server] [-- --desktop] [-- --editor] [-- --rebuild]

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUN = join(ROOT, "server", "src", "run", "server");
const noServer = process.argv.includes("--no-server");
const desktop = process.argv.includes("--desktop");
const editor = process.argv.includes("--editor");
const rebuild = process.argv.includes("--rebuild");
const SRC = join(ROOT, "server", "src");
const MANIFEST = join(ROOT, "dist", "assets", "manifest.json");
const EDITOR = resolve(ROOT, "..", "meridian-editor");
const VITE_URL = "http://localhost:5173";

const isListening = (port: number, host = "127.0.0.1") =>
  new Promise<boolean>((res) => {
    const s = connect({ host, port });
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureServer(): Promise<void> {
  if (await isListening(5959)) {
    console.log("[dev] blakserv already running on 5959");
    return;
  }
  const exe = join(RUN, "blakserv.exe");
  if (!existsSync(exe)) {
    console.error("[dev] blakserv.exe not found; run server\\build.cmd (see README)");
    process.exit(1);
  }
  if (!existsSync(join(RUN, "blakserv.cfg"))) spawnSync("cmd", ["/c", join(ROOT, "server", "setup-run.cmd")], { stdio: "inherit" });
  console.log("[dev] starting blakserv (its own window; it keeps running after dev exits)");
  spawn(exe, [], { cwd: RUN, detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 120; i++) {
    if (await isListening(5959)) {
      console.log("[dev] blakserv is up");
      return;
    }
    await sleep(1000);
  }
  console.error("[dev] blakserv didn't open port 5959 within 2 minutes; check server/src/run/server/channel/error.txt");
  process.exit(1);
}

/** The newest modification time of the files under `dir` whose names match, 0 if there are none */
function newest(dir: string, match: RegExp): number {
  if (!existsSync(dir)) return 0;
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && match.test(e.name)) t = Math.max(t, statSync(join(e.parentPath, e.name)).mtimeMs);
  }
  return t;
}

const mtime = (path: string) => (existsSync(path) ? statSync(path).mtimeMs : 0);

/** What's out of date: the server build behind its sources, the asset build behind the server */
function staleness(): { server: string[]; assets: boolean } {
  const server: string[] = [];
  // kodbase.txt is rewritten by every Kod build; the run folder's rooms are copied by Bresource
  if (newest(join(SRC, "kod"), /\.(kod|khd|lkod)$/i) > mtime(join(RUN, "kodbase.txt"))) server.push("Kod");
  if (newest(join(SRC, "resource", "rooms"), /\.roo$/i) > newest(join(RUN, "rooms"), /\.roo$/i)) server.push("rooms");
  const built = Math.max(newest(join(RUN, "rooms"), /\.roo$/i), mtime(join(RUN, "rsc", "rsc0000.rsb")), newest(join(ROOT, "apps", "client", "tables"), /\.json$/i));
  return { server, assets: !existsSync(MANIFEST) || built > mtime(MANIFEST) };
}

function buildServer(): void {
  console.log("[dev] building the server's Kod and resources (server\\build.cmd Bresource Bkod)");
  const r = spawnSync("cmd", ["/c", join(ROOT, "server", "build.cmd"), "Bresource", "Bkod"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("[dev] the server build failed");
    process.exit(1);
  }
}

function buildAssets(): void {
  console.log("[dev] building dist/assets");
  spawnSync(process.execPath, [join(ROOT, "tools", "assets", "build-assets.ts")], { stdio: "inherit" });
}

const children: ChildProcess[] = [];
/** `viaShell` is needed for .cmd shims such as npx on Windows; never for paths with spaces. */
function run(name: string, cmd: string, args: string[], cwd = ROOT, viaShell = false, env: Record<string, string> = {}): ChildProcess {
  const child = spawn(cmd, args, { cwd, shell: viaShell, env: { ...process.env, FORCE_COLOR: "1", ...env } });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((l) => console.log(`[${name}] ${l}`));
  child.stdout?.on("data", prefix);
  child.stderr?.on("data", prefix);
  child.on("exit", (code) => console.log(`[${name}] exited (${code})`));
  children.push(child);
  return child;
}

const stale = staleness();
const running = await isListening(5959);
if (stale.server.length) {
  if (rebuild) {
    buildServer();
    // blakserv keeps the Kod it loaded: reloading saves the game, so it's left to you
    if (running && stale.server.includes("Kod")) console.log('[dev] blakserv is running the old Kod: node tools/maint/maint.ts "reload system" (saves the game first)');
  } else console.log(`[dev] ${stale.server.join(" and ")} changed since the last server build: npm run dev -- --rebuild, or server\\build.cmd`);
}
if (!existsSync(MANIFEST) || (rebuild && staleness().assets)) buildAssets();
else if (stale.assets) console.log("[dev] the server build or the client's tables are newer than dist/assets: npm run dev -- --rebuild, or npm run assets");
if (!noServer) await ensureServer();
if (await isListening(8059)) console.log("[dev] a gateway is already running on 8059; not starting another");
else run("gateway", process.execPath, [join(ROOT, "tools", "gateway", "gateway.ts")]);
// Vite listens on localhost, which can be ::1 only
if (await isListening(5173, "localhost")) console.log("[dev] Vite is already running on 5173; not starting another");
else run("vite", "npx vite", [], join(ROOT, "apps", "client"), true);

if (editor) {
  if (!existsSync(join(EDITOR, "package.json"))) console.log(`[dev] no room editor at ${EDITOR}`);
  else if (await isListening(5174)) console.log("[dev] the room editor is already running on 5174");
  else run("editor", "npm run editor:web", [], EDITOR, true);
}

const shutdown = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (desktop) {
  const dir = join(ROOT, "apps", "desktop");
  console.log("[dev] building the desktop main process");
  const built = spawnSync("npx vite build --mode main && npx vite build --mode preload", { cwd: dir, shell: true, stdio: "ignore" });
  if (built.status !== 0) {
    console.error("[dev] the desktop build failed; npm run build -w @shards/desktop shows why");
    shutdown();
  }
  for (let i = 0; i < 60 && !(await isListening(5173, "localhost")); i++) await sleep(500);
  // The electron package's main export is the path of its binary
  const electron = createRequire(join(dir, "package.json"))("electron") as string;
  run("desktop", electron, [dir], dir, false, { SHARDS_DEV_URL: VITE_URL }).on("exit", shutdown);
}
