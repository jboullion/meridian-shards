# ADR 0019: Arena bouts, and the Arena of Death's show

- Status: built (2026-10-18)
- Builds on: [ADR 0007](0007-arena.md), the arena show on the relay; [ADR 0009](0009-quests.md), quests; [ADR 0015](0015-social-on-our-server.md), `UC_SHARDS`

## Context

The Arena of Kraanan's NPC fights were only to watch: the relay runs them, and real players were never in them (ADR 0007 decision 8). The play test asked:

- that players can join fights against the NPCs, told how by a quest anyone can take in Tos;
- for buttons by the map in the arena: join a mock battle, join player battles, leave;
- for the Arena of Death (RID 79, `tosarena_death.roo`) to have its own show:
  - by night, while the Arena of Kraanan is shut: two elites fighting one against one in its cage, the stands cheering;
  - by day: a few people walking about inside;
  - the elites: warriors in heavy armour with fine weapons (scimitars, axes, hammers, nerudite swords) or bows, and battle mages of Qor (thorn circlet, orc shield), Faren (circlet, Jewel of Froz) and Riija (circlet, a Riija herald's shield) who hold and web;
- that a player can duel a random elite there, with about the player's health and never less than 100; losing takes them out of the cage with little health, never to the Underworld;
- for a mock record and a title, kept apart from real battles, shown in an arena window.

## Decisions

1. **A player's bout is fought on our server, with real monsters.** The relay can't touch a player's health, place or death, doesn't know who a connection is, and has none of the game's combat: spells, skills, weapons, hit messages, the hands, damage numbers. Kod has all of it, and the arenas' cages, safe deaths and watchers too. `Human` monsters wear real items, so the elites' kit is the game's own. The relay keeps the show of NPCs alone, as ADR 0007 has it.

2. **The bouts: `util/arenabouts.kod` (`ArenaBouts`, `SYS@GetArenaBouts`).** One slot per arena:
   - **The Arena of Kraanan: a melee** of the player and three fighters, everyone against everyone. Any level: the fighters have four fifths of the player's health and a weaker attack; adepts (mages) only face players with 60 health or more, as a bolt is too much for the newest.
   - **The Arena of Death: a duel** against one elite with the player's health, at least 100.
   - **The flow:** a line (`arena join`), then a 10 s countdown on the open floor with the fighters still (not the watchers' cages or start boxes: monsters walk straight at their foes and can't find their way out of them), then the fight: 4 minutes for a melee, 3 for a duel. The player is healed to full as they go in.
   - **Winning:** every fighter down. The player leaves with the health, mana and vigor they came in with.
   - **Losing:** beaten, out of time, leaving the floor, logging off, or `arena leave`. The player wakes in the stands with a tenth of their health and the mana and vigor they came in with, and the bout's curses and poisons go (one left running in the Arena of Death's stands would be a real death).
   - **Never a death:** `Player.Killed` asks `BoutDeath` before anything else, even the Underworld check; `User.Killed` skips "You are dead" for a bout. The end is posted, as the fighter that struck the blow is still running.
   - **No XP, skills or spells:** arenas give none, and `ArenaFighter.CanPlayerAdvanceOnMe` is false (no skill practice either). No treasure: what fighters wear goes with them.
   - **The watchers:** a bout waits while a watcher has a match of players set up (`Watcher.IsBusy`), and a watcher takes no champion or challenger while a bout holds the floor (`TrigChampion`, `TrigChallenge`). A fighter deleted by anything but its bout (a watcher clearing the arena, an admin) calls the bout off, with no record.
   - **The room's checks:** `Room.ReqSomethingAttack` asks `ReqBoutAttack` first and `Watcher.ReqSpellCast` asks `ReqBoutSpell`: `$` (no bout here) leaves the watcher's rules as they were.

