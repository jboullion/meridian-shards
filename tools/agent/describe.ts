// The world as text for the agent (docs/adr/0020-ai-playtester.md): who and where we are, what's
// in the room (with its square, distance and compass bearing), the ways out, our inventory and our
// quests. Squares are Kod rows and columns, 1-based, as maintenance commands and the quests use.
// Pure, tested in describe.test.ts.

import { exitsTo, squareOf, type AmbientExits, type QuestCatalog, type QuestLogEntry, type WorldObject, type WorldState } from "../../packages/world/src/index.ts";
import { objectiveLine } from "../../packages/world/src/quests.ts";
import { STAT_GROUP, type ObjectInfo } from "../../packages/protocol/src/index.ts";

const SQ = 1024;

/** include/proto.h OF_* (apps/client/src/game/gameScene.ts) */
export const OF = {
  PLAYER: 0x4, ATTACKABLE: 0x8, GETTABLE: 0x10, CONTAINER: 0x20, NOEXAMINE: 0x40, OFFERABLE: 0x200, BUYABLE: 0x400, ACTIVATABLE: 0x800,
} as const;
/** include/proto.h MM_* (MiniMap.tsx) and ours (apps/client/src/game/markers.ts MM_OURS) */
const MM = {
  NPC: 0x40, MINIBOSS: 0x400, BOSS: 0x800, RARE_ITEM: 0x1000, NO_PVP: 0x2000,
  QUEST_OFFER: 0x4000, QUEST_TURNIN: 0x8000, QUEST_SOON: 0x10000, QUEST_TARGET: 0x20000, TRAVEL: 0x40000, TRAVEL_UNATTUNED: 0x80000,
  QUEST_PENDING: 0x100000, SERVICE: 0x800000,
} as const;

export interface View {
  world: WorldState;
  /** A resource's string, "" when unknown */
  name: (res: number) => string;
  /** Our room's file, lower case ("" before we're in one) */
  roomFile: string;
  exits: Record<string, AmbientExits>;
  /** The numbered rooms that use a file */
  roomsOf: (file: string) => { rid: number; name: string }[];
}

const COMPASS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"] as const;

/** The compass point of a direction (x east, y south) */
export function compass(dx: number, dy: number): string {
  const a = Math.atan2(dy, dx); // clockwise from east, as y runs south
  return COMPASS[(Math.round(a / (Math.PI / 4)) + 8) % 8]!;
}

/** Client angles are 4096 to the circle, 0 east, clockwise as y runs south */
export const angleTo = (dx: number, dy: number): number => (Math.round((Math.atan2(dy, dx) * 4096) / (2 * Math.PI)) + 4096) % 4096;
export const facing = (angle: number): string => compass(Math.cos((angle * 2 * Math.PI) / 4096), Math.sin((angle * 2 * Math.PI) / 4096));

/** "row 12, col 8" for a fine position */
export function squareText(x: number, y: number): string {
  const [row, col] = squareOf({ x, y });
  return `row ${row}, col ${col}`;
}

/** What sort of thing an object is, with any marker the server gives it */
export function kindOf(info: ObjectInfo): string {
  const f = info.flags,
    m = info.minimapFlags;
  const kinds: string[] = [];
  const npc = (m & MM.NPC) !== 0 || (m & (MM.QUEST_OFFER | MM.QUEST_TURNIN | MM.QUEST_SOON | MM.QUEST_PENDING | MM.SERVICE)) !== 0;
  if (f & OF.PLAYER) kinds.push("player");
  else if (f & OF.ATTACKABLE) kinds.push(m & MM.BOSS ? "boss monster" : m & MM.MINIBOSS ? "mini-boss monster" : "monster");
  else if (npc || f & (OF.BUYABLE | OF.OFFERABLE)) {
    kinds.push("npc");
    if (f & OF.BUYABLE) kinds.push("sells (shop)");
    if (f & OF.OFFERABLE) kinds.push("takes items (buys, banks or receives)");
  } else if (f & OF.GETTABLE) kinds.push(m & MM.RARE_ITEM ? "rare item" : "item");
  else if (f & OF.CONTAINER) kinds.push("container");
  else if (m & MM.TRAVEL) kinds.push("travel portal");
  else if (f & OF.ACTIVATABLE) kinds.push("usable");
  else kinds.push("thing");
  if (m & MM.QUEST_TURNIN) kinds.push('"?" quest to hand in');
  else if (m & MM.QUEST_OFFER) kinds.push('"!" quest offered');
  else if (m & MM.QUEST_PENDING) kinds.push("waiting on a quest step");
  else if (m & MM.QUEST_SOON) kinds.push("quest soon (more health needed)");
  if (m & MM.QUEST_TARGET) kinds.push("counts for a quest");
  if (m & MM.SERVICE) kinds.push("tailor or barber");
  if (m & MM.TRAVEL_UNATTUNED) kinds.push("not attuned");
  return kinds.join(", ");
}

