import { describe, expect, it } from "vitest";
import { buildSpellTimes } from "./spellTimes.ts";

const file = (path: string, text: string) => ({ path, text });

const FILES = [
  file("spell.kod", 'Spell is PassiveObject\nresources:\n   spell_name_rsc = "spell"\nclassvars:\n   vrName = spell_name_rsc\n   viMana = 1\n   viPostCast_time = 1\n'),
  // An abstract class: no name of its own, its own delay
  file("teleport.kod", "TeleportationSpell is Spell\nclassvars:\n   viPostCast_time = 2 // in seconds\n"),
  file("blink.kod", 'Blink is TeleportationSpell\nresources:\n   blink_name_rsc = "Blink"\nclassvars:\n   vrName = blink_name_rsc\n   viMana = 8\n'),
  file("light.kod", 'Light is Spell\nresources:\n   light_name_rsc = "light"\nclassvars:\n   vrName = light_name_rsc\n   viPostCast_time = 5\n'),
  // Not a spell
  file("mace.kod", 'Mace is Weapon\nresources:\n   mace_name_rsc = "mace"\nclassvars:\n   vrName = mace_name_rsc\n   viPostCast_time = 9\n'),
];

describe("spell times", () => {
  it("reads each named spell's post-cast delay and mana, inheriting from its parents", () => {
    expect(buildSpellTimes(FILES)).toEqual({
      blink: { postCast: 2, mana: 8 },
      light: { postCast: 5, mana: 1 },
    });
  });
});