3. **The fighters: `ArenaFighter is Human`** (`battler/monster/human/arenafighter.kod`).
   - **Kinds:** 1 gladiator (plate, scale or nerudite; a scimitar, axe, hammer, nerudite sword, longbow or battle bow with nerudite arrows; sometimes a metal shield and a helm), 2 battle mage of Qor (black disciple robe, thorn circlet, orc shield; Hold, Blind, Vampiric Drain, Splash of Acid), 3 of Faren (red robe, circlet, Jewel of Froz; Spider Web, Lightning Bolt, Fireball, Ice Shard), 4 of Riija (purple robe, circlet, the guild shield in purple with Riija's sign; Hold, Vertigo, Dazzle, Illusionary Wounds), 5 brawler and 6 adept (the Arena of Kraanan's).
   - **Strength** from the player (`ArenaBouts.MakeFighter`, after the companions' formula): offence and defence 4 x health + 400 (three quarters of it in the Arena of Kraanan), damage per mille of the player's health, spell power 40 + health / 4 for elites.
   - **Mages** cast at their chance every 4 s (6 s for adepts), a hold, web or blind at most every 12 s, and keep about 3 squares off (archers 5).
   - **Targeting:** only their bout's members (`IsBoutFoe`, `SpecialHatredBehavior`, `TargetSwitch`), the nearest first; the bout spreads the melee out (`PickTarget`: a foe others are on counts as further off). Frozen (`AI_NOMOVE | AI_NOFIGHT`) until the fight begins.

4. **Records and a title:** `User.plArenaRecord`, wins, losses, streak and best streak in each arena's mock bouts, apart from the watchers' champion lists. The title comes from the mock wins in both: Untested, Blooded (1), Brawler (5), Gladiator (15), Champion of the Sands (30), Legend of the Arena (60).

5. **Our client:**
   - **`UC_ARENA` (116)** tells where we stand, the floor's bout, its fighters' health, and our records ([protocol.md](../research/protocol.md), "Ours").
   - **The Arena window** (`ui/ArenaDialog.tsx`), from the crossed swords at the minimap's left in an arena (the Classic toolbar's row, the phone's top buttons), or typed `arena`: Mock bouts (the rules, join, the line, the countdown, the opponents' health, give up), Player battles (the watcher's styles, Champion, Challenge, Accept, Renege, unspoken), Record.
   - The bout's fighters show a health bar under their names; the arena's crowd cheers our blows.

6. **Quests: a step kind `arena`** (`QK_ARENA` 18): `{ "kind": "arena", "arena": "kraanan" | "death", "win": true }`, counted by the arena's watcher class (`QBS_WITH`) when a bout ends (`QuestBook.ArenaBoutDone`). Paddock, the Tos innkeeper, gives *Blood and Sand* to anyone (fight one melee, hand it in), and Johlan Tulca a daily *A Dealer of Death* from 100 health (win a duel).

7. **The Arena of Death's show, on the relay** (packages/world `arena/arenaRooms.ts`):
   - **One sim per server and room.** The Arena of Death's fighting floor is the nav area under its cage (`floorAt`), not the biggest area (the stands round it are bigger).
   - **Its settings** (`DEATH_ARENA_CONFIG`): one against one, its own roster of 16 elites (`gladiator`, `qorbattle`, `farenbattle`, `riijabattle`), open 22 to 6 (hours may run past midnight now: `arenaOpenAt`), 3-minute rounds. arena.json changes them under `"death"`.
   - **Its season** is kept under the server's name and `|death`, beside the Arena of Kraanan's.
   - **The sim's new parts:** Hold (a curse with no projectile: the victim stands still, keeping its foe; `debuff/hold.kod`'s numbers), bows (fighters keep three squares off and loose arrows, a "spell" with the arrow's art), battle mages that stand their ground longer (`temper.stepEvery`), and a minimum of casters per round as a setting (`minCasters`).
   - **The looks** (townsfolk.ts): bows (the bottom half held, the top half too while drawn: `bow.kod`), the firing pose (`PANM_BOW_FIRE`), and disciple robes' school emblems on the chest (`robedisc.kod`, `HS_EMBLEM`).
   - **By day,** with the show shut, 4 townsfolk walk about its stands (`AMBIENT_ROOMS`).

8. **The show gives way to a bout.** While our server says a player's bout holds an arena's floor (`UC_ARENA`'s floor state), our client tells the relay (`arenaBusy`, or its own sim): the round stops and its fighters walk off, the stands stay, and no round starts until the bout's over. The relay asks nobody, so a busy floor lapses after 6 minutes unless said again.

## Consequences

- **Real death is one bug away.** A slip that lets a mock loss in the Arena of Death reach `Player.Killed`'s own path would be a real death. Hence `BoutDeath` first, and the forced deaths tried on the dev server only (`tools/headless/arena.ts lose`).
- **New classes stay.** `ArenaBouts` and `ArenaFighter`, and their properties, are in saved games from now on: blakserv won't load a save holding an object whose class is gone.
- **The watchers' cleanup deletes NPC monsters.** Bouts and players' matches are kept apart both ways; a fighter deleted from outside calls its bout off.
- **The show and the bouts are separate fights.** The relay's fighters aren't the server's: a player fights the server's, and the relay's leave the floor to them.
- Mock bouts are the arenas' only way to practise against strong opponents without risk, and give nothing but the record, the title and the quests, so they can't be farmed.

## As built (2026-10-18)

- shards-server: `util/arenabouts.kod`, `battler/monster/human/arenafighter.kod`; hooks in `player.kod Killed`, `player/user.kod` (`ShardsCommand` `arena`, `UserLogoff`, `Killed`, `plArenaRecord`), `room.kod ReqSomethingAttack`, `towns/watcher.kod` (`ReqSpellCast`, `IsBusy`, `ArenaCommand`, the sign-up guards), `util/questbook.kod` (`QK_ARENA`, `ArenaBoutDone`), `util/system.kod GetArenaBouts`; `UC_ARENA` in `protocol.khd` and `proto.h`; the quests `tos-blood-and-sand.json` (250) and `tos-death-arena-duel.json` (251).
- Our client: `packages/world/src/arenaBouts.ts` (`readArena`), `apps/client/src/game/arenaBouts.ts` (`ArenaStore`), `ui/ArenaDialog.tsx`, the buttons (`ModernHud.tsx MapCluster`, `TouchControls.tsx`, the Classic toolbar in `GameView.tsx`), `gameScene.ts` (`arenaHp`, `arenaFloorBusy`, the Death arena's hours, cheers), the quest kind in `tools/quests` and the dashboard's Quests tab.
- The relay: `tools/gateway/arena.ts` (per room), `relay.ts` (`arenaBusy`), `arena/arenaRooms.ts`, the elites in `arenaData.ts`, Hold and bows in `arenaSim.ts`, `townsfolk.ts battleMageAppearance`, `gladiatorAppearance`; `stage.ts` ships `tosarena_death.roo` and its nav grid.
- Tried: `tools/headless/arena.ts` on the dev server (a melee won, lost by time and by logging off; a duel lost to a forced loss in the Arena of Death, waking in its stands; a duel won; the quest taken, counted and handed in; a champion refused a bout), and in the browser (the window and the buttons in Modern, Classic and the phone layout; the gladiator's bow and the battle mages' kits on the server; the relay's night duel giving way when a player joined).
