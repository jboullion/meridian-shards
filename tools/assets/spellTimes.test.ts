import { describe, expect, it } from "vitest";
import { buildSpellTimes } from "./spellTimes.ts";

const file = (path: string, text: string) => ({ path, text });

const FILES = [
  file("spell.kod", 'Spell is PassiveObject\nresources:\n   spell_name_rsc = "spell"\nclassvars:\n   vrName = spell_name_rsc\n   viMana = 1\n   viPostCast_time = 1\n'),
  // An abstract class: no name of its own, its own delay
  file("teleport.kod", "TeleportationSpell is Spell\nclassvars:\n   viPostCast_time = 2 // in seconds\n"),
  file("blink.kod", 'Blink is TeleportationSpell\nresources:\n   blink_name_rsc = "Blink"\nclassvars:\n   vrName = blink_name_rsc\n   viMana = 8\n'),
  file(
    "bless.kod",
    'Bless is Spell\nresources:\n   bless_name_rsc = "bless"\nclassvars:\n   vrName = bless_name_rsc\nmessages:\n   ResetReagents()\n   {\n      plReagents = $;\n      plReagents = Cons([&Mushroom,2],plReagents);\n      plReagents = Cons([ &Sapphire, 1 ],plReagents);\n\n      return;\n   }\n\n   CastSpell() { return; }\n',
  ),
  file("mushroom.kod", 'Mushroom is Reagent\nresources:\n   mushroom_name_rsc = "Mushroom"\n   mushroom_plural_rsc = "mushrooms"\nclassvars:\n   vrName = mushroom_name_rsc\n   vrName_plural = mushroom_plural_rsc\n'),
  // Its name is its parent's
  file("sapphire.kod", 'Sapphire is Gem\n'),
  file("gem.kod", 'Gem is Reagent\nresources:\n   gem_name_rsc = "sapphire"\nclassvars:\n   vrName = gem_name_rsc\n'),
  // Inherits Bless's reagents
  file("holybless.kod", 'HolyBless is Bless\nresources:\n   holy_name_rsc = "holy bless"\nclassvars:\n   vrName = holy_name_rsc\n'),
  file("light.kod", 'Light is Spell\nresources:\n   light_name_rsc = "light"\nclassvars:\n   vrName = light_name_rsc\n   viPostCast_time = 5\n'),
  // Not a spell
  file("mace.kod", 'Mace is Weapon\nresources:\n   mace_name_rsc = "mace"\nclassvars:\n   vrName = mace_name_rsc\n   viPostCast_time = 9\n'),
];

describe("spell times", () => {
  it("reads each named spell's post-cast delay, mana and reagents, inheriting from its parents", () => {
    expect(buildSpellTimes(FILES)).toEqual({
      blink: { postCast: 2, mana: 8, reagents: [] },
      bless: { postCast: 1, mana: 1, reagents: [{ name: "mushroom", plural: "mushrooms", amount: 2 }, { name: "sapphire", amount: 1 }] },
      "holy bless": { postCast: 1, mana: 1, reagents: [{ name: "mushroom", plural: "mushrooms", amount: 2 }, { name: "sapphire", amount: 1 }] },
      light: { postCast: 5, mana: 1, reagents: [] },
    });
  });
});
