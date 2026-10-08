// Which chat tab a line belongs in. The original client has one text window; the tabs are ours.
//
//   chat:   what people and NPCs say (BP_SAID: say, tell, yell, broadcast, emote, guild)
//   combat: server messages about fighting (BP_MESSAGE): hits, misses, kills, damage...
//   server: everything else the server or the client itself says (BP_MESSAGE, BP_SYS_MESSAGE)
//
// Server messages carry no kind, only a format resource ("%s%s%s hits you."), so combat is
// recognised by that format string, before the names are filled in: a monster or player called
// "Slayer" can't move a line into the wrong tab. Descriptions and NPC speech never come this
// way (they're BP_LOOK and BP_SAID), so the words below only ever meet game messages.
// The logon's messages skip this and go to Server (GameSession LOGON_SERVER_TAB_MS): the
// newbie help text says "E key - attack monsters".

export type ChatChannel = "chat" | "combat" | "server";

/** Announcements ("[###] Your safety is now ON", "[Event] ..."), even when they mention fighting */
const ANNOUNCEMENT = /^(~[a-zA-Z])*\s*\[(###|Event)\]/;

const COMBAT = new RegExp(
  "\\b(" +
    [
      "hits?", "miss(es|ed)?", "kill(s|ed)?", "slain", "slays?", "dies", "died",
      "parr(y|ies|ied)", "dodges?", "dodged", "blocks?", "blocked", "fumbles?", "fumbled",
      "attacks?", "attacked", "damage", "wounds?", "wounded", "strikes?", "struck",
      "stabs?", "slash(es)?", "bash(es)?", "punch(es)?", "bites?", "claws?", "stings?", "kicks?", "smash(es)?",
      "shrugs off", "cry of pain", "resists?", "too far away to hit",
    ].join("|") +
    ")\\b",
  "i",
);

/**
 * Combat lines whose verb is filled in rather than written into the format, and the rest of a
 * fight: how hurt the monster is, and what killing it brings (battler.kod, monster.kod, player.kod)
 */
const COMBAT_FORMATS = [
  // battler_attacker_*: "%sYour %s %s %s%q." -> "Your mace brutalizes the rat."
  /Your %s %s %s/,
  // battler_defender_*: "%s%s%q's %s %s you." -> "The rat's teeth gnaw you."
  /'s %s %s you\b/,
  // Lm_*_damage_level: "is slightly wounded", "is clearly injured", "is weak, and near death"
  // (not the tips about Near Death Studios)
  /\bis (slightly |clearly |seriously |badly )?(wounded|injured)\b|\bnear death\b(?! Studios)/i,
  // the spoils: XP, training points, unbound energy, and looting the corpse or "your fallen enemy"
  /\bgained\b.*\b(XP|training points)\b/i,
  /\b(the corpse|your fallen enemy)\b/i,
];

/** The tab for a server message, from its format string (BP_MESSAGE, BP_SYS_MESSAGE). */
export function messageChannel(format: string): ChatChannel {
  if (ANNOUNCEMENT.test(format)) return "server";
  return COMBAT.test(format) || COMBAT_FORMATS.some((re) => re.test(format)) ? "combat" : "server";
}
