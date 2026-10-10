// Gathers everything the Docker images need into deploy/.stage (git-ignored: it holds
// the original game data and art):
//
//   deploy/.stage/blakserv-src/   blakserv sources to build on Linux (blakserv/, include/, util/)
//   deploy/.stage/gamedata/       compiled Kod (memmap), resources (rsc), rooms and kodbase.txt
//                                 from our Windows build, so the server's rsc0000.rsb matches the
//                                 client's assets exactly
//   deploy/.stage/client/         the production browser client, built for /play/
//   deploy/.stage/site/           the website (landing page, downloads, wiki) from the
//                                 meridian-shards-website repository next to this one
//   deploy/.stage/assets/         the asset build (dist/assets)
//   deploy/.stage/gateway/        the gateway script and its one dependency (ws)
//
//   node tools/deploy/stage.ts [--skip-client] [--skip-assets] [--skip-site] [--client-only] [--web-only]
//
// --client-only builds and stages the browser client and nothing else. --web-only stages the
// client and the website (push.ts --web-only). The website's repository is found at
// ../meridian-shards-website, or SHARDS_SITE; SITE_URL (the domain's https:// origin) is passed
// to its build for canonical URLs and the sitemap. Without the repository, the site is skipped
// and Caddy sends every other path to /play/ as before.
// Run `npm run assets` (and server\build.cmd) first. Then `docker compose -f deploy/docker-compose.yml build`.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseRsb } from "../../packages/formats/src/rsb.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const STAGE = join(ROOT, "deploy", ".stage");
const SRC = join(ROOT, "server", "src");
const RUN = join(SRC, "run", "server");
const { values: opt } = parseArgs({
  options: {
    "skip-client": { type: "boolean", default: false },
    "skip-assets": { type: "boolean", default: false },
    "client-only": { type: "boolean", default: false },
    "web-only": { type: "boolean", default: false },
    "skip-site": { type: "boolean", default: false },
  },
});

function need(path: string, hint: string): void {
  if (!existsSync(path)) {
    console.error(`!! missing ${path}\n   ${hint}`);
    process.exit(1);
  }
}

function copy(from: string, to: string, filter?: (src: string) => boolean): void {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, filter });
}

// The hosted client lives at /play/ (deploy/web/Caddyfile), so it's built with that base,
// straight into the stage: apps/client/dist stays the apps' build, whose pages are at /
function stageClient(): void {
  console.log("building the client for /play/ (vite build)...");
  const out = join(STAGE, "client");
  execSync(`npm run build -w @shards/client -- --base /play/ --outDir "${out}" --emptyOutDir`, { cwd: ROOT, stdio: "inherit" });
}

// The website is static files (meridian-shards-website, built with React Router's prerender).
// Its build checks itself: every page, link and image, and that nothing lands in /play/ or
// /assets/, which Caddy hands to the game.
function stageSite(): void {
  const site = resolve(process.env.SHARDS_SITE ?? join(ROOT, "..", "meridian-shards-website"));
  if (!existsSync(join(site, "package.json"))) {
    console.warn(`!! no website at ${site}: skipping it (set SHARDS_SITE to its folder)`);
    return;
  }
  need(join(site, "node_modules"), `install the website's dependencies first: npm install in ${site}`);
  console.log(`building the website in ${site} (npm run build)...`);
  execSync("npm run build", { cwd: site, stdio: "inherit" });
  const out = join(STAGE, "site");
  rmSync(out, { recursive: true, force: true });
  copy(join(site, "build", "client"), out);
}

if (opt["client-only"] || opt["web-only"]) {
  stageClient();
  if (opt["web-only"] && !opt["skip-site"]) stageSite();
  console.log(`staged in ${STAGE}`);
  process.exit(0);
}

