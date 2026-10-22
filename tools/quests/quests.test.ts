import { describe, expect, it } from "vitest";
import { generateFrom, type QuestSources } from "./generate.ts";
import { worldFrom } from "./world.ts";

const kod = (path: string, text: string) => ({ path, text });

// A small world: a monster tree, an NPC, items, two rooms
const WORLD = worldFrom(
  [
    kod("monster.kod", "Monster is Battler\nclassvars:\n   vrName = monster_name\nresources:\n   monster_name = \"monster\"\n"),
    kod("towns.kod", "Towns is Monster\nclassvars:\n   viDefault_behavior = AI_NPC | AI_NOMOVE\n"),
    kod(
      "tsinnk.kod",
      "TosInnKeeper is Towns\nresources:\n   tosinnkeeper_name_rsc = \"Paddock\"\n   tosinnkeeper_icon_rsc = tsinnk.bgf\nclassvars:\n   vrName = tosinnkeeper_name_rsc\n   vrIcon = tosinnkeeper_icon_rsc\n",
    ),
    kod("giarat.kod", "GiantRat is Monster\nresources:\n   giantrat_name = \"giant rat\"\n   giantrat_icon = rat.bgf\nclassvars:\n   vrName = giantrat_name\n   vrIcon = giantrat_icon\n"),
    kod("giaratsm.kod", "SmallRat is GiantRat\nresources:\n   smallrat_name = \"small rat\"\nclassvars:\n   vrName = smallrat_name\n"),
    kod("item.kod", "Item is PassiveObject\n"),
    kod("numbitem.kod", "NumberItem is Item\n"),
    kod("orctooth.kod", "OrcTooth is NumberItem\nresources:\n   orctooth_name = \"orc tooth\"\nclassvars:\n   vrName = orctooth_name\n"),
    kod(
      "tosinn.kod",
      "TosInn is Room\nresources:\n   room_name_tosinn = \"Familiars\"\n   room_tosinn = tosinn.roo\nclassvars:\n   vrName = room_name_tosinn\nproperties:\n   prRoom = room_tosinn\n   piRoom_num = RID_TOS_INN\nmessages:\n   CreateStandardObjects()\n   {\n      Send(self,@NewHold,#what=Create(&TosInnKeeper),#new_row=7,#new_col=9);\n   }\n",
    ),
    kod(
      "toscellar.kod",
      "TosInnCellar is Room\nresources:\n   room_name_cellar = \"The Cellar\"\n   room_cellar = toscellar.roo\nclassvars:\n   vrName = room_name_cellar\nproperties:\n   prRoom = room_cellar\n   piRoom_num = RID_TOS_INN_CELLAR\nmessages:\n   Constructed()\n   {\n      plMonsters = [ [&SmallRat, 100] ];\n   }\n",
    ),
    // The rat cave inherits its parent's spawn list, and makes a boss
    kod("ratden.kod", "RatDen is Room\nproperties:\n   piRoom_num = RID_RAT_DEN\nmessages:\n   Constructed()\n   {\n      plMonsters = [ [&GiantRat, 50], [&SmallRat, 100] ];\n   }\n"),
    kod(
      "ratcave.kod",
      "RatCave is RatDen\nresources:\n   room_name_ratcave = \"Rat Cave\"\n   room_ratcave = ratcave.roo\nclassvars:\n   vrName = room_name_ratcave\nproperties:\n   prRoom = room_ratcave\n   piRoom_num = RID_RAT_CAVE\nmessages:\n   CreateStandardObjects()\n   {\n      Send(self,@NewHold,#what=Create(&RatKing));\n   }\n",
    ),
    kod("ratking.kod", "RatKing is GiantRat\n"),
    kod("spell.kod", "Spell is PassiveObject\n"),
    kod("phase.kod", "Phase is Spell\nresources:\n   phase_name_rsc = \"phase\"\nclassvars:\n   vrName = phase_name_rsc\n"),
    kod("skill.kod", "Skill is PassiveObject\n"),
    kod("block.kod", "Block is Skill\nresources:\n   block_name_rsc = \"block\"\nclassvars:\n   vrName = block_name_rsc\n"),
    // The arenas and their watchers, for the arena kind
    kod("watcher.kod", "Watcher is Towns\n"),
    kod("tswatch.kod", "TosWatcher is Watcher\n"),
    kod("darenawatcher.kod", "DeathArenaWatcher is Watcher\n"),
    kod("tosarena.kod", "TosArena is Room\nresources:\n   room_name_tosarena = \"The Arena of Kraanan\"\n   room_tosarena = tosarena.roo\nclassvars:\n   vrName = room_name_tosarena\nproperties:\n   prRoom = room_tosarena\n   piRoom_num = RID_TOS_ARENA\n"),
    kod("tosdeatharena.kod", "TosDeathArena is Room\nresources:\n   room_name_tosdeath = \"The Arena of Death\"\n   room_tosdeath = tosarena_death.roo\nclassvars:\n   vrName = room_name_tosdeath\nproperties:\n   prRoom = room_tosdeath\n   piRoom_num = RID_TOS_DEATH_ARENA\n"),
  ],
  "   RID_TOS_INN = 52\n   RID_TOS_INN_CELLAR = 53\n   RID_RAT_CAVE = 60\n   RID_TOS_ARENA = 70\n   RID_TOS_DEATH_ARENA = 79\n   QST_ID_FAMS_RATS = 76\n   HP20_RAZA_CHAIN = 0\n",
);

