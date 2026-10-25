// Ours (docs/adr/0025-achievements.md): what our client knows of the character's achievements, from
// UC_ACHIEVEMENTS (shards-server util/achievements.kod), and the catalogue of them: the server only
// says which ids are earned and when, the names, descriptions and icons are here. Kept from logon.

import { useEffect, useState } from "react";
import type { AchievementsEvent } from "@shards/world";

export type AchievementCategory = "Bosses" | "Factions" | "Guild" | "Level" | "Schools" | "Quests" | "Glory";

export const ACHIEVEMENT_CATEGORIES: readonly AchievementCategory[] = ["Bosses", "Factions", "Guild", "Level", "Schools", "Quests", "Glory"];

export interface AchievementInfo {
  /** The server's ACH_* id (blakston.khd); a boss's is its guild trophy's */
  id: number;
  category: AchievementCategory;
  name: string;
  description: string;
  /** The game's own picture: a .bgf, as its monster draws it; none: the game's logo */
  sprite?: string;
  /** The title it adds to the character's look, when it adds one */
  title?: string;
}

const boss = (id: number, name: string, where: string, sprite?: string): AchievementInfo => ({
  id, category: "Bosses", name: `Slayer of ${name}`, description: `Strike down ${name} in ${where}.`, sprite,
});

const SCHOOLS = ["Shal'ille", "Qor", "Kraanan", "Faren", "Riija", "Jala"] as const;

