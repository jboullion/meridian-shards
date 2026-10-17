import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { addStyle } from "./spriteApi.ts";

const KOD = `
   charinfo_hair_ce_icon = ptce.bgf  // Mohawk with a long braid

   // Shards: new styles
   charinfo_hair_sa_icon = ptsa.bgf  // Warrior's top knot
   charinfo_hair_sb_icon = ptsb.bgf  // Short tousled crop

   charinfo_hair_bald_icon = blank.bgf   // bald.

   // Shards: facial hair
   charinfo_beard_a_icon = pbda.bgf  // Short trimmed full beard
   charinfo_beard_b_icon = pbdb.bgf  // Long full beard

   GetAllowedHairIcons(iGender = GENDER_MALE)
   "Every hairstyle."
   {
      return [charinfo_hair_ce_icon,
          charinfo_hair_sa_icon, charinfo_hair_sb_icon,
          charinfo_hair_bald_icon];
   }

   GetAllowedBeardIcons(iGender = GENDER_MALE)
   "The facial hair."
   {
      if iGender = GENDER_MALE
      {
         return [charinfo_beard_a_icon, charinfo_beard_b_icon];
      }
      return [];
   }
`;

describe("addStyle", () => {
  test("a hairstyle: resource after the last of ours, listed before bald", () => {
    const { kod, resource } = addStyle(KOD, "hair", "ptsm.bgf", "Side braid");
    expect(resource).toBe("charinfo_hair_sc_icon");
    expect(kod).toContain("   charinfo_hair_sb_icon = ptsb.bgf  // Short tousled crop\n   charinfo_hair_sc_icon = ptsm.bgf  // Side braid\n");
    expect(kod).toContain("charinfo_hair_sb_icon,\n          charinfo_hair_sc_icon,\n          charinfo_hair_bald_icon];");
  });

  test("a beard: resource after the last beard, listed for men", () => {
    const { kod, resource } = addStyle(KOD, "beard", "pbdg.bgf", "");
    expect(resource).toBe("charinfo_beard_c_icon");
    expect(kod).toContain("   charinfo_beard_c_icon = pbdg.bgf\n");
    expect(kod).toContain("return [charinfo_beard_a_icon, charinfo_beard_b_icon,\n         charinfo_beard_c_icon];");
    expect(kod).toContain("      return [];");
  });

  test("refuses a file that's already listed", () => {
    expect(() => addStyle(KOD, "hair", "ptsa.bgf", "")).toThrow(/already/);
  });

  test("works on the real system.kod", () => {
    const real = readFileSync(join(import.meta.dirname, "../../server/src/kod/util/system.kod"), "latin1");
    const { kod } = addStyle(real, "beard", "pbdz.bgf", "Test");
    expect(kod.split("\n").length).toBe(real.split("\n").length + 2);
  });
});
