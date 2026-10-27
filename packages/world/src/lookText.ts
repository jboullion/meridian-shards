// Ours: a spell's look text, as our server marks it up for our client's Description and Stats
// tabs (shards-server kod/object/passive/spell.kod spell_desc_rsc, 2026-10-27):
//   - the description, then § (0xA7);
//   - then the stats, one to a line, "Label¦Value" (0xA6). A label starting · (0xB7) is a sub-row
//     (a part of the spellpower);
//   - a line without ¦ is a note across the table (an enchantment's own lines: "Your current bless
//     enchantment adds…").
// Text without § (items, monsters, players) isn't split.

/** Ends the description and starts the stats */
export const DESC_STATS_MARK = "\xa7";
const CELL_MARK = "\xa6";
const SUB_MARK = "\xb7";

export type DescStatRow = { label: string; value: string; sub: boolean } | { note: string };

export interface SplitDesc {
  description: string;
  /** null: no stats in it (not a spell's look) */
  stats: DescStatRow[] | null;
}

export function splitLookText(text: string): SplitDesc {
  const at = text.indexOf(DESC_STATS_MARK);
  if (at < 0) return { description: text, stats: null };
  const stats: DescStatRow[] = [];
  for (const raw of text.slice(at + 1).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const cell = line.indexOf(CELL_MARK);
    if (cell < 0) {
      stats.push({ note: line });
      continue;
    }
    let label = line.slice(0, cell).trim();
    const sub = label.startsWith(SUB_MARK);
    if (sub) label = label.slice(SUB_MARK.length).trim();
    stats.push({ label, value: line.slice(cell + 1).trim(), sub });
  }
  return { description: text.slice(0, at).trim(), stats };
}
