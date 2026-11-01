// How well players' browsers keep the game files cached (docs/adr/0032-installable-web-client.md
// decision 7): the gateway's daily totals (tools/gateway/cacheStats.ts) read from the live server
// in one ssh round trip, summed. Prints one JSON object; a failure is a field in it, never a crash.
//
//   node tools/console/cache-stats.ts            (npm run console:cache) the live server, last 30 days
//   node tools/console/cache-stats.ts --days 7
//   node tools/console/cache-stats.ts --local    the local gateway's dist/cache-stats.json
//
// The number that decides step 2 is `kept`: of the files a browser had loaded on an earlier page,
// the share still in its cache when loaded again. Near 1, the browser's cache is enough.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { addCounts, emptyCounts, type CacheCounts, type CacheDays } from "../gateway/cacheStats.ts";
import { COMPOSE, deployTarget, ssh } from "../deploy/remote.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface CacheSummary extends CacheCounts {
  /** cached / files: every load, first visits included */
  hitRate: number | null;
  /** seenCached / seen: loads of a file this browser had before; 1 - kept is what the cache lost */
  kept: number | null;
  /** Megabytes sent over the network (as compressed on the wire) */
  downloadedMB: number;
}

export interface CacheStatsResult {
  at: string;
  source: "live" | "local";
  error?: string;
  days: number;
  total: CacheSummary | null;
  /** By kind: returning|new, app|tab, browser, desktop|mobile */
  byKind: Record<string, CacheSummary>;
  /** Returning browsers only, by day (UTC), oldest first */
  returningByDay: { date: string; pages: number; seen: number; kept: number | null }[];
}

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

function summary(c: CacheCounts): CacheSummary {
  return { ...c, hitRate: ratio(c.cached, c.files), kept: ratio(c.seenCached, c.seen), downloadedMB: Math.round((c.bytes - c.cachedBytes) / 1e5) / 10 };
}

/** The last `days` days of the book, summed */
export function summarize(book: CacheDays, days: number, now = new Date()): Omit<CacheStatsResult, "at" | "source"> {
  const from = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const total = emptyCounts();
  const byKind: Record<string, CacheCounts> = {};
  const returningByDay: CacheStatsResult["returningByDay"] = [];
  for (const date of Object.keys(book).sort()) {
    if (date < from) continue;
    const returning = emptyCounts();
    for (const [kind, c] of Object.entries(book[date]!)) {
      addCounts(total, c);
      addCounts((byKind[kind] ??= emptyCounts()), c);
      if (kind.startsWith("returning|")) addCounts(returning, c);
    }
    returningByDay.push({ date, pages: returning.pages, seen: returning.seen, kept: ratio(returning.seenCached, returning.seen) });
  }
  return {
    days,
    total: total.files ? summary(total) : null,
    byKind: Object.fromEntries(Object.entries(byKind).sort(([, a], [, b]) => b.pages - a.pages).map(([k, c]) => [k, summary(c)])),
    returningByDay,
  };
}

function readBook(local: boolean): { book?: CacheDays; error?: string } {
  if (local) {
    const path = resolve(ROOT, "dist/cache-stats.json");
    if (!existsSync(path)) return { book: {} };
    return { book: JSON.parse(readFileSync(path, "utf8")) as CacheDays };
  }
  const target = deployTarget();
  if (!target) return { error: "SHARDS_DEPLOY_HOST isn't set (.env)" };
  const r = ssh(target, `${COMPOSE} exec -T gateway sh -c 'cat state/cache-stats.json 2>/dev/null || echo {}' </dev/null`, { timeoutMs: 45_000 });
  if (r.status !== 0) return { error: (r.stderr.trim() || `ssh exited ${r.status}`).split("\n").slice(-3).join(" ") };
  try {
    return { book: JSON.parse(r.stdout) as CacheDays };
  } catch {
    return { error: `the gateway's cache-stats.json isn't JSON: ${r.stdout.slice(0, 200)}` };
  }
}

export function cacheStats(days: number, local: boolean): CacheStatsResult {
  const head = { at: new Date().toISOString(), source: local ? ("local" as const) : ("live" as const) };
  const { book, error } = readBook(local);
  if (!book) return { ...head, error, days, total: null, byKind: {}, returningByDay: [] };
  return { ...head, ...summarize(book, days) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { days: { type: "string" }, local: { type: "boolean" } } });
  console.log(JSON.stringify(cacheStats(Math.max(1, Number(values.days ?? 30) || 30), !!values.local), null, 2));
}
