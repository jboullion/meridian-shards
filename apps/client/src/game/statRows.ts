// Ours: the Stats tab's rows (Sidebar.tsx NumericStats). Training points first (with Train beside
// them, docs/adr/0016-abilities.md), then the six attributes down to Aim, a divider, and the
// rest. Karma (always 0 now), Unbound Energy (gone) and Weight and Bulk Carried (the inventory
// shows them) aren't listed, whichever of them the server still sends.

import type { Statistic } from "@shards/protocol";

/** Stat group 2's numbers (shards-server user.kod ToCliStats, the SendStat* senders) */
export const STAT_NUM = {
  MIGHT: 1, INTELLECT: 2, STAMINA: 3, AGILITY: 4, MYSTICISM: 5, AIM: 6, KARMA: 7, TRAINING: 8, WEIGHT: 9, BULK: 10, UNBOUND: 27,
} as const;

/** The attributes, in the server's order, which the divider follows */
const ATTRIBUTES: readonly number[] = [STAT_NUM.MIGHT, STAT_NUM.INTELLECT, STAT_NUM.STAMINA, STAT_NUM.AGILITY, STAT_NUM.MYSTICISM, STAT_NUM.AIM];
const HIDDEN_NUMS: readonly number[] = [STAT_NUM.KARMA, STAT_NUM.WEIGHT, STAT_NUM.BULK, STAT_NUM.UNBOUND];
/** The same by English name, should the numbers move */
const HIDDEN_NAMES = new Set(["karma", "weight carried", "bulk carried", "unbound energy"]);

export type StatRow = { kind: "stat"; stat: Statistic; training: boolean } | { kind: "divider" };

/** The rows to show, in order; `english` names a stat in English (lower case doesn't matter) */
export function statRows(stats: readonly Statistic[], english: (nameRes: number) => string | null | undefined = () => null): StatRow[] {
  const shown = stats.filter((s) => !HIDDEN_NUMS.includes(s.num) && !HIDDEN_NAMES.has((english(s.nameRes) ?? "").toLowerCase()));
  const byNum = [...shown].sort((a, b) => a.num - b.num);
  const training = byNum.filter((s) => s.num === STAT_NUM.TRAINING);
  const attributes = byNum.filter((s) => ATTRIBUTES.includes(s.num));
  const rest = byNum.filter((s) => s.num !== STAT_NUM.TRAINING && !ATTRIBUTES.includes(s.num));
  const rows: StatRow[] = [...training, ...attributes].map((stat) => ({ kind: "stat", stat, training: stat.num === STAT_NUM.TRAINING }));
  if (attributes.length && rest.length) rows.push({ kind: "divider" });
  for (const stat of rest) rows.push({ kind: "stat", stat, training: false });
  return rows;
}
