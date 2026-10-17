// Ours (docs/adr/0009-quests.md): the quest catalogue (dist/assets/quests.json, written by
// tools/quests from shards-server's quests/), and what our client works out from it with the
// server's UC_QUEST_* numbers (session.ts QuestEvent): objective lines, what's suggested for us.

import type { QuestLogEntry } from "./session.ts";

export interface CatalogNpc {
  name: string;
  /** Kod class, or null for a placed giver */
  className: string | null;
  /** A placed giver's id, or 0 */
  placed: number;
  /** Where it stands: room numbers and names */
  rooms: { rid: number; name: string }[];
}

export type QuestStepKind = "kill" | "collect" | "talk" | "deliver" | "visit" | "cast" | "deposit" | "stash" | "buy" | "equip" | "health" | "hometown" | "nodes";

/** How a quest's markers look: gold (main and levelling chains), silver (story), bronze (errands) */
export type QuestTier = "main" | "story" | "errand";

export interface CatalogRewards {
  xp: number;
  shillings: number;
  trainingPoints: number;
  items: { className: string; name: string; count: number }[];
  /** One of these, at random */
  oneOf: { className: string; name: string; count: number }[];
  /** Rewards that aren't things, in words: joining a faction, an insignia, the necromancer guild */
  special: string[];
}

export interface CatalogStep {
  kind: QuestStepKind;
  objective: string;
  /** What the giver says as the step begins ("" for none) */
  brief: string;
  count: number;
  /** kill: the monster's class and name; collect: the item's */
  className: string | null;
  targetName: string | null;
  exact: boolean;
  rooms: { rid: number; name: string }[];
  parcel: string | null;
  turnin: CatalogNpc;
  /** Done as soon as it's counted, with no hand-in */
  auto: boolean;
  /** Given when the step is done */
  rewards: CatalogRewards;
  /** deposit, stash, buy: who with (null: anyone) */
  withName: string | null;
  /** deposit: the least shillings; health: the health; nodes: how many */
  amount: number;
  /** equip: any one of these */
  items: { className: string; name: string }[];
}

export interface CatalogQuest {
  id: number;
  key: string;
  name: string;
  tier: QuestTier;
  giver: CatalogNpc;
  band: { min: number; max: number };
  prereqs: number[];
  /** null: once */
  repeatHours: number | null;
  timeLimitMinutes: number | null;
  text: { offer: string; progress: string; complete: string };
  steps: CatalogStep[];
  rewards: CatalogRewards;
}

export interface QuestCatalog {
  /** The same number the server's UC_QUEST_LOG carries (QuestDefs.GetCatalogHash) */
  hash: number;
  quests: CatalogQuest[];
}

export const EMPTY_CATALOG: QuestCatalog = { hash: 0, quests: [] };

/** A quest health band as players read it: "15-35 health" */
export const bandText = (q: CatalogQuest): string => `${q.band.min}-${q.band.max} health`;

/** The tracker's line for a step: "Small rats slain 7/20", "Speak to Paddock", "Cast Phase (done)" */
export function objectiveLine(step: CatalogStep, count: number): string {
  if (step.kind === "kill" || step.kind === "collect") return `${step.objective} ${Math.min(count, step.count)}/${step.count}`;
  if (step.kind === "talk" || step.kind === "deliver") return step.objective;
  return count > 0 ? `${step.objective} (done)` : step.objective;
}

/** Whether a step's count says it's done; talk and deliver are done at the hand-in */
export const stepCounted = (step: CatalogStep, count: number): boolean => (step.kind === "talk" || step.kind === "deliver" ? false : count >= step.count);

/** What a reward is, in a line: "300 experience, 50 shillings, 2 Inky-cap mushroom"; "" for none */
export function rewardsLine(r: CatalogRewards): string {
  const parts: string[] = [];
  if (r.xp) parts.push(`${r.xp} experience`);
  if (r.trainingPoints) parts.push(`${r.trainingPoints} training points`);
  if (r.shillings) parts.push(`${r.shillings} shillings`);
  for (const i of r.items) parts.push(i.count > 1 ? `${i.count} ${i.name}` : i.name);
  // The same item more than once in the list only weighs the draw
  const pick = [...new Map(r.oneOf.map((i) => [`${i.count} ${i.name}`, i.count > 1 ? `${i.count} ${i.name}` : i.name])).values()];
  if (pick.length === 1) parts.push(pick[0]!);
  else if (pick.length) parts.push(`one of: ${pick.join(", ")}`);
  parts.push(...r.special);
  return parts.join(", ");
}

/** A quest's reward at the end, and along the way for steps that give some */
export function rewardText(q: CatalogQuest): string {
  const end = rewardsLine(q.rewards);
  const along = q.steps.some((s) => rewardsLine(s.rewards));
  return end ? (along ? `${end}, and more along the way` : end) : along ? "rewards along the way" : "nothing but thanks";
}

/** "3:05" for seconds left, or "" for no limit */
export function timeLeftText(seconds: number): string {
  if (seconds < 0) return "";
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The quests to suggest to a player of this much (base) health: those whose band fits, not
 * active, not done (unless they repeat), with their prerequisites done. Main quests first, then
 * story, then errands; nearest band first in each.
 * The server decides for real (QuestBook.CanOffer); this only leads players on.
 */
export function suggestedQuests(catalog: QuestCatalog, health: number, active: QuestLogEntry[], done: { id: number }[]): CatalogQuest[] {
  const isActive = new Set(active.map((a) => a.id));
  const isDone = new Set(done.map((d) => d.id));
  return catalog.quests
    .filter((q) => !isActive.has(q.id) && (!isDone.has(q.id) || q.repeatHours !== null))
    .filter((q) => q.prereqs.every((p) => isDone.has(p)))
    .filter((q) => health >= q.band.min && health <= q.band.max)
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.band.min - b.band.min || a.id - b.id);
}

const TIER_ORDER: Record<QuestTier, number> = { main: 0, story: 1, errand: 2 };

export const questById = (catalog: QuestCatalog, id: number): CatalogQuest | undefined => catalog.quests.find((q) => q.id === id);
