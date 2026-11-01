// Ours: how well the browser's own HTTP cache keeps the game files (docs/adr/0032-installable-web-client.md
// decision 7), to decide whether step 2, a service-worker cache for /assets/, is worth building.
// The page's Resource Timing entries say whether each /assets/<name>?v=<hash> came over the network
// or from the cache. localStorage remembers which name and hash this browser loaded before, so a
// file loaded again after an earlier page tells eviction apart from a first visit to a room.
// Totals since the last report go to the gateway (POST /api/stats/cache, tools/gateway/cacheStats.ts)
// when the page is hidden or closed. No account, character or address: counts, and the browser's family.

import { assetBase, desktop, hostedServer } from "./host.ts";

/** One game file the page loaded */
export interface AssetLoad {
  key: string;
  hash: string;
  /** The file's size as sent (compressed) */
  bytes: number;
  /** From the browser's cache, not the network */
  cached: boolean;
}

/** What a page reports (the gateway's parseReport checks it) */
export interface CacheReport {
  v: 1;
  /** This browser had loaded game files on an earlier page */
  returning: boolean;
  /** Running as the installed app (webApp.ts runsInstalled) */
  installed: boolean;
  browser: "chrome" | "edge" | "firefox" | "safari" | "other";
  mobile: boolean;
  /** 1 on a page's first report, 0 after */
  pages: number;
  files: number;
  cached: number;
  /** Files whose name and hash this browser loaded on an earlier page */
  seen: number;
  /** Of those, the ones still in the cache: seen - seenCached is what the cache lost */
  seenCached: number;
  bytes: number;
  cachedBytes: number;
}

/** Only the timing fields we read */
type ResourceEntry = Pick<PerformanceResourceTiming, "name" | "transferSize" | "encodedBodySize" | "decodedBodySize">;

/**
 * A game file's load from its timing entry; null for anything else, or when the browser gives no
 * sizes (a file from another site without Timing-Allow-Origin reports zeros).
 */
export function assetLoad(entry: ResourceEntry, base: string, origin: string): AssetLoad | null {
  let url: URL;
  try {
    url = new URL(entry.name, origin);
  } catch {
    return null;
  }
  const basePath = new URL(base, origin).pathname;
  const hash = url.searchParams.get("v");
  if (!hash || url.origin !== origin || !url.pathname.startsWith(basePath)) return null;
  if (entry.decodedBodySize === 0) return null;
  const key = decodeURIComponent(url.pathname.slice(basePath.length));
  // A cached response sends nothing; a revalidated one (304) only its headers
  const cached = entry.transferSize === 0 || entry.transferSize < entry.encodedBodySize;
  return { key, hash, bytes: entry.encodedBodySize, cached };
}

/** The browser's family, from its user agent; Edge and Chrome before Safari, which they also name */
export function browserFamily(ua: string): CacheReport["browser"] {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "edge";
  if (/Firefox\/|FxiOS\//.test(ua)) return "firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

type Tally = Pick<CacheReport, "files" | "cached" | "seen" | "seenCached" | "bytes" | "cachedBytes">;
const emptyTally = (): Tally => ({ files: 0, cached: 0, seen: 0, seenCached: 0, bytes: 0, cachedBytes: 0 });

/** Counts a page's game file loads against what this browser loaded before. */
export class CacheTally {
  /** Name -> hash, as loaded on earlier pages */
  private readonly before: ReadonlyMap<string, string>;
  /** Everything loaded, earlier pages and this one, for the next page */
  readonly known: Map<string, string>;
  /** Counted on this page already (an image's URL may load more than once) */
  private readonly counted = new Set<string>();
  private pending = emptyTally();
  private reported = false;

  constructor(before: Record<string, string>) {
    this.before = new Map(Object.entries(before));
    this.known = new Map(this.before);
  }

  get returning(): boolean {
    return this.before.size > 0;
  }

  add(load: AssetLoad): void {
    const id = `${load.key}?${load.hash}`;
    if (this.counted.has(id)) return;
    this.counted.add(id);
    this.known.set(load.key, load.hash);
    const t = this.pending;
    t.files++;
    t.bytes += load.bytes;
    if (load.cached) {
      t.cached++;
      t.cachedBytes += load.bytes;
    }
    if (this.before.get(load.key) === load.hash) {
      t.seen++;
      if (load.cached) t.seenCached++;
    }
  }

  /** What's not reported yet, or null when nothing loaded since. Call `sent` once it went. */
  report(context: Pick<CacheReport, "installed" | "browser" | "mobile">): CacheReport | null {
    if (this.pending.files === 0) return null;
    return { v: 1, returning: this.returning, ...context, pages: this.reported ? 0 : 1, ...this.pending };
  }

  sent(): void {
    this.pending = emptyTally();
    this.reported = true;
  }
}

/** Off for now (2026-11-01): nothing is counted or sent. Set true to measure again. */
const CACHE_STATS = false;

const SEEN_KEY = "shards.assetsSeen";
const ENDPOINT = "/api/stats/cache";

function readSeen(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Starts counting, in a plain browser on the game's own server only: the desktop and Android apps
 * serve the files from their own caches, and the itch.io page loads them from another site.
 */
export function startCacheStats(installed: () => boolean): void {
  if (!CACHE_STATS || desktop || hostedServer || typeof PerformanceObserver === "undefined" || !navigator.sendBeacon) return;
  const tally = new CacheTally(readSeen());
  const base = assetBase();
  const context = {
    installed: installed(),
    browser: browserFamily(navigator.userAgent),
    mobile: matchMedia("(pointer: coarse)").matches,
  };
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries() as PerformanceResourceTiming[]) {
      const load = assetLoad(e, base, location.origin);
      if (load) tally.add(load);
    }
  });
  try {
    observer.observe({ type: "resource", buffered: true });
  } catch {
    return;
  }
  const flush = () => {
    // Entries the observer hasn't been called with yet
    for (const e of observer.takeRecords() as PerformanceResourceTiming[]) {
      const load = assetLoad(e, base, location.origin);
      if (load) tally.add(load);
    }
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(tally.known)));
    } catch {
      // Full or refused: the next page counts these files as new
    }
    const report = tally.report(context);
    if (report && navigator.sendBeacon(ENDPOINT, JSON.stringify(report))) tally.sent();
  };
  // Hidden is the last moment a phone or an installed window is sure to give the page
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}