export const ACHIEVEMENTS: readonly AchievementInfo[] = [
  boss(1, "Mistress Ysolde", "the Den of Shadows"),
  boss(2, "Old Blackroot", "the home of the Friends of the Forest", "res0003a.bgf"),
  boss(3, "Hrimvald", "Muskgate Post", "iceleme.bgf"),
  boss(4, "Thane Durrek", "the Old Dwarven Hall", "gskelbody.bgf"),
  boss(5, "Captain Vesk", "the Abandoned Warehouse"),
  boss(6, "Grisk, the Sewer King", "the Sewer Hideout", "lupking.bgf"),
  boss(7, "Marshal Corvane", "the Hall of the Slaughtered Command", "Cknight.bgf"),
  boss(8, "Lieutenant Morvaine", "the Wetland Fortress", "angel.bgf"),
  { id: 50, category: "Bosses", name: "Delver of the Fallen Halls", description: "Defeat the master of every Fallen Hall.", title: "Delver of the Fallen Halls" },
  boss(21, "the Orc Pit Boss", "the orc pit", "OrcPitB.bgf"),
  boss(22, "the Lupogg King", "the Sewer King's lair", "lupking.bgf"),
  boss(23, "Queen Venya'cyr", "beneath Castle Brax", "licha.bgf"),
  boss(24, "the ghost of Far'Nohl", "the old throne room of Far'Nohl", "ghost.bgf"),
  boss(25, "the Queen Spider", "the spiders' nest", "spdrqu.bgf"),
  boss(26, "the Dragonfly Queen", "the jungles of Ko'catan", "dflo.bgf"),
  boss(27, "the Avar Chieftain", "the jungles of Ko'catan", "avchief.bgf"),
  boss(28, "the Groundworm Queen", "the tunnels", "worml.bgf"),
  boss(29, "the Spinebeast Behemoth", "Bergentaal", "spinebeastbehemoth.bgf"),
  boss(30, "the Ice Dragon", "the desert", "icedrag.bgf"),
  boss(31, "the Earth Dragon", "the desert", "earthdrag.bgf"),
  boss(32, "the ne'xeochicatl", "the Valley of the Xeochicatl", "Xeoneru.bgf"),
  { id: 51, category: "Bosses", name: "Slayer of the World's Beasts", description: "Defeat every one of the world's great bosses.", title: "Slayer of the World's Beasts" },
  { id: 41, category: "Bosses", name: "Bane of Venya'cyr Ascended", description: "Defeat Queen Venya'cyr Ascended in the Inner Sanctum.", sprite: "licha.bgf", title: "Bane of Queen Venya'cyr Ascended" },

  { id: 60, category: "Factions", name: "Sworn Soldier", description: "Join a faction." },
  { id: 61, category: "Factions", name: "Duke's Soldier", description: "Swear yourself to Duke Akardius." },
  { id: 62, category: "Factions", name: "Princess's Soldier", description: "Swear yourself to Princess Kateriina." },
  { id: 63, category: "Factions", name: "Rebel Soldier", description: "Swear yourself to Jonas D'Accor." },
  { id: 64, category: "Factions", name: "Hero of Barloque", description: "Finish the Duke's quest chain, to the siege of Barloque.", title: "Hero of Barloque" },
  { id: 65, category: "Factions", name: "Hero of Tos", description: "Finish the Princess's quest chain, to the siege of Tos.", title: "Hero of Tos" },
  { id: 66, category: "Factions", name: "Storm of the Keep", description: "Finish the Rebels' quest chain, storming the keep.", title: "Storm of the Keep" },

  { id: 71, category: "Guild", name: "Guildmate", description: "Join a guild." },
  { id: 70, category: "Guild", name: "Guildmaster", description: "Found a guild, or lead one." },

  { id: 80, category: "Level", name: "Seasoned", description: "Reach 50 hit points." },
  { id: 81, category: "Level", name: "Veteran", description: "Reach 100 hit points." },
  { id: 82, category: "Level", name: "Legend of the Realm", description: "Reach 150 hit points.", title: "Legend of the Realm" },

  ...SCHOOLS.map((s, n): AchievementInfo => ({
    id: 91 + n, category: "Schools", name: `Adept of ${s}`, description: `Learn a level 6 spell of ${s}.`,
  })),

  { id: 100, category: "Quests", name: "First Errand", description: "Finish a quest." },
  { id: 101, category: "Quests", name: "Hired Hand", description: "Finish 10 quests." },
  { id: 102, category: "Quests", name: "Questing Knight", description: "Finish 50 quests." },
  { id: 103, category: "Quests", name: "Every Army's Friend", description: "Finish the soldier's quest for all three lieges." },

  { id: 110, category: "Glory", name: "Achiever", description: "Earn 10 achievements." },
  { id: 111, category: "Glory", name: "Distinguished", description: "Earn 25 achievements." },
  { id: 112, category: "Glory", name: "Completionist", description: "Earn every other achievement.", title: "Completionist" },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const achievementInfo = (id: number): AchievementInfo | undefined => BY_ID.get(id);

/** How long a toast stays up, ms */
export const TOAST_MS = 5000;

export class AchievementsStore {
  /** id -> when it was earned, ms since the epoch */
  earned = new Map<number, number>();
  /** Whether the server has sent the list yet */
  loaded = false;
  /** Just earned and not yet shown, oldest first */
  toasts: number[] = [];
  /** Goes up with every change */
  version = 0;
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  handle(e: AchievementsEvent, nowMs = Date.now()): void {
    if (e.type === "all") {
      this.earned = new Map(e.earned.map((a) => [a.id, nowMs - Math.max(0, e.now - a.when) * 1000]));
      this.loaded = true;
    } else if (!this.earned.has(e.id)) {
      this.earned.set(e.id, nowMs);
      if (achievementInfo(e.id)) this.toasts.push(e.id);
    }
    this.changed();
  }

  /** The toast on screen has had its time */
  shiftToast(): void {
    this.toasts.shift();
    this.changed();
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** How many of the catalogue are earned */
  count(): number {
    let n = 0;
    for (const a of ACHIEVEMENTS) if (this.earned.has(a.id)) n++;
    return n;
  }
}

/** Re-renders on every change; returns the store's version */
export function useAchievements(store: AchievementsStore | null): number {
  const [, setVersion] = useState(0);
  useEffect(() => store?.onChange(() => setVersion(store.version)), [store]);
  return store?.version ?? 0;
}
