// server\build.cmd with the traps in shards-server's AGENTS.md checked (ADR 0031 decision 6):
//   - nmake exits 0 when a .kod fails to compile: the output is read, and any ".kod(N): error"
//     (or a fatal nmake line) fails the build
//   - a failed bc run can corrupt kod/kodbase.txt: it's copied to kodbase.txt.bak first
//   - Bserver can't copy blakserv.exe into run/server while blakserv runs: when the game port
//     listened during the build, it says whether run/server/blakserv.exe is now stale
// The output is shown and kept in server/build.log.
//
//   node tools/server/build.ts                    the default targets (Bzlib Bjansson Bserver Bkod)
//   node tools/server/build.ts Bresource Bkod     other nmake targets, as build.cmd takes them

import { spawn } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, statSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "server", "src");
const LOG = join(ROOT, "server", "build.log");
const DEFAULT_TARGETS = ["Bzlib", "Bjansson", "Bserver", "Bkod"];

/** The lines of a build's output that mean it failed, though nmake may have exited 0 */
export function buildErrors(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((l) => /\.(kod|khd|lkod)(\(\d+\))?: error/i.test(l) || /\bfatal error\b/i.test(l) || /^NMAKE : .*error/i.test(l));
}

function listening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const sock = connect({ host: "127.0.0.1", port });
    sock.setTimeout(1000);
    sock.on("connect", () => (sock.destroy(), done(true)));
    sock.on("timeout", () => (sock.destroy(), done(false)));
    sock.on("error", () => done(false));
  });
}

const mtime = (p: string) => (existsSync(p) ? statSync(p).mtimeMs : 0);

async function main() {
  const args = process.argv.slice(2);
  const targets = args.length ? args : DEFAULT_TARGETS;
  const serverRunning = await listening(5959);
  if (serverRunning && targets.includes("Bserver")) {
    console.log("[build] blakserv is running (port 5959): Bserver can't replace run/server/blakserv.exe while it does");
  }

  const kodbase = join(SRC, "kod", "kodbase.txt");
  if (existsSync(kodbase)) copyFileSync(kodbase, `${kodbase}.bak`);

  const log = createWriteStream(LOG);
  let output = "";
  const child = spawn("cmd", ["/c", join(ROOT, "server", "build.cmd"), ...args], { cwd: ROOT });
  const take = (to: NodeJS.WriteStream) => (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    log.write(text);
    to.write(text);
  };
  child.stdout.on("data", take(process.stdout));
  child.stderr.on("data", take(process.stderr));
  const code: number = await new Promise((done) => child.on("close", (c) => done(c ?? 1)));
  await new Promise((done) => log.end(done));

  const errors = buildErrors(output);
  if (serverRunning && targets.includes("Bserver") && mtime(join(SRC, "blakserv", "debug", "blakserv.exe")) > mtime(join(SRC, "run", "server", "blakserv.exe"))) {
    console.log("[build] run/server/blakserv.exe is older than the new build: stop blakserv (npm stop in shards-server) and build again to run it");
  }
  if (errors.length) {
    console.error(`\n[build] failed: ${errors.length} error line${errors.length === 1 ? "" : "s"} (all of it in server/build.log)`);
    for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
    if (/segmentation|access violation|0xc0000005/i.test(output)) {
      console.error(`[build] bc may have crashed: if it now fails on every file, put back ${kodbase}.bak as kodbase.txt`);
    }
    process.exit(1);
  }
  if (code !== 0) {
    console.error(`\n[build] build.cmd exited ${code} (the output is in server/build.log)`);
    process.exit(code);
  }
  console.log("[build] ok");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
