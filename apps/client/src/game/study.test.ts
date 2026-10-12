import { describe, expect, it } from "vitest";
import { CONFIRM_MS } from "./cooldowns.ts";
import {
  MAX_MISSES, STALL_MS, StudySession, carriedCounts, castsFromReagents, formatDuration, loadStudyMemory, saveStudyMemory, studyEstimate, type StudySnapshot,
} from "./study.ts";

const BLESS = { postCast: 1, mana: 6, reagents: [{ name: "mushroom", plural: "mushrooms", amount: 2 }, { name: "sapphire", amount: 1 }] };
const snap = (mana: number, extra: Partial<StudySnapshot> = {}): StudySnapshot => ({ mana, maxMana: 30, hp: 50, resting: false, ...extra });
const study = (count: number | null = 3, logOff = true) => new StudySession({ spell: "bless", count, logOff }, BLESS, () => 0);

describe("study mode", () => {
  it("casts, waits for the mana drop, then the post-cast delay, and casts again", () => {
    const s = study();
    expect(s.step(0, snap(30))).toEqual([{ type: "cast" }]);
    expect(s.step(100, snap(30))).toEqual([]);
    expect(s.step(200, snap(24))).toEqual([]);
    expect(s.casts).toBe(1);
    expect(s.step(999, snap(24))).toEqual([]);
    s.step(1000, snap(24));
    expect(s.step(1001, snap(24))).toEqual([{ type: "cast" }]);
  });

  it("finishes, and logs off, when the count is reached", () => {
    const s = study(1);
    s.step(0, snap(30));
    expect(s.step(100, snap(24))).toEqual([{ type: "finish", reason: "You've cast bless 1 times.", logOff: true }]);
    expect(s.done).toBe(true);
    expect(s.step(200, snap(24))).toEqual([]);
  });

  it("rests when mana runs short, stands when it's full, and measures the regeneration", () => {
    const s = study(null);
    expect(s.step(0, snap(4))).toEqual([{ type: "rest" }]);
    expect(s.step(1000, snap(4, { resting: true }))).toEqual([]);
    expect(s.step(11_000, snap(14, { resting: true }))).toEqual([]);
    expect(s.regen).toBeCloseTo(10 / 11);
    expect(s.step(27_000, snap(30, { resting: true }))).toEqual([{ type: "stand" }]);
    expect(s.step(27_100, snap(30))).toEqual([]);
    s.step(28_000, snap(30));
    expect(s.step(28_001, snap(30))).toEqual([{ type: "cast" }]);
  });

  it("stands when the mana stops rising short of full, if a cast fits", () => {
    const s = study(null);
    s.step(0, snap(4));
    s.step(1000, snap(20, { resting: true }));
    expect(s.step(1000 + STALL_MS, snap(20, { resting: true }))).toEqual([{ type: "stand" }]);
  });

  it("stops when it can never cast", () => {
    expect(study().step(0, snap(4, { maxMana: 5 }))[0]).toMatchObject({ type: "finish", logOff: false });
    const s = study();
    s.step(0, snap(2));
    expect(s.step(STALL_MS, snap(2, { resting: true }))[0]).toMatchObject({ type: "finish", logOff: false });
  });

  it("starts resting if we already are", () => {
    const s = study();
    expect(s.step(0, snap(10, { resting: true }))).toEqual([]);
    expect(s.phase).toBe("rest");
  });

  it("finishes on running out of reagents, logging off as chosen", () => {
    const s = study(null, true);
    s.step(0, snap(30));
    expect(s.refused("reagents", "Bless", 100, snap(30))).toEqual([{ type: "finish", reason: "You've run out of reagents for bless.", logOff: true }]);
    const t = study(null, false);
    t.step(0, snap(30));
    expect(t.refused("reagents", "bless", 100, snap(30))[0]).toMatchObject({ logOff: false });
  });

  it("ignores another spell's refusal", () => {
    const s = study();
    s.step(0, snap(30));
    expect(s.refused("reagents", "light", 100, snap(30))).toEqual([]);
    expect(s.done).toBe(false);
  });

  it("rests on the server's no-mana refusal, and stands on its resting one", () => {
    const s = study();
    s.step(0, snap(30));
    expect(s.refused("mana", "bless", 100, snap(30))).toEqual([{ type: "rest" }]);
    const t = study();
    t.step(0, snap(30));
    expect(t.refused("resting", "", 100, snap(30))).toEqual([{ type: "stand" }]);
  });

  it("gives up after several casts that don't go ahead", () => {
    const s = study();
    let t = 0;
    for (let i = 0; i < MAX_MISSES - 1; i++) {
      expect(s.step(t, snap(30))).toEqual([{ type: "cast" }]);
      t += CONFIRM_MS;
      expect(s.step(t, snap(30))).toEqual([]);
      t += 1;
      s.step(t, snap(30));
    }
    s.step(t, snap(30));
    t += CONFIRM_MS;
    expect(s.step(t, snap(30))[0]).toMatchObject({ type: "finish", logOff: false });
  });

  it("stops, logging off, when we're hurt", () => {
    const s = study();
    s.step(0, snap(30));
    expect(s.step(100, snap(30, { hp: 45 }))[0]).toMatchObject({ type: "finish", reason: "You were hurt while studying.", logOff: true });
  });

  it("counts a free spell's cast when no refusal comes", () => {
    const s = new StudySession({ spell: "free", count: 1, logOff: false }, { postCast: 1, mana: 0 }, () => 0);
    s.step(0, snap(30));
    expect(s.step(CONFIRM_MS, snap(30))[0]).toMatchObject({ type: "finish" });
    expect(s.casts).toBe(1);
  });

  it("can be cancelled", () => {
    const s = study();
    expect(s.cancel()).toEqual([{ type: "finish", reason: "You stop studying.", logOff: false }]);
  });
});

