// Ours: the client's tables that are data, not code: the achievements, the chat's emoji, the typed
// commands and the Help window's words. Their one source is apps/client/tables/*.json; the asset
// build (tools/assets/build-assets.ts) serves them with the game's files and lists them in its
// manifest, so every client of our server (this one, meridian-godot) reads the same. App loads
// them before the login screen, so the rest of the client uses them as it would constants.

import type { AssetStore } from "../assets.ts";
import { setAchievementsTable, type AchievementsTable } from "./achievements.ts";
import { setCommandsTable, type CommandsTable } from "./commands.ts";
import { setEmojiTable, type EmojiTable } from "./emoji.ts";

/** The interfaces the Help window describes */
export type HelpLayout = "modern" | "classic" | "touch";

/** A term and what it means (a <dt> and its <dd>) */
export interface HelpItem {
  term: string;
  text: string;
  /** Only in these interfaces (all without) */
  layouts?: HelpLayout[];
  /** Only for admins */
  admin?: boolean;
}

/** help.json: the Help window's words (HelpDialog.tsx) */
export interface HelpTable {
  /** The phone's gestures (Controls) */
  touch: HelpItem[];
  /** The HUD page's numbered parts, each found by the first of its CSS selectors that shows, and the 3D view under them */
  hud: { view: { title: string; text: string }; parts: { sel: string[]; title: string; text: string }[] };
  /** The Interface page's sections; a note says, by interface, where the section's windows are */
  interface: { title: string; note?: Record<HelpLayout, string>; items: HelpItem[] }[];
}

export interface ClientTables {
  achievements: AchievementsTable;
  emoji: EmojiTable;
  commands: CommandsTable;
  help: HelpTable;
}

let help: HelpTable = { touch: [], hud: { view: { title: "", text: "" }, parts: [] }, interface: [] };

/** The Help window's words */
export const helpTable = (): HelpTable => help;

/** Puts the tables in use */
export function applyClientTables(t: ClientTables): void {
  setAchievementsTable(t.achievements);
  setEmojiTable(t.emoji);
  setCommandsTable(t.commands);
  help = t.help;
}

/**
 * Loads the tables from the game's files. An asset build without one leaves it empty (and says so):
 * no achievements' names, no emoji, every line said aloud, a bare Help window.
 */
export async function loadClientTables(assets: AssetStore): Promise<void> {
  const load = async <K extends keyof ClientTables>(key: K): Promise<ClientTables[K] | null> => {
    const t = await assets.json<ClientTables[K]>(`${key}.json`);
    if (!t) console.warn(`No ${key}.json in the game's files: run npm run assets`);
    return t;
  };
  const [achievements, emoji, commands, loadedHelp] = await Promise.all([load("achievements"), load("emoji"), load("commands"), load("help")]);
  if (achievements) setAchievementsTable(achievements);
  if (emoji) setEmojiTable(emoji);
  if (commands) setCommandsTable(commands);
  if (loadedHelp) help = loadedHelp;
}
