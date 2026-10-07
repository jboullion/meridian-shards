// The game files for app://shards/assets/*. The page asks for them exactly as in the
// browser (apps/client/src/assets.ts: /assets/<name>?v=<hash>); we fetch them from the
// selected server's /assets/ and keep them on disk as
//   userData/asset-cache/<name>.<hash>
// The hash is the asset build's (tools/assets/build-assets.ts: the first 16 hex digits of
// the SHA-1) and downloads are checked against it before they're kept, so one store serves
// every server: servers on the same build share files, and a server on another build asks
// for other hashes. manifest.json is always fetched fresh: it says which hashes the server
// has now, so after a server update only the files whose hashes changed are fetched again.
//
// The installer also carries the asset build it was made with (resources/assets, with its
// manifest). A file whose hash there matches the server's is read from the install, so a
// fresh install downloads nothing; after a server update only the changed files come from
// the server, into the cache.
//
// downloadAll() fetches every file the server lists that's in neither place yet (the
// desktop app does this at each launch, with a progress bar on the login and character
// screens), and after a complete pass deletes cached versions the server no longer lists.

import { net } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DesktopAssetProgress } from "../../client/src/host.ts";
import { log } from "./log.ts";

/** Files needed first come first: the resources, rooms, then sprites and textures, then sound. */
const ORDER = [".rsb", ".json", ".bin", ".ttf", ".bmp", ".ico", ".roo", ".bgf", ".bsf", ".ogg", ".wav", ".mp3"];
const rank = (name: string) => {
  const i = ORDER.indexOf(name.slice(name.lastIndexOf(".")).toLowerCase());
  return i < 0 ? ORDER.length : i;
};
/** Downloads at once: enough to hide the latency to a far server (HTTP/2 shares one connection). */
const PARALLEL = 8;

/** Stops a downloadAll() run (the server changed, or a newer run started). */
export interface DownloadRun {
  cancelled: boolean;
}

const MIME: Record<string, string> = {
  json: "application/json",
  bmp: "image/bmp",
  png: "image/png",
  ico: "image/x-icon",
  ttf: "font/ttf",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
};

const mimeOf = (name: string) => MIME[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

const HASH = /^[0-9a-f]{16}$/;

/** A relative asset path with no way out of its folder, or null. */
function safeName(raw: string): string | null {
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parts = name.split("/");
  if (!name || name.includes("\\") || parts.some((p) => !p || p === "." || p === "..")) return null;
  return name;
}

const reply = (bytes: Uint8Array, name: string) =>
  new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "content-type": mimeOf(name), "content-length": String(bytes.length) } });

const failure = (status: number, text: string) => new Response(text, { status, headers: { "content-type": "text/plain" } });

export class AssetCache {
  private readonly root: string;
  /** The asset build packaged with the app, and its file hashes */
  private readonly bundle: string | null;
  private readonly bundled = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<Uint8Array>>();
  private hits = 0;
  private fromInstall = 0;
  private downloads = 0;
  private downloaded = 0;
  private reported = "";

  constructor(root: string, bundle: string | null) {
    this.root = root;
    this.bundle = bundle;
    if (bundle)
      try {
        const m = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as { files: Record<string, { hash: string }> };
        for (const [name, f] of Object.entries(m.files)) this.bundled.set(name, f.hash);
        log(`assets: ${this.bundled.size} files packaged with the app`);
      } catch (e) {
        log(`assets: no packaged files (${(e as Error).message})`);
      }
    setInterval(() => this.report(), 10_000).unref();
  }

  /** Answers app://shards/assets/<name>?v=<hash> from `origin`'s files. */
  async handle(origin: string, rawName: string, hash: string | null): Promise<Response> {
    const name = safeName(rawName);
    if (!name) return failure(400, "bad asset name");
    const remote = `${origin}/assets/${name}${hash ? `?v=${hash}` : ""}`;
    try {
      // The manifest, and anything asked for without a content hash, isn't cached
      if (!hash || !HASH.test(hash)) return await this.passThrough(remote, name);
      return reply(await this.cached(name, hash, remote), name);
    } catch (e) {
      log(`assets: ${remote}: ${(e as Error).message}`);
      return failure(502, (e as Error).message);
    }
  }

  private async passThrough(remote: string, name: string): Promise<Response> {
    const res = await net.fetch(remote, { cache: "no-store" });
    if (!res.ok) return failure(res.status, `${remote}: HTTP ${res.status}`);
    return reply(new Uint8Array(await res.arrayBuffer()), name);
  }

  private pathOf(name: string, hash: string): string {
    return join(this.root, ...name.split("/")) + "." + hash;
  }

  private cached(name: string, hash: string, remote: string): Promise<Uint8Array> {
    const path = this.pathOf(name, hash);
    let p = this.inflight.get(path);
    if (!p) {
      p = this.load(path, name, hash, remote).finally(() => this.inflight.delete(path));
      this.inflight.set(path, p);
    }
    return p;
  }

