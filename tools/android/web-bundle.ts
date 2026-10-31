// The Android app's page by itself, for updates without a new APK (ADR 0003; WebUpdates.java,
// apps/client/src/updates.ts): the folder Capacitor serves the page from
// (apps/android/android/app/src/main/assets/public, which `npm run android:sync` fills from the
// client build) plus a bundle.json, zipped as Meridian-Shards-web-<version>-shell<n>.zip.
//
//   npm run android:web-bundle [-- --out <folder>]   (dist/ by default, git-ignored)
//
// <version> is the release's (apps/desktop/package.json) and <n> the shell the page needs
// (apps/android/shell.json): an app with an older shell gets the APK instead. Run
// `npm run android:sync` first.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { zip } from "../deploy/zip.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = join(ROOT, "apps", "android", "android", "app", "src", "main", "assets", "public");
const { values: opt } = parseArgs({ options: { out: { type: "string", default: join(ROOT, "dist") } } });

const version = (JSON.parse(readFileSync(join(ROOT, "apps", "desktop", "package.json"), "utf8")) as { version: string }).version;
const shell = (JSON.parse(readFileSync(join(ROOT, "apps", "android", "shell.json"), "utf8")) as { shell: number }).shell;

if (!existsSync(join(PUBLIC, "index.html"))) {
  console.error("No page in apps/android/android/app/src/main/assets/public: run `npm run android:sync` first");
  process.exit(2);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const files: [string, Buffer][] = [...walk(PUBLIC)].map((path) => [relative(PUBLIC, path).split("\\").join("/"), readFileSync(path)]);
files.push(["bundle.json", Buffer.from(JSON.stringify({ version, shell }) + "\n")]);

mkdirSync(opt.out, { recursive: true });
const out = join(opt.out, `Meridian-Shards-web-${version}-shell${shell}.zip`);
const data = zip(files);
writeFileSync(out, data);
console.log(`[web-bundle] ${relative(ROOT, out) || out}: ${files.length} files, ${(data.length / 1024).toFixed(0)} KB`);
