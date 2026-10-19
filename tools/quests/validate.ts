// Checks quests and givers against each other and the Kod (world.ts), and resolves every name
// to what the Kod writer and the catalogue need: classes as declared, rooms as numbers, NPCs'
// names, and each step's objective line.

import { ACTION_KINDS, ARENAS, checkGiverShape, checkQuestShape, INSIGNIA, SCHOOLS, type Faction, type Giver, type NpcRef, type Quest, type QuestRewards, type StepKind, type Tier } from "./schema.ts";
import { xpForPoints } from "./xp.ts";
import { classOf, iconOf, isItem, isMonster, isNpc, isNumberItem, isSkill, isSpell, nameOf, spawnRooms, type World } from "./world.ts";

/** QuestBook's step kinds (questbook.kod QK_*) */
export const KIND_NUM: Record<StepKind, number> = {
  kill: 1, collect: 2, talk: 3, deliver: 4, visit: 5, cast: 6, deposit: 7, stash: 8, buy: 9, equip: 10, health: 11, hometown: 12, nodes: 13, companion: 14, convey: 15, learn: 16, attune: 17, arena: 18, train: 19, node: 20, claim: 21,
};

/** The faction a quest needs, as QuestBook reads it: the FACTION_ number, -1 any but neutral, $ none */
export const FACTION_NUM: Record<Faction, number> = { neutral: 0, duke: 1, princess: 2, rebel: 3, any: -1 };

/** QuestBook's tiers (questbook.kod QT_*) */
export const TIER_NUM: Record<Tier, number> = { main: 1, story: 2, errand: 3 };

export interface ResolvedRewards {
  xp: number;
  shillings: number;
  trainingPoints: number;
  items: ResolvedItem[];
  oneOf: ResolvedItem[];
  /** QuestBook's special rewards: [ QRW_* kind, its number ] */
  special: [number, number][];
  /** The special rewards in words, for our client */
  specialText: string[];
}

export interface ResolvedItem {
  cls: string;
  name: string;
  count: number;
  stack: boolean;
  /** SS_* for an item made for a school, or null */
  school: number | null;
}

/** QuestBook's special rewards (questbook.kod QRW_*) */
export const SPECIAL = { join: 1, insignia: 2, necroGuild: 3 } as const;

const FACTION_NAME = { duke: "Duke Akardius", princess: "Princess Kateriina", rebel: "Jonas and his rebels" } as const;

export interface ResolvedNpc {
  /** A Kod class (every NPC of it), or null for a placed giver */
  cls: string | null;
  /** A placed giver's id, or 0 */
  placed: number;
  name: string;
  /** The rooms it stands in, where known */
  rids: number[];
}

export interface ResolvedStep {
  kind: StepKind;
  /** kill: the monster; collect: the item */
  cls: string | null;
  clsName: string | null;
  exact: boolean;
  /** kill: only kills in `rooms` count */
  inRooms: boolean;
  count: number;
  /** visit: the rooms to visit (the server's) */
  rooms: number[];
  /** Where the step is done, for our client's maps: the visit's rooms, the rooms given, or a kill's spawn rooms */
  area: number[];
  objective: string;
  brief: string;
  parcel: string | null;
  turnin: ResolvedNpc;
  /** Done when counted, with no hand-in */
  auto: boolean;
  /** Given when the step is done */
  rewards: ResolvedRewards;
  /** deposit, stash, buy: the NPC class it's done with, or null for anyone */
  withCls: string | null;
  withName: string | null;
  /** deposit: the least shillings; health: the health; nodes: how many */
  amount: number;
  /** equip: the item classes, any one */
  items: { cls: string; name: string }[];
}

export interface ResolvedQuest {
  id: number;
  key: string;
  name: string;
  tier: Tier;
  giver: ResolvedNpc;
  /** Old QuestEngine quest ids and guide chains this replaces, as numbers */
  replaces: { template: number[]; chains: number[] };
  band: { min: number; max: number };
  prereqs: number[];
  karmaMin: number | null;
  karmaMax: number | null;
  faction: Faction | null;
  /** Quests that, done or going, keep this one from being offered */
  excludes: number[];
  /** QuestBook's requirement bits (QBQ_*): 1 intriguing, 2 a guild master, 4 a guild shield, 8 no guild, 16 paused (never offered), 32 starts on a death */
  needs: number;
  /** Offered only while base health is under this (null: no cap) */
  healthBelow: number | null;
  /** null: once */
  cooldownSeconds: number | null;
  timeLimitSeconds: number | null;
  text: { offer: string; progress: string; complete: string };
  steps: ResolvedStep[];
  rewards: ResolvedRewards;
}

