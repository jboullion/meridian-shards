import { describe, expect, it } from "vitest";
import { ByteReader } from "@shards/protocol";
import { readAppraisal, readTraining, trainableAmount, trainCommand } from "../src/training.ts";

/** Little-endian bytes from [size, value] pairs */
function bytes(parts: [1 | 2 | 4, number][]): ByteReader {
  const out: number[] = [];
  for (const [size, v] of parts) for (let i = 0; i < size; i++) out.push((v >>> (8 * i)) & 0xff);
  return new ByteReader(new Uint8Array(out));
}

describe("UC_TRAINING", () => {
  it("reads each ability and its cost a percent", () => {
    expect(readTraining(bytes([[2, 2], [4, 6461], [4, 30], [4, 6470], [4, 10]]))).toEqual([
      { id: 6461, cost: 30 },
      { id: 6470, cost: 10 },
    ]);
    expect(readTraining(bytes([[2, 0]]))).toEqual([]);
  });

  it("trains no further than 99% or the points allow", () => {
    expect(trainableAmount(50, 10, 1000)).toBe(49);
    expect(trainableAmount(50, 30, 100)).toBe(3);
    expect(trainableAmount(99, 10, 1000)).toBe(0);
    expect(trainableAmount(10, 30, 20)).toBe(0);
    expect(trainableAmount(10, 0, 1000)).toBe(0);
  });

  it("makes the command", () => {
    expect(trainCommand(3)).toBe("train 3");
    expect(trainCommand(0)).toBe("train 1");
  });
});

describe("UC_APPRAISAL", () => {
  it("reads the item, whether it can be appraised and its price", () => {
    expect(readAppraisal(bytes([[4, 0x10000000 | 6461], [1, 1], [4, 500]]))).toEqual({ id: 6461, appraisable: true, price: 500 });
    expect(readAppraisal(bytes([[4, 6470], [1, 0], [4, 0]]))).toEqual({ id: 6470, appraisable: false, price: 0 });
  });
});
