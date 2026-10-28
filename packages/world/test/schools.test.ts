import { describe, expect, it } from "vitest";
import { ByteReader, UC } from "@shards/protocol";
import { readSchools, schoolsCommand, SCHOOL_STATE } from "../src/schools.ts";
import { fixture, userCommand } from "../../protocol/test/fixture.ts";

const UC_SCHOOLS = userCommand(UC.SCHOOLS, "packages/world/src/schools.ts");

/** Little-endian bytes from [size, value] pairs */
function bytes(parts: [1 | 2 | 4, number][]): ByteReader {
  const out: number[] = [];
  for (const [size, v] of parts) for (let i = 0; i < size; i++) out.push((v >>> (8 * i)) & 0xff);
  return new ByteReader(new Uint8Array(out));
}

describe("UC_SCHOOLS", () => {
  it("reads the learn points, each school's standing and each ability's school and level", () => {
    const body = bytes([
      [2, 6], [2, 28],
      [1, 2],
      [1, 10], [1, 2], [1, 3], [2, 41], [2, 185], [1, SCHOOL_STATE.SHORT],
      [1, 4], [1, 6], [1, 0], [2, 0], [2, 0], [1, SCHOOL_STATE.MAX],
      [2, 2],
      [4, 6461], [1, 10], [1, 2], [1, 1],
      [4, 6470], [1, 4], [1, 6], [1, 0],
    ]);
    expect(fixture(UC_SCHOOLS, readSchools, body)).toEqual({
      learnPoints: 6,
      intellectHelp: 28,
      schools: [
        { school: 10, level: 2, next: 3, have: 41, need: 185, state: SCHOOL_STATE.SHORT },
        { school: 4, level: 6, next: 0, have: 0, need: 0, state: SCHOOL_STATE.MAX },
      ],
      abilities: [
        { id: 6461, school: 10, level: 2, counts: true },
        { id: 6470, school: 4, level: 6, counts: false },
      ],
    });
  });

  it("reads a character who knows nothing yet", () => {
    expect(fixture(UC_SCHOOLS, readSchools, bytes([[2, 0], [2, 4], [1, 0], [2, 0]]))).toEqual({ learnPoints: 0, intellectHelp: 4, schools: [], abilities: [] });
  });

  it("makes the command", () => {
    expect(schoolsCommand()).toBe("schools");
  });
});
