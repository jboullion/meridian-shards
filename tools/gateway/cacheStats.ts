// How well players' browsers keep the game files cached (docs/adr/0032-installable-web-client.md
// decision 7): the browser client's reports (apps/client/src/cacheStats.ts, POST /api/stats/cache)
// summed per day and per kind of player, and kept in a JSON file (CACHE_STATS) for
// `npm run console:cache` (tools/console/cache-stats.ts). Nothing about who sent them is kept.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const COUNTS = ["pages", "files", "cached", "seen", "seenCached", "bytes", "cachedBytes"] as const;
const BROWSERS = ["chrome", "edge", "firefox", "safari", "other"] as const;

export type CacheCounts = Record<(typeof COUNTS)[number], number>;

export interface CacheReport extends CacheCounts {
  returning: boolean;
  installed: boolean;
  browser: (typeof BROWSERS)[number];
  mobile: boolean;
}

/** Day (UTC, YYYY-MM-DD) -> kind ("returning|tab|chrome|desktop") -> counts */
export type CacheDays = Record<string, Record<string, CacheCounts>>;

/** Days kept */
const KEEP_DAYS = 90;
/** A page reports a few hundred files at most; far more is a made-up report */
const MAX_FILES = 20_000;
const MAX_BYTES = 2 ** 31;

/** A report as sent, checked; null when it isn't one. */
export function parseReport(text: string): CacheReport | null {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || v.v !== 1) return null;
  if (typeof v.returning !== "boolean" || typeof v.installed !== "boolean" || typeof v.mobile !== "boolean") return null;
  if (!BROWSERS.includes(v.browser as CacheReport["browser"])) return null;
  const counts = {} as CacheCounts;
  for (const k of COUNTS) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return null;
    counts[k] = n;
  }
  const c = counts;
  if (c.pages > 1 || c.files > MAX_FILES || c.bytes > MAX_BYTES) return null;
  if (c.cached > c.files || c.seen > c.files || c.seenCached > c.seen || c.seenCached > c.cached || c.cachedBytes > c.bytes) return null;
  return { ...counts, returning: v.returning, installed: v.installed, browser: v.browser as CacheReport["browser"], mobile: v.mobile };
}

export const kindOf = (r: CacheReport) =>
  `${r.returning ? "returning" : "new"}|${r.installed ? "app" : "tab"}|${r.browser}|${r.mobile ? "mobile" : "desktop"}`;

export const emptyCounts = (): CacheCounts => ({ pages: 0, files: 0, cached: 0, seen: 0, seenCached: 0, bytes: 0, cachedBytes: 0 });

export function addCounts(into: CacheCounts, from: CacheCounts): void {
  for (const k of COUNTS) into[k] += from[k];
}

/** The days' totals, saved to `path` (null: kept in memory only) at most once a minute and on stop. */
export class CacheStatsBook {
  days: CacheDays = {};
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly path: string | null;
  private readonly log: (...a: unknown[]) => void;

  constructor(path: string | null, log: (...a: unknown[]) => void = () => {}) {
    this.path = path;
    this.log = log;
    if (!path || !existsSync(path)) return;
    try {
      this.days = JSON.parse(readFileSync(path, "utf8")) as CacheDays;
    } catch (e) {
      log(`cache stats: ${path} isn't JSON (${(e as Error).message}); starting again`);
    }
  }

  add(r: CacheReport, now = new Date()): void {
    const day = now.toISOString().slice(0, 10);
    const kinds = (this.days[day] ??= {});
    addCounts((kinds[kindOf(r)] ??= emptyCounts()), r);
    for (const d of Object.keys(this.days).sort().slice(0, -KEEP_DAYS)) delete this.days[d];
    this.dirty = true;
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.save();
    }, 60_000);
    this.timer.unref?.();
  }

  save(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.path || !this.dirty) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.tmp`, JSON.stringify(this.days));
      renameSync(`${this.path}.tmp`, this.path);
      this.dirty = false;
    } catch (e) {
      this.log(`cache stats: can't save ${this.path}: ${(e as Error).message}`);
    }
  }
}
