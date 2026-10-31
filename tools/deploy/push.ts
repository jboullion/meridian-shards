// Ships the staged stack to the VPS and (re)starts it there:
//   1. stage (tools/deploy/stage.ts) unless --skip-stage
//   2. pack deploy/ into a tarball (without the local .env; --skip-assets leaves out the
//      417 MB of game assets for code-only updates)
//   3. scp it to the host, unpack into ~/meridian-shards/deploy (the remote .env stays)
//   4. docker compose build, then swap in what Caddy serves and up -d, so the site stays up
//      while the images build
//
//   node tools/deploy/push.ts --host <user>@<ip> [--key ~/.ssh/id_ed25519] [--skip-stage] [--skip-assets] [--web-only]
//
// --web-only ships just the browser client, the website and Caddy's config (deploy/web, the
// compose file) and recreates only the web container: blakserv and the gateway keep running, so
// nobody is disconnected and the server's game data stays as it is.
//
// Uses the OpenSSH client that ships with Windows 10+ (ssh, scp) and tar.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({
  options: {
    host: { type: "string" },
    key: { type: "string" },
    "skip-stage": { type: "boolean", default: false },
    "skip-assets": { type: "boolean", default: false },
    "web-only": { type: "boolean", default: false },
  },
});
const webOnly = opt["web-only"];
if (!opt.host) {
  console.error("usage: node tools/deploy/push.ts --host <user>@<ip> [--key <ssh key>] [--skip-stage] [--skip-assets] [--web-only]");
  process.exit(2);
}

const sshArgs = opt.key ? ["-i", opt.key] : [];
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });

if (!opt["skip-stage"]) {
  const stageArgs = ["tools/deploy/stage.ts"];
  if (webOnly) stageArgs.push("--web-only");
  else if (opt["skip-assets"]) stageArgs.push("--skip-assets");
  run(process.execPath, stageArgs);
}

// A relative path: GNU tar and scp read "C:\..." as a remote host called C
const tarball = ".deploy.tgz";
rmSync(join(ROOT, tarball), { force: true });
const excludes = ["--exclude=deploy/.env"];
if (opt["skip-assets"]) excludes.push("--exclude=deploy/.stage/assets");
console.log("packing deploy/ ...");
const site = existsSync(join(ROOT, "deploy", ".stage", "site")) ? ["deploy/.stage/site"] : [];
const packed = webOnly ? ["deploy/docker-compose.yml", "deploy/web", "deploy/.stage/client", ...site] : ["deploy"];
run("tar", ["-czf", tarball, ...excludes, ...packed]);
console.log(`${(statSync(join(ROOT, tarball)).size / 2 ** 20).toFixed(0)} MB; uploading to ${opt.host}`);

run("scp", [...sshArgs, tarball, `${opt.host}:meridian-shards-deploy.tgz`]);

// Unpack into .incoming first. Caddy bind-mounts .stage/client, .stage/site and .stage/assets,
// so they stay as they are while the images build (minutes on the VM); deleting them first
// left the site empty that long, and every page went to /play/. They're swapped in by rename
// only just before Caddy restarts: a running container keeps serving the renamed .old folders
// until then. Each is replaced only when it was sent (assets not with --skip-assets).
const compose = "sudo docker compose -f deploy/docker-compose.yml";
const served = "client site assets";
const remote = [
  "set -e",
  "mkdir -p ~/meridian-shards/deploy && cd ~/meridian-shards",
  "test -f deploy/.env || { echo 'deploy/.env is missing on the server: copy deploy/.env.example and set SITE_ADDRESS'; exit 1; }",
  "rm -rf .incoming && mkdir .incoming",
  "tar -xzf ~/meridian-shards-deploy.tgz -C .incoming",
  "rm ~/meridian-shards-deploy.tgz",
  `for d in ${served}; do if [ -d .incoming/deploy/.stage/$d ]; then mv .incoming/deploy/.stage/$d .incoming/$d; fi; done`,
  webOnly ? "" : "rm -rf deploy/.stage/blakserv-src deploy/.stage/gamedata deploy/.stage/gateway deploy/.stage/accounts",
  "cp -a .incoming/deploy/. deploy/",
  webOnly ? "" : `${compose} build`,
  `for d in ${served}; do if [ -d .incoming/$d ]; then rm -rf deploy/.stage/$d.old; if [ -d deploy/.stage/$d ]; then mv deploy/.stage/$d deploy/.stage/$d.old; fi; mv .incoming/$d deploy/.stage/$d; fi; done`,
  webOnly ? `${compose} up -d --no-deps web` : `${compose} up -d`,
  `${compose} restart web`,
  `rm -rf .incoming ${served.split(" ").map((d) => `deploy/.stage/${d}.old`).join(" ")}`,
  `${compose} ps`,
]
  .filter(Boolean)
  .join(" && ");
run("ssh", [...sshArgs, opt.host, remote]);
rmSync(join(ROOT, tarball), { force: true });
console.log("deployed");

if (!existsSync(join(ROOT, "deploy", ".stage", "assets"))) console.warn("note: no staged assets locally");