export interface ResolvedGiver extends Giver {
  ridNum: number;
  roomName: string;
  /** The look class as declared, and its picture */
  lookCls: string;
  icon: string;
}

export interface Checked {
  errors: string[];
  quests: ResolvedQuest[];
  givers: ResolvedGiver[];
}

/** Text that goes into the Kod: Latin-1, and nothing Kod strings or format strings would read as their own */
function kodText(s: string, where: string, errs: string[]): void {
  if ([...s].some((ch) => ch.charCodeAt(0) > 255)) errs.push(`${where}: only Latin-1 characters (no curly quotes or emoji)`);
  if (/[\\%]/.test(s)) errs.push(`${where}: no \\ or %`);
}

/** Text that goes only to our client: Latin-1, as the server's own text is */
function clientText(s: string, where: string, errs: string[]): void {
  if ([...s].some((ch) => ch.charCodeAt(0) > 255)) errs.push(`${where}: only Latin-1 characters (no curly quotes or emoji)`);
}

export function checkAll(questFiles: { file: string; data: unknown }[], giversData: unknown, retiredData: unknown, w: World): Checked {
  const errs: string[] = [];

  // ---- the placed givers
  const givers: ResolvedGiver[] = [];
  if (!Array.isArray(giversData)) errs.push("givers.json: a list");
  else
    giversData.forEach((g, i) => {
      const where = `givers.json[${i}]`;
      const shape = checkGiverShape(g, where);
      if (shape.length) return void errs.push(...shape);
      const giver = g as Giver;
      const ridNum = typeof giver.rid === "number" ? giver.rid : w.rids.get(giver.rid);
      if (ridNum === undefined || !w.rooms.has(ridNum)) errs.push(`${where}: no room ${giver.rid}`);
      const lookCls = classOf(w, giver.look);
      const icon = lookCls ? iconOf(w, lookCls) : null;
      if (!lookCls || !isMonster(w, lookCls) || !icon) errs.push(`${where}: look: ${giver.look} isn't a monster or NPC class with a picture`);
      kodText(giver.name, `${where}: name`, errs);
      if (giver.desc) kodText(giver.desc, `${where}: desc`, errs);
      if (givers.some((x) => x.id === giver.id)) errs.push(`${where}: id ${giver.id} is used twice`);
      if (givers.some((x) => x.key === giver.key)) errs.push(`${where}: key ${giver.key} is used twice`);
      givers.push({ ...giver, ridNum: ridNum ?? 0, roomName: (ridNum && w.rooms.get(ridNum)) || "", lookCls: lookCls ?? giver.look, icon: icon ?? "" });
    });

  const npc = (ref: NpcRef, where: string): ResolvedNpc => {
    const named = (ref.rooms ?? []).map((r) => {
      const n = typeof r === "number" ? r : w.rids.get(r);
      if (n === undefined || !w.rooms.has(n)) errs.push(`${where}: no room ${r}`);
      return n ?? 0;
    });
    if ("placed" in ref) {
      const g = givers.find((x) => x.key === ref.placed);
      if (!g) errs.push(`${where}: no placed giver "${ref.placed}" in givers.json`);
      return { cls: null, placed: g?.id ?? 0, name: g?.name ?? ref.placed, rids: g ? [g.ridNum] : named };
    }
    const cls = classOf(w, ref.class);
    if (!cls || !isNpc(w, cls)) errs.push(`${where}: ${ref.class} isn't an NPC class (a Monster with AI_NPC)`);
    return { cls: cls ?? ref.class, placed: 0, name: cls ? nameOf(w, cls) : ref.class, rids: named.length ? named : (cls && w.npcRooms.get(cls)) || [] };
  };

  // ---- retired ids
  const retired = new Set<number>();
  if (!Array.isArray(retiredData) || !retiredData.every((x) => Number.isInteger(x))) errs.push("retired.json: a list of quest ids");
  else for (const x of retiredData as number[]) retired.add(x);

  // ---- the quests
  const quests: ResolvedQuest[] = [];
  for (const { file, data } of questFiles) {
    const shape = checkQuestShape(data, file);
    if (shape.length) {
      errs.push(...shape);
      continue;
    }
    const q = data as Quest;
    if (`${q.key}.json` !== file.replace(/^.*[\\/]/, "")) errs.push(`${file}: key "${q.key}" should be the file's name`);
    if (retired.has(q.id)) errs.push(`${file}: id ${q.id} is retired (retired.json) and can't be used again`);
    const twin = quests.find((x) => x.id === q.id);
    if (twin) errs.push(`${file}: id ${q.id} is also ${twin.key}'s`);
    kodText(q.name, `${file}: name`, errs);
    for (const k of ["offer", "progress", "complete"] as const) if (q.text[k]) clientText(q.text[k], `${file}: text.${k}`, errs);

    const giver = npc(q.giver, `${file}: giver`);
    const itemsOf = (list: { class: string; count?: number; school?: keyof typeof SCHOOLS }[] | undefined, where: string): ResolvedItem[] =>
      (list ?? []).map((it, i) => {
        const cls = classOf(w, it.class);
        if (!cls || !isItem(w, cls)) errs.push(`${where}[${i}]: ${it.class} isn't an item class`);
        const base = cls ? nameOf(w, cls) : it.class;
        const school = it.school ? SCHOOLS[it.school] : null;
        const label = it.school ? `${base} (${it.school === "shalille" ? "Shal'ille" : it.school[0]!.toUpperCase() + it.school.slice(1)})` : base;
        return { cls: cls ?? it.class, name: label, count: it.count ?? 1, stack: cls ? isNumberItem(w, cls) : false, school };
      });
    const rewardsOf = (r: QuestRewards | undefined, where: string): ResolvedRewards => {
      const special: [number, number][] = [];
      const specialText: string[] = [];
      if (r?.joinFaction) {
        special.push([SPECIAL.join, FACTION_NUM[r.joinFaction]]);
        specialText.push(`a place in the service of ${FACTION_NAME[r.joinFaction]}`);
      }
      if (r?.insignia) {
        special.push([SPECIAL.insignia, INSIGNIA[r.insignia]]);
        specialText.push(`the sign of ${r.insignia === "shalille" ? "Shal'ille" : r.insignia[0]!.toUpperCase() + r.insignia.slice(1)} on your guild shield`);
      }
      if (r?.necroGuild) {
        special.push([SPECIAL.necroGuild, 0]);
        specialText.push("the necromancer guild, with you its master");
      }
      return {
        xp: (r?.xp ?? 0) + (r?.xpPoints ? xpForPoints(r.xpPoints, q.band.min) : 0),
        shillings: r?.shillings ?? 0,
        trainingPoints: r?.trainingPoints ?? 0,
        items: itemsOf(r?.items, `${where}.items`),
        oneOf: itemsOf(r?.oneOf, `${where}.oneOf`),
        special,
        specialText,
      };
    };
    const replaces = { template: [] as number[], chains: [] as number[] };
    for (const r of q.replaces ?? []) {
      const n = w.consts.get(r);
      if (n === undefined) errs.push(`${file}: replaces: no ${r} in the Kod's headers`);
      else (r.startsWith("QST_ID_") ? replaces.template : replaces.chains).push(n);
    }
    const steps: ResolvedStep[] = q.steps.map((s, i) => {
      const where = `${file}: step ${i + 1}`;
      const turnin = s.turnin ? npc(s.turnin, `${where}: turnin`) : giver;
      let cls: string | null = null;
      if (s.kind === "kill") {
        cls = classOf(w, s.target!);
        if (!cls || !isMonster(w, cls)) errs.push(`${where}: target: ${s.target} isn't a monster class`);
        else if (isNpc(w, cls)) errs.push(`${where}: target: ${s.target} is an NPC; NPCs can't be killed`);
      }
      if (s.kind === "collect" || ((s.kind === "stash" || s.kind === "buy") && s.item)) {
        cls = classOf(w, s.item!);
        if (!cls || !isItem(w, cls)) errs.push(`${where}: item: ${s.item} isn't an item class`);
      }
      if (s.kind === "cast") {
        cls = classOf(w, s.spell!);
        if (!cls || !isSpell(w, cls)) errs.push(`${where}: spell: ${s.spell} isn't a spell class`);
      }
      let withCls: string | null = null;
      // An arena step is counted by its arena's watcher (QBS_WITH), and its area is the arena
      const arena = s.kind === "arena" && s.arena ? ARENAS[s.arena] : null;
      if (arena) {
        withCls = classOf(w, arena.watcher);
        if (!withCls) errs.push(`${where}: arena: no ${arena.watcher} class`);
      } else if (s.with) {
        withCls = classOf(w, s.with);
        if (!withCls || !isNpc(w, withCls)) errs.push(`${where}: with: ${s.with} isn't an NPC class`);
      }
      const withName = withCls ? nameOf(w, withCls) : null;
      // equip's items, or learn's skills and spells: the step's classes (QuestBook QBS_CLASSES)
      const listed: { name: string; field: "items" | "skills" | "spells" }[] =
        s.kind === "equip"
          ? (s.items ?? []).map((name) => ({ name, field: "items" as const }))
          : s.kind === "learn"
            ? [...(s.skills ?? []).map((name) => ({ name, field: "skills" as const })), ...(s.spells ?? []).map((name) => ({ name, field: "spells" as const }))]
            : [];
      const items = listed.map(({ name, field }) => {
        const c = classOf(w, name);
        const ok = !!c && (field === "skills" ? isSkill(w, c) : field === "spells" ? isSpell(w, c) : isItem(w, c));
        if (!ok) errs.push(`${where}: ${field}: ${name} isn't ${field === "skills" ? "a skill" : field === "spells" ? "a spell" : "an item"} class`);
        return { cls: c ?? name, name: c ? nameOf(w, c) : name };
      });
      // A node step's amount is the node's bit (QuestBook checks the player's GetNodeList)
      const nodeBit = s.kind === "node" && s.node ? w.consts.get(s.node) : undefined;
      if (s.kind === "node" && (nodeBit === undefined || nodeBit <= 0)) errs.push(`${where}: node: no ${s.node} in blakston.khd`);
      const amount =
        s.kind === "attune" ? (s.point ?? 0) : s.kind === "arena" ? (s.win ? 1 : 0) : s.kind === "node" ? (nodeBit ?? 0) : (s.amount ?? (s.kind === "nodes" ? 12 : s.kind === "deposit" ? 1 : 0));
      const ridsOf = (list: (string | number)[] | undefined) =>
        (list ?? []).map((r) => {
          const n = typeof r === "number" ? r : w.rids.get(r);
          if (n === undefined || !w.rooms.has(n)) errs.push(`${where}: no room ${r}`);
          return n ?? 0;
        });
      const rooms = ridsOf(arena ? [arena.room] : s.rooms);
      const exclude = new Set(ridsOf(s.exclude));
      // A kill's area is where its monster spawns (5.1), and a deposit's or a purchase's where its
      // NPC stands, unless the step names it
      const area = (
        rooms.length ? rooms : s.kind === "kill" && cls ? spawnRooms(w, cls, s.exact ?? false) : withCls ? (w.npcRooms.get(withCls) ?? []) : []
      ).filter((r) => !exclude.has(r));
      const clsName = cls ? nameOf(w, cls) : null;
      const count = s.kind === "kill" || s.kind === "collect" ? (s.count ?? 1) : 1;
      const objective =
        s.objective?.trim() ||
        (s.kind === "kill"
          ? `${clsName ?? s.target} slain`
          : s.kind === "collect"
            ? `${clsName ?? s.item} gathered`
            : s.kind === "talk"
              ? `Speak to ${turnin.name}`
              : s.kind === "deliver"
                ? `Take ${s.parcel} to ${turnin.name}`
                : s.kind === "visit"
                  ? `Visit ${rooms.map((r) => w.rooms.get(r) ?? r).join(" or ")}`
                  : s.kind === "cast"
                    ? `Cast ${clsName ?? s.spell}`
                    : s.kind === "deposit"
                      ? `Deposit ${amount > 1 ? `${amount} shillings` : "money"} with ${withName ?? "a banker"}`
                      : s.kind === "stash"
                        ? `Leave ${clsName ? `${clsName} ` : "something "}with ${withName ?? "a vault keeper"}`
                        : s.kind === "buy"
                          ? `Buy ${clsName ?? "something"}${withName ? ` from ${withName}` : ""}`
                          : s.kind === "equip"
                            ? `Use ${items.map((x) => x.name).join(" or ")}`
                            : s.kind === "health"
                              ? `Reach ${amount} health`
                              : s.kind === "hometown"
                                ? "Choose a hometown"
                                : s.kind === "companion"
                                  ? "Take a companion into your service"
                                  : s.kind === "convey"
                                    ? "Send something to your vault"
                                    : s.kind === "learn"
                                      ? `Learn ${items.map((x) => x.name).join(" or ")}`
                                      : s.kind === "attune"
                                        ? "Attune to the portal"
                                        : s.kind === "train"
                                          ? "Spend training points"
                                          : s.kind === "node"
                                            ? "Bond with the mana node"
                                            : s.kind === "claim"
                                              ? "Claim a flagpole for your faction"
                                        : arena
                                          ? `${s.win ? "Win" : "Fight"} a mock bout in ${arena.name}`
                                        : "Bond with every mana node");
      kodText(objective, `${where}: objective`, errs);
      if (s.parcel) kodText(s.parcel, `${where}: parcel`, errs);
      if (s.brief) clientText(s.brief, `${where}: brief`, errs);
      return {
        kind: s.kind,
        cls,
        clsName,
        exact: s.exact ?? false,
        inRooms: s.inRooms ?? false,
        count,
        rooms: s.kind === "visit" || s.inRooms ? rooms : [],
        area,
        objective,
        brief: s.brief ?? "",
        parcel: s.parcel ?? null,
        turnin,
        auto: s.auto ?? ACTION_KINDS.includes(s.kind),
        rewards: rewardsOf(s.rewards, `${where}: rewards`),
        withCls,
        withName,
        amount,
        items,
      };
    });

    quests.push({
      id: q.id,
      key: q.key,
      name: q.name,
      tier: q.tier ?? "story",
      giver,
      replaces,
      band: q.band,
      prereqs: q.requires?.quests ?? [],
      karmaMin: q.requires?.karmaMin ?? null,
      karmaMax: q.requires?.karmaMax ?? null,
      faction: q.requires?.faction ?? null,
      excludes: q.requires?.notQuests ?? [],
      needs: (q.requires?.intriguing ? 1 : 0) | (q.requires?.guildMaster ? 2 : 0) | (q.requires?.guildShield ? 4 : 0) | (q.requires?.noGuild ? 8 : 0) | (q.paused ? 16 : 0) | (q.start === "death" ? 32 : 0),
      healthBelow: q.requires?.healthBelow ?? null,
      cooldownSeconds: q.repeat ? Math.round(q.repeat.cooldownHours * 3600) : null,
      timeLimitSeconds: q.timeLimitMinutes ? q.timeLimitMinutes * 60 : null,
      text: { offer: q.text.offer, progress: q.text.progress ?? "", complete: q.text.complete },
      steps,
      rewards: rewardsOf(q.rewards, `${file}: rewards`),
    });
  }

  // Main (gold) quests are how quests level a character: each gives XP (2026-10-17)
  for (const q of quests)
    if (q.tier === "main" && q.rewards.xp <= 0 && !q.steps.some((s) => s.rewards.xp > 0))
      errs.push(`${q.key}.json: a main quest gives XP (rewards.xpPoints or rewards.xp)`);

  // Prerequisites name quests that exist, and no quest needs itself
  for (const q of quests)
    for (const p of q.prereqs) {
      if (p === q.id) errs.push(`${q.key}.json: requires itself`);
      else if (!quests.some((x) => x.id === p)) errs.push(`${q.key}.json: requires quest ${p}, which isn't there`);
    }
  for (const q of quests)
    for (const p of q.excludes) if (!quests.some((x) => x.id === p)) errs.push(`${q.key}.json: requires.notQuests: quest ${p} isn't there`);

  quests.sort((a, b) => a.id - b.id);
  givers.sort((a, b) => a.id - b.id);
  return { errors: errs, quests, givers };
}

