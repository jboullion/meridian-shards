// Quests as data (docs/adr/0009-quests.md 6): one JSON file per quest in shards-server's
// quests/, the placed quest givers in quests/givers.json, and the ids that may never come back
// in quests/retired.json. The generator (generate.ts) turns them into kod/util/questdefs.kod and
// our client's dist/assets/quests.json.
//
// An NPC is named by its Kod class ({ "class": "TosInnKeeper" }: every NPC of that class) or as
// one of the placed givers ({ "placed": "cellar-warden" }: QuestGiver objects the rooms place).

/**
 * An NPC: a Kod class (any NPC of it or its kinds), or a placed giver. A class NPC's rooms are read
 * from the room Kod that creates it; `rooms` names them when nothing does (the faction leaders
 * and councillors, placed by the parliament).
 */
export type NpcRef = ({ class: string } | { placed: string }) & { rooms?: (string | number)[] };

/** The schools (SS_*), for an item made for one (a disciple robe) */
export const SCHOOLS = { shalille: 1, qor: 2, kraanan: 3, faren: 4, riija: 5, jala: 6 } as const;
export type School = keyof typeof SCHOOLS;

/** Guild shield insignia (INSIG_*) */
export const INSIGNIA = { riija: 1, qor: 2, kraanan: 3, faren: 4, jala: 5, princess: 6, duke: 7, shalille: 8, rebel: 9 } as const;
export type Insignia = keyof typeof INSIGNIA;

export const FACTIONS = ["neutral", "duke", "princess", "rebel", "any"] as const;
export type Faction = (typeof FACTIONS)[number];

/** The arenas with mock bouts (docs/adr/0019-arena-bouts.md): the Watcher class that reports their results, and the room */
export const ARENAS = {
  kraanan: { watcher: "TosWatcher", room: "RID_TOS_ARENA", name: "the Arena of Kraanan" },
  death: { watcher: "DeathArenaWatcher", room: "RID_TOS_DEATH_ARENA", name: "the Arena of Death" },
} as const;
export type ArenaName = keyof typeof ARENAS;

