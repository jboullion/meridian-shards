// Writes kod/util/questdefs.kod: the QuestDefs class QuestBook inherits its tables from. Only
// what the server needs is in it (ids, classes, counts, rooms, rewards, and the few lines it
// says itself); the quests' stories are in our client's catalogue (catalog.ts).
//
// The tables' fields are QuestBook's Q_*, S_* and G_* constants (kod/util/questbook.kod):
//   quest: [ id, name, giver class, giver placed id, band min, band max, prerequisites,
//            karma min, karma max, cooldown seconds ($ once), time limit seconds ($ none),
//            steps, xp, shillings, items, training points, tier, faction ($ any, -1 any but
//            neutral, else FACTION_*), one of these items, requirement bits (QBQ_*), special rewards,
//            quests that keep it from being offered ]
//   step:  [ kind, class, count, exact (1; 2: only kills in its rooms count),  turn-in class, turn-in placed id, objective, rooms, parcel,
//            turn-in's name, auto, rewards ([ xp, shillings, training points, items, one of, special ] or $),
//            with (an NPC class), classes (equip's), amount ]
//   giver: [ id, name, icon, desc, room, row, col, fine row, fine col, angle, service ]
//   replaced: [ 1 (an old QuestEngine template) or 2 (a guide chain), its QST_ID or chain number, quest id ]
//
// A Kod list literal holds at most 40 elements, so each table is a list of groups of rows
// (GROUP at a time), which QuestBook flattens when it reads them.

import { FACTION_NUM, KIND_NUM, TIER_NUM, type ResolvedGiver, type ResolvedQuest, type ResolvedRewards } from "./validate.ts";
import { SERVICE_NUM } from "./schema.ts";

