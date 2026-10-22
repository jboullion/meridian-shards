# ADR 0021: Factions, the Faction War, and no random PvP

- Status: built (2026-10-22), but for the client's war panel: the prep, renown and the Faction War, no random PvP and its cleanup, Champion's Gifts, Roq's contracts, per-viewer name colours, the battles, the world's reactions and the campaigns.
- Builds on: [ADR 0009](0009-quests.md), quests (its "Renown" section); [ADR 0011](0011-fast-travel.md), the PvP lockout; [ADR 0019](0019-arena-bouts.md), arena bouts; the magic item revamp, where broken items keep their magic and a smith repairs them.
- Design page, with decisions D1-D28 and a phase tracker: https://claude.ai/artifact/L6bNhsUXTTgXPXk62d1NBF

## Context

Meridian has always had three factions: Duke Akardius (Tos), Princess Kateriina (Barloque) and Jonas D'Accor (Jasper). They stayed in the background:

- **Membership was one number,** `Player.piFaction`. Joining took a QuestBook quest (70-72) or a council token. The only personal progress was the soldier shield's rank, 1 to 10, which drifted down over time.
- **Power was world-wide.** `Parliament.RedoPower` turned the flag share (`TerritoryGame`) and the five councillors (`TokenGame`) into a level from 1 to 5 for each faction, which drove the faction bonuses and the NPCs' moods.
- **Flag troops never fought each other.** `FactionTroop` lacks `AI_FIGHT_MONSTERS`, so `Brain.GetHatred` returns before `SpecialHatredBehavior` is asked.
- **The server-wide events were random monsters.** `GameEventEngine` started a `TriggeredInvasion` every two hours ("[Event] A ... has appeared at ..."), and Xeochicatl attacked mana nodes.
- **Any player past 50 health could attack any other.** Outlaws, murderers, the safety toggle, guardian angels and revenants policed it, and a death dropped everything on the corpse.

The game is becoming mostly single-player. So the factions are to drive the world and the story, the Faction War is to be the PvP that remains (with guild wars, the arenas and Frenzies), and nobody should be a target just for being out in the world.

## Decisions

1. **Every server-wide event is faction-driven.** The random invasion and the node attacks are off. A DM can still start the rat, orc, spider, skeleton, Easter and triggered invasions by hand, and `NodeAttack.SetAttacks` turns node attacks back on. Qormas, the Easter egg hunt and the Frenzy stay. The faction battles (decision 11) take the invasion's two-hour slot.

2. **Renown: 0 to 100 with your faction** (`Player.piFactionRenown`, `AddFactionRenown`).
   - **Ranks:** Recruit 0, Soldier 10, Sergeant 25, Lieutenant 45, Captain 70, Champion 100 (`GetRenownRank`, `RENOWN_RANK_*`).
   - **Starting and decay:** it starts at 0 on joining or changing faction (`ClearFactionRenown`), and it never decays.
   - **Earned from:**
     - quests (`rewards.renown`): the soldier quests 10, the zone chains 3, the ground dailies 3, the favours and priestess pointers 2;
     - a flag claim, 3;
     - a token brought to a councillor or your own liege, 3;
     - an enemy soldier killed, 1;
     - enemy troops, 1 for every 10, at most 5 a day.
   - **Lost from:**
     - a war death, 1;
     - attacking your own faction, 10, at most once a minute (expelled only at 0);
     - a Champion's Gift left unfed for 12 hours, 10.
   - **The soldier shield's rank is renown / 10** (`SoldierShield.RenownChanged`), so its stat and spell powers follow renown. The old 60-day rank loss, the kill-based rank changes and the shield's deletion at low rank are gone.
   - **Quests can require it:** `requires.renown` (QuestBook's `QB_RENOWN_MIN`, a quest's 24th field) and reward it (`QRW_RENOWN`). See ADR 0009.

3. **The Faction War: the worn soldier shield is the opt-in.** Two players can fight in it when both wear shields of rival lieges (`SoldierShield.IsEnemyAttack`).
   - The shield can be put away, and taken up again, outside the 120 s PvP lockout (`ReqUnuse`, `IsInPvP`). Before this it could never come off.
   - Unshielded members of a faction are never war targets.