const RATS = {
  id: 1,
  key: "cellar-rats",
  name: "Rats in the Cellar",
  giver: { class: "TosInnKeeper" },
  band: { min: 0, max: 40 },
  text: { offer: "Rats, everywhere.", complete: "Thanks!" },
  steps: [
    { kind: "kill", target: "SmallRat", count: 20 },
    { kind: "collect", item: "orctooth", count: 5, objective: "Orc teeth" },
    { kind: "visit", rooms: ["RID_TOS_INN_CELLAR"] },
    { kind: "deliver", parcel: "a sealed letter", turnin: { placed: "warden" } },
  ],
  rewards: { xp: 300, shillings: 50, items: [{ class: "OrcTooth", count: 2 }] },
};

const WARDEN = { key: "warden", id: 3, name: "Warden Hobb", look: "TosInnKeeper", rid: "RID_TOS_INN_CELLAR", row: 4, col: 5, angle: "ANGLE_WEST" };

const sources = (quests: unknown[], givers: unknown[] = [WARDEN], retired: unknown = []): QuestSources => ({
  questFiles: quests.map((data) => ({ file: `${(data as { key: string }).key}.json`, data })),
  givers,
  retired,
  errors: [],
});

describe("the quest generator", () => {
  it("resolves names, rooms and objectives", () => {
    const g = generateFrom(sources([RATS]), WORLD);
    expect(g.errors).toEqual([]);
    const q = g.quests[0]!;
    expect(q.giver).toMatchObject({ cls: "TosInnKeeper", placed: 0, name: "Paddock", rids: [52] });
    expect(q.steps.map((s) => s.objective)).toEqual(["small rat slain", "Orc teeth", "Visit The Cellar", "Take a sealed letter to Warden Hobb"]);
    // Kod ignores case; the class is written as declared
    expect(q.steps[1]!.cls).toBe("OrcTooth");
    expect(q.steps[2]!.rooms).toEqual([53]);
    expect(q.steps[3]!.turnin).toMatchObject({ cls: null, placed: 3, rids: [53] });
    expect(q.rewards.items).toEqual([{ cls: "OrcTooth", name: "orc tooth", count: 2, stack: true, school: null }]);
  });

  it("works out a kill's area from the spawn lists and the bosses rooms make", () => {
    const q = {
      ...RATS,
      steps: [
        { kind: "kill", target: "SmallRat" },
        { kind: "kill", target: "GiantRat" },
        { kind: "kill", target: "GiantRat", exact: true },
        { kind: "kill", target: "RatKing" },
        { kind: "kill", target: "GiantRat", exclude: ["RID_RAT_CAVE"] },
        { kind: "kill", target: "SmallRat", rooms: [60] },
        { kind: "collect", item: "OrcTooth" },
      ],
    };
    const g = generateFrom(sources([q]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.catalog.quests[0]!.steps.map((s) => s.rooms.map((r) => r.rid))).toEqual([[53, 60], [53, 60], [60], [60], [53], [60], []]);
    // The server needs no area: only a visit's rooms go into the Kod
    expect(g.kod).toContain("[ 1, &SmallRat, 1, 0, &TosInnKeeper, 0, qd_1_s1, $, $, qd_1_t1,\r\n               0, $, $, $, 0 ]");
  });

  it("writes QuestDefs' tables for QuestBook", () => {
    const { kod } = generateFrom(sources([RATS]), WORLD);
    expect(kod).toContain("QuestDefs is UtilityFunctions");
    expect(kod).toContain("[ 1, qd_1_name, &TosInnKeeper, 0, 0, 40, $,");
    expect(kod).toContain("[ 1, &SmallRat, 20, 0, &TosInnKeeper, 0, qd_1_s1, $, $, qd_1_t1,\r\n               0, $, $, $, 0 ]");
    expect(kod).toContain("[ 5, $, 1, 0, &TosInnKeeper, 0, qd_1_s3, [ 53 ], $, qd_1_t3,\r\n               0, $, $, $, 0 ]");
    expect(kod).toContain("[ 4, $, 1, 0, $, 3, qd_1_s4, $, qd_1_p4, qd_1_t4,\r\n               0, $, $, $, 0 ]");
    expect(kod).toContain("300, 50, [ [ &OrcTooth, 2 ] ], 0, 2, $, $, 0, $, $, $, $ ]");
    expect(kod).toContain("[ 3, qg_3_name, qg_3_icon, qg_3_desc, 53, 4, 5, 32, 32, ANGLE_WEST, 0 ]");
    expect(kod).toContain("   qg_3_icon = tsinnk.bgf");
    expect(kod).toContain('   qd_1_p4 = "a sealed letter"');
    expect(kod).not.toMatch(/[^\r]\n/);
  });

  it("writes the guide chains' kinds, auto steps, step rewards, tiers and what a quest replaces", () => {
    const q = {
      ...RATS,
      tier: "main",
      replaces: ["QST_ID_FAMS_RATS", "HP20_RAZA_CHAIN"],
      steps: [
        { kind: "cast", spell: "Phase", rewards: { xp: 150 } },
        { kind: "deposit", with: "TosInnKeeper", amount: 5 },
        { kind: "buy", with: "TosInnKeeper", item: "OrcTooth" },
        { kind: "equip", items: ["OrcTooth"], auto: false },
        { kind: "health", amount: 100 },
        { kind: "nodes" },
        { kind: "visit", rooms: [53], auto: true, rewards: { trainingPoints: 600, shillings: 10, items: [{ class: "OrcTooth" }] } },
      ],
      rewards: { trainingPoints: 1000 },
    };
    const g = generateFrom(sources([q]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("[ 6, &Phase, 1, 0, &TosInnKeeper, 0, qd_1_s1, $, $, qd_1_t1,\r\n               1, [ 150, 0, 0, $, $, $ ], $, $, 0 ]");
    expect(g.kod).toContain("[ 7, $, 1, 0, &TosInnKeeper, 0, qd_1_s2, $, $, qd_1_t2,\r\n               1, $, &TosInnKeeper, $, 5 ]");
    expect(g.kod).toContain("[ 9, &OrcTooth, 1, 0, &TosInnKeeper, 0, qd_1_s3, $, $, qd_1_t3,\r\n               1, $, &TosInnKeeper, $, 0 ]");
    expect(g.kod).toContain("[ 10, $, 1, 0, &TosInnKeeper, 0, qd_1_s4, $, $, qd_1_t4,\r\n               0, $, $, [ &OrcTooth ], 0 ]");
    expect(g.kod).toContain("[ 13, $, 1, 0, &TosInnKeeper, 0, qd_1_s6, $, $, qd_1_t6,\r\n               1, $, $, $, 12 ]");
    expect(g.kod).toContain("1, [ 0, 10, 600, [ [ &OrcTooth, 1 ] ], $, $ ], $, $, 0 ]");
    expect(g.kod).toContain("0, 0, $, 1000, 1, $, $, 0, $, $, $, $ ]");
    expect(g.kod).toContain("[ 1, 76, 1 ],\r\n            [ 2, 0, 1 ]");
    const steps = g.catalog.quests[0]!.steps;
    expect(steps.map((s) => s.objective)).toEqual([
      "Cast phase",
      "Deposit 5 shillings with Paddock",
      "Buy orc tooth from Paddock",
      "Use orc tooth",
      "Reach 100 health",
      "Bond with every mana node",
      "Visit The Cellar",
    ]);
    // A deposit or purchase is done where its NPC stands
    expect(steps[1]!.rooms.map((r) => r.rid)).toEqual([52]);
    expect(g.catalog.quests[0]).toMatchObject({ tier: "main", rewards: { trainingPoints: 1000 } });
  });

  it("writes the convey kind (sending a stack to the vault, docs/adr/0016-abilities.md)", () => {
    const g = generateFrom(sources([{ ...RATS, steps: [{ kind: "convey" }] }]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("[ 15, $, 1, 0, &TosInnKeeper, 0, qd_1_s1, $, $, qd_1_t1,\r\n               1, $, $, $, 0 ]");
    expect(g.catalog.quests[0]!.steps[0]!.objective).toBe("Send something to your vault");
  });

  it("writes the learn and attune kinds: the skills as the step's classes, the travel point as its amount", () => {
    const w = WORLD;
    const g = generateFrom(sources([{ ...RATS, steps: [{ kind: "learn", skills: ["Block"] }, { kind: "attune", point: 3 }] }]), w);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("[ 16, $, 1, 0, &TosInnKeeper, 0, qd_1_s1, $, $, qd_1_t1,\r\n               1, $, $, [ &Block ], 0 ]");
    expect(g.kod).toContain("[ 17, $, 1, 0, &TosInnKeeper, 0, qd_1_s2, $, $, qd_1_t2,\r\n               1, $, $, $, 3 ]");
    expect(g.catalog.quests[0]!.steps.map((s) => s.objective)).toEqual(["Learn block", "Attune to the portal"]);
    expect(generateFrom(sources([{ ...RATS, steps: [{ kind: "learn", skills: ["OrcTooth"] }] }]), w).errors.join()).toMatch(/OrcTooth isn't a skill class/);
  });

  it("writes a learn step's spells with its skills, as the step's classes", () => {
    const g = generateFrom(sources([{ ...RATS, steps: [{ kind: "learn", spells: ["Phase"] }, { kind: "learn", skills: ["Block"], spells: ["Phase"] }] }]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("[ 16, $, 1, 0, &TosInnKeeper, 0, qd_1_s1, $, $, qd_1_t1,\r\n               1, $, $, [ &Phase ], 0 ]");
    expect(g.kod).toContain("[ 16, $, 1, 0, &TosInnKeeper, 0, qd_1_s2, $, $, qd_1_t2,\r\n               1, $, $, [ &Block, &Phase ], 0 ]");
    expect(g.catalog.quests[0]!.steps.map((s) => s.objective)).toEqual(["Learn phase", "Learn block or phase"]);
    expect(generateFrom(sources([{ ...RATS, steps: [{ kind: "learn", spells: ["Block"] }] }]), WORLD).errors.join()).toMatch(/spells: Block isn't a spell class/);
    expect(generateFrom(sources([{ ...RATS, steps: [{ kind: "learn", spells: [] }] }]), WORLD).errors.join()).toMatch(/skills, spells/);
  });

  it("writes the train kind (spending training points, ShardsAbilities.Train)", () => {
    const g = generateFrom(sources([{ ...RATS, steps: [{ kind: "train" }] }]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("[ 19, $, 1, 0, &TosInnKeeper, 0, qd_1_s1, $, $, qd_1_t1,\r\n               1, $, $, $, 0 ]");
    expect(g.catalog.quests[0]!.steps[0]!.objective).toBe("Spend training points");
  });

  it("writes the arena kind: its watcher as the step's NPC, a win as its amount, the arena as its area", () => {
    const g = generateFrom(sources([{ ...RATS, steps: [{ kind: "arena", arena: "kraanan" }, { kind: "arena", arena: "death", win: true }] }]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("[ 18, $, 1, 0, &TosInnKeeper, 0, qd_1_s1, $, $, qd_1_t1,\r\n               1, $, &TosWatcher, $, 0 ]");
    expect(g.kod).toContain("[ 18, $, 1, 0, &TosInnKeeper, 0, qd_1_s2, $, $, qd_1_t2,\r\n               1, $, &DeathArenaWatcher, $, 1 ]");
    const steps = g.catalog.quests[0]!.steps;
    expect(steps.map((s) => s.objective)).toEqual(["Fight a mock bout in the Arena of Kraanan", "Win a mock bout in the Arena of Death"]);
    expect(steps.map((s) => s.rooms.map((r) => r.rid))).toEqual([[70], [79]]);
    expect(generateFrom(sources([{ ...RATS, steps: [{ kind: "arena", arena: "moon" }] }]), WORLD).errors.join()).toMatch(/arena: kraanan or death/);
  });

  it("writes long tables in groups, as a Kod list literal holds at most 40 elements", () => {
    const many = Array.from({ length: 35 }, (_, i) => ({ ...RATS, id: i + 1, key: `q${i + 1}` }));
    const { kod, errors } = generateFrom(sources(many), WORLD);
    expect(errors).toEqual([]);
    const table = kod.slice(kod.indexOf("GetQuests()"), kod.indexOf("GetReplaced()"));
    // Two groups: 30 rows, then 5
    expect(table.match(/^ {9}\[\r$/gm)).toHaveLength(2);
    expect(table.match(/^ {9}\/\/ q\d+\r$/gm)).toHaveLength(35);
  });

  it("writes requirement bits, special rewards and items made for a school", () => {
    const q = {
      ...RATS,
      requires: { intriguing: true, guildShield: true },
      rewards: { joinFaction: "duke", insignia: "shalille", items: [{ class: "OrcTooth", school: "qor" }] },
    };
    const g = generateFrom(sources([q]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("0, 0, [ [ &OrcTooth, 1, 2 ] ], 0, 2, $, $, 5, [ [ 1, 1 ], [ 2, 8 ] ], $, $, $ ]");
    expect(g.catalog.quests[0]!.rewards.special).toEqual(["a place in the service of Duke Akardius", "the sign of Shal'ille on your guild shield"]);
    expect(g.catalog.quests[0]!.rewards.items[0]!.name).toBe("orc tooth (Qor)");
    const bad = { ...RATS, requires: { guildMaster: "yes" }, rewards: { joinFaction: "king", insignia: "none", items: [{ class: "OrcTooth", school: "x" }] } };
    expect(generateFrom(sources([bad]), WORLD).errors).toEqual([
      "cellar-rats.json: requires.guildMaster: true or false",
      "cellar-rats.json: rewards.items: [{ class, count?, school? }]",
      "cellar-rats.json: rewards.joinFaction: duke, princess or rebel",
      "cellar-rats.json: rewards.insignia: one of riija, qor, kraanan, faren, jala, princess, duke, shalille, rebel",
    ]);
  });

  it("scales xpPoints by the band and wants XP from a main quest", () => {
    const main = { ...RATS, tier: "main", band: { min: 20, max: 30 }, rewards: { xpPoints: 0.75, xp: 10 } };
    const g = generateFrom(sources([main]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.catalog.quests[0]!.rewards.xp).toBe(341);
    expect(generateFrom(sources([{ ...main, rewards: { shillings: 5 } }]), WORLD).errors).toEqual(["cellar-rats.json: a main quest gives XP (rewards.xpPoints or rewards.xp)"]);
  });

  it("writes kills that count only in their rooms, and quests another keeps from being offered", () => {
    const q = { ...RATS, requires: { notQuests: [2] }, steps: [{ kind: "kill", target: "SmallRat", count: 3, rooms: [53], inRooms: true }] };
    const other = { ...RATS, id: 2, key: "other", steps: [{ kind: "kill", target: "SmallRat" }] };
    const g = generateFrom(sources([q, other]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("[ 1, &SmallRat, 3, 2, &TosInnKeeper, 0, qd_1_s1, [ 53 ], $, qd_1_t1,");
    expect(g.kod).toContain(", [ 2 ], $, $ ]");
    const noRooms = { ...RATS, steps: [{ kind: "kill", target: "SmallRat", inRooms: true }] };
    expect(generateFrom(sources([noRooms]), WORLD).errors).toEqual(["cellar-rats.json: step 1: inRooms: a kill step with rooms"]);
    expect(generateFrom(sources([{ ...RATS, requires: { notQuests: [9] } }]), WORLD).errors).toEqual(["cellar-rats.json: requires.notQuests: quest 9 isn't there"]);
  });

  it("writes a health cap on offers, above the band's min", () => {
    const g = generateFrom(sources([{ ...RATS, band: { min: 20, max: 30 }, requires: { healthBelow: 30 }, repeat: { cooldownHours: 0 } }]), WORLD);
    expect(g.errors).toEqual([]);
    // A cooldown of 0 hours: offered again at once
    expect(g.kod).toMatch(/\[ 1, qd_1_name, &TosInnKeeper, 0, 20, 30, \$,\s+\$, \$, 0, \$,/);
    expect(g.kod).toContain("0, 2, $, $, 0, $, $, 30, $ ]");
    const low = { ...RATS, band: { min: 20, max: 30 }, requires: { healthBelow: 20 } };
    expect(generateFrom(sources([low]), WORLD).errors).toEqual(["cellar-rats.json: requires.healthBelow: a health above the band's min"]);
  });

  it("writes renown as a special reward and a renown minimum on offers (the faction revamp)", () => {
    const g = generateFrom(sources([{ ...RATS, requires: { faction: "duke", renown: 25 }, rewards: { renown: 3, warEffort: 1 } }]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("0, 2, 1, $, 0, [ [ 4, 3 ], [ 5, 1 ] ], $, $, 25 ]");
    const bad = { ...RATS, requires: { faction: "neutral", renown: 0 }, rewards: { renown: 101, warEffort: 5 } };
    expect(generateFrom(sources([bad]), WORLD).errors).toEqual([
      "cellar-rats.json: requires.renown: 1 to 100",
      "cellar-rats.json: requires.renown: a neutral has no renown",
      "cellar-rats.json: rewards.renown: 1 to 100",
      "cellar-rats.json: rewards.warEffort: 1 to 4",
    ]);
  });

  it("writes a paused quest as never offered, and says so in the catalogue only for it", () => {
    const g = generateFrom(sources([{ ...RATS, paused: true }, { ...RATS, id: 2, key: "other" }]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("0, 2, $, $, 16, $, $, $, $ ]");
    expect(g.catalog.quests[0]!.paused).toBe(true);
    expect("paused" in g.catalog.quests[1]!).toBe(false);
    expect(generateFrom(sources([{ ...RATS, paused: "yes" }]), WORLD).errors).toEqual(["cellar-rats.json: paused: true or false"]);
  });

  it("writes a quest that starts on a death with its needs bit, and says so in the catalogue", () => {
    const g = generateFrom(sources([{ ...RATS, start: "death" }, { ...RATS, id: 2, key: "other" }]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("0, 2, $, $, 32, $, $, $, $ ]");
    expect(g.catalog.quests[0]!.onDeath).toBe(true);
    expect("onDeath" in g.catalog.quests[1]!).toBe(false);
    expect(generateFrom(sources([{ ...RATS, start: "dawn" }]), WORLD).errors).toEqual(['cellar-rats.json: start: "death", or left out']);
  });

  it("writes the claim kind (claiming a flagpole, Flagpole.ClaimAttempt)", () => {
    const g = generateFrom(sources([{ ...RATS, steps: [{ kind: "claim" }] }]), WORLD);
    expect(g.errors).toEqual([]);
    expect(g.kod).toContain("[ 21, $, 1, 0, &TosInnKeeper, 0, qd_1_s1, $, $, qd_1_t1,\r\n               1, $, $, $, 0 ]");
    expect(g.catalog.quests[0]!.steps[0]!.objective).toBe("Claim a flagpole for your faction");
  });

  it("writes the node kind: the NODE_ bit (hex in blakston.khd) as the step's amount", () => {
    const w = worldFrom([], "   NODE_A5 = 0x0020\n   RID_TOS_INN = 52\n");
    expect(w.consts.get("NODE_A5")).toBe(32);
    const g = generateFrom(sources([{ ...RATS, steps: [{ kind: "node", node: "NODE_BADLANDS" }] }]), worldFrom([], "   NODE_BADLANDS = 0x0008\n"));
    expect(g.errors.filter((e) => e.includes("node"))).toEqual([]);
    expect(g.kod).toContain("[ 20, $, 1, 0,");
    expect(g.kod).toContain("1, $, $, $, 8 ]");
    expect(g.catalog.quests[0]!.steps[0]!.objective).toBe("Bond with the mana node");
    expect(generateFrom(sources([{ ...RATS, steps: [{ kind: "node", node: "NODE_NOWHERE" }] }]), WORLD).errors.join()).toMatch(/no NODE_NOWHERE in blakston.khd/);
    expect(generateFrom(sources([{ ...RATS, steps: [{ kind: "node" }] }]), WORLD).errors.join()).toMatch(/node: a NODE_ constant/);
  });

  it("refuses an auto talk step and unknown replacements", () => {
    const q = { ...RATS, steps: [{ kind: "talk", turnin: { class: "TosInnKeeper" }, auto: true }, { kind: "cast", spell: "OrcTooth" }] };
    expect(generateFrom(sources([q]), WORLD).errors).toEqual(["cellar-rats.json: step 1: auto: a talk step is the hand-in itself"]);
    const r = { ...RATS, replaces: ["QST_ID_NOPE"], steps: [{ kind: "cast", spell: "OrcTooth" }] };
    expect(generateFrom(sources([r]), WORLD).errors).toEqual(["cellar-rats.json: replaces: no QST_ID_NOPE in the Kod's headers", "cellar-rats.json: step 1: spell: OrcTooth isn't a spell class"]);
  });

  it("splits long text over lines and escapes quotes", () => {
    const q = { ...RATS, name: 'The "Big" Rat', steps: [{ kind: "kill", target: "SmallRat", objective: "x ".repeat(70).trim() }] };
    const { kod, errors } = generateFrom(sources([q]), WORLD);
    expect(errors).toEqual([]);
    expect(kod).toContain('qd_1_name = "The \\"Big\\" Rat"');
    expect(kod).toMatch(/qd_1_s1 = \\\r\n {6}"x x/);
  });

  it("keeps the catalogue's hash to Kod's integers, the same for the same quests", () => {
    const a = generateFrom(sources([RATS]), WORLD).catalog;
    const b = generateFrom(sources([RATS]), WORLD).catalog;
    const c = generateFrom(sources([{ ...RATS, name: "Rats!" }]), WORLD).catalog;
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(a.hash).toBeGreaterThan(0);
    expect(a.hash).toBeLessThan(2 ** 27);
    expect(a.quests[0]!.steps[0]).toMatchObject({ kind: "kill", count: 20, targetName: "small rat", turnin: { name: "Paddock" } });
  });

  it("refuses names the Kod doesn't have", () => {
    const q = {
      ...RATS,
      giver: { class: "SmallRat" },
      steps: [
        { kind: "kill", target: "Dragon" },
        { kind: "collect", item: "SmallRat" },
        { kind: "visit", rooms: ["RID_NOWHERE"] },
        { kind: "talk", turnin: { placed: "nobody" } },
      ],
    };
    const { errors } = generateFrom(sources([q]), WORLD);
    expect(errors).toEqual([
      "cellar-rats.json: giver: SmallRat isn't an NPC class (a Monster with AI_NPC)",
      "cellar-rats.json: step 1: target: Dragon isn't a monster class",
      "cellar-rats.json: step 2: item: SmallRat isn't an item class",
      "cellar-rats.json: step 3: no room RID_NOWHERE",
      'cellar-rats.json: step 4: turnin: no placed giver "nobody" in givers.json',
    ]);
  });

  it("refuses an NPC as a kill target", () => {
    const { errors } = generateFrom(sources([{ ...RATS, steps: [{ kind: "kill", target: "TosInnKeeper" }] }]), WORLD);
    expect(errors).toEqual(["cellar-rats.json: step 1: target: TosInnKeeper is an NPC; NPCs can't be killed"]);
  });

  it("keeps ids unique and never reuses a retired one", () => {
    const twin = { ...RATS, key: "twin" };
    expect(generateFrom(sources([RATS, twin]), WORLD).errors).toContain("twin.json: id 1 is also cellar-rats's");
    expect(generateFrom(sources([RATS], [WARDEN], [1]), WORLD).errors).toContain("cellar-rats.json: id 1 is retired (retired.json) and can't be used again");
  });

  it("checks the shape, prerequisites and text", () => {
    const bad = { ...RATS, band: { min: 30, max: 10 }, requires: { quests: [9] }, name: "Curly “quotes” 100%", steps: [] };
    expect(generateFrom(sources([bad]), WORLD).errors).toEqual([
      "cellar-rats.json: band: { min, max } with max >= min",
      "cellar-rats.json: steps: 1 to 20 of them",
    ]);
    const text = { ...RATS, requires: { quests: [9] }, name: "Curly “quotes” 100%" };
    expect(generateFrom(sources([text]), WORLD).errors).toEqual([
      "cellar-rats.json: name: only Latin-1 characters (no curly quotes or emoji)",
      "cellar-rats.json: name: no \\ or %",
      "cellar-rats.json: requires quest 9, which isn't there",
    ]);
  });

  it("checks the placed givers", () => {
    const g = generateFrom(sources([RATS], [{ ...WARDEN, look: "OrcTooth", rid: 999, angle: "UP" }]), WORLD);
    expect(g.errors).toEqual([
      "givers.json[0]: angle: one of ANGLE_EAST, ANGLE_NORTH_EAST, ANGLE_NORTH, ANGLE_NORTH_WEST, ANGLE_WEST, ANGLE_SOUTH_WEST, ANGLE_SOUTH, ANGLE_SOUTH_EAST",
      // A giver that isn't right isn't there for quests to name
      'cellar-rats.json: step 4: turnin: no placed giver "warden" in givers.json',
    ]);
    const h = generateFrom(sources([RATS], [{ ...WARDEN, look: "OrcTooth", rid: 999 }]), WORLD);
    expect(h.errors).toEqual(["givers.json[0]: no room 999", "givers.json[0]: look: OrcTooth isn't a monster or NPC class with a picture"]);
  });
});
