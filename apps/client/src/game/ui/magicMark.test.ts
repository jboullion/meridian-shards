import { describe, expect, it } from "vitest";
import { magicMark } from "./magicMark.tsx";

// blakston.khd OF_MAGIC_SHOW_MUL, OF_MAGIC_COLOUR_MUL, OF_MAGIC_GLYPH_MUL
const flags = (show: number, colour = 0, glyph = 0) => show * 0x00100000 + colour * 0x00800000 + glyph * 0x00004000;

describe("a magic item's mark", () => {
  it("is nothing for plain items and things without flags", () => {
    expect(magicMark({ flags: 0x10 })).toBeNull();
    expect(magicMark({ name: "a spell" })).toBeNull();
    expect(magicMark(null)).toBeNull();
  });

  it("is a grey question mark while the magic is hidden, whatever else the bits say", () => {
    expect(magicMark({ flags: flags(1) })?.key).toBe("?");
    expect(magicMark({ flags: flags(1, 3, 2) })?.key).toBe("?");
  });

  it("is the magic's own glyph once revealed, tier or not", () => {
    expect(magicMark({ flags: flags(2, 3, 1) })?.key).toBe("3:1"); // blinding
    expect(magicMark({ flags: flags(6, 3, 1) })?.key).toBe("3:1");
    expect(magicMark({ flags: flags(4, 9, 3) })?.key).toBe("9:3"); // adventuring
    expect(magicMark({ flags: flags(2, 15) })?.key).toBe("15:0"); // the necromancers
  });

  it("falls back to its colour's first glyph for a glyph it doesn't have", () => {
    expect(magicMark({ flags: flags(2, 11, 3) })?.key).toBe("11:0"); // holy has one
  });

  it("puts a dark glyph on the pale discs and a white one on the rest", () => {
    expect(magicMark({ flags: flags(2, 11) })?.ink).not.toBe("#fff");
    expect(magicMark({ flags: flags(2, 6) })?.ink).not.toBe("#fff");
    expect(magicMark({ flags: flags(2, 10) })?.ink).toBe("#fff");
  });
});
