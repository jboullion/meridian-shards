import { describe, expect, it } from "vitest";
import { splitLookText } from "../src/lookText.ts";

describe("a spell's marked-up look text", () => {
  it("splits the description from the stats rows, sub-rows and notes", () => {
    const text =
      "Invokes Kraanan's blessing.\xa7\nSchool\xa6Kraanan\nLevel\xa62\nMana\xa64\nVigor\xa61\nReagents\xa62 sapphires, 2 mushrooms" +
      "\nRecovery\xa6a second\nSpellpower\xa699 (the most is 99)\n\xb7Immortal\xa6+99" +
      "\n\nYour current bless enchantment adds 99 offense and 0-3 attack damage.\nTraining\xa620 points to improve";
    expect(splitLookText(text)).toEqual({
      description: "Invokes Kraanan's blessing.",
      stats: [
        { label: "School", value: "Kraanan", sub: false },
        { label: "Level", value: "2", sub: false },
        { label: "Mana", value: "4", sub: false },
        { label: "Vigor", value: "1", sub: false },
        { label: "Reagents", value: "2 sapphires, 2 mushrooms", sub: false },
        { label: "Recovery", value: "a second", sub: false },
        { label: "Spellpower", value: "99 (the most is 99)", sub: false },
        { label: "Immortal", value: "+99", sub: true },
        { note: "Your current bless enchantment adds 99 offense and 0-3 attack damage." },
        { label: "Training", value: "20 points to improve", sub: false },
      ],
    });
  });

  it("leaves other looks whole", () => {
    expect(splitLookText("A rusty sword.\n\nIt has seen better days.")).toEqual({ description: "A rusty sword.\n\nIt has seen better days.", stats: null });
  });
});
