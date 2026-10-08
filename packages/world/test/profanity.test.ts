import { describe, expect, test } from "vitest";
import { PROFANITY_REMOVED, ProfanityFilter, normalizeTerm, verifyProfaneUsage } from "../src/profanity.ts";

const xor5 = (s: string) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) ^ 5)).join("");

describe("the profanity filter (profane.c)", () => {
  test("profane.dat: XORed terms, + adds, - removes, ; comments", () => {
    const f = new ProfanityFilter();
    f.load(`; a comment\r\n${xor5("heck")}\r\n  +darn\r\n+gosh\r\n-gosh\r\n\r\n`);
    expect(f.terms).toEqual(["heck", "darn"]);
    expect(normalizeTerm("H-e c!K")).toBe("heck");
    // A removed term's slot is the next one's
    f.remove("heck");
    f.add("drat");
    expect(f.terms).toEqual(["drat", "darn"]);
  });

  test("look-alikes, colour codes and punctuation between letters still match", () => {
    const f = new ProfanityFilter();
    f.add("heck");
    expect(f.contains("what the heck", false)).toBe(true);
    expect(f.contains("what the H.e.c.k!", false)).toBe(true);
    expect(f.contains("~rhheecckk~n now", false)).toBe(true);
    // Inside a word and broken up: innocent, unless searching harder
    expect(f.contains("ch-eckers", false)).toBe(false);
    expect(f.contains("ch-eckers", true)).toBe(true);
    // Inside a word but unbroken counts, as in the original
    expect(f.contains("checkers", false)).toBe(true);
  });

  test("VerifyProfaneUsage: words, unbroken runs and extended characters count", () => {
    expect(verifyProfaneUsage("a heck b", 2, 6, false)).toBe(true);
    // Inside a word and broken up: innocent
    expect(verifyProfaneUsage("xh-eckx", 1, 6, false)).toBe(false);
    // Inside a word but unbroken: deliberate
    expect(verifyProfaneUsage("xheckx", 1, 5, false)).toBe(true);
    expect(verifyProfaneUsage("xhéckx", 1, 5, false)).toBe(true);
  });

  test("incoming text: obscured with each term's symbols in turn, or blocked", () => {
    const f = new ProfanityFilter();
    f.add("heck");
    f.add("darn");
    expect(f.cleanse("heck and darn", false)).toBe("@+$&! and *!%#@");
    expect(f.cleanse("heck", false)).toBe("&@!+$");
    expect(f.filterIncoming("oh heck", true, false)).toBe(PROFANITY_REMOVED);
    expect(f.filterIncoming("all fine", true, false)).toBe("all fine");
  });
});
