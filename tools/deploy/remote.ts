// The live VM, as .env names it: SHARDS_DEPLOY_HOST (user@ip) and SHARDS_DEPLOY_KEY (an ssh
// key; %USERPROFILE% and ~ are expanded). Shared by ship.ts and tools/console/live-status.ts.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The docker compose command on the VM, run from ~/meridian-shards */
export const COMPOSE = "sudo docker compose -f deploy/docker-compose.yml";

/** The repository's .env, KEY=value lines (quotes taken off) */
export function readEnv(): Record<string, string> {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

export const expandHome = (p: string) => p.replace(/%USERPROFILE%/gi, homedir()).replace(/^~(?=[\\/])/, homedir());

export interface DeployTarget {
  host: string;
  /** The key path, expanded; undefined to use ssh's default */
  key?: string;
  /** `-i <key>` when there is a key */
  sshArgs: string[];
}

/** The VM from .env (the process environment wins); null when SHARDS_DEPLOY_HOST isn't set */
export function deployTarget(): DeployTarget | null {
  const env = { ...readEnv(), ...process.env } as Record<string, string | undefined>;
  const host = env.SHARDS_DEPLOY_HOST;
  if (!host) return null;
  const key = env.SHARDS_DEPLOY_KEY ? expandHome(env.SHARDS_DEPLOY_KEY) : undefined;
  return { host, key, sshArgs: key ? ["-i", key] : [] };
}

/** Runs a shell command on the VM in ~/meridian-shards, with no prompts; `input` is its stdin */
export function ssh(target: DeployTarget, command: string, { timeoutMs = 60_000, input }: { timeoutMs?: number; input?: string } = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("ssh", [...target.sshArgs, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", target.host, `cd ~/meridian-shards && ${command}`], {
    encoding: "utf8",
    timeout: timeoutMs,
    input,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.error ? r.error.message : (r.stderr ?? "") };
}
