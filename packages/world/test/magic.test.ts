import { describe, expect, it } from "vitest";
import { ByteReader } from "@shards/protocol";
import { MAGIC_SHOW, magicColour, magicShow, magicTier, readMagicName } from "../src/magic.ts";

/** Little-endian bytes from [size, value] pairs */
function bytes(parts: [1 | 4, number][]): ByteReader {
  const out: number[] = [];
  for (const [size, v] of parts) for (let i = 0; i < size; i++) out.push((v >>> (8 * i)) & 0xff);
  return new ByteReader(new Uint8Array(out));
}

// blakston.khd: OF_MAGIC_SHOW_MUL 0x00100000, OF_MAGIC_COLOUR_MUL 0x00800000
const flags = (other: number, show: number, colour: number) => other | (show * 0x00100000) | (colour * 0x00800000);

describe("magic item flags", () => {
  it("reads a potent vampiric weapon's tier and colour, ignoring the other flags", () => {
    const f = flags(0x10 | 0x80, MAGIC_SHOW.POTENT, 1);
    expect(magicShow(f)).toBe(MAGIC_SHOW.POTENT);
    expect(magicTier(f)).toBe(2);
    expect(magicColour(f)).toBe(1);
  });

  it("reads the necromancers' colour, the highest bits used", () => {
    expect(magicColour(flags(0, MAGIC_SHOW.ENORMOUS, 15))).toBe(15);
    expect(magicTier(flags(0, MAGIC_SHOW.ENORMOUS, 15))).toBe(3);
  });

  it("has no tier for hidden magic or revealed magic without one", () => {
    expect(magicTier(flags(0, MAGIC_SHOW.UNREVEALED, 0))).toBeNull();
    expect(magicTier(flags(0, MAGIC_SHOW.REVEALED, 9))).toBeNull();
    expect(magicShow(0x10)).toBe(MAGIC_SHOW.NONE);
  });
});

describe("UC_MAGIC_NAME", () => {
  it("fills in the chain of name parts", () => {
    const strings: Record<number, string> = { 1: "%s", 2: "potent %s", 3: "durable %s", 4: "%s of siphoning", 5: "longsword" };
    const m = readMagicName(bytes([[4, 6461], [4, 0x500010], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5]]), (id) => strings[id]);
    expect(m).toEqual({ id: 6461, flags: 0x500010, name: "potent durable longsword of siphoning" });
  });
});
