import { describe, expect, it } from "vitest";
import type { Room, Sector } from "../../packages/formats/src/index.ts";
import { findWaterTextures } from "./waterTextures.ts";

const sector = (floorType: number, depth: number) => ({ floorType, flags: depth }) as Sector;
const room = (sectors: Sector[]) => ({ sectors }) as Room;

describe("water textures", () => {
  it("takes a texture mostly under water, often enough to tell, for water anywhere", () => {
    const rooms = [
      // 10 under water, 4 dry: water (Raza's pool is one of the dry ones)
      room([...Array.from({ length: 10 }, () => sector(1802, 1)), ...Array.from({ length: 4 }, () => sector(1802, 0))]),
      // Grass at a river's edge: under water now and then, mostly dry
      room([...Array.from({ length: 9 }, () => sector(7301, 2)), ...Array.from({ length: 50 }, () => sector(7301, 0))]),
      // Too few to tell
      room([sector(555, 1), sector(555, 1)]),
    ];
    expect(findWaterTextures(rooms)).toEqual([1802]);
  });
});
