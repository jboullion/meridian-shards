import { describe, expect, it } from "vitest";
import { ByteReader } from "@shards/protocol";
import { barberCommand, readCosmetics, tailorDyeCommand } from "../src/cosmetics.ts";

/** Little-endian bytes from [size, value] pairs */
function bytes(parts: [1 | 4, number][]): ByteReader {
  const out: number[] = [];
  for (const [size, v] of parts) for (let i = 0; i < size; i++) out.push((v >>> (8 * i)) & 0xff);
  return new ByteReader(new Uint8Array(out));
}

describe("UC_COSMETICS", () => {
  it("reads a tailor's menu, numbering the items from 1", () => {
    const names: Record<number, string> = { 900: "purple", 901: "gold" };
    const e = readCosmetics(
      bytes([[1, 1], [4, 6463], [4, 250], [4, 50], [1, 2], [1, 42], [4, 900], [1, 50], [4, 901], [1, 2], [4, 6461], [1, 1], [1, 42], [1, 1], [4, 6462], [1, 2], [1, 0], [1, 0]]),
      (id) => names[id],
    );
    expect(e).toEqual({
      type: "tailor", npc: 6463, dyePrice: 250, undyePrice: 50,
      dyes: [{ field: 42, name: "purple" }, { field: 50, name: "gold" }],
      items: [
        { slot: 1, id: 6461, ramp: 1, field: 42, worn: true },
        { slot: 2, id: 6462, ramp: 2, field: 0, worn: false },
      ],
    });
  });

  it("reads a barber's menu", () => {
    const e = readCosmetics(bytes([[1, 2], [4, 6494], [4, 500], [1, 1], [1, 3], [1, 0], [1, 5], [1, 0], [1, 2], [1, 1], [1, 4], [1, 2]]), () => null);
    expect(e).toEqual({ type: "barber", npc: 6494, price: 500, look: { gender: 1, hair: 3, beard: 0, hairColour: 5, head: 0, eyes: 2, nose: 1, mouth: 4, skin: 2 } });
  });

  it("makes the commands", () => {
    expect(tailorDyeCommand(2, 42)).toBe("tailor dye 2 42");
    expect(barberCommand(3, 0, 5)).toBe("barber 3 0 5");
  });
});
