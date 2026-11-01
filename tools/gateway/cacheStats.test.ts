import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summarize } from "../console/cache-stats.ts";
import { CacheStatsBook, parseReport } from "./cacheStats.ts";

const report = {
  v: 1,
  returning: true,
  installed: false,
  browser: "chrome",
  mobile: false,
  pages: 1,
  files: 10,
  cached: 8,
  seen: 6,
  seenCached: 5,
  bytes: 1000,
  cachedBytes: 800,
};

describe("the browser client's cache reports (ADR 0032 decision 7)", () => {
  it("takes a report as the client sends it", () => {
    const { v, ...counts } = report;
    expect(v).toBe(1);
    expect(parseReport(JSON.stringify(report))).toEqual(counts);
  });

  it("refuses anything that isn't one, or doesn't add up", () => {
    for (const bad of [
      "not json",
      JSON.stringify({ ...report, v: 2 }),
      JSON.stringify({ ...report, browser: "netscape" }),
      JSON.stringify({ ...report, files: -1 }),
      JSON.stringify({ ...report, files: 1.5 }),
      JSON.stringify({ ...report, pages: 2 }),
      JSON.stringify({ ...report, cached: 11 }),
      JSON.stringify({ ...report, seenCached: 7 }),
      JSON.stringify({ ...report, cachedBytes: 1001 }),
      JSON.stringify({ ...report, files: 1e9, cached: 0, seen: 0, seenCached: 0 }),
    ])
      expect(parseReport(bad)).toBeNull();
  });

  it("sums reports per day and kind, keeps them on save, and summarizes them", () => {
    const path = join(mkdtempSync(join(tmpdir(), "cache-stats-")), "cache-stats.json");
    const book = new CacheStatsBook(path);
    const r = parseReport(JSON.stringify(report))!;
    const day = new Date("2026-11-01T12:00:00Z");
    book.add(r, day);
    book.add({ ...r, pages: 0 }, day);
    book.add({ ...r, returning: false, seen: 0, seenCached: 0 }, day);
    book.save();
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(saved["2026-11-01"]["returning|tab|chrome|desktop"]).toMatchObject({ pages: 1, files: 20, seen: 12, seenCached: 10 });
    expect(new CacheStatsBook(path).days).toEqual(saved);

    const s = summarize(saved, 7, day);
    expect(s.total).toMatchObject({ pages: 2, files: 30, cached: 24, hitRate: 0.8, kept: 0.833, downloadedMB: 0 });
    expect(s.returningByDay).toEqual([{ date: "2026-11-01", pages: 1, seen: 12, kept: 0.833 }]);
    expect(Object.keys(s.byKind)).toEqual(["returning|tab|chrome|desktop", "new|tab|chrome|desktop"]);
  });

  it("keeps 90 days", () => {
    const book = new CacheStatsBook(null);
    const r = parseReport(JSON.stringify(report))!;
    for (let d = 0; d < 100; d++) book.add(r, new Date(Date.UTC(2026, 0, 1 + d)));
    book.save();
    const days = Object.keys(book.days).sort();
    expect(days).toHaveLength(90);
    expect(days[0]).toBe("2026-01-11");
  });
});