/** An object's name, with its amount for a stack */
export function nameOf(v: View, info: ObjectInfo): string {
  const n = v.name(info.nameRes) || `object ${info.id}`;
  return info.amount > 1 ? `${info.amount} ${n}` : n;
}

/** The main group's stats (statmain.c): their name resources are their icons */
const MAIN_STATS: Record<number, string> = { 1: "Health", 2: "Mana", 3: "Vigor", 4: "Experience" };

/** The stats of a group, by their names: "Health 25/30" */
function statLines(v: View, group: number): string[] {
  return (v.world.stats.get(group) ?? []).flatMap((s) => {
    if (!s.numeric) return [];
    const label = (group === STAT_GROUP.MAIN ? MAIN_STATS[s.num] : v.name(s.nameRes)) || `stat ${s.num}`;
    return [s.numeric.currentMax ? `${label} ${s.numeric.value}/${s.numeric.currentMax}` : `${label} ${s.numeric.value}`];
  });
}

/** Our health as numbers, or null before the server says */
export function health(world: WorldState): { value: number; max: number } | null {
  const hp = world.stats.get(STAT_GROUP.MAIN)?.find((s) => s.num === 1)?.numeric;
  return hp ? { value: hp.value, max: hp.currentMax } : null;
}

/** The room's name and numbers */
export function roomName(v: View): string {
  const p = v.world.player;
  const name = p ? v.name(p.roomNameRes) : "";
  const rids = v.roomsOf(v.roomFile).map((r) => r.rid);
  return `${name || "(unnamed room)"} [${v.roomFile || "?"}${rids.length ? `, RID ${rids.join("/")}` : ""}]`;
}

export function statusText(v: View, target: number | null): string {
  const w = v.world;
  const self = w.self;
  if (!w.player || !self) return "Not in the game.";
  const lines = [
    `You are ${v.name(self.info.nameRes) || "?"} (object ${self.id}).`,
    `Room: ${roomName(v)}.`,
    `Standing at ${squareText(self.x, self.y)}, facing ${facing(self.angle)}.`,
    `Main: ${statLines(v, STAT_GROUP.MAIN).join(", ") || "not sent yet"}.`,
  ];
  const ench = [...w.enchantments.player.values()].map((e) => v.name(e.nameRes)).filter(Boolean);
  if (ench.length) lines.push(`Enchantments on you: ${ench.join(", ")}.`);
  const roomEnch = [...w.enchantments.room.values()].map((e) => v.name(e.nameRes)).filter(Boolean);
  if (roomEnch.length) lines.push(`On the room: ${roomEnch.join(", ")}.`);
  const using = [...w.inventory.values()].filter((i) => w.inUse.has(i.id)).map((i) => nameOf(v, i));
  lines.push(`Using: ${using.join(", ") || "nothing"}.`);
  const fx = w.effects;
  const states = [fx.paralyzed && "paralyzed", fx.blind && "blind", fx.raining && "it's raining", fx.snowing && "it's snowing"].filter(Boolean);
  if (states.length) lines.push(`Now: ${states.join(", ")}.`);
  const t = target !== null ? w.objects.get(target) : undefined;
  if (t) lines.push(`Target: ${nameOf(v, t.info)} (object ${t.id}), ${distanceText(self, t)}.`);
  return lines.join("\n");
}

