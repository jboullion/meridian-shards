import { describe, expect, test } from "vitest";
import { messageChannel } from "../src/chatChannel.ts";

describe("chat tabs (chatChannel.ts)", () => {
  test("fighting goes to Combat, by the message's format string", () => {
    for (const f of [
      "%s%s%s hits you.",
      "%s%s%s misses you.",
      "You hit %s%s.",
      "You killed %s%s with your room enchantment.",
      "%s%s lets out a cry of pain as flames sear %s flesh for ~k~B%i~n damage.",
      "%s%s%s shrugs off your attack.",
      "%s%s is too far away to hit with %s%s.",
      "A brilliant move, but easily blocked.",
      "You fumble and drop your %s.",
      // the verb comes in a parameter: "Your mace brutalizes the giant rat."
      "%sYour %s %s %s%q.",
      "%s%s%q's %s %s you for ~r~B%i~B%s damage.",
      // how the monster is doing, and the spoils
      "~B~r%s%s is clearly injured.",
      "~B~r%s%s is weak, and near death.",
      "You have gained ~B~s%i~v~B XP.",
      "You gather ~B~t%i~v~B unbound energy from your fallen enemy. You have ~B~t%i~v~B unbound energy.",
      "You loot the corpse clean, and find %d %r.",
    ])
      expect(messageChannel(f), f).toBe("combat");
  });

  test("everything else, and announcements, go to Server", () => {
    for (const f of [
      "You have %i pieces of new mail.",
      "System is saving: please wait.",
      "~B~k[###]~n Your safety is now ~BON~n:  You can no longer strike innocents.",
      "~B~k[Event]~n ~B~v An army of skeletons have risen from the dead and are advancing on Tos.",
      "The %s is empty.",
      "Near Death Studios was co-founded by former Meridian 59 developers.",
    ])
      expect(messageChannel(f), f).toBe("server");
  });
});