need(join(SRC, "blakserv", "makefile.linux"), "copy the Server 104 source to server/src first (see README)");
need(join(RUN, "memmap"), "build the server and Kod first: server\\build.cmd");
need(join(ROOT, "dist", "assets", "manifest.json"), "build the assets first: npm run assets");

rmSync(join(STAGE, "blakserv-src"), { recursive: true, force: true });
rmSync(join(STAGE, "gamedata"), { recursive: true, force: true });
rmSync(join(STAGE, "gateway"), { recursive: true, force: true });

// Sources for the Linux build (no Windows build output)
const noObjects = (p: string) => !/[\\/](debug|release)([\\/]|$)/i.test(p) && !/\.(obj|pdb|exe|ilk|lib)$/i.test(p);
copy(join(SRC, "blakserv"), join(STAGE, "blakserv-src", "blakserv"), noObjects);
copy(join(SRC, "include"), join(STAGE, "blakserv-src", "include"));
copy(join(SRC, "util"), join(STAGE, "blakserv-src", "util"), noObjects);
copy(join(SRC, "common.mak.linux"), join(STAGE, "blakserv-src", "common.mak.linux"));

// Game data from our build (platform independent)
for (const d of ["memmap", "rsc", "rooms"]) copy(join(RUN, d), join(STAGE, "gamedata", d));
for (const f of ["kodbase.txt", "blakston.khd", "protocol.khd"]) {
  if (existsSync(join(RUN, f))) copy(join(RUN, f), join(STAGE, "gamedata", f));
}
// The message of the day (server/config/motd.txt): blakserv moves it into memmap/ at startup
copy(join(ROOT, "server", "config", "motd.txt"), join(STAGE, "gamedata", "motd.txt"));

// Linux file names are case-sensitive and Kod names rooms as it likes ("RazaBank.roo"
// for razabank.roo). Windows can't hold both spellings, so list them in room-aliases.txt
// ("file alias" per line) and the image links each alias to its file.
{
  const onDisk = new Map(readdirSync(join(STAGE, "gamedata", "rooms")).map((f) => [f.toLowerCase(), f]));
  const rsb = parseRsb(readFileSync(join(RUN, "rsc", "rsc0000.rsb")));
  const aliases = new Set<string>();
  for (const langs of rsb.entries.values()) {
    for (const name of langs.values()) {
      if (!/^[\w.-]+\.roo$/i.test(name)) continue;
      const actual = onDisk.get(name.toLowerCase());
      if (actual && actual !== name) aliases.add(`${actual} ${name}`);
    }
  }
  writeFileSync(join(STAGE, "gamedata", "room-aliases.txt"), [...aliases].sort().join("\n") + "\n");
  console.log(`rooms: ${aliases.size} other spellings`);
}

// The server's Linux config and the maintenance helper, next to the game data
copy(join(ROOT, "deploy", "blakserv", "blakserv.cfg"), join(STAGE, "blakserv.cfg"));
copy(join(ROOT, "deploy", "blakserv", "maint.sh"), join(STAGE, "maint.sh"));

// Gateway: the script plus ws (pure JS, no dependencies of its own)
copy(join(ROOT, "tools", "gateway", "gateway.ts"), join(STAGE, "gateway", "gateway.ts"));
copy(join(ROOT, "node_modules", "ws"), join(STAGE, "gateway", "node_modules", "ws"));

if (!opt["skip-client"]) stageClient();
if (!opt["skip-site"]) stageSite();

if (!opt["skip-assets"]) {
  // Mirror dist/assets (417 MB); skipped files that haven't changed keep it quick
  const src = join(ROOT, "dist", "assets"),
    dst = join(STAGE, "assets");
  copy(src, dst, (p) => {
    const rel = p.slice(src.length);
    const out = join(dst, rel);
    if (!existsSync(out)) return true;
    const a = statSync(p),
      b = statSync(out);
    return a.isDirectory() || a.size !== b.size || a.mtimeMs > b.mtimeMs;
  });
}

console.log(`staged in ${STAGE}`);
