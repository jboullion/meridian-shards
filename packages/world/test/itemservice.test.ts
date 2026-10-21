import { describe, expect, it } from "vitest";
import { ByteReader } from "@shards/protocol";
import { readItemService, repairCommand, revealCommand } from "../src/itemservice.ts";

/** Little-endian bytes from [size, value] pairs */
function bytes(parts: [1 | 4, number][]): ByteReader {
  const out: number[] = [];
  for (const [size, v] of parts) for (let i = 0; i < size; i++) out.push((v >>> (8 * i)) & 0xff);
  return new ByteReader(new Uint8Array(out));
}

describe("UC_ITEM_SERVICE", () => {
  it("reads an elder's reveal menu, numbering the items from 1", () => {
    const e = readItemService(bytes([[1, 1], [4, 6463], [1, 2], [4, 6461], [4, 1000], [4, 40], [4, 50], [4, 6462], [4, 1000], [4, 0], [4, 0]]));
    expect(e).toEqual({
      type: "reveal", npc: 6463,
      items: [
        { slot: 1, id: 6461, price: 1000, hits: 40, maxHits: 50 },
        { slot: 2, id: 6462, price: 1000, hits: 0, maxHits: 0 },
      ],
    });
  });

  it("reads a smith's repair menu", () => {
    const e = readItemService(bytes([[1, 2], [4, 6494], [1, 1], [4, 6470], [4, 125], [4, 0], [4, 300]]));
    expect(e).toEqual({ type: "repair", npc: 6494, items: [{ slot: 1, id: 6470, price: 125, hits: 0, maxHits: 300 }] });
  });

  it("ignores a kind it doesn't know", () => {
    expect(readItemService(bytes([[1, 9]]))).toBeNull();
  });

  it("makes the commands", () => {
    expect(revealCommand(2)).toBe("reveal 2");
    expect(repairCommand(1)).toBe("repair 1");
  });
});