export const STEP_KINDS = ["kill", "collect", "talk", "deliver", "visit", "cast", "deposit", "stash", "buy", "equip", "health", "hometown", "nodes", "companion", "convey", "learn", "attune", "arena", "train", "node", "claim"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Steps that happen by doing something, once (the guide chains' kinds): done by themselves unless `auto` is false */
export const ACTION_KINDS: readonly StepKind[] = ["cast", "deposit", "stash", "buy", "equip", "health", "hometown", "nodes", "companion", "convey", "learn", "attune", "arena", "train", "node", "claim"];

/** How a quest's markers look: gold for the main and levelling chains, silver for story quests, bronze for errands */
export const TIERS = ["main", "story", "errand"] as const;
export type Tier = (typeof TIERS)[number];

/**
 * A step. kill, collect and visit count up in the world; once done, the step is handed in at
 * `turnin` (default: the quest's giver), or with `auto` it's done there and then. talk is only
 * the hand-in; deliver gives a parcel at the start of the step and takes it back at the hand-in.
 * The action kinds happen once: cast a spell, deposit shillings with a banker, stash an item with
 * a vault keeper, buy from someone, equip one of some items, reach a health, choose a hometown,
 * bond with every mana node, have a companion (docs/adr/0010-followers.md), learn a skill (one of
 * `skills`, or done at once if we know them all), attune to a portal (`point`, docs/adr/0011; a
 * quest that starts with one isn't offered once we're attuned), fight a mock bout in an arena
 * (`arena`; with `win`, only a bout won: docs/adr/0019-arena-bouts.md).
 */
export interface QuestStep {
  kind: StepKind;
  /** Done as soon as it's counted, with no hand-in (default: true for the action kinds, false otherwise) */
  auto?: boolean;
  /** Given when this step is done, besides the quest's rewards at the end */
  rewards?: QuestRewards;
  /** cast: the spell class (its kinds count too) */
  spell?: string;
  /** deposit, stash, buy: the NPC class it's done with (any of its kinds); left out, anyone */
  with?: string;
  /** deposit: the least shillings; health: the base health to reach; nodes: how many (default 12) */
  amount?: number;
  /** equip: any one of these item classes */
  items?: string[];
  /** learn: skill classes; learning any one counts, and knowing them all already does too */
  skills?: string[];
  /** learn: spell classes, the same way (Minor Heal at the Temple of Shal'ille) */
  spells?: string[];
  /** attune: the travel point (util/travelnet.kod GetPoints id) */
  point?: number;
  /** node: the mana node, by its NODE_ constant (blakston.khd: "NODE_A5"); done once bonded */
  node?: string;
  /** arena: whose mock bouts count (the Arena of Kraanan's melee, the Arena of Death's duel) */
  arena?: ArenaName;
  /** arena: only a bout won counts */
  win?: boolean;
  /** The tracker's line ("Rats slain"); made up from the step when left out */
  objective?: string;
  /** What the giver says as the step begins (the offer window, the log); the quest's offer for the first */
  brief?: string;
  /** kill: the monster class (its subclasses count too, unless `exact`) */
  target?: string;
  exact?: boolean;
  /** kill: only kills in `rooms` count (a region's own: the bone faction's chieftains) */
  inRooms?: boolean;
  /** collect: the item class. stash, buy: the item (left out, anything) */
  item?: string;
  /** kill, collect: how many (default 1) */
  count?: number;
  /**
   * visit: the rooms, as RID_ names or numbers; any one of them. kill, collect: where to do it
   * (docs/adr/0009-quests.md 5), when the rooms the monster spawns in (a kill's area, worked out by
   * the generator) aren't right; never guessed for a collect
   */
  rooms?: (string | number)[];
  /** kill: rooms to leave out of the area worked out from the spawn lists */
  exclude?: (string | number)[];
  /** deliver: what the parcel is called ("a sealed letter") */
  parcel?: string;
  /** Who it's handed in to; default the quest's giver. talk and deliver: who to go to */
  turnin?: NpcRef;
}

export interface QuestRewards {
  xp?: number;
  /**
   * More XP, worth this many points of health to a player at the quest's band minimum
   * (tools/quests/xp.ts): it scales with the quest's level. Added to `xp`.
   */
  xpPoints?: number;
  shillings?: number;
  trainingPoints?: number;
  /** `school`: the item is made for that school (a disciple robe) */
  items?: { class: string; count?: number; school?: School }[];
  /** One of these, at random (the old QuestEngine's prize lists) */
  oneOf?: { class: string; count?: number; school?: School }[];
  /** The player joins this faction (leaving any other) */
  joinFaction?: "duke" | "princess" | "rebel";
  /** The player's guild shield is embossed with this sign */
  insignia?: Insignia;
  /** The necromancer guild is established, with the player its master (the Lich in the Inner Sanctum) */
  necroGuild?: boolean;
  /** Renown with the player's faction, 1 to 100 (the faction revamp; nothing for a neutral) */
  renown?: number;
}

export interface Quest {
  /** Never changes and is never reused (retired.json) */
  id: number;
  /** The file's name, quests/<key>.json */
  key: string;
  name: string;
  /** The markers' colour (default story) */
  tier?: Tier;
  giver: NpcRef;
  /**
   * What it replaces from before (docs/adr/0009-quests.md 7.3): old QuestEngine templates' QST_ID_
   * names, and the guide chain (HP*_CHAIN) it ports. A player who finished one has this done
   */
  replaces?: string[];
  /** The health band: the least, and the most it's suggested for */
  band: { min: number; max: number };
  /** faction: the player's ("any" is any but neutral) */
  requires?: {
    quests?: number[];
    /** Not offered once any of these is done or going (the same errand from another giver) */
    notQuests?: number[];
    /**
     * Offered only while the player's base health is under this (Raza's repeatable hunts, until
     * the road to Marion at 30). The band's max is only a suggestion; this is a rule
     */
    healthBelow?: number;
    karmaMin?: number | null;
    karmaMax?: number | null;
    faction?: Faction;
    /** At least this much renown with the player's faction, 1 to 100 (the faction revamp); never a neutral */
    renown?: number;
    /** Of interest to the royal court (Player.PlayerIsIntriguing): may join a faction */
    intriguing?: boolean;
    /** The master of a guild with colours */
    guildMaster?: boolean;
    /** Carries a guild shield */
    guildShield?: boolean;
    /** In no guild (raising the necromancer guild makes the player its master) */
    noGuild?: boolean;
  };
  /** null: once. Else again after the cooldown */
  repeat?: { cooldownHours: number } | null;
  /**
   * Not offered for now (QuestBook's QBQ_PAUSED need), without retiring it: a player who has it
   * going can still finish it, and taking the flag off brings it back (the Road through Meridian,
   * paused 2026-10-18 to be broken into smaller quests)
   */
  paused?: boolean;
  /**
   * "death": never offered by its giver; it starts by itself when a player dies for real and may
   * take it (QuestBook's QBQ_ON_DEATH need, PlayerDied: the Underworld's node)
   */
  start?: "death";
  timeLimitMinutes?: number | null;
  text: { offer: string; progress?: string; complete: string };
  steps: QuestStep[];
  rewards: QuestRewards;
}

/** A quest giver the rooms place (QuestGiver), from quests/givers.json */
export interface Giver {
  /** Quests name it with { "placed": key } */
  key: string;
  /** Never changes: QuestGiver objects keep it */
  id: number;
  name: string;
  /** The NPC class whose picture it borrows */
  look: string;
  /** The room: an RID_ name or its number */
  rid: string | number;
  row: number;
  col: number;
  fineRow?: number;
  fineCol?: number;
  /** ANGLE_ name */
  angle: string;
  desc?: string;
  /** Ours (docs/adr/0012-cosmetics.md): it also cuts hair or dyes clothes (util/cosmeticsbook.kod) */
  service?: GiverService;
}

export const ANGLES = [
  "ANGLE_EAST",
  "ANGLE_NORTH_EAST",
  "ANGLE_NORTH",
  "ANGLE_NORTH_WEST",
  "ANGLE_WEST",
  "ANGLE_SOUTH_WEST",
  "ANGLE_SOUTH",
  "ANGLE_SOUTH_EAST",
] as const;

// Kod's integers are 28-bit and signed
export const KOD_INT_MAX = 2 ** 27 - 1;

/** The most quests a player has going at once (QuestBook's MAX_ACTIVE) */
export const MAX_ACTIVE = 10;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0, max = KOD_INT_MAX): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function npcRef(v: unknown, where: string, errs: string[]): void {
  if (!isObj(v)) return void errs.push(`${where}: { "class": ... } or { "placed": ... }`);
  const keys = Object.keys(v).filter((k) => k !== "rooms");
  if (keys.length !== 1 || !(keys[0] === "class" || keys[0] === "placed") || !isText(v[keys[0]]))
    errs.push(`${where}: { "class": "<Kod class>" } or { "placed": "<giver key>" }`);
  if (v.rooms !== undefined && (!Array.isArray(v.rooms) || !v.rooms.every((r) => isText(r) || isInt(r, 1)))) errs.push(`${where}: rooms: RID_ names or numbers`);
}

/** The shape of one quest; names that must exist in the Kod are checked later (validate.ts) */
export function checkQuestShape(q: unknown, where: string): string[] {
  const errs: string[] = [];
  if (!isObj(q)) return [`${where}: not an object`];
  if (!isInt(q.id, 1)) errs.push(`${where}: id: a whole number from 1`);
  if (typeof q.key !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(q.key)) errs.push(`${where}: key: lower-case letters, digits and dashes`);
  if (!isText(q.name)) errs.push(`${where}: name`);
  if (q.tier !== undefined && !TIERS.includes(q.tier as Tier)) errs.push(`${where}: tier: one of ${TIERS.join(", ")}`);
  if (q.replaces !== undefined && (!Array.isArray(q.replaces) || !q.replaces.every((r) => typeof r === "string" && /^(QST_ID_\w+|HP\d+_\w+_CHAIN)$/.test(r))))
    errs.push(`${where}: replaces: QST_ID_ or HP*_CHAIN names`);
  npcRef(q.giver, `${where}: giver`, errs);
  if (!isObj(q.band) || !isInt(q.band.min, 0, 10000) || !isInt(q.band.max, 0, 10000) || q.band.max < q.band.min)
    errs.push(`${where}: band: { min, max } with max >= min`);
  if (q.requires !== undefined && q.requires !== null) {
    const r = q.requires;
    if (!isObj(r)) errs.push(`${where}: requires: an object`);
    else {
      if (r.quests !== undefined && (!Array.isArray(r.quests) || !r.quests.every((x) => isInt(x, 1)))) errs.push(`${where}: requires.quests: quest ids`);
      for (const k of ["karmaMin", "karmaMax"] as const)
        if (r[k] !== undefined && r[k] !== null && !isInt(r[k], -100, 100)) errs.push(`${where}: requires.${k}: -100 to 100`);
      if (r.faction !== undefined && !FACTIONS.includes(r.faction as Faction)) errs.push(`${where}: requires.faction: one of ${FACTIONS.join(", ")}`);
      if (r.renown !== undefined && !isInt(r.renown, 1, 100)) errs.push(`${where}: requires.renown: 1 to 100`);
      if (r.renown !== undefined && r.faction === "neutral") errs.push(`${where}: requires.renown: a neutral has no renown`);
      if (r.notQuests !== undefined && (!Array.isArray(r.notQuests) || !r.notQuests.every((x) => Number.isInteger(x)))) errs.push(`${where}: requires.notQuests: quest ids`);
      if (r.healthBelow !== undefined && (!isInt(r.healthBelow, 1, 10000) || (isObj(q.band) && isInt(q.band.min) && r.healthBelow <= q.band.min)))
        errs.push(`${where}: requires.healthBelow: a health above the band's min`);
      for (const k of ["intriguing", "guildMaster", "guildShield", "noGuild"] as const) if (r[k] !== undefined && typeof r[k] !== "boolean") errs.push(`${where}: requires.${k}: true or false`);
    }
  }
  if (q.repeat !== undefined && q.repeat !== null && (!isObj(q.repeat) || typeof q.repeat.cooldownHours !== "number" || q.repeat.cooldownHours < 0 || q.repeat.cooldownHours > 24 * 365))
    errs.push(`${where}: repeat: null, or { cooldownHours }`);
  if (q.paused !== undefined && typeof q.paused !== "boolean") errs.push(`${where}: paused: true or false`);
  if (q.start !== undefined && q.start !== "death") errs.push(`${where}: start: "death", or left out`);
  if (q.timeLimitMinutes !== undefined && q.timeLimitMinutes !== null && !isInt(q.timeLimitMinutes, 1, 60 * 24 * 30))
    errs.push(`${where}: timeLimitMinutes: null, or minutes`);
  if (!isObj(q.text) || !isText(q.text.offer) || !isText(q.text.complete) || (q.text.progress !== undefined && typeof q.text.progress !== "string"))
    errs.push(`${where}: text: { offer, progress?, complete }`);
  if (!Array.isArray(q.steps) || q.steps.length === 0 || q.steps.length > 20) errs.push(`${where}: steps: 1 to 20 of them`);
  else q.steps.forEach((s, i) => errs.push(...checkStepShape(s, `${where}: step ${i + 1}`)));
  if (!isObj(q.rewards)) errs.push(`${where}: rewards: an object ({} for none)`);
  else errs.push(...checkRewards(q.rewards, `${where}: rewards`));
  return errs;
}

function checkRewards(r: Record<string, unknown>, where: string): string[] {
  const errs: string[] = [];
  for (const k of ["xp", "shillings", "trainingPoints"] as const) if (r[k] !== undefined && !isInt(r[k], 0, 10_000_000)) errs.push(`${where}.${k}`);
  if (r.xpPoints !== undefined && !(typeof r.xpPoints === "number" && r.xpPoints > 0 && r.xpPoints <= 20)) errs.push(`${where}.xpPoints: a number above 0, at most 20`);
  for (const k of ["items", "oneOf"] as const)
    if (
      r[k] !== undefined &&
      (!Array.isArray(r[k]) ||
        !(r[k] as unknown[]).every((x) => isObj(x) && isText(x.class) && (x.count === undefined || isInt(x.count, 1, 10000)) && (x.school === undefined || (x.school as string) in SCHOOLS)))
    )
      errs.push(`${where}.${k}: [{ class, count?, school? }]`);
  if (r.joinFaction !== undefined && !["duke", "princess", "rebel"].includes(r.joinFaction as string)) errs.push(`${where}.joinFaction: duke, princess or rebel`);
  if (r.insignia !== undefined && !((r.insignia as string) in INSIGNIA)) errs.push(`${where}.insignia: one of ${Object.keys(INSIGNIA).join(", ")}`);
  if (r.necroGuild !== undefined && typeof r.necroGuild !== "boolean") errs.push(`${where}.necroGuild: true or false`);
  if (r.renown !== undefined && !isInt(r.renown, 1, 100)) errs.push(`${where}.renown: 1 to 100`);
  return errs;
}

function checkStepShape(s: unknown, where: string): string[] {
  const errs: string[] = [];
  if (!isObj(s)) return [`${where}: not an object`];
  if (!STEP_KINDS.includes(s.kind as StepKind)) return [`${where}: kind: one of ${STEP_KINDS.join(", ")}`];
  if (s.objective !== undefined && typeof s.objective !== "string") errs.push(`${where}: objective: text`);
  if (s.brief !== undefined && typeof s.brief !== "string") errs.push(`${where}: brief: text`);
  if (s.auto !== undefined && typeof s.auto !== "boolean") errs.push(`${where}: auto: true or false`);
  if (s.auto === true && (s.kind === "talk" || s.kind === "deliver")) errs.push(`${where}: auto: a ${s.kind} step is the hand-in itself`);
  if (s.rewards !== undefined) {
    if (!isObj(s.rewards)) errs.push(`${where}: rewards: an object`);
    else errs.push(...checkRewards(s.rewards, `${where}: rewards`));
  }
  if (s.with !== undefined && !isText(s.with)) errs.push(`${where}: with: an NPC class`);
  if (s.amount !== undefined && !isInt(s.amount, 1, 10_000_000)) errs.push(`${where}: amount: a whole number from 1`);
  if (s.count !== undefined && !isInt(s.count, 1, 1000)) errs.push(`${where}: count: 1 to 1000`);
  if (s.turnin !== undefined) npcRef(s.turnin, `${where}: turnin`, errs);
  for (const k of ["rooms", "exclude"] as const)
    if (s[k] !== undefined && (!Array.isArray(s[k]) || !(s[k] as unknown[]).every((r) => isText(r) || isInt(r, 1)))) errs.push(`${where}: ${k}: RID_ names or numbers`);
  switch (s.kind) {
    case "kill":
      if (!isText(s.target)) errs.push(`${where}: target: the monster's class`);
      if (s.exact !== undefined && typeof s.exact !== "boolean") errs.push(`${where}: exact: true or false`);
      if (s.inRooms !== undefined && typeof s.inRooms !== "boolean") errs.push(`${where}: inRooms: true or false`);
      if (s.inRooms && (s.kind !== "kill" || !Array.isArray(s.rooms) || !s.rooms.length)) errs.push(`${where}: inRooms: a kill step with rooms`);
      break;
    case "collect":
      if (!isText(s.item)) errs.push(`${where}: item: the item's class`);
      break;
    case "talk":
      if (s.turnin === undefined) errs.push(`${where}: turnin: who to talk to`);
      break;
    case "deliver":
      if (!isText(s.parcel)) errs.push(`${where}: parcel: what it's called`);
      if (s.turnin === undefined) errs.push(`${where}: turnin: who it goes to`);
      break;
    case "visit":
      if (!Array.isArray(s.rooms) || s.rooms.length === 0 || !s.rooms.every((r) => isText(r) || isInt(r, 1)))
        errs.push(`${where}: rooms: RID_ names or numbers`);
      break;
    case "cast":
      if (!isText(s.spell)) errs.push(`${where}: spell: the spell's class`);
      break;
    case "deposit":
    case "stash":
      if (!isText(s.with)) errs.push(`${where}: with: the banker's or vault keeper's class`);
      break;
    case "equip":
      if (!Array.isArray(s.items) || !s.items.length || !s.items.every(isText)) errs.push(`${where}: items: item classes, any one of them`);
      break;
    case "learn": {
      const lists = [s.skills, s.spells].filter((l) => l !== undefined);
      if (!lists.length || !lists.every((l) => Array.isArray(l) && l.every(isText)) || !lists.some((l) => (l as unknown[]).length))
        errs.push(`${where}: skills, spells: skill or spell classes, any one of them`);
      break;
    }
    case "attune":
      if (!isInt(s.point, 1)) errs.push(`${where}: point: a travel point's id`);
      break;
    case "node":
      if (typeof s.node !== "string" || !/^NODE_\w+$/.test(s.node)) errs.push(`${where}: node: a NODE_ constant`);
      break;
    case "health":
      if (s.amount === undefined) errs.push(`${where}: amount: the health to reach`);
      break;
    case "arena":
      if (typeof s.arena !== "string" || !Object.hasOwn(ARENAS, s.arena)) errs.push(`${where}: arena: ${Object.keys(ARENAS).join(" or ")}`);
      if (s.win !== undefined && typeof s.win !== "boolean") errs.push(`${where}: win: true or false`);
      if (s.with !== undefined) errs.push(`${where}: with: an arena step is counted by its arena's watcher`);
      break;
  }
  return errs;
}

export function checkGiverShape(g: unknown, where: string): string[] {
  const errs: string[] = [];
  if (!isObj(g)) return [`${where}: not an object`];
  if (typeof g.key !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(g.key)) errs.push(`${where}: key: lower-case letters, digits and dashes`);
  if (!isInt(g.id, 1)) errs.push(`${where}: id: a whole number from 1`);
  if (!isText(g.name)) errs.push(`${where}: name`);
  if (!isText(g.look)) errs.push(`${where}: look: the NPC class whose picture it borrows`);
  if (!(isText(g.rid) || isInt(g.rid, 1))) errs.push(`${where}: rid: an RID_ name or number`);
  if (!isInt(g.row, 1, 1000) || !isInt(g.col, 1, 1000)) errs.push(`${where}: row, col`);
  for (const k of ["fineRow", "fineCol"] as const) if (g[k] !== undefined && !isInt(g[k], 0, 63)) errs.push(`${where}: ${k}: 0 to 63`);
  if (!ANGLES.includes(g.angle as (typeof ANGLES)[number])) errs.push(`${where}: angle: one of ${ANGLES.join(", ")}`);
  if (g.desc !== undefined && typeof g.desc !== "string") errs.push(`${where}: desc: text`);
  if (g.service !== undefined && !GIVER_SERVICES.includes(g.service as GiverService)) errs.push(`${where}: service: one of ${GIVER_SERVICES.join(", ")}`);
  return errs;
}

/** What a placed giver can do besides quests (blakston.khd SERVICE_*: tailor 1, barber 2) */
export const GIVER_SERVICES = ["tailor", "barber"] as const;
export type GiverService = (typeof GIVER_SERVICES)[number];
export const SERVICE_NUM: Record<GiverService, number> = { tailor: 1, barber: 2 };
