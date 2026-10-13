import { describe, expect, it } from "vitest";
import { buildItemSlots, buildItemTypes, parseConstants } from "./itemSlots.ts";

const KHD = `
   ITEM_SINGLE_USE = 0x0001
   ITEM_USE_HAND = 0x0008   // in a hand
   ITEM_USE_BODY = 0x0010
   ITEM_USE_QUIVER = 0x0020
   ITEM_USE_FINGER = 0x0080
   ITEM_USE_HEAD = 0x0200
   ITEM_USE_LEGS = 0x0400
`;

const file = (path: string, text: string) => ({ path, text });

const FILES = [
  file("item.kod", "Item is Object\n"),
  file("passitem.kod", "PassiveItem is Item\n"),
  file("weapon.kod", "Weapon is PassiveItem\nclassvars:\n   viUse_type = ITEM_USE_HAND\n"),
  file("mace.kod", "Mace is Weapon\nresources:\n   mace_icon_rsc = Mace.bgf\nclassvars:\n   vrIcon = mace_icon_rsc\n"),
  file("shield.kod", "Shield is PassiveItem\nclassvars:\n   viUse_type = ITEM_USE_HAND\n"),
  file("torch.kod", "Torch is Shield\nresources:\n   torch_icon_rsc = torch.bgf\n   torch_flame_rsc = torchflm.bgf\nclassvars:\n   vrIcon = torch_icon_rsc\n"),
  // Held, but neither a weapon nor a shield: no slot
  file("instrum.kod", "Instrument is PassiveItem\nresources:\n   lute_icon_rsc = lute.bgf\nclassvars:\n   vrIcon = lute_icon_rsc\n   viUse_type = ITEM_USE_HAND\n"),
  // The female picture is a resource with "icon" in its name, not vrIcon
  file(
    "helm.kod",
    "// Helm is a comment\nHelm is PassiveItem\nresources:\n   helm_icon_male_rsc   = ornhelma.bgf\n   helm_icon_female_rsc = ornhelmb.bgf\n" +
      "   helm_desc = \"It is fine.\"\nclassvars:\n   vrIcon = helm_icon_male_rsc\n   viUse_type = ITEM_USE_HEAD\n",
  ),
  file("robe.kod", "Robe is PassiveItem\nresources:\n   robe_icon = robe.bgf\nclassvars:\n   vrIcon = robe_icon\n   viUse_type = ITEM_USE_BODY | ITEM_USE_LEGS\n"),
  // A ring whose picture is its parent's resource; the parent sets the use type
  file("ring.kod", "Ring is PassiveItem\nresources:\n   ring_icon_rsc = ring3.bgf\nclassvars:\n   viUse_type = ITEM_USE_FINGER\n"),
  file("acidring.kod", "AcidRing is Ring\nclassvars:\n   vrIcon = ring_icon_rsc\n"),
  file("arrow.kod", "Arrow is PassiveItem\nresources:\n   arrow_icon_rsc = arrow.bgf\nclassvars:\n   vrIcon = arrow_icon_rsc\n   viUse_type = ITEM_USE_QUIVER\n"),
  // Two slots claim one picture: it's left out
  file("odd.kod", "Odd is PassiveItem\nclassvars:\n   vrIcon = robe_icon\n   viUse_type = ITEM_USE_HEAD\n"),
  file("potion.kod", "Potion is PassiveItem\nresources:\n   potion_icon = potion.bgf\nclassvars:\n   vrIcon = potion_icon\n   viUse_type = ITEM_SINGLE_USE\n"),
  // Not an item at all
  file("orc.kod", "Orc is Monster\nresources:\n   orc_icon = orc.bgf\nclassvars:\n   vrIcon = orc_icon\n   viUse_type = ITEM_USE_HEAD\n"),
];

describe("item slots", () => {
  it("reads hex and decimal constants", () => {
    const c = parseConstants(KHD);
    expect(c.get("ITEM_USE_HAND")).toBe(8);
    expect(c.get("ITEM_USE_LEGS")).toBe(0x400);
  });

  it("maps each worn item's pictures to its slot, inheriting use types", () => {
    expect(buildItemSlots(FILES, KHD)).toEqual({
      "arrow.bgf": "quiver",
      "mace.bgf": "weapon",
      "ornhelma.bgf": "head",
      "ornhelmb.bgf": "head",
      "ring3.bgf": "finger",
      "torch.bgf": "shield",
    });
  });
});

describe("item types, for sorting the inventory", () => {
  it("each picture's type, from the nearest Kod item family above it", () => {
    const files = [
      ...FILES,
      file("numbitem.kod", "NumberItem is PassiveItem\n"),
      file("money.kod", "Money is NumberItem\n"),
      file("shillings.kod", "Shillings is Money\nresources:\n   shillings_icon_rsc = money.bgf\nclassvars:\n   vrIcon = shillings_icon_rsc\n"),
      file("reagent.kod", "Reagent is NumberItem\n"),
      file("herbs.kod", "Herbs is Reagent\nresources:\n   herbs_icon_rsc = herbs.bgf\nclassvars:\n   vrIcon = herbs_icon_rsc\n"),
    ];
    expect(buildItemTypes(files)).toEqual({
      "herbs.bgf": "reagent",
      "lute.bgf": "instrument",
      "mace.bgf": "weapon",
      "money.bgf": "money",
      "potion.bgf": "potion",
      "ring3.bgf": "jewelry",
      // Torches are Shields in Kod
      "torch.bgf": "shield",
    });
  });
});
