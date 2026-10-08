// The client's profanity filter (clientd3d/profane.c): the terms from ui/profane.dat in
// the asset build, or the list as the player last left it (SaveProfaneTerms writes the
// whole list back), and the checks the options ask for.

import { ProfanityFilter } from "@shards/world";
import type { AssetStore } from "../assets.ts";
import { getSettings } from "./settings.ts";

const STORAGE_KEY = "shards.profanity.terms";

export const profanity = new ProfanityFilter();
let loading: Promise<void> | null = null;

/** LoadProfaneTerms, once: our saved list, else profane.dat */
export function loadProfanity(assets: AssetStore): Promise<void> {
  loading ??= (async () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        for (const t of JSON.parse(saved) as string[]) profanity.add(t);
        return;
      }
    } catch {
      // Unreadable: start from the file
    }
    if (!assets.has("ui/profane.dat")) return;
    const bytes = await assets.fetchBytes("ui/profane.dat");
    // One byte per character (Latin-1)
    profanity.load(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  })();
  return loading;
}

/** SaveProfaneTerms: after the player adds or removes a term */
export function saveProfanity(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profanity.terms));
  } catch {
    // Storage full or blocked
  }
}

/** srvrstr.c: what an incoming line shows with Filter text profanity */
export function filterIncoming(text: string): string {
  const s = getSettings();
  return s.profanityFilter ? profanity.filterIncoming(text, s.profanityIgnore, s.profanityExtra) : text;
}

/** say.c FilterSayMessage: outgoing speech with profanity is blocked */
export function isProfane(text: string): boolean {
  const s = getSettings();
  return s.profanityFilter && profanity.contains(text, s.profanityExtra);
}
