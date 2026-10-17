import { describe, expect, it } from "vitest";
import { markerFor, MM_OURS } from "./markers.ts";

const NPC = 0x40;
const MONSTER = 0x20;

describe("markers from the minimap bits", () => {
  it("draws quests' marks in the ADR's order: ?, !, grey ?, grey !", () => {
    expect(markerFor(NPC | MM_OURS.QUEST_TURNIN | MM_OURS.QUEST_OFFER)).toEqual({ glyph: "?", grey: false, tier: "gold", map: "glyph" });
    expect(markerFor(NPC | MM_OURS.QUEST_OFFER | MM_OURS.QUEST_PENDING)).toEqual({ glyph: "!", grey: false, tier: "gold", map: "glyph" });
    expect(markerFor(NPC | MM_OURS.QUEST_PENDING | MM_OURS.QUEST_SOON)).toEqual({ glyph: "?", grey: true, tier: "gold", map: "glyph" });
    expect(markerFor(NPC | MM_OURS.QUEST_SOON)).toEqual({ glyph: "!", grey: true, tier: "gold", map: "glyph" });
    expect(markerFor(NPC)).toBeNull();
  });

  it("rings a monster that counts for a step, and draws no glyph over it", () => {
    expect(markerFor(MONSTER | MM_OURS.QUEST_TARGET)).toEqual({ glyph: null, grey: false, tier: "gold", map: "ring" });
  });

  it("keeps the portals' marks", () => {
    expect(markerFor(MM_OURS.TRAVEL | MM_OURS.TRAVEL_UNATTUNED)?.glyph).toBe("!");
    expect(markerFor(MM_OURS.TRAVEL)?.map).toBe("portal");
  });

  it("leaves quests' marks out when they're turned off, but not the portals'", () => {
    expect(markerFor(NPC | MM_OURS.QUEST_OFFER, false)).toBeNull();
    expect(markerFor(MONSTER | MM_OURS.QUEST_TARGET, false)).toBeNull();
    expect(markerFor(MM_OURS.TRAVEL | MM_OURS.TRAVEL_UNATTUNED, false)?.glyph).toBe("!");
  });

  it("colours a quest's marks by its tier: gold, silver, bronze", () => {
    expect(markerFor(NPC | MM_OURS.QUEST_OFFER)?.tier).toBe("gold");
    expect(markerFor(NPC | MM_OURS.QUEST_OFFER | MM_OURS.QUEST_SILVER)?.tier).toBe("silver");
    expect(markerFor(NPC | MM_OURS.QUEST_TURNIN | MM_OURS.QUEST_BRONZE)).toEqual({ glyph: "?", grey: false, tier: "bronze", map: "glyph" });
    // A portal's "!" is always gold
    expect(markerFor(MM_OURS.TRAVEL | MM_OURS.TRAVEL_UNATTUNED | MM_OURS.QUEST_BRONZE)?.tier).toBe("gold");
  });
});
