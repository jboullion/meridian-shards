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

import { deflateRawSync, crc32 } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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

/** The zip of `files` (name → contents): deflated, sizes in the local headers (no data descriptors). */
function zip(files: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const fileName = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    // DOS date 1980-01-01: the same bytes for the same page
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, fileName, packed);
    central.push(entry, fileName);
    offset += local.length + fileName.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const files: [string, Buffer][] = [...walk(PUBLIC)].map((path) => [relative(PUBLIC, path).split("\\").join("/"), readFileSync(path)]);
files.push(["bundle.json", Buffer.from(JSON.stringify({ version, shell }) + "\n")]);

mkdirSync(opt.out, { recursive: true });
const out = join(opt.out, `Meridian-Shards-web-${version}-shell${shell}.zip`);
const data = zip(files);
writeFileSync(out, data);
console.log(`[web-bundle] ${relative(ROOT, out) || out}: ${files.length} files, ${(data.length / 1024).toFixed(0)} KB`);