const kodString = (s: string) => `"${s.replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;

/** A resource line, split over lines with `\` as the Kod's own long strings are */
function resource(name: string, text: string): string {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 80) {
    let cut = rest.lastIndexOf(" ", 80);
    if (cut < 20) cut = 80;
    parts.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  parts.push(rest);
  if (parts.length === 1) return `   ${name} = ${kodString(text)}`;
  return `   ${name} = \\\n${parts.map((p) => `      ${kodString(p)}`).join("\n")}`;
}

const cls = (c: string | null) => (c ? `&${c}` : "$");
const list = (xs: string[]) => (xs.length ? `[ ${xs.join(", ")} ]` : "$");
const opt = (n: number | null) => (n === null ? "$" : String(n));

const GIVER_DESC = "A traveller with work for those willing to do it.";

/** Rows per group: under the Kod's 40 elements a list literal may hold */
export const GROUP = 30;

/** A table's return: its rows in groups, or $ for none */
function groups(rows: string[]): string {
  if (!rows.length) return "      return $;";
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += GROUP) out.push(`         [\n${rows.slice(i, i + GROUP).join(",\n")}\n         ]`);
  return `      return [\n${out.join(",\n")}\n      ];`;
}

const itemList = (items: ResolvedRewards["items"]) => list(items.map((it) => `[ &${it.cls}, ${it.count}${it.school === null ? "" : `, ${it.school}`} ]`));
const specialList = (r: ResolvedRewards) => list(r.special.map(([k, n]) => `[ ${k}, ${n} ]`));

/** A step's rewards, or $ for none */
const stepRewards = (r: ResolvedRewards) =>
  r.xp || r.shillings || r.trainingPoints || r.items.length || r.oneOf.length || r.special.length
    ? `[ ${r.xp}, ${r.shillings}, ${r.trainingPoints}, ${itemList(r.items)}, ${itemList(r.oneOf)}, ${specialList(r)} ]`
    : "$";

function replacedRows(quests: ResolvedQuest[]): string {
  return groups(quests.flatMap((q) => [...q.replaces.template.map((n) => `            [ 1, ${n}, ${q.id} ]`), ...q.replaces.chains.map((n) => `            [ 2, ${n}, ${q.id} ]`)]));
}

export function writeQuestDefs(quests: ResolvedQuest[], givers: ResolvedGiver[], hash: number): string {
  const rsc: string[] = [];
  const questRows: string[] = [];
  for (const q of quests) {
    rsc.push(resource(`qd_${q.id}_name`, q.name));
    const steps = q.steps.map((s, i) => {
      const n = i + 1;
      rsc.push(resource(`qd_${q.id}_s${n}`, s.objective));
      if (s.parcel) rsc.push(resource(`qd_${q.id}_p${n}`, s.parcel));
      rsc.push(resource(`qd_${q.id}_t${n}`, s.turnin.name));
      return (
        `[ ${KIND_NUM[s.kind]}, ${cls(s.cls)}, ${s.count}, ${(s.exact ? 1 : 0) | (s.inRooms ? 2 : 0)}, ${cls(s.turnin.cls)}, ${s.turnin.placed}, qd_${q.id}_s${n}, ${list(s.rooms.map(String))}, ${s.parcel ? `qd_${q.id}_p${n}` : "$"}, qd_${q.id}_t${n},` +
        `\n               ${s.auto ? 1 : 0}, ${stepRewards(s.rewards)}, ${cls(s.withCls)}, ${list(s.items.map((i) => `&${i.cls}`))}, ${s.amount} ]`
      );
    });
    questRows.push(
      [
        `         // ${q.key}`,
        `         [ ${q.id}, qd_${q.id}_name, ${cls(q.giver.cls)}, ${q.giver.placed}, ${q.band.min}, ${q.band.max}, ${list(q.prereqs.map(String))},`,
        `           ${opt(q.karmaMin)}, ${opt(q.karmaMax)}, ${opt(q.cooldownSeconds)}, ${opt(q.timeLimitSeconds)},`,
        `           [ ${steps.join(",\n             ")} ],`,
        `           ${q.rewards.xp}, ${q.rewards.shillings}, ${itemList(q.rewards.items)}, ${q.rewards.trainingPoints}, ${TIER_NUM[q.tier]}, ${q.faction === null ? "$" : FACTION_NUM[q.faction]}, ${itemList(q.rewards.oneOf)}, ${q.needs}, ${specialList(q.rewards)}, ${list(q.excludes.map(String))}, ${opt(q.healthBelow)} ]`,
      ].join("\n"),
    );
  }
  const giverRows: string[] = [];
  for (const g of givers) {
    rsc.push(resource(`qg_${g.id}_name`, g.name));
    rsc.push(resource(`qg_${g.id}_desc`, g.desc?.trim() || GIVER_DESC));
    rsc.push(`   qg_${g.id}_icon = ${g.icon}`);
    giverRows.push(
      `         [ ${g.id}, qg_${g.id}_name, qg_${g.id}_icon, qg_${g.id}_desc, ${g.ridNum}, ${g.row}, ${g.col}, ${g.fineRow ?? 32}, ${g.fineCol ?? 32}, ${g.angle}, ${g.service ? SERVICE_NUM[g.service] : 0} ]`,
    );
  }

  return [
    "// GENERATED by meridian-browser's tools/quests (npm run quests) from quests/*.json: don't",
    "// edit it by hand, edit the quests and run the generator (server\\build.cmd runs it too).",
    "// The fields are QuestBook's (util/questbook.kod); docs/adr/0009-quests.md 6.",
    "",
    "////////////////////////////////////////////////////////////////////////////////",
    "QuestDefs is UtilityFunctions",
    "",
    "constants:",
    "",
    "   include blakston.khd",
    "",
    "resources:",
    "",
    ...(rsc.length ? rsc : ["   qd_none = \"\""]),
    "",
    "classvars:",
    "",
    "properties:",
    "",
    "messages:",
    "",
    "   GetCatalogHash()",
    "   \"Our client's catalogue (dist/assets/quests.json) carries the same number.\"",
    "   {",
    `      return ${hash};`,
    "   }",
    "",
    "   GetQuests()",
    "   {",
    groups(questRows),
    "   }",
    "",
    "   GetReplaced()",
    "   \"What the quests replace (QuestBook.PlayerLoggedOn): a player who finished one has its quest done.\"",
    "   {",
    replacedRows(quests),
    "   }",
    "",
    "   GetGivers()",
    "   \"The quest givers the rooms place (QuestBook.PlaceGivers).\"",
    "   {",
    groups(giverRows),
    "   }",
    "",
    "end",
    "////////////////////////////////////////////////////////////////////////////////",
    "",
  ].join("\r\n").replace(/\r?\n/g, "\r\n");
}
