// One command for the local dev stack:
//   1. blakserv: started (detached) if nothing listens on 5959 yet; left running on exit,
//      because killing it skips the save. Stop it from its own window.
//   2. dist/assets: built if missing (npm run assets).
//   3. the gateway (ws://localhost:8059) and Vite (http://localhost:5173), with prefixed output.
//
//   npm run dev [-- --no-server]

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUN = join(ROOT, "server", "src", "run", "server");
const noServer = process.argv.includes("--no-server");

const isListening = (port: number) =>
  new Promise<boolean>((res) => {
    const s = connect({ host: "127.0.0.1", port });
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

const children: ChildProcess[] = [];
/** `viaShell` is needed for .cmd shims such as npx on Windows; never for paths with spaces. */
function run(name: string, cmd: string, args: string[], cwd = ROOT, viaShell = false): void {
  const child = spawn(cmd, args, { cwd, shell: viaShell, env: { ...process.env, FORCE_COLOR: "1" } });
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
}

if (!noServer) await ensureServer();
if (!existsSync(join(ROOT, "dist", "assets", "manifest.json"))) {
  console.log("[dev] building dist/assets (first run)");
  spawnSync(process.execPath, [join(ROOT, "tools", "assets", "build-assets.ts")], { stdio: "inherit" });
}
if (await isListening(8059)) console.log("[dev] a gateway is already running on 8059; not starting another");
else run("gateway", process.execPath, [join(ROOT, "tools", "gateway", "gateway.ts")]);
run("vite", "npx vite", [], join(ROOT, "apps", "client"), true);

const shutdown = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
