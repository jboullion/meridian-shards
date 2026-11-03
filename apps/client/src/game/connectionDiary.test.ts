import { describe, expect, it, vi } from "vitest";
import { ConnectionDiary, GAP_MS } from "./connectionDiary.ts";

vi.spyOn(console, "info").mockImplementation(() => {});

describe("ConnectionDiary", () => {
  it("notes a tick that comes late as a gap", () => {
    const d = new ConnectionDiary();
    d.tick(1000);
    d.tick(6000);
    expect(d.entries).toEqual([]);
    d.tick(6000 + GAP_MS);
    expect(d.entries).toEqual([{ at: 6000 + GAP_MS, kind: "gap", ms: GAP_MS }]);
  });

  it("explains a long gap, and stays quiet about short ones", () => {
    const d = new ConnectionDiary();
    d.tick(0);
    d.tick(20_000);
    expect(d.explain(21_000)).toBeNull();
    d.tick(110_000);
    expect(d.explain(110_000)).toMatch(/stopped running for 90 s/);
  });

  it("counts the silence since the last tick", () => {
    const d = new ConnectionDiary();
    d.tick(1000);
    expect(d.explain(6_000)).toBeNull();
    expect(d.explain(126_000)).toMatch(/stopped running for 125 s/);
  });

  it("says the page was in the background when it was hidden, also after it came back", () => {
    const d = new ConnectionDiary();
    d.note("hidden", 0);
    expect(d.explain(130_000)).toMatch(/in the background.*130 s/);
    d.note("visible", 131_000);
    expect(d.explain(132_000)).toMatch(/in the background.*131 s/);
    expect(d.explain(10 * 60_000)).toBeNull();
  });

  it("stays quiet about a short look away", () => {
    const d = new ConnectionDiary();
    d.note("hidden", 0);
    d.note("visible", 20_000);
    expect(d.explain(21_000)).toBeNull();
  });

  it("keeps its entries in storage across pages", () => {
    const saved = new Map<string, string>();
    const store = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
    new ConnectionDiary(store).note("closed", 5);
    expect(new ConnectionDiary(store).entries).toEqual([{ at: 5, kind: "closed" }]);
  });
});