  private async load(path: string, name: string, hash: string, remote: string): Promise<Uint8Array> {
    if (this.bundle && this.bundled.get(name) === hash)
      try {
        const bytes = new Uint8Array(await readFile(join(this.bundle, ...name.split("/"))));
        this.fromInstall++;
        return bytes;
      } catch {
        // missing from the install after all: try the cache, then the server
      }
    try {
      const bytes = new Uint8Array(await readFile(path));
      this.hits++;
      return bytes;
    } catch {
      // not cached yet
    }
    // no-store: this is the cache. Letting Chromium's HTTP cache keep a second copy too
    // slows downloads to a few files a second.
    const res = await net.fetch(remote, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    this.downloads++;
    this.downloaded += bytes.length;
    const actual = createHash("sha1").update(bytes).digest("hex").slice(0, 16);
    if (actual !== hash) {
      log(`assets: ${name} hashes to ${actual}, not ${hash}; not caching it`);
      return bytes;
    }
    await this.store(path, bytes);
    return bytes;
  }

  /** Written to a temporary name and renamed, so a crash never leaves half a file. */
  private async store(path: string, bytes: Uint8Array): Promise<void> {
    try {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${randomUUID()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, path);
    } catch (e) {
      log(`assets: can't cache ${path}: ${(e as Error).message}`);
    }
  }

  /**
   * Downloads every file in `origin`'s manifest that isn't cached yet, PARALLEL at a time,
   * reporting progress (by bytes, counting what's already on disk) a few times a second.
   */
  async downloadAll(origin: string, run: DownloadRun, onProgress: (p: DesktopAssetProgress) => void): Promise<void> {
    let progress: DesktopAssetProgress = { state: "checking", doneBytes: 0, totalBytes: 0, fetched: 0, failed: 0 };
    let sent = 0;
    const emit = (force = false) => {
      if (run.cancelled) return;
      const now = Date.now();
      if (force || now - sent >= 250) {
        sent = now;
        onProgress({ ...progress });
      }
    };
    emit(true);
    let files: Record<string, { size: number; hash: string }>;
    try {
      const res = await net.fetch(`${origin}/assets/manifest.json`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      files = ((await res.json()) as { files: typeof files }).files;
    } catch (e) {
      log(`assets: can't read ${origin}'s manifest: ${(e as Error).message}`);
      progress = { ...progress, state: "error", failed: 1 };
      return emit(true);
    }
    const wanted = Object.entries(files).filter(([name, f]) => safeName(name) === name && HASH.test(f.hash));
    const missing: [string, { size: number; hash: string }][] = [];
    for (const [name, f] of wanted) {
      progress.totalBytes += f.size;
      if (this.bundled.get(name) === f.hash || existsSync(this.pathOf(name, f.hash))) progress.doneBytes += f.size;
      else missing.push([name, f]);
    }
    missing.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
    progress.state = missing.length ? "downloading" : "done";
    if (missing.length) log(`assets: downloading ${missing.length} files (${((progress.totalBytes - progress.doneBytes) / 2 ** 20).toFixed(0)} MB) from ${origin}`);
    emit(true);
    const worker = async () => {
      for (let next = missing.shift(); next && !run.cancelled; next = missing.shift()) {
        const [name, f] = next;
        try {
          await this.cached(name, f.hash, `${origin}/assets/${name}?v=${f.hash}`);
          progress.doneBytes += f.size;
          progress.fetched++;
        } catch (e) {
          progress.failed++;
          log(`assets: ${name}: ${(e as Error).message}`);
        }
        emit();
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (run.cancelled) return;
    progress.state = progress.failed ? "error" : "done";
    if (progress.failed) log(`assets: ${progress.failed} files failed; they'll load as they're needed`);
    else await this.prune(new Set(wanted.map(([name, f]) => this.pathOf(name, f.hash))));
    emit(true);
  }

  /** Deletes cached files that aren't in `keep` (versions an update replaced) and empty folders. */
  private async prune(keep: Set<string>): Promise<void> {
    let removed = 0;
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          await walk(p);
          await rmdir(p).catch(() => {}); // only succeeds when empty
        } else if (!keep.has(p) && !this.inflight.has(p) && !p.endsWith(".tmp")) {
          await unlink(p).then(() => removed++, () => {});
        }
      }
    };
    await walk(this.root);
    if (removed) log(`assets: removed ${removed} outdated files`);
  }

  private report(): void {
    const line = `assets: ${this.fromInstall} from the install, ${this.hits} from the cache, ${this.downloads} downloaded (${(this.downloaded / 2 ** 20).toFixed(1)} MB)`;
    if (line !== this.reported && this.fromInstall + this.hits + this.downloads > 0) log(line);
    this.reported = line;
  }
}
