// Releases the desktop app: bumps the version, commits, tags, pushes, then follows the
// Desktop builds workflow (.github/workflows/desktop.yml) until the release is published.
//
//   npm run release -- 0.2.0            release v0.2.0
//   npm run release -- 0.2.0 --no-wait  push and leave (watch it in the Actions tab)
//   npm run release -- --watch 0.2.0    only follow an already pushed v0.2.0
//
// The workflow does the rest on GitHub: builds Windows, macOS and Linux with the hosted
// server's game files, uploads them to a draft release, and publishes it once every
// platform is there. So deploy the server first (tools/deploy/push.ts): the installers
// carry its files.
//
// Pushing uses plain git (your git credentials). Watching uses GitHub's public API, or
// GH_TOKEN / GITHUB_TOKEN when set (a higher rate limit). On a failure it names the failed
// jobs and steps; `gh run view <id> --log-failed` shows the log when gh is signed in.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO = "jboullion/meridian-shards";
const API = `https://api.github.com/repos/${REPO}`;
const PKG = join(ROOT, "apps", "desktop", "package.json");
const LOCK = join(ROOT, "package-lock.json");
const POLL_MS = 30_000;
/** What a complete release holds (apps/desktop/electron-builder.yml artifactName) */
const EXPECTED = [/\.exe$/, /\.exe\.blockmap$/, /-mac\.dmg$/, /-mac\.zip$/, /\.AppImage$/, /\.deb$/, /^latest\.yml$/, /^latest-mac\.yml$/, /^latest-linux\.yml$/];

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: { "no-wait": { type: "boolean", default: false }, watch: { type: "boolean", default: false } },
});
const version = positionals[0];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: npm run release -- <x.y.z> [--no-wait] | npm run release -- --watch <x.y.z>");
  process.exit(2);
}
const tag = `v${version}`;

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
function fail(msg: string): never {
  console.error(`!! ${msg}`);
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
async function api<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).catch((e: Error) => e);
    if (!(res instanceof Error) && res.ok) return (await res.json()) as T;
    const why = res instanceof Error ? res.message : `HTTP ${res.status}`;
    if (attempt >= 5) throw new Error(`${path}: ${why}`);
    await sleep(5000 * attempt);
  }
}

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: { name: string; size: number }[];
}
interface Run {
  id: number;
  status: string;
  conclusion: string | null;
  head_branch: string;
  event: string;
  html_url: string;
}
interface Job {
  name: string;
  status: string;
  conclusion: string | null;
  steps?: { name: string; conclusion: string | null }[];
}

const semver = (v: string) => v.split(".").map(Number);
const newer = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

async function prepare(): Promise<void> {
  const pkgText = readFileSync(PKG, "utf8");
  const current = (JSON.parse(pkgText) as { version: string }).version;
  if (!newer(version, current)) fail(`${version} isn't newer than the current version ${current}`);
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("releases are made from main");
  if (git("status", "--porcelain")) fail("commit or stash your changes first (git status)");
  git("fetch", "--tags", "origin");
  if (git("rev-list", "--count", "HEAD..origin/main") !== "0") fail("origin/main has commits you don't: pull first");
  if (git("tag", "-l", tag)) fail(`tag ${tag} already exists`);
  // A release that already exists for the tag (made by hand, say) would make the build skip its upload
  const releases = await api<Release[]>("/releases?per_page=100");
  if (releases.some((r) => r.tag_name === tag)) fail(`GitHub already has a release for ${tag}; delete it or pick another version`);

  console.log(`version ${current} -> ${version}`);
  writeFileSync(PKG, pkgText.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
  const lockText = readFileSync(LOCK, "utf8");
  const lock = JSON.parse(lockText) as { packages: Record<string, { version?: string }> };
  if (lock.packages["apps/desktop"]) {
    lock.packages["apps/desktop"].version = version;
    writeFileSync(LOCK, JSON.stringify(lock, null, 2) + (lockText.endsWith("\n") ? "\n" : ""));
  }
  git("add", PKG, LOCK);
  git("commit", "-m", `Release ${tag}`);
  git("tag", tag);
  console.log(`pushing main and ${tag}`);
  execFileSync("git", ["push", "origin", "main"], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["push", "origin", tag], { cwd: ROOT, stdio: "inherit" });
}

async function watch(): Promise<void> {
  console.log(`waiting for the Desktop builds run for ${tag}`);
  let run: Run | undefined;
  for (let i = 0; !run && i < 20; i++) {
    const runs = await api<{ workflow_runs: Run[] }>(`/actions/runs?event=push&per_page=20`);
    run = runs.workflow_runs.find((r) => r.head_branch === tag);
    if (!run) await sleep(15_000);
  }
  if (!run) fail(`no workflow run for ${tag} after 5 minutes; see https://github.com/${REPO}/actions`);
  console.log(`run: ${run.html_url}`);
  let last = "";
  while (run.status !== "completed") {
    await sleep(POLL_MS);
    run = await api<Run>(`/actions/runs/${run.id}`);
    const jobs = (await api<{ jobs: Job[] }>(`/actions/runs/${run.id}/jobs`)).jobs;
    const line = jobs.map((j) => `${j.name.replace(/^build \((.*)\)$/, "$1")}: ${j.conclusion ?? j.status}`).join(", ");
    if (line !== last) console.log(`  ${line}`);
    last = line;
  }
  if (run.conclusion !== "success") {
    const jobs = (await api<{ jobs: Job[] }>(`/actions/runs/${run.id}/jobs`)).jobs;
    for (const j of jobs.filter((j) => j.conclusion !== "success" && j.conclusion !== "skipped")) {
      const step = j.steps?.find((s) => s.conclusion === "failure")?.name;
      console.error(`!! ${j.name}: ${j.conclusion}${step ? ` at "${step}"` : ""}`);
    }
    fail(`the run ${run.conclusion}. Logs: ${run.html_url} (or gh run view ${run.id} --log-failed). The release stays an unpublished draft.`);
  }
  const release = (await api<Release[]>("/releases?per_page=100")).find((r) => r.tag_name === tag);
  if (!release) fail(`the run passed but there's no release for ${tag}`);
  const missing = EXPECTED.filter((re) => !release.assets.some((a) => re.test(a.name)));
  for (const a of release.assets) console.log(`  ${a.name} (${(a.size / 2 ** 20).toFixed(0)} MB)`);
  if (missing.length) fail(`the release is missing ${missing.map(String).join(", ")}`);
  if (release.draft) fail(`the release is still a draft: ${release.html_url}`);
  console.log(`published: ${release.html_url}`);
}

if (!opt.watch) await prepare();
if (opt.watch || !opt["no-wait"]) await watch();
