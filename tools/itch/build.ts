// The browser client as an itch.io HTML game: a zip with index.html at the top, which itch.io
// serves from its own host (html-classic.itch.zone) in an iframe on the game's page.
//
//   npm run itch [-- --server https://m59-shards.com] [-- --out <folder>]   (dist/ by default, git-ignored)
//
// Only the page goes in the zip (about 2 MB): the game files (~450 MB in 5,000+ files, past
// itch.io's limits) and the game socket stay on our server, which the page is built to reach
// (SHARDS_SERVER_ORIGIN, vite.config.ts; host.ts hostedServer). For that the server must let
// itch.io's page in: CORS on /assets/* (deploy/web/Caddyfile) and, when GATEWAY_ORIGINS is set,
// https://html-classic.itch.zone in it (deploy/README.md).

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { zip } from "../deploy/zip.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({
  options: {
    server: { type: "string", default: "https://m59-shards.com" },
    out: { type: "string", default: join(ROOT, "dist") },
  },
});
const server = new URL(opt.server).origin;
const version = (JSON.parse(readFileSync(join(ROOT, "apps", "desktop", "package.json"), "utf8")) as { version: string }).version;
const BUILD = join(ROOT, "apps", "client", "dist-itch");

// Relative paths (--base ./): itch.io serves the page from a folder of its own
console.log(`building the client for itch.io, playing on ${server} (vite build)...`);
execSync(`npm run build -w @shards/client -- --base ./ --outDir "${BUILD}" --emptyOutDir`, {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, SHARDS_SERVER_ORIGIN: server },
});

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

// The admin page needs the dev server's endpoints: not for players
const files: [string, Buffer][] = [...walk(BUILD)]
  .map((path) => relative(BUILD, path).split("\\").join("/"))
  .filter((name) => name !== "admin.html")
  .map((name) => [name, readFileSync(join(BUILD, name))]);

mkdirSync(opt.out, { recursive: true });
const out = join(opt.out, `Meridian-Shards-itch-${version}.zip`);
const data = zip(files);
writeFileSync(out, data);
rmSync(BUILD, { recursive: true, force: true });
console.log(`[itch] ${relative(ROOT, out) || out}: ${files.length} files, ${(data.length / 1024).toFixed(0)} KB`);