4. **A war death breaks gear instead of dropping it** (`Player.IsWarDeath`, `WarDeath`).
   - **What makes one:** the player wears the shield, and the killer is a rival soldier or a rival faction's troop.
   - **What it costs:** nothing drops. The worn weapon, armour, helm and shield break (`BreakWornGear`: soldier shields, masks and indestructible items are spared; jewellery isn't touched). No skill, spell or XP is lost (`piDeathCost` 0). Renown drops by 1.
   - **Regrouping:** for 10 minutes rival soldiers can't attack the player, until the player strikes first (`IsRegrouping`, `EndRegrouping`).
   - **Order:** `Killed` checks for a war death before the newbie no-penalty death. A Frenzy or an arena keeps its own rules.

5. **Anti-grief.** A war kill scores nothing when the killer's base health is more than 30 above the victim's, or when the same victim was killed in the last 30 minutes (`WarKill`, `plRecentWarKills`; `WAR_HEALTH_GAP`, `WAR_REPEAT_KILL_SECS`). Kills, deaths, battles fought and battles won are kept on the player (`GetWarRecord`) and shown on the shield.

6. **No random PvP.** Outside the arenas, chaos zones, Frenzies and guild halls, `Player.AllowBattlerAttack` asks `MayAttackPlayer`. One player may attack another only:
   - in the Faction War;
   - in a mutual guild war (`Guild.IsMutualEnemy`);
   - when the attacker is in a faction and the victim carries a council token and belongs to another faction or none.

   Everything else is refused with `player_no_random_pvp`. Minions and spells go through the same check.

7. **No death drops anything,** except in an arena that drops loot (the Arena of Death). A death to a monster or in a guild war breaks the worn gear as a war death does, and costs no skill, spell or XP. Newbie and Frenzy deaths cost nothing, as before.

8. **The PvP machinery is gone** (the cleanup):
   - **Outlaws and murderers:** the flags, kill counts, kill karma, the murderer penalties, the town NPCs that snubbed them and the "murdered" broadcasts.
   - **The Office of the Justicar:** Caramo now only changes names by deed poll.
   - **The safety toggle, guardian angels, the PvP opt-out, revenants and PK loot locks.**
   - **The logoff ghost's losses.** A soldier who logs off soon after a fight with a player still counts as fallen in the war.
   - **What stays:** `PFLAG_PKILL_ENABLE` remains only as the end of newbie protection (50 base health, or joining a guild; `EvaluateNewbieStatus`). `CheckStatusAndSafety` is now `CheckAttackStatus`.
   - **Related changes:** Seance and the shrunken head now give away a random enemy (`Player.GetRevealableEnemies`). Failed delivery and tax quests threaten a curse, not outlaw status.

9. **Joining a faction no longer needs the PvP flag.** Intrigue is the health (50) or a level-5 spell alone (`PlayerIsIntriguing`). Flag claims and carrying a faction flag need the worn shield and no guardian angel.

10. **Name colours are per viewer** (`User.NameColorFor`):
    - red: a member of a guild at mutual war with ours;
    - orange: a member of a rival faction, when we're in one;
    - white: everyone else, and always a guildmate.

    The red and orange that marked murderers and outlaws are reused.

11. **Champion's Gifts.** At renown 70 and 100 base health, say "champion" to your liege (`util/championgifts.kod`). One gift is held at a time:
    - **The Princess:** the Sword of the Hunt.
    - **The Duke:** the Amulet of the Three.
    - **Jonas:** the Fist of Kraanan, gold gauntlets.
    - **How they feed:** an hour of play adds a point of hunger, and kills in the bearer's room feed it (enemy soldiers most). A starving gift weakens but never hurts its bearer.
    - **How they're lost:** 12 hours unfed, or leaving the faction, sends the gift back. It doesn't break in a death and can't be dropped, given or stored.
    - The sword and amulet are reworked from the old Necromancer and Hunter scenario. The Goad no longer sells them.

12. **Roq's contracts.** Say "contract" to Roq in Barloque (`util/roqcontracts.kod`) to be sent after a rival liege's agent in the open lands (`troop/contractmark/`).
    - **The kill:** only the contract dagger hurts the mark, and the fourth true strike finishes it.
    - **The pay:** 3 renown and 1000 shillings. Five contracts are paid a day.
    - **Time limit:** an hour, then the mark slips away.
    - A finished contract is a point of war effort for the player's liege (decision 13).

13. **Battles** (`util/factionwar.kod`, `SYS@GetFactionWar`; built 2026-10-22). One object runs them, made on demand. `System.NewGameHour` asks for it every game hour, which keeps the schedule going on any world.
    - **When:** every 2 real hours (`piBattleMinutes`), one at a time. The old random invasion's slot.
    - **Where** (`PickFront`):
      - **an assault:** a flag room whose pole's liege differs from a neighbouring pole's (`GetYellZone`); it counts twice in the draw;
      - **open ground:** a pole nobody holds next to a liege's land, which a random rival liege marches on too.
      - Never a liege's own city or its capture points (`IsHometownFlag`), nor a town's own pole (`Flagpole.IsClaimable`).
    - **Timeline:** a server-wide muster 10 minutes ahead (`fw_muster`), then up to 20 minutes of fighting (`fw_begin`). No flag claims on that pole meanwhile.
    - **The armies take the field only when a player enters** (`SpawnArmies`):
      - 10 a side (`piArmySize`), plus a troop for each point of war effort (at most 4);
      - per side: a captain, one mage per 10, one archer per 10, and the rest soldiers;
      - defenders round the pole; attackers round the room's monster spawn point farthest from it.
    - **The troops** are the liege's own classes (`DukeTroop`/`DukeMage`, `PrincessTroop`/`PrincessMage`, `RebelTroop`, and the new `RebelMage`) put into battle by `FactionTroop.SetBattle`:
      - **strength:** twice a flag troop's level (at most 240) and difficulty +2; a captain is level 300 with half again the health;
      - **archers** carry a longbow and keep their range;
      - **mages** take a school's robe and spells (`FactionMage.SetBattleSchool`): Qor (hold, blind, acid), Riija (vertigo, dazzle, illusionary wounds), Faren (web, lightning, fireball, ice shard), Shal'ille (dazzle, Holy Blaze). Kraanan's war priests and Jala's bards have no spell a monster can turn on a foe, so they fight with blades at 2.5 times the level.
    - **Fighting:** battle troops have `AI_FIGHT_MONSTERS`. `SpecialHatredBehavior` and `TargetSwitch` keep them to the other army and the other side's shielded soldiers (`IsBattleFoe`), nearest first. Every second `FactionWar.KeepTargets` points any troop without a foe at the nearest one, spreading out as the arena bouts do.
      - **Captains are guarded:** they hold their ground (`AI_NOMOVE`) and the enemy army leaves them be while more than half their own army stands (`IsGuardedCaptain`). A soldier may still go for them.
      - **Bystanders:** anyone but the two lieges' shielded soldiers can't strike a battle troop (`CanMonsterFight`), and the troops ignore them.
      - **No loot:** battle troops drop nothing.
      - **Not tidied away:** an empty room's `DestroyDisposable` passes them over.
    - **Winning:** the side whose captain falls, or whose army is gone, loses (`HOW_FIELD`).
      - **Out of time:** a fought battle is rolled by the health each army has left (`HOW_TIME`).
      - **Never fought** (nobody came): 50/50, shifted 5% for each point of war effort either side brought, at most 20% (`HOW_UNWATCHED`).
    - **Result** (`Resolve`):
      - the winner takes the pole (`Flagpole.SetFaction`, which recounts territory and power), and the room is announced;
      - every soldier who stood there gets 5 renown and 1000 shillings for a win, or 2 renown and 250 shillings for a loss, and the battle is recorded (`Player.NoteBattle`);
      - joining a battle ends regrouping;
      - both sides' war effort is spent, and the last ten battles are kept (`GetHistory`).
    - **War effort** (`AddWarEffort`, at most 4 a liege): a finished Roq contract gives 1, and so do the three faction ground dailies (`rewards.warEffort`, QuestBook's `QRW_WAR_EFFORT` 5).
    - **Maintenance port:** `StartBattle rid int <RID> attacker int <faction>`, `SpawnArmies`, `EndBattle winner int <faction>`, `AddWarEffort`, `GetStatus`, `GetHistory`, `SetBattleMinutes`, `SetMusterMinutes`, `SetFightMinutes`, `SetArmySize`.

14. **The world answers the war** (`util/factionworld.kod`, `FactionWar.GetWorld`; built 2026-10-22). It's made on demand and kept in step by `FactionWar.NewGameHour`. A town is the room its pole stands in, and a room belongs to a town by its class: a Tos tavern is a `TosRoom`.
    - **Celebrations** (`Celebrate`): triggered when a liege takes a town (`TerritoryGame.RecalcTownFlags` → `FactionWar.TownChanged` → `TownChanged`), or wins three battles running (`BattleWon`, from `FactionWar.Resolve`). For an hour, in the liege's capital and the town won:
      - three of the liege's standards (an `OrnamentalObject` with the flag item's art) and four revellers round the town pole. The revellers are the liege's own troops on duty (`FactionTroop.SetDuty`, `DUTY_REVELLER`): they wander, cheer now and then, and neither fight nor can be fought;
      - a fanfare when it begins;
      - a day's +5 boon of the liege's stat for each member who comes: the Duke intellect, the Princess agility, Jonas might;
      - 10% off at the merchants there for members.

      A celebration already going is lengthened and spreads to the new town.
    - **Mourning** (`Mourn`): the liege who lost a town flies the flags of their capital and its capture points at half-staff for two hours, and laments it to whoever is in their hall. Their celebration in that town ends (`EndCelebrationIn`).
    - **Occupation** (`SyncSentries`): each town's liege keeps two sentries at its pole (`DUTY_SENTRY`), changed with the town. Its merchants sell to that liege's members for 10% less. `Parliament.GetFactionPriceBonus` asks `GetPriceBonus`, and it stacks with a celebration and with the Princess's own 5%.
    - **The ledger:** a member who says "ledger" to their liege (`Factions.SomeoneSaid`) hears the ten best of their soldiers. The score is kills + 3 × battles won + battles fought. It's spoken rather than an object in the hall, because a list that long doesn't fit an object's description.
    - **Left out:** the plan's lighting and music moods (they would need our client), and dialogue that changes with the war beyond the lament.
    - **For the admin:** `EndAllCelebrations`, `RaiseFlags`.

15. **The campaigns** (built 2026-10-22). Each liege has five acts of QuestBook quests (300-304 the Duke, 305-309 the Princess, 310-314 Jonas). They're gold, each needs the act before it (the first needs the soldier quest), and they're gated by renown and health:

    | Act | Renown | Health from | Pays |
    |---|---|---|---|
    | I | 10 | 55 | 5 renown, 1,000 shillings |
    | II | 25 | 65 | 6 renown, 1,500 shillings |
    | III | 35 | 80 | 8 renown, 2,500 shillings |
    | IV | 45 | 95 | 10 renown, 4,000 shillings |
    | V | 70 | 105 | 15 renown, 10,000 shillings |

    Every act also pays XP.

    - **The Duke** (order through strength):
      - I hunt Jonas's soldiers, then hear Zuxana's omens (Qor);
      - II carry his offer to the Monk of Riija and thin the Princess's scouts;
      - III win a battle for him and claim a pole;
      - IV take Zuxana an offering and kill three bandit captains in Jonas's pay;
      - V *The Siege of Barloque*.
    - **The Princess** (the rightful heir, healing):
      - I drive off the Duke's raiders and bring Xiana's healers (Shal'ille);
      - II blue dragon scales for Tenuv'vyal's wards (Faren) and Jonas's raiders;
      - III a battle and a pole;
      - IV the treaty to Ko'catan's captain and ten avars on the jungle paths;
      - V *The Siege of Tos*.
    - **Jonas** (freedom):
      - I the Duke's tax men, then Themala's songs (Jala);
      - II the Princess's supply guards and an offering for Qerti'nya's blessing (Kraanan);
      - III a battle and a pole;
      - IV ten of the lords' knights and Kraanan's oath;
      - V *Storm the Keep* at Tos.
    - **New step kinds** (`QuestBook`):
      - `battle` (`QK_BATTLE` 22; with `win`, only a battle won), counted for each soldier who stood in it (`FactionWar.Resolve` → `BattleDone`);
      - `siege` (`QK_SIEGE` 23; `against` the faction besieged, its amount).
    - **The siege:** a player on the siege step says "march" to their liege (`Factions.SomeoneSaid` → `QuestBook.SiegeAgainst` → `FactionWar.StartSiege`).
      - It's a story battle at a random capture point of the rival's capital, the one ground the regular battles never touch. It's announced to everyone, and the army gathers two minutes later.
      - **When the leader never comes,** it fails.
      - **Won:** it counts for the step (`SiegeDone`), the winner's capital celebrates (`fw_siege_won`), and the soldiers who fought are paid as for any battle. It takes no pole.
      - **Refused** while another battle is under way. The regular two-hour schedule isn't disturbed.
    - **The Champion's Gift** now waits on the fourth act as well (`ChampionGifts.CampaignAct4`, `champion_need_campaign`).
    - **The schools:** `Parliament.IsFactionSchool` gives the spell-power and learning bonuses to the same schools as the battle mages: the Duke Qor and Riija, the Princess Shal'ille and Faren, Jonas Kraanan and Jala. Before, the Duke had Kraanan too, the Princess had Jala too, and Jonas had none. Jonas keeps the learning bonus for skills.
    - **Left out:** separate rank-milestone quests. The acts mark the ranks.

## Consequences

- **Dying is much softer.** No death drops your things and none costs skills or XP outside the newbie rules. The cost is broken gear and a smith's bill, which leans on the magic revamp's repairs. Players who used to fear the walk back to a corpse don't have that walk any more.
- **The war is the only open-world PvP,** and it's opt-in at any moment outside a fight. A player who never takes up the shield is never attacked by a player, apart from guild wars they joined and council tokens they chose to carry.
- **Saved worlds:** classes a saved world can hold stay as empty stubs (`Revenant`, `ItemAttPKPointer`, `AbstainPvPQuest`, `Pardon`, `Villify`). Retired flag bits are left out of `PFLAG_MASK`, so old characters lose them. New properties appear on `reload system` with their defaults. A world running from before the prep keeps its old invasion and node-attack timers until the event engine is recreated. `StartAttackTimer` now stops once attacks are off.
- **The token game stays dangerous** to faction members carrying tokens. Neutral carriers can be attacked by any faction member.
- **Still dead but left in place:** the Assassin's Game, the hunter sword versus necro amulet PvP, some "branded an outlaw" quest texts, and the legacy C client's safety UI.

## As built

- **Prep (shards-server 5e817177, 2026-10-21).**
  - `gameeventengine.kod`: the invasion timer and the unused `plRandomEvents` are gone; `triggeredinvasion.kod` no longer reschedules itself.
  - `nodeattk.kod`: `pbAttackEnabled = FALSE`.
  - Bugs fixed: `Parliament.FigurePowerFromCount` tested `neutral` for `bNeutral` (no effect while `piBalanceFactor` is 25), and Jonas tested `> FACTION_STRONGLY_IN`, which is never true.
- **Renown and the Faction War (a9693567, then 4c8f26a5 for the war death's order).**
  - `blakston.khd` `RENOWN_*` and `WAR_*`.
  - `player.kod`: renown, `WarKill`, `EnemyTroopKilled`, `IsWarDeath`, `WarDeath`, regrouping, and `CheckFactionAttack`'s renown.
  - `soldshld.kod`: `RenownChanged`, `KilledSomething`, `OwnerDied`, `ReqUnuse`, `AppendDesc`.
  - Hooks in `token.kod` `TokenDelivered`, `flag.kod` `ClaimAttempt` and `questbook.kod` (`QB_RENOWN_MIN`, `QRW_RENOWN`).
  - Renown on 38 faction quests.
  - The quest tool (`tools/quests`) and its test (this repo's dcdec20).
- **No random PvP (5fc7b863):** `MayAttackPlayer`, `BreakWornGear`, the new death branches in `Killed`, intrigue without the PvP flag, and `flag.kod`/`factflag.kod` without `CanPlayerPvP`. `IsEnemyAttack` now records the right attacker.
- **The cleanup (83e7ec38, 4b8ef4dc, a05107a7).**
  - 113 Kod files, about 6,500 lines out.
  - Our client (dcdec20): the safety and opt-out options, the minimap's PvP colours and the help text are gone. The PvP lockout banner stays (ADR 0011).
- **Champion's Gifts (fa4bd75b), Roq's contracts (fac99271), name colours (284d7b8c, cf2c4419).**
- **Battles (b6c4e1a0, 2026-10-22).**
  - New: `util/factionwar.kod`; `troop/factionmage/rebelmage.kod`.
  - `troop.kod`: `SetBattle`, `ReplaceGear`, `IsBattleFoe`, the battle's `SpecialHatredBehavior`, `TweakBehavior`, `TargetSwitch`, `CanMonsterFight`, `CreateTreasure` and `DestroyDisposable`, the captains' names; a liege's own troops and mages count as allies.
  - `factionmage.kod`: `SetBattleSchool`.
  - Hooks: `system.kod` (`GetFactionWar`, `NewGameHour`), `flag.kod` (`IsClaimable`, no claims during a battle, `CleanupExtraTroops` leaves battle troops be), `territry.kod GetFlagRIDs`, `player.kod NoteBattle`, `questbook.kod QRW_WAR_EFFORT`, `roqcontracts.kod`.
  - The quest tool's `rewards.warEffort`, and its test.
  - **Tried on the dev server, with nobody in the room:**
    - about ten fought battles, each 1.5 to 2.5 minutes, between every pair of lieges;
    - war effort bringing extra troops and moving a roll;
    - an unwatched battle settled by the roll;
    - the pole changing hands.
  - **Three fixes came out of those tests:**
    - an empty room's `DestroyDisposable` had been tidying the armies away every 150 seconds;
    - `DelListElem` emptied an army list when it couldn't find a troop;
    - Vampiric Drain needs a caster that can heal, which a troop isn't.
  - **Balance:** the Rebels, with no casters, lost three of three, so their priests and bards were made stronger; afterwards they won two of two. Captains used to die in the first half-minute until they were guarded.
- **World reactions (7c6f151e, 2026-10-22).**
  - New: `util/factionworld.kod`.
  - `troop.kod`: `SetDuty`.
  - Hooks: `factionwar.kod` (`GetWorld`, `TownChanged`, `BattleWon` in `Resolve`), `territry.kod RecalcTownFlags`, `parlia.kod GetFactionPriceBonus`, `factions.kod` (the ledger).
  - **Tried on the dev server over the maintenance port:**
    - Marion taken by the Duke through its capture points, with the celebration in Tos and Marion and the sentries changed;
    - Marion then taken by the Princess: the Duke mourned (Tos at half-staff) and his Marion revelry ended;
    - a three-win streak celebrated in Jasper;
    - the town of a room, the ledger's score, and ending and raising everything.
  - **Kod names:** a message `Towns` and the parameters `room` and `towns` were all rejected as duplicate identifiers.
- **Campaigns (2026-10-22).**
  - Quests: `quests/{duke,princess,rebel}-act1..5-*.json` (300-314).
  - `questbook.kod`: `QK_BATTLE`, `QK_SIEGE`, `BattleDone`, `SiegeDone`, `SiegeAgainst`.
  - `factionwar.kod`: `StartSiege`, sieges in `Resolve` and `ResolveByRoll`, the quest calls.
  - `factions.kod`: "march".
  - `championgifts.kod`: the Act IV gate.
  - `parlia.kod`: `IsFactionSchool`.
  - `player.kod`: a player who becomes eligible for a faction (`PlayerIsIntriguing`) loses any old renown too.
  - Our tools and client: the quest tool's `battle` and `siege` kinds (with a test), and the dashboard's Quests tab.
  - **Tried over the maintenance port on Scout, then reset:**
    - the school mapping;
    - a lost battle not counting and a won one moving Act III on;
    - "march" finding the siege, against the Princess;
    - the siege called at a Barloque capture point, won, with no pole taken and Tos celebrating;
    - Act V completing;
    - the gift refused without Act IV.
- **Not yet tried in the game:**
  - a campaign played through, and a siege actually led and fought;
  - a real war death (the gear breaking, the regroup protection, a smith mending it);
  - attacking your own side;
  - a monster death above 50 health;
  - the gifts, the contracts and the name colours;
  - a player in a battle: the muster and result messages, the pay, bystanders being turned away, and a lone soldier going for a captain;
  - a player at a celebration (the boon, the cheers and the look of the revellers and standards), a discount at a merchant, and the ledger as a player hears it.

  Renown, the war death's gear breaking, the anti-grief rules and `MayAttackPlayer` were checked over the maintenance port on Scout. The in-game playtest has to run from this repo, where the meridian MCP server loads.
