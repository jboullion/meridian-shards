import { describe, expect, it } from "vitest";
import { ByteReader, ByteWriter } from "@shards/protocol";
import { guildHallCommand, guildHallPublicCommand, prestigeText, readGuildHall, rentText } from "../src/guildHall.ts";

/** guild.kod SendHallInfo's tail: prestige, tier, next tier, chest limit, rent, hours, trophies, colours */
function tail(w: ByteWriter, rentDue = 0, hours = 0): ByteWriter {
  return w.u32(105).u8(1).u32(150).u16(75).i32(rentDue).u16(hours).u8(9).u8(21).u8(1);
}

describe("UC_GUILD_HALL", () => {
  it("reads a hall, its chests and the guild's standing (SendHallInfo)", () => {
    const w = new ByteWriter().u8(1).string("Mercenary Alley").u8(0).u8(1).u8(3);
    w.string("common chest").u8(1).u16(12).string("members' chest").u8(2).u16(0).string("vault").u8(3).u16(75);
    const s = readGuildHall(new ByteReader(tail(w, -120).finish()));
    expect(s.hall).toEqual({
      name: "Mercenary Alley", isPublic: false, mayToggle: true,
      chests: [{ name: "common chest", rank: 1, items: 12 }, { name: "members' chest", rank: 2, items: 0 }, { name: "vault", rank: 3, items: 75 }],
    });
    expect(s).toMatchObject({ prestige: 105, tier: 1, nextTierAt: 150, chestLimit: 75, rentDue: -120, rentHours: 0, trophies: 9, trophyTotal: 21, hasColours: true });
  });

  it("reads a guild with no hall", () => {
    const s = readGuildHall(new ByteReader(tail(new ByteWriter().u8(0)).finish()));
    expect(s.hall).toBeNull();
    expect(s.trophies).toBe(9);
  });

  it("words the rent and the prestige", () => {
    const withHall = (rentDue: number, rentHours: number) => ({ ...readGuildHall(new ByteReader(tail(new ByteWriter().u8(1).string("X").u8(1).u8(0).u8(0), rentDue, rentHours).finish())) });
    expect(rentText(withHall(-120, 0))).toBe("Rent is paid ahead by 120 shillings.");
    expect(rentText(withHall(0, 0))).toBe("The rent is paid up.");
    expect(rentText(withHall(300, 12))).toBe("Rent owed: 300 shillings. Pay Frular in Barloque. Pay it within 12 hours or lose the hall.");
    expect(prestigeText(withHall(0, 0))).toBe("Prestige 105, tier 1 of 4: each chest holds 75 items. The next tier comes at 150.");
    expect(guildHallCommand()).toBe("guildhall");
    expect(guildHallPublicCommand(true)).toBe("guildhall public");
  });
});
