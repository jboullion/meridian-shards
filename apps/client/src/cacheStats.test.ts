import { describe, expect, it } from "vitest";
import { assetLoad, browserFamily, CacheTally } from "./cacheStats.ts";

const ORIGIN = "https://m59-shards.com";
const entry = (name: string, transferSize: number, encodedBodySize: number, decodedBodySize = encodedBodySize) => ({
  name,
  transferSize,
  encodedBodySize,
  decodedBodySize,
});

describe("a game file's load from its timing entry (ADR 0032 decision 7)", () => {
  it("is over the network when the body was sent", () => {
    expect(assetLoad(entry(`${ORIGIN}/assets/rooms/inn.roo?v=0123456789abcdef`, 5300, 5000), "/assets/", ORIGIN)).toEqual({
      key: "rooms/inn.roo",
      hash: "0123456789abcdef",
      bytes: 5000,
      cached: false,
    });
  });

  it("is from the cache when nothing, or only a 304's headers, came over", () => {
    expect(assetLoad(entry(`${ORIGIN}/assets/a.bgf?v=1`, 0, 5000), "/assets/", ORIGIN)?.cached).toBe(true);
    expect(assetLoad(entry(`${ORIGIN}/assets/a.bgf?v=1`, 300, 5000), "/assets/", ORIGIN)?.cached).toBe(true);
  });

  it("skips anything else: other paths, no hash, another site, no sizes", () => {
    expect(assetLoad(entry(`${ORIGIN}/play/assets-client/index.js`, 0, 10), "/assets/", ORIGIN)).toBeNull();
    expect(assetLoad(entry(`${ORIGIN}/assets/manifest.json`, 900, 800), "/assets/", ORIGIN)).toBeNull();
    expect(assetLoad(entry("https://elsewhere.example/assets/a.bgf?v=1", 900, 800), "/assets/", ORIGIN)).toBeNull();
    expect(assetLoad(entry(`${ORIGIN}/assets/a.bgf?v=1`, 0, 0, 0), "/assets/", ORIGIN)).toBeNull();
  });
});

describe("the browser's family", () => {
  it("tells Edge and Chrome from Safari, which they also name", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
    expect(browserFamily(chrome)).toBe("chrome");
    expect(browserFamily(`${chrome} Edg/155.0.0.0`)).toBe("edge");
    expect(browserFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1")).toBe("safari");
    expect(browserFamily("Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0")).toBe("firefox");
  });
});

describe("a page's tally", () => {
  const load = (key: string, hash: string, cached: boolean, bytes = 100) => ({ key, hash, bytes, cached });
  const context = { installed: false, browser: "chrome" as const, mobile: false };

  it("counts what this browser loaded before apart from what's new, once per file", () => {
    const t = new CacheTally({ "a.roo": "1", "b.bgf": "2" });
    t.add(load("a.roo", "1", true)); // seen, kept
    t.add(load("a.roo", "1", true)); // the same file again on this page: not counted
    t.add(load("b.bgf", "2", false)); // seen, lost
    t.add(load("c.ogg", "3", false, 400)); // new
    t.add(load("b.bgf", "9", false)); // a new version: not seen
    expect(t.report(context)).toEqual({
      v: 1,
      returning: true,
      ...context,
      pages: 1,
      files: 4,
      cached: 1,
      seen: 2,
      seenCached: 1,
      bytes: 700,
      cachedBytes: 100,
    });
    expect(Object.fromEntries(t.known)).toEqual({ "a.roo": "1", "b.bgf": "9", "c.ogg": "3" });
  });

  it("reports only what came since the last report, and the page once", () => {
    const t = new CacheTally({});
    expect(t.report(context)).toBeNull();
    t.add(load("a.roo", "1", false));
    expect(t.report(context)).toMatchObject({ returning: false, pages: 1, files: 1 });
    t.sent();
    expect(t.report(context)).toBeNull();
    t.add(load("b.roo", "1", false));
    expect(t.report(context)).toMatchObject({ pages: 0, files: 1 });
  });
});
