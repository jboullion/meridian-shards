// Ours: markers over objects and on the minimap, from the server's per-viewer minimap bits
// (user.kod BuildMinimapDotFlag). Fast travel's portals now (docs/adr/0011-fast-travel.md 3); quests'
// "!" and "?" (docs/adr/0009-quests.md 2) will join them here, drawn the same way.

/** include/blakston.khd MM_* bits of ours (the original's end at MM_NO_PVP, 0x2000) */
export const MM_OURS = {
  /** A fast travel portal */
  TRAVEL: 0x40000,
  /** ... that this player hasn't attuned to yet */
  TRAVEL_UNATTUNED: 0x80000,
} as const;

export interface Marker {
  /** What's drawn over the object in the view: "!" (something for you here), or null for none */
  glyph: "!" | null;
  /** How the minimap draws it */
  map: "exclaim" | "portal";
}

/** The marker an object's minimap bits ask for, or null */
export function markerFor(minimapFlags: number): Marker | null {
  if (minimapFlags & MM_OURS.TRAVEL_UNATTUNED) return { glyph: "!", map: "exclaim" };
  if (minimapFlags & MM_OURS.TRAVEL) return { glyph: null, map: "portal" };
  return null;
}
