// Ships the staged stack to the VPS and (re)starts it there:
//   1. stage (tools/deploy/stage.ts) unless --skip-stage
//   2. build the images here (docker compose build: blakserv, the gateway, the accounts service)
//      and save the ones whose image ID differs from the host's into a gzipped tar
//   3. pack deploy/ into a tarball (without the local .env and the images' build contexts;
//      --skip-assets leaves out the 417 MB of game assets for code-only updates)
//   4. scp them to the host, unpack into ~/meridian-shards/deploy (the remote .env stays),
//      docker load the images, swap in what Caddy serves and up -d
//
//   node tools/deploy/push.ts --host <user>@<ip> [--key ~/.ssh/id_ed25519] [--skip-stage] [--skip-assets] [--web-only] [--build-on-vm]
//
// The images are built on this PC because building them on the VM (an e2-micro then) thrashed it
// to a standstill on 2026-11-03, the game running beside the build. This needs Docker here
// (Docker Desktop). --build-on-vm builds on the host as before, for a PC without Docker.
//
// --web-only ships just the browser client, the website and Caddy's config (deploy/web, the
// compose file) and recreates only the web container: blakserv and the gateway keep running, so
// nobody is disconnected and the server's game data stays as it is.
//
// Uses the OpenSSH client that ships with Windows 10+ (ssh, scp) and tar.

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, rmSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
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
    "build-on-vm": { type: "boolean", default: false },
  },
});
const webOnly = opt["web-only"];
const buildHere = !webOnly && !opt["build-on-vm"];
if (!opt.host) {
  console.error("usage: node tools/deploy/push.ts --host <user>@<ip> [--key <ssh key>] [--skip-stage] [--skip-assets] [--web-only]");
  process.exit(2);
}

const sshArgs = opt.key ? ["-i", opt.key] : [];
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
const read = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

if (!opt["skip-stage"]) {
  const stageArgs = ["tools/deploy/stage.ts"];
  if (webOnly) stageArgs.push("--web-only");
  else if (opt["skip-assets"]) stageArgs.push("--skip-assets");
  run(process.execPath, stageArgs);
}

// The images compose builds (named <project>-<service>), and their build contexts in .stage
const IMAGES = ["meridian-shards-blakserv", "meridian-shards-gateway", "meridian-shards-accounts"];
const CONTEXTS = ["blakserv-src", "gamedata", "gateway", "accounts"];
// A relative path: GNU tar and scp read "C:\..." as a remote host called C
const imageTar = ".deploy-images.tar.gz";
rmSync(join(ROOT, imageTar), { force: true });
let sendImages: string[] = [];
if (buildHere) {
  try {
    read("docker", ["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    console.error("Docker isn't running on this PC: start Docker Desktop, or pass --build-on-vm");
    process.exit(1);
  }
  console.log("building the images here ...");
  execFileSync("docker", ["compose", "-f", "deploy/docker-compose.yml", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    // One plain image each, no provenance attestation: the host's ID after docker load matches ours
    env: { ...process.env, DOCKER_DEFAULT_PLATFORM: "linux/amd64", BUILDX_NO_DEFAULT_ATTESTATIONS: "1" },
  });
  const local = IMAGES.map((i) => read("docker", ["image", "inspect", "-f", "{{.Id}}", i]).trim());
  // The host's IDs, one line each, blank for an image it doesn't have: docker load keeps the ID
  let remoteIds: string[] = [];
  try {
    const out = read("ssh", [...sshArgs, opt.host, IMAGES.map((i) => `(sudo docker image inspect -f '{{.Id}}' ${i} 2>/dev/null || echo)`).join("; ")]);
    remoteIds = out.split("\n").map((l) => l.trim());
  } catch {
    // send them all
  }
  sendImages = IMAGES.filter((_, n) => local[n] !== remoteIds[n]);
  if (sendImages.length) {
    console.log(`saving ${sendImages.join(", ")} ...`);
    const save = spawn("docker", ["image", "save", ...sendImages], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
    const exited = new Promise<number | null>((done) => save.on("close", done));
    await pipeline(save.stdout, createGzip({ level: 6 }), createWriteStream(join(ROOT, imageTar)));
    if ((await exited) !== 0) throw new Error("docker image save failed");
    console.log(`${(statSync(join(ROOT, imageTar)).size / 2 ** 20).toFixed(0)} MB of images`);
  } else {
    console.log("the host has these images already");
  }
}

const tarball = ".deploy.tgz";
rmSync(join(ROOT, tarball), { force: true });
const excludes = ["--exclude=deploy/.env"];
if (opt["skip-assets"]) excludes.push("--exclude=deploy/.stage/assets");
if (buildHere) excludes.push(...CONTEXTS.map((c) => `--exclude=deploy/.stage/${c}`));
console.log("packing deploy/ ...");
const site = existsSync(join(ROOT, "deploy", ".stage", "site")) ? ["deploy/.stage/site"] : [];
const packed = webOnly ? ["deploy/docker-compose.yml", "deploy/web", "deploy/.stage/client", ...site] : ["deploy"];
run("tar", ["-czf", tarball, ...excludes, ...packed]);
console.log(`${(statSync(join(ROOT, tarball)).size / 2 ** 20).toFixed(0)} MB; uploading to ${opt.host}`);

run("scp", [...sshArgs, tarball, `${opt.host}:meridian-shards-deploy.tgz`]);
if (sendImages.length) run("scp", [...sshArgs, imageTar, `${opt.host}:meridian-shards-images.tar.gz`]);

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
  buildHere && sendImages.length ? "gunzip -c ~/meridian-shards-images.tar.gz | sudo docker load && rm ~/meridian-shards-images.tar.gz" : "",
  webOnly || buildHere ? "" : `${compose} build`,
  `for d in ${served}; do if [ -d .incoming/$d ]; then rm -rf deploy/.stage/$d.old; if [ -d deploy/.stage/$d ]; then mv deploy/.stage/$d deploy/.stage/$d.old; fi; mv .incoming/$d deploy/.stage/$d; fi; done`,
  webOnly ? `${compose} up -d --no-deps web` : buildHere ? `${compose} up -d --no-build` : `${compose} up -d`,
  `${compose} restart web`,
  `rm -rf .incoming ${served.split(" ").map((d) => `deploy/.stage/${d}.old`).join(" ")}`,
  // The images the new ones replaced
  webOnly ? "" : "sudo docker image prune -f",
  `${compose} ps`,
]
  .filter(Boolean)
  .join(" && ");
run("ssh", [...sshArgs, opt.host, remote]);
rmSync(join(ROOT, tarball), { force: true });
rmSync(join(ROOT, imageTar), { force: true });
console.log("deployed");

if (!existsSync(join(ROOT, "deploy", ".stage", "assets"))) console.warn("note: no staged assets locally");
