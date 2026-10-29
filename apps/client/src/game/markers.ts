// Ours: markers over objects and on the minimap, from the server's per-viewer minimap bits
// (user.kod BuildMinimapDotFlag): fast travel's portals (docs/adr/0011-fast-travel.md 3) and
// quests' "!" and "?" (docs/adr/0009-quests.md 2, shards-server util/questbook.kod MarkerFor).

/** include/blakston.khd MM_* bits of ours (the original's end at MM_NO_PVP, 0x2000) */
export const MM_OURS = {
  /** An NPC with a quest for us: "!" */
  QUEST_OFFER: 0x4000,
  /** An NPC to hand a finished step in to: "?" */
  QUEST_TURNIN: 0x8000,
  /** An NPC with a quest we nearly have the health for: grey "!" */
  QUEST_SOON: 0x10000,
  /** A monster that counts for one of our kill steps: a gold ring on the minimap */
  QUEST_TARGET: 0x20000,
  /** A fast travel portal */
  TRAVEL: 0x40000,
  /** ... that this player hasn't attuned to yet */
  TRAVEL_UNATTUNED: 0x80000,
  /** An NPC waiting on a step of ours that isn't done yet: grey "?" */
  QUEST_PENDING: 0x100000,
  /**
   * The quest's tier: silver (story), bronze (errands), neither the main chains. The server still
   * sends them, but every mark is gold (29 October: the colours confused more than they told);
   * the quest window's badge says the tier
   */
  QUEST_SILVER: 0x200000,
  QUEST_BRONZE: 0x400000,
  /** A tailor or barber (docs/adr/0012-cosmetics.md): a double-click talks to them, not their shop */
  SERVICE: 0x800000,
  /** An NPC that pays shillings for what we offer (MOB_BUYER): only they get a Sell button */
  BUYS: 0x1000000,
} as const;

/** Any quest bit on an NPC: activating it opens the quest window */
export const MM_QUEST_NPC = MM_OURS.QUEST_OFFER | MM_OURS.QUEST_TURNIN | MM_OURS.QUEST_SOON | MM_OURS.QUEST_PENDING;

/** An NPC worth activating: one with quests, or a tailor or barber */
export const MM_TALK_NPC = MM_QUEST_NPC | MM_OURS.SERVICE;

export interface Marker {
  /** What's drawn over the object in the view: "!" (something for you here), "?" (hand it in), or null */
  glyph: "!" | "?" | null;
  /** Greyed: not yet ("!" soon, "?" once the step is done); gold otherwise */
  grey: boolean;
  /**
   * How the minimap draws it: the glyph in place of the dot, a portal's ring, or a gold ring
   * round the object's usual dot
   */
  map: "glyph" | "portal" | "ring";
}

/** The marker an object's minimap bits ask for, or null. Quests' are left out when `quests` is off */
export function markerFor(minimapFlags: number, quests = true): Marker | null {
  if (quests) {
    if (minimapFlags & MM_OURS.QUEST_TURNIN) return { glyph: "?", grey: false, map: "glyph" };
    if (minimapFlags & MM_OURS.QUEST_OFFER) return { glyph: "!", grey: false, map: "glyph" };
  }
  if (minimapFlags & MM_OURS.TRAVEL_UNATTUNED) return { glyph: "!", grey: false, map: "glyph" };
  if (minimapFlags & MM_OURS.TRAVEL) return { glyph: null, grey: false, map: "portal" };
  if (quests) {
    if (minimapFlags & MM_OURS.QUEST_PENDING) return { glyph: "?", grey: true, map: "glyph" };
    if (minimapFlags & MM_OURS.QUEST_SOON) return { glyph: "!", grey: true, map: "glyph" };
    if (minimapFlags & MM_OURS.QUEST_TARGET) return { glyph: null, grey: false, map: "ring" };
  }
  return null;
}

/** A mark's gold, for the minimap: fill and outline */
export const MARK_COLOR: [string, string] = ["rgb(255,200,40)", "rgb(40,20,0)"];