/** "3.2 sq NE" from us to an object */
export function distanceText(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const d = Math.hypot(dx, dy) / SQ;
  return d < 0.3 ? "here" : `${d.toFixed(1)} sq ${compass(dx, dy)}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The ways out of the room: doors (their middle square) and sides, with where they lead */
export function exitLines(v: View): string[] {
  const e = v.exits[v.roomFile];
  if (!e) return [];
  const dests = new Set<string>();
  for (const [, , to] of e.doors) if (to) dests.add(to);
  for (const edge of e.edges) if (edge.to) dests.add(edge.to);
  const lines: string[] = [];
  for (const to of dests) {
    const name = v.roomsOf(to)[0]?.name ?? "";
    const where = exitsTo(v.exits, v.roomFile, to).map((m) => (m.kind === "door" ? `door at row ${round1(m.row)}, col ${round1(m.col)}` : `the ${m.side} edge`));
    lines.push(`${to}${name ? ` (${name})` : ""}: ${where.join("; ")}`);
  }
  return lines.sort();
}

/** The room's objects nearest first (all, or within `radius` squares), then its exits */
export function roomText(v: View, radius?: number): string {
  const w = v.world;
  const self = w.self;
  if (!w.player || !self) return "Not in the game.";
  const objs = [...w.objects.values()]
    .filter((o) => o.id !== self.id && !(o.info.flags & OF.NOEXAMINE && !o.info.nameRes))
    .map((o) => ({ o, d: Math.hypot(o.x - self.x, o.y - self.y) / SQ }))
    .filter(({ d }) => radius === undefined || d <= radius)
    .sort((a, b) => a.d - b.d);
  const lines = [`${roomName(v)}. You stand at ${squareText(self.x, self.y)}, facing ${facing(self.angle)}.`];
  lines.push(objs.length ? `${objs.length} objects${radius !== undefined ? ` within ${radius} squares` : ""}:` : "Nothing else here.");
  for (const { o } of objs) lines.push(`- [${o.id}] ${nameOf(v, o.info)} (${kindOf(o.info)}) at ${squareText(o.x, o.y)}, ${distanceText(self, o)}${o.motion ? ", moving" : ""}`);
  const exits = exitLines(v);
  lines.push(exits.length ? "Exits:" : "No known exits (rooms without fixed exits, or reached by portals).");
  for (const e of exits) lines.push(`- ${e}`);
  return lines.join("\n");
}

export function inventoryText(v: View): string {
  const items = [...v.world.inventory.values()];
  if (!items.length) return "Your inventory is empty.";
  return items.map((i) => `- [${i.id}] ${nameOf(v, i)}${v.world.inUse.has(i.id) ? " (in use)" : ""}`).join("\n");
}

export function spellsText(v: View): string {
  const spells = v.world.spells;
  if (!spells.length) return "You know no spells.";
  return spells.map((s) => `- [${s.object.id}] ${v.name(s.object.nameRes)}${s.numTargets ? " (needs a target)" : ""}`).join("\n");
}

/** Our quest log, with each step's objective from the catalogue */
export function questLogText(log: { active: QuestLogEntry[]; done: { id: number; times: number }[] } | null, catalog: QuestCatalog): string {
  if (!log) return "No quest log yet (ask with quest log).";
  const lines: string[] = [];
  for (const a of log.active) {
    const q = catalog.quests.find((x) => x.id === a.id);
    const step = q?.steps[a.step - 1];
    lines.push(`- [${a.id}] ${q?.name ?? "?"}, step ${a.step}/${q?.steps.length ?? "?"}: ${step ? objectiveLine(step, a.count) : `count ${a.count}`}${step?.turnin && !step.auto ? ` (hand in to ${step.turnin.name}${step.turnin.rooms[0] ? ` in ${step.turnin.rooms[0].name}` : ""})` : ""}`);
  }
  if (!lines.length) lines.push("No quests going.");
  if (log.done.length) lines.push(`Done: ${log.done.map((d) => catalog.quests.find((q) => q.id === d.id)?.name ?? d.id).join(", ")}.`);
  return lines.join("\n");
}

/** A quest from the catalogue, in full */
export function questText(catalog: QuestCatalog, id: number): string {
  const q = catalog.quests.find((x) => x.id === id);
  if (!q) return `No quest ${id} in the catalogue.`;
  const lines = [`[${q.id}] ${q.name} (${q.tier}, ${q.band.min}-${q.band.max} health), from ${q.giver.name}${q.giver.rooms[0] ? ` in ${q.giver.rooms.map((r) => r.name).join(" / ")}` : ""}.`, `Offer: ${q.text.offer}`];
  q.steps.forEach((s, i) => lines.push(`Step ${i + 1}: ${s.objective}${s.count > 1 ? ` (${s.count})` : ""}${s.rooms.length ? ` in ${s.rooms.map((r) => `${r.name} (RID ${r.rid})`).join(", ")}` : ""}${s.auto ? "" : `, hand in to ${s.turnin.name}`}`));
  return lines.join("\n");
}

/** Whether an object is a creature we could fight */
export const isAttackable = (o: WorldObject): boolean => (o.info.flags & OF.ATTACKABLE) !== 0;
