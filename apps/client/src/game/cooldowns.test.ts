import { describe, expect, it } from "vitest";
import { CONFIRM_MS, CastCooldown } from "./cooldowns.ts";

describe("cast cooldown", () => {
  it("runs for the spell's post-cast delay once our mana drops", () => {
    const c = new CastCooldown();
    expect(c.cast(2000, 8, 30, 0)).toBe(true);
    expect(c.active).toEqual({ start: 0, end: 2000 });
    c.mana(22);
    expect(c.tick(1999)).toBe(false);
    expect(c.tick(2000)).toBe(true);
    expect(c.active).toBeNull();
  });

  it("is taken back when our mana doesn't drop (the server refused the cast)", () => {
    const c = new CastCooldown();
    c.cast(1000, 8, 3, 0);
    c.mana(3);
    expect(c.tick(CONFIRM_MS - 1)).toBe(false);
    expect(c.tick(CONFIRM_MS)).toBe(true);
    expect(c.active).toBeNull();
  });

  it("ignores casts while it runs, and spells that cost nothing need no confirming", () => {
    const c = new CastCooldown();
    c.cast(1000, 0, 30, 0);
    expect(c.cast(5000, 0, 30, 500)).toBe(false);
    expect(c.active?.end).toBe(1000);
    expect(c.tick(1000)).toBe(true);
    expect(c.cast(0, 5, 30, 1200)).toBe(false);
  });
});
