// Runs a long command detached, for the Shards Console (ADR 0031 decision 4): ships, releases,
// builds and checks keep going when the console's mod reloads or its session closes. Each run
// has, in ~/.meridian-shards/runs:
//   <id>.log    everything it wrote (stdout and stderr), after a "> command" first line
//   <id>.json   { id, name, argv, cwd, pid, startedAt }
//   <id>.exit   { code, endedAt }, once it has ended
// With --lock, only one locked run goes at a time (runs/release.lock names it): ships and
// releases take it.
//
//   node tools/console/run.ts <name> [--lock] [--cwd <dir>] -- <command> [args...]
//       starts it; prints { started, id, log } (or { started: false, reason, running })
//   node tools/console/run.ts --list          the last runs, newest first, with their state
//   node tools/console/run.ts --stop <id>     ends a run and everything it started

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const RUNS = join(homedir(), ".meridian-shards", "runs");
const LOCK = join(RUNS, "release.lock");

export interface RunInfo {
  id: string;
  name: string;
  argv: string[];
  cwd: string;
  pid: number;
  startedAt: string;
  locked: boolean;
}
export interface RunState extends RunInfo {
  /** Still going: no .exit yet and its process is alive */
  running: boolean;
  code: number | null;
  endedAt: string | null;
  log: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

export function runState(id: string): RunState | null {
  const info = readJson<RunInfo>(join(RUNS, `${id}.json`));
  if (!info) return null;
  const exit = readJson<{ code: number; endedAt: string }>(join(RUNS, `${id}.exit`));
  return { ...info, running: !exit && alive(info.pid), code: exit?.code ?? null, endedAt: exit?.endedAt ?? null, log: join(RUNS, `${id}.log`) };
}

/** The locked run that is still going, if any; a lock left by a run that died is cleared */
function heldLock(): RunState | null {
  const id = existsSync(LOCK) ? readFileSync(LOCK, "utf8").trim() : "";
  if (!id) return null;
  const state = runState(id);
  if (state?.running) return state;
  rmSync(LOCK, { force: true });
  return null;
}

/** On Windows, npm and other .cmd shims need cmd /c */
const windowsArgv = (argv: string[]) => (process.platform === "win32" && /^(npm|npx)$/i.test(argv[0]!) ? ["cmd", "/c", ...argv] : argv);

function start(name: string, argv: string[], cwd: string, lock: boolean) {
  mkdirSync(RUNS, { recursive: true });
  if (lock) {
    const running = heldLock();
    if (running) return { started: false, reason: `${running.name} is running`, running: running.id };
  }
  const id = `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const job = JSON.stringify({ id, argv, cwd, locked: lock });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", job], { cwd, detached: true, stdio: "ignore", windowsHide: true });
  const info: RunInfo = { id, name, argv, cwd, pid: child.pid!, startedAt: new Date().toISOString(), locked: lock };
  writeFileSync(join(RUNS, `${id}.json`), JSON.stringify(info, null, 2));
  if (lock) writeFileSync(LOCK, id);
  child.unref();
  return { started: true, id, log: join(RUNS, `${id}.log`) };
}

/** The detached side: runs the command into the log, then writes the exit */
function child(job: string) {
  const info = JSON.parse(job) as Pick<RunInfo, "id" | "argv" | "cwd" | "locked">;
  const { id } = info;
  const log = openSync(join(RUNS, `${id}.log`), "a");
  writeSync(log, `> ${info.argv.join(" ")}\n`);
  const [cmd, ...args] = windowsArgv(info.argv);
  const proc = spawn(cmd!, args, { cwd: info.cwd, stdio: ["ignore", log, log], windowsHide: true, env: { ...process.env, FORCE_COLOR: "0" } });
  const finish = (code: number) => {
    writeFileSync(join(RUNS, `${id}.exit`), JSON.stringify({ code, endedAt: new Date().toISOString() }));
    if (info.locked && existsSync(LOCK) && readFileSync(LOCK, "utf8").trim() === id) rmSync(LOCK, { force: true });
  };
  proc.on("error", (e) => {
    writeSync(log, `\n!! ${e.message}\n`);
    finish(127);
  });
  proc.on("close", (code) => finish(code ?? 1));
}

export function listRuns(limit = 10): RunState[] {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => runState(f.slice(0, -5)))
    .filter((r): r is RunState => !!r)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

function stop(id: string) {
  const state = runState(id);
  if (!state) return { stopped: false, reason: "no such run" };
  if (!state.running) return { stopped: false, reason: "it has ended" };
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(state.pid), "/t", "/f"]);
  else process.kill(-state.pid, "SIGTERM");
  return { stopped: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--child") child(args[1]!);
  else if (args[0] === "--list") console.log(JSON.stringify(listRuns(), null, 2));
  else if (args[0] === "--stop") console.log(JSON.stringify(stop(args[1]!)));
  else {
    const dash = args.indexOf("--");
    const opts = dash < 0 ? [] : args.slice(0, dash);
    const argv = dash < 0 ? [] : args.slice(dash + 1);
    const name = opts[0];
    if (!name || name.startsWith("-") || !argv.length) {
      console.error("usage: node tools/console/run.ts <name> [--lock] [--cwd <dir>] -- <command> [args...]");
      process.exit(2);
    }
    const cwdAt = opts.indexOf("--cwd");
    const result = start(name, argv, cwdAt >= 0 ? resolve(opts[cwdAt + 1]!) : ROOT, opts.includes("--lock"));
    console.log(JSON.stringify(result));
    process.exit(result.started ? 0 : 1);
  }
}