describe("study estimate", () => {
  const carried = carriedCounts([
    { name: "Mushrooms", amount: 8 },
    { name: "mushroom", amount: 1 },
    { name: "sapphire", amount: 3 },
    { name: "sapphire", amount: 2 },
  ]);
  const have = (n: string) => carried.get(n) ?? 0;

  it("counts casts by the scarcest reagent", () => {
    expect(castsFromReagents(BLESS, have)).toBe(4);
    expect(castsFromReagents({ postCast: 1, mana: 1 }, have)).toBeNull();
    expect(castsFromReagents({ postCast: 1, mana: 1, reagents: [{ name: "emerald", amount: 1 }] }, have)).toBe(0);
  });

  it("is limited by the count or the reagents", () => {
    expect(studyEstimate(BLESS, 3, 4, 30, 30)).toMatchObject({ casts: 3, limit: "count" });
    expect(studyEstimate(BLESS, 10, 4, 30, 30)).toMatchObject({ casts: 4, limit: "reagents" });
    expect(studyEstimate(BLESS, null, 4, 30, 30)).toMatchObject({ casts: 4, limit: "reagents" });
    expect(studyEstimate({ postCast: 1, mana: 1 }, null, null, 30, 30)).toEqual({ casts: null, limit: "none", reagentCasts: null, seconds: null });
  });

  it("adds the rests the mana needs, faster with a faster regeneration", () => {
    const noRest = studyEstimate(BLESS, 5, null, 30, 30).seconds!;
    const slow = studyEstimate(BLESS, 20, null, 30, 30, 0.5).seconds!;
    const fast = studyEstimate(BLESS, 20, null, 30, 30, 2).seconds!;
    expect(noRest).toBeLessThan(10);
    // 120 mana for 20 casts, 90 more than we have: 180 s resting at 0.5 a second
    expect(slow).toBeGreaterThan(180);
    expect(fast).toBeLessThan(slow);
  });

  it("reads like a person would say it", () => {
    expect(formatDuration(30)).toBe("under a minute");
    expect(formatDuration(5 * 60)).toBe("about 5 min");
    expect(formatDuration(80 * 60)).toBe("about 1 h 20 min");
    expect(formatDuration(120 * 60)).toBe("about 2 h");
  });

  it("remembers the last choices per character", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadStudyMemory(s, "ws", "Bob")).toEqual({ spell: "", count: 10, logOff: true, regen: null });
    saveStudyMemory(s, "ws", "Bob", { spell: "bless", count: null, logOff: false, regen: 0.8 });
    expect(loadStudyMemory(s, "ws", "bob")).toEqual({ spell: "bless", count: null, logOff: false, regen: 0.8 });
  });
});
