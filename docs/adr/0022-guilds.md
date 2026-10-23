# ADR 0022: Guilds, halls, Fallen Halls and trophies

- Status: partly built (2026-10-22). Built: phase 0, the cleanup (shards-server 146967e0), and phase 1, the halls (f735b043). Neither has been tried in the game client. Phase 2, prestige and the guild bonus (5fb122b5), the old Necromancer/Hunter scenario's cleanup (dbf0e91a) and phase 3, the recruiting boards (not yet committed), are built too. Planned: phases 4-7, with the Order of Necromancers (26) as the frame for 4 and 5.
- Builds on: [ADR 0021](0021-factions-and-the-faction-war.md), the faction revamp and its no-random-PvP rule; [ADR 0011](0011-fast-travel.md), fast travel's checks; [ADR 0012](0012-cosmetics.md), the dye code and decals; the magic item revamp, whose items the Fallen Halls drop.
- Design page, with decisions G1-G25, numbered as here and a phase tracker: https://claude.ai/artifact/Nvvnp6oGKoutiwwHpbGvfK

## Context

The end game is player interaction through factions and guilds. ADR 0021 rebuilt the factions; guilds are still the 1990s system:

- **Ranks** are `RANK_APPRENTICE` 1, `RANK_SIR` 2, `RANK_LORD` 3, `RANK_LIEUTENANT` 4 and `RANK_MASTER` 5 (`blakston.khd`). Each guild command (`guildcmd/`) has a fixed `viRank_needed`, applied by `Guild.ResetPowers` → `GuildCommand.ResetCommand`. There may be two Lieutenants (`MAX_LIEUTENANT`); Lords and Sirs are uncapped (`NewLordOkay` is always TRUE). Rank names are chosen at creation (`prMaster`..`prApprentice_Female`, 20 characters).
- **The Master is elected** (`Vote`, `CountVotes`, `piSuccession = GS_VOTING`).
- **Small guilds die.** Under `MINIMUM_MEMBERS` (3), `piThreePersonWarning` counts down `THREE_PERSON_LIMIT` (240 six-minute ticks, about a day) and then deletes the guild. Maturity (`piMature`, 3 or 6 hours) also only counts with three members.
- **Halls** (`room/ghall.kod`, `ghall/guildh1`-`guildh20`, created in `system.kod`) are 19 single rooms with a foyer, a password door, a secret door that opens to the spoken password, a private news ball and a shield lever (`GuildLever`). A guild at war could lower the shield and take the hall in ten minutes (`GuildLeverFlipped`, `ConquerTimer`, `Guild.GuildHallConquered`). Hall 15 has no entrance and is the Dead Lich's room. `CanEnter` lets in the owner and allies at `RANK_SIR` and up, so apprentices can't enter. Halls are an exception in `Player.MayAttackPlayer`, so players can fight there.
- **Hall chests** (`Chest`, `WoodenBox`, `SmallBox`, `Box`) have `viBulk_hold_max` 60,000,000 and no weight limit: in practice there's no limit. `ReqUseGuildChest` only refuses use from the foyer.
- **No recall to a hall** apart from the Rescue spell (an emerald; it goes to your hall if you have one). **No cloak** item exists; ADR 0012 lists "no cloaks".
- **Kill XP** (`Player.AdvancementCheck`) already has a group share: a player grouped with the killer in the room (`Room.AreGroupedHere`) gets a quarter. There's no guild bonus.
- **Boss rooms** (`BossRoom`) reset 30 minutes after the last player leaves. Other unique creatures come from room timers or weighted generators. Nothing marks a monster as a boss.
- **News globes:** the adventurers' halls link to `NID_TOS_HALL` ("General News"); the inns link to `NID_ANNOUNCEMENTS`. Berg's two are the wrong way round.

There are few players, so the hall-raiding design only ever hurt the guilds it was meant to challenge, and most halls sit empty.

## Decisions

### Ranks and membership

1. **Five fixed ranks, with the roles Leader, Officer, Trusted, Member and Recruit.** They are the existing rank numbers 5 to 1, so nothing on a guild migrates. Their default names are Commander, Lieutenant, Lord (Lady), Sir (Madame) and Apprentice, and guilds can still name their own at creation. This ADR calls the ranks by their roles. Powers stay fixed per rank and can't be edited:

   | Power | Lowest rank |
   |---|---|
   | Guild chat, roster (`GuildRoster`), the guild cloak, the XP bonus, renounce | Recruit |
   | Enter a private hall, the Common chest | Recruit |
   | The Members' chest, the recall stone | Member |
   | The Vault, opening the sanctum, invite (`GuildInvite`) | Trusted |
   | Exile, set rank below their own (`GuildExile`, `GuildSetRank`), alliances, war and peace, the MOTD | Officer |
   | Hall public/private, the recruiting notice | Officer |
   | Buy or abandon the hall (`GuildAbandon` moves up from Lieutenant), colours, abdicate, disband | Leader |

   At most two Officers (`MAX_LIEUTENANT`); no other caps. `GuildRoster` moves down from Lord to Recruit.

2. **Succession instead of votes.** `GuildVote`, `Vote` and `CountVotes` go. The Leader hands over with `GuildAbdicate`. If the Leader hasn't logged on for 30 days, `MaintenanceTimer` makes the highest-ranked active member Leader, the longest-serving first (`NewGuildMaster`).

3. **Two members found and keep a guild; size never disbands one.** `MINIMUM_MEMBERS` becomes 2. The `piThreePersonWarning` countdown and its messages go, and maturity counts down with two.

4. **An inactive guild loses its hall, not itself.** When no member has logged on within `USER_INACTIVE_TIME`, the hall is released (`AbandonGuildHall`). The guild keeps its name, trophies and prestige.

   **Rent is only for a hall** (decided 2026-10-23).
   - A guild without a hall accrues no rent, and owes nothing (`Guild.AccrueRent`); rent it has prepaid stays to its credit.
   - Unpaid rent costs the guild its hall, never its charter. The warnings and Frular's lines say so.
   - Before this, a hall-less guild still built up rent and was disbanded for it, which undid this decision.

### Halls

5. **No conquest.** Out go: `GuildLever` (`gldlever.kod`); `GuildLeverFlipped`, `CanRaidGuildhall`, `ConquerTimer`, `WarnGuildMembers`, `AreDefensesDown`/`DefensesUp`/`DefensesDown` and the `STATUS_RAIDED`/`STATUS_CONQUERED` branches in `ghall.kod` (and the overrides in `guildh10` and `guildh12`); `GuildHallConquered` and the last-raid properties in `guild.kod` and `necguild.kod`; the abandon check in `gcaband.kod`; `pbGuildHallRaids` and `piGuildHallRaidDelay` in `settings.kod`; the raid help text. `GuildWarNews` stays: it records war declarations, not raids.

6. **Halls are safe.** They leave `MayAttackPlayer`'s exceptions, and `ghall.kod` refuses any player attack inside, guild war included.

7. **Public or private** (`GuildHall.pbPublic`). An Officer or the Leader says "hall public" or "hall private" in the hall (`HallCommandSaid`), and the guild's online members are told. A newly leased hall starts private.
   - **Public:** anyone can come through the outer door, and visitors are told the hall is open to them.
   - **Private:** the owner guild at any rank, and allied guilds at Member and up. Recruits can now enter.
   - `ValidEntry` still moves anyone who logs in somewhere they can't be to the foyer.

8. **The sanctum.** The area behind each hall's secret door (each subclass's `OpenSecretDoor`) opens for a member of Trusted rank or higher who says "open" where the hall listens for it (`GuildHall.IsSanctumWord`). The guild password (`GuildSetPassword`, `ChangePassword`) is retired. The Den of Shadows' outer balcony door opens to "open" from anyone the hall would let in (`IsDoorWord`).

9. **Three chests per hall: Common, Members' and Vault**, for Recruit, Member and Trusted and up (`StorageBox.piGuildRank`, named "common chest", "members' chest" and "vault").
   - **Which is which:** `GuildHall.AssignChestRanks` ranks a hall's chests in the order the hall makes them. The last is the Vault, the one before it the Members' chest, and the rest are Common. With two chests, they're Common and Members'.
   - **Halls that needed more:** the kept halls with fewer than three (1 Mercenary Alley, 10 Jaarba's Abode, 12 the West Tower) get chests placed on open floor beside their old ones. The Fallen Halls-to-be keep what they have.
   - **Who may use them:** only the owner guild, from each chest's rank up (`CanUseChest`). That includes looking inside (`User.UserObjectContents`). Allies and visitors may not use them. An unowned hall's chests are open to anyone, as before.
   - The Vault isn't always in the sanctum; placing it there is left for when the halls are revisited.

10. **Chests get a size limit that prestige raises:** 50 items, plus 25 per prestige tier, up to 150 (`Guild.GetChestLimit`). `StorageBox.ReqNewHold` asks `GuildHall.ChestHasRoom` after the rank check, and a stack counts once (`GetItemCount`). A chest already over its limit keeps its contents but takes nothing new. Admins aren't limited.

11. **The recall stone** (`GuildRecallStone`).
    - **Who gets one:** a Member or higher of a guild with a hall says "recall stone" in the hall. One is carried at a time. It's tinted in the guild's first colour.
    - **Using it:** 5 seconds, then `GuildHall.RecallTo` puts you on the hall's inner square. Moving to another room in those seconds breaks it.
    - **Refused:** during the PvP lockout (`IsInPvP`), while holding a token, or when dead or phased, as in fast travel's `Journey`.
    - **Cooldown:** 30 minutes.
    - **The stone itself:** it can't be dropped, given or stored, and it disappears when you leave the guild. If the guild has no hall, it does nothing.

12. **Ten halls stay for guilds:** 1 Mercenary Alley and 6 the Ivory Chapel (Cor Noth); 2 the Hall of Explorers, 14 the Bookmaker's Guild House and 16 the Symbol of Dawn (Barloque); 4 the Wryn's Keep and 10 Jaarba's Abode (Jasper); 5 Konima's Abandoned Dwelling (Tos); 12 the West Tower (Ko'catan); 17 Green's Workshop (Marion).

### Fallen Halls

13. **Eight halls fall:** 3 the Den of Shadows, 7 the Old Dwarven Hall, 8 the Sewer Hideout, 9 the Abandoned Warehouse, 11 Home of the Friends of the Forest, 13 Hall of the Slaughtered Command, 19 the Wetland Fortress and 20 Muskgate Post. Each becomes a `FallenHall` room, no longer a `GuildHall`: the ruin of an old guild, held by a themed garrison and a named boss. They're open to everyone. Frular stops selling them.

14. **Once a Meridian day.** Each garrison and boss returns when the game day turns: every two real hours (`System.NewGameDay`, which tells each Fallen Hall to re-arm). Whatever's killed stays dead until then, so the first group to clear a hall has it until the next game day. The halls are small, so two hours is enough to clear one, and players can run a hall several times a day. Changed 2026-10-22: the first plan reset at real midnight.

15. **The garrison appears when the first player enters after the reset**, the way `FactionWar.SpawnArmies` does. Its strength is fixed and tuned for about three strong players. Garrisons are themed monster classes. Where they use faction troops, they need a non-battle hatred (`TroopsAttackNonShielded` or a stub battle), since `FactionTroop` ignores unshielded players.

16. **Rewards:** the boss drops a magic item from the item revamp and shillings; its trophy (17) is earned; every guild that took part gets 2 prestige.

    **The phase 4 plan (decided 2026-10-23, all four of the recommended options):**
    - **The room class:** `FallenHall is MonsterRoom` replaces `GuildHall` for the eight.
      - Each hall keeps its `.roo`, exits and sector or wall doors. It loses the chests, the news ball, the rank and foyer rules and the hall-is-safe rules.
      - Frular no longer lists them, because only `GuildHall`s join `plGuild_halls`.
      - `FallenHall` carries shims for the names the hall files share with `GuildHall` (`plGuild_doors`, `plEntrance`, `ptEntrance`, `ClearDoor`, `TimeStampDoor`, `InFoyer`, `CanEnter`, the door sounds), and for the calls that F8 (the Den of Shadows' balcony) and Ko'catan south (the Slaughtered Command's porch) make into their halls.
      - A room's class only changes when the room is built, so this needs a fresh world.
    - **A high-end ladder.** Each hall is harder than the last, at about these levels:

      | Hall | Level |
      |---|---|
      | Den of Shadows | 90 |
      | Friends of the Forest | 105 |
      | Muskgate Post | 120 |
      | Old Dwarven Hall | 135 |
      | Abandoned Warehouse | 150 |
      | Sewer Hideout | 165 |
      | Slaughtered Command | 185 |
      | Wetland Fortress | 200 |

      Each boss is 1.5 to 2 times its garrison. The Queen's capstone (26) comes above them all. *Changed 2026-10-23 after timed fights (As built, phase 4): each boss is about 15 levels above its garrison, with its toughness in hit points and damage.*
    - **The sanctum holds the boss.** Each hall's old secret door (its own `OpenSecretDoor`, stairs, lift or wall) becomes the way in. It opens once the garrison in the main hall has fallen.
    - **A fixed garrison,** tuned for about three strong players.
      - Each hall lists its forces as class, square and role.
      - They are spawned on the first entry after a reset, placed as `FactionWar.PlaceTroop` places troops, and kept from being tidied away (`SetDontDispose`).
      - They never regenerate (`pbGenerateMonsters` FALSE).
    - **The reset** comes on `System.NewGameDay`, through a lazy `FallenHalls` singleton. A hall with players in it resets when the last one leaves.
    - **The Order's forces:**
      - an Order soldier: a `NecromancerTroop` subclass that hates every player, since the troop's own rules spare the unshielded;
      - a new Order mage: Qor or Riija spells, after `FactionMage.SetBattleSchool`;
      - the effigy, with its treasure bug fixed (it has `viTreasure_type = $`, so it drops nothing);
      - dark angels, only as a boss's guards in the larger halls.
    - **Themes alongside the Order:**
      - Den of Shadows: Riija casters, shadowbeasts and reflections.
      - Friends of the Forest: evil ents, death spiders, wolves and effigies.
      - Muskgate Post: ice elementals, the wendigo and snow rats.
      - Old Dwarven Hall: skeletons and spirits as the dwarves' dead.
      - Abandoned Warehouse: bandits and snipers, smuggling the Order's relics.
      - Sewer Hideout: lupoggs, dusk rats and bandits.
      - Slaughtered Command: undead knights and captains.
      - Wetland Fortress: thrashers, frogmen and napalm slimes, with a Dark Angel lieutenant.

      The bosses are named after `icelech.kod` (`vbNamedMob`, own names, raised level and hit points).
    - **The boss's drop:** a guaranteed magic item, carried in its inventory so it drops at death. Its tier rises with the ladder: moderate low down, potent in the middle, and a chance of enormous at the top (`ItemAttribute.AddToItem` with `iPower`). It drops shillings as well.
      - Killing the boss clears the hall: every guild that struck it gets 2 prestige.
    - **Build order:** the shared parts and the Slaughtered Command end to end, then a playtest, then the other seven in batches.

### Trophies and prestige

17. **One trophy per guild for each listed creature** (`Monster.GetTrophyId`, set on the class):
    - the 8 Fallen Hall bosses;
    - 12 from the world: the Orc Pit Boss, the Lupogg King, Queen Venya'cyr, the ghost of Far'Nohl, the Queen Spider, the Dragonfly Queen, the Avar Chieftain, the Groundworm Queen, the Spinebeast Behemoth, the Ice Dragon, the Earth Dragon and Xeochicatl.

    Left off for now: the Dark Angel and the Thrasher (ordinary spawns), the Yeti (no fixed home), arena and event bosses, and the death-realm bosses.

18. **Who earns it:** when a trophy creature dies (`Monster.Killed`), every guilded player who is in the room and in its `plAttackers` earns the trophy for their guild, if the guild doesn't have it yet (`Guild.plTrophies`: id, date, members' names). The guild's online members are told. Later kills earn nothing more.

19. **A trophy case in every guild hall** lists the guild's trophies with the date and the members who took part. The count also shows on the recruiting notice and in the guild window. Mounted trophies as decorations are later.

20. **Guild prestige** (`Guild.piPrestige`, `AddPrestige`) never decays.
    - **Earned from:**
      - a Fallen Hall trophy, 25;
      - a world trophy, 10;
      - a Fallen Hall cleared, 2 to each guild that took part;
      - kills that earned the guild bonus, 1 per 50, at most 5 a day.
    - **Tiers** at 0, 50, 150, 300 and 500 (`GetPrestigeTier`) set the chest limit (10). That's its only use for now. Reaching a tier tells the guild's online members.
    - **Seeing it:** any member says "prestige" in the hall.
    - **The daily cap** counts real days (`GetTime() / 86400`).

### The guild bonus

21. **+20% experience for monster kills with a guildmate.**
    - **When it applies:** in `AdvancementCheck`, when another member of your guild is in the room and has struck the monster (`Player.HasGuildmateOn`).
    - **Who struck it:** `Monster.plStruckBy` (`WasStruckBy`), a new list of the players who struck it, at most 15. `plAttackers` is kept only for event mobs, and the dragons and the lich use it for their own rewards.
    - **Other accounts:** an account has only one character in the game at a time, so two guildmates in a room are always two accounts. No check is needed.
    - **How much:** 20% of the kill XP, before the flat item and monster bonuses.
    - **What the player sees:** "Guild member questing bonus experience: +X" after the usual XP message.
    - **What doesn't count:** quest XP, allied guilds, and arena kills.
    - **Prestige:** each bonus kill counts towards prestige (20).

### Cloaks

22. **A guild cloak in the guild's colours** for every member, once the Leader has set them (`HasGuildColors`). It's taken free from the hall and is for looks only: it's worn over armour and put on or off with a command. It uses ADR 0012's dye code: cloth is `GetPrimaryGuildColor` and trim is `GetSecondaryGuildColor`. The shield's insignia becomes a hotspot-51 decal when decals arrive. It needs new art through `garmentforge` and a client overlay above the torso, because nothing draws a cloak today.

### Recruiting boards

23. **The globes in the nine adventurers' halls become Guild Recruitment boards:** Tos (`toshall`, which holds the master), Barloque, Cor Noth, Jasper, Jixa, Ko'catan, Marion, Raza and Berg. They link to a new `NID_GUILD_RECRUIT` board (`NewsRecruiting`). Inns keep `NID_ANNOUNCEMENTS`. Berg's swapped pair is put right.

24. **One notice per guild.** An Officer or the Leader posts it, and a new one replaces the old. The server heads it with the Leader, member count, hall, prestige and trophy count. Anyone can read it. The notice goes when the guild does.
    - **As built (phase 3):**
      - The notice's title is the guild's name, with the poster's title after it.
      - The header is built each time the notice is read (`NewsRecruiting.GetNewsBody`), so it's never stale. It carries the Commander, the member count, the hall and whether it's open, and the prestige. The trophy count joins in phase 5.
      - The poster is told the notice is up.

25. **The General News board (`NID_TOS_HALL`) retires,** because the adventurers' halls were its only globes.

### The Order of Necromancers (decided 2026-10-23)

26. **The Order of Necromancers took the Fallen Halls** (planned, for phases 4 and 6; phase 4 built).
    - **The story:** the eight halls fell to Queen Venya'cyr's Order of Necromancers, the guild of the old Necromancer/Hunter scenario.
    - **The garrisons:** each Fallen Hall's garrison is drawn from the Order's forces (`NecromancerTroop`, `NecromancerEffigy`, dark angels) alongside the hall's own theme, and each boss is one of the Queen's lieutenants.
    - **The capstone:** a guild that holds all eight Fallen Hall trophies may open the way down through the lever maze under Castle Brax (`LichMaze`, RID 825) to the Inner Sanctum (RID 749). The sanctum is itself a fallen guild hall: it is built on hall 15's map, the one hall never sold.
      - Its ten levers, whose effects are shuffled, and the four spy globes become the dungeon's puzzle, reshuffled every Meridian day.
      - The fight with Queen Venya'cyr there earns a capstone trophy, worth more prestige than a Fallen Hall.
      - Queen Venya'cyr stays a world trophy (17), and Tendrath's quest 169 still has players kill her as now.
      - How the capstone fight differs from that kill is settled when it's built.
    - **The lore:** the Order's founding mails, the Queen's lines, the hunger and tribute warnings, and the Watcher's journal in the Brax Arena are the source text. They are kept in git history when the code goes (27).

27. **The old Necromancer/Hunter scenario's code goes** (cleanup, 2026-10-23). It has been unreachable since the faction revamp:
    - nothing creates the Ghostly Remains (`DeadLich`);
    - no live quest founds the Order;
    - the amulet and sword spawners are commented out;
    - the two artifacts are now Champion's Gifts (ADR 0021 decision 11).

    **What goes:**
    - the Order's guild class (`NecromancerGuild`) and the guild commands' checks for it;
    - the Order's quest template and its QuestBook and QuestEngine prize (`QRW_NECRO_GUILD`, `EstablishNecromancerGuild`);
    - `DeadLich`;
    - `NecromancerBalance`'s artifact generator, hunger balancing and PK statistics;
    - the sword-against-amulet PvP branches and kill announcements.

    **What stays:** Brax's rooms, maze, levers and spy globes, Queen Venya'cyr, the necromancer troops and effigies, Tendrath and his quests, and the gifts.

### Finding the Fallen Halls (planned 2026-10-23)

Nothing pointed players at the Fallen Halls: they sit behind their old doors, and Frular no longer lists them. Players already don't need a guild hall to fight them. What was missing was a way to find them and a reason to come back. The user chose four parts: a Guild Master beside each faction leader for the guild story, daily hall quests in the guild window, announcements when a hall falls, and the guild window as the place for repeatable guild quests.

28. **Three Guild Masters, the project's first new NPCs.** One stands beside each liege, so players who come to talk to their faction find their faction's Guild Master too:

    | Guild Master | Beside | Room | Square to try |
    |---|---|---|---|
    | the Duke's | Duke Akardius | `RID_DUKE3` 952, `duke3.kod` | 28,32 or 28,36 |
    | the Princess's | Princess Kateriina | `RID_CASTLE2C` 852, `castle2c.kod` | 32,21 or 33,25 |
    | the rebels' | Jonas D'Accor, the Jasper tavern | `RID_JAS_BAR` 371, `jastavrn.kod` | 8,6 or 7,7 |

    - **The class:** `GuildMaster is Human`, an NPC (`AI_NPC | AI_NOMOVE | AI_NOFIGHT`, `MOB_NOFIGHT | LISTEN | RECEIVE`), with one subclass per faction. It's built from player body parts, as `FactionTroop` and `Companion` are, and dressed in its liege's colours (`SetClothes`, `SetDefaultClothes`, `SetTroopLegs`), with its own face, hair and a fixed weapon or none. So it needs no new art. A bespoke sprite can come later through the Sprites tab as a new `.bgf`.
    - **Placing:** each room's `CreateStandardObjects` makes its Guild Master (`NewHold`). The lieges come from `Parliament.RecreateLieges`, but the Guild Masters stay put whoever holds power.
    - **Who they serve (default, to confirm):** every Guild Master serves any guild member, whatever their faction, so guildless and neutral players aren't shut out. A Guild Master's faction only colours its words. A neutral player can use any of the three.
    - **Names (placeholders, to confirm):** Master Aldric Vane for the Duke, Dame Seraphine Dawnmere for the Princess, and Brannoc the Red for Jonas.

29. **The guild story: one quest per Fallen Hall, in ladder order,** from any Guild Master (`"giver": {"class": "GuildMaster"}`; `IsClass` matches the subclasses). The chain is "The Order of the Fallen Halls": the Guild Master tells how the Order of Necromancers took the old guild halls, and sends the guild up the ladder.
    - **Quest 1, "A Guild's Calling":** needs a guild. The Guild Master explains the Fallen Halls and sends the player to the Den of Shadows' door (a `visit` step).
    - **Quests 2-9:** each a first clear of the next hall (the new `fallen` step, 31), with the hall's HP gate (30) and the previous quest as its prerequisite. Each story text reveals a piece of the Order's plan and names the hall's lieutenant.
    - **The end:** the last points at the Inner Sanctum capstone (26), which waits for phase 6's trophies.
    - **Rewards:** XP (`xpPoints`) and shillings, rising with the ladder, and guild prestige (the new `prestige` reward, 31).

30. **Daily hall quests, the "End Game" dungeons.** Each Fallen Hall has a repeatable quest with a 24-hour cooldown, so guilds have a reason to run them every day. They are offered in the guild window (32), not by an NPC.
    - **Gate:** a guild member (the new `inGuild` requirement, 31) with at least the hall's base max HP. The Den of Shadows opens at 80 HP, the Friends of the Forest at 90, and the other six at 100.
    - **Rank:** each hall has a difficulty rank shown with its name, so players know which are harder. Rank I is the Den of Shadows, II the Friends of the Forest, III Muskgate Post, IV the Old Dwarven Hall, V the Abandoned Warehouse, VI the Sewer Hideout, VII the Slaughtered Command and VIII the Wetland Fortress. All eight are marked End Game.
    - **Done:** when the hall's boss dies with the player present who struck it (31). It completes on its own, with no turn-in.
    - **Rewards:** XP and shillings by rank. Prestige already comes from the boss itself (16).
    - **Unlock (default, to confirm):** a hall's daily is offered once the player has done that hall's story quest (29), so the story leads into the dailies.
    - **Halls reset more often:** a Fallen Hall re-arms every Meridian day (two real hours), but its daily quest pays once a real day. A hall can be run again for its loot.

31. **Quest system additions** (`util/questbook.kod`, the generated `questdefs.kod`, and the tool in `tools/quests`):
    - **`requires.inGuild`:** a new needs bit, `QBQ_IN_GUILD` 64, checked in `MeetsNeeds` (`GetGuild <> $`). Today there are only guild master, guild shield and no guild.
    - **A `fallen` step** (`QK_FALLEN` 24), naming a hall's room. `FallenHall.BossSlain` sends the quest book `FallenHallCleared` for each present player who struck the boss, which calls `ActionDone`. A kill step on the boss class wouldn't do: it credits only the killing blow and its group.
    - **`start: "guild"`:** a quest with no NPC giver. A new needs bit (128) keeps NPCs from offering it, the way death quests work. New `QuestCommand` verbs, `quest board` (the guild quests the player may take, past `CanOffer`) and `quest board-accept <id>`, skip `NpcNear` and go to `StartQuest`. The tool makes `giver` optional when `start` is "guild", in `schema.ts`, `validate.ts` and `catalog.ts`.
    - **A `prestige` reward** for the story quests, through `Guild.AddPrestige`.
    - **Also to update:** `kodWriter.ts`'s columns and the tests that check them, the admin dashboard's quest tab, and ADR 0009.

32. **The guild window gets a Fallen Halls tab and a Guild Quests tab** (`GuildDialogs.tsx`). The story stays with the Guild Masters; the window holds what's current and repeatable.
    - **Fallen Halls:** one row per hall, with its rank, name, minimum HP, where its door is, and its state:
      - held by the Order;
      - its sanctum open;
      - or cleared today, and by which guild;
      - and when it resets.

      Each row also shows the player's own daily: offered (with an Accept button), taken, or done until a time. The window replaces the "live board" globe idea.
    - **Guild Quests:** the guild's other repeatable quests, empty until there are some.
    - **The packet:** a new `UC_FALLEN_HALLS` (121), built in `FallenHalls` like `UC_FACTION_WAR`. It's asked for with the command "halls" (`UC_SHARDS` â†’ `ShardsCommand` â†’ `SYS@GetFallenHalls`). It's pushed to guild members on every change (a boss's death, a sanctum opening, a reset).
    - **The countdown:** the client counts down from "seconds to reset", sent with the packet. That means working out the time to the next game day from the game hour.
    - **Accepting:** the window sends "quest board-accept <id>". The page area is small (`dlu` 284Ã—160), so eight rows need a list.

33. **World announcements when a hall falls.** `FallenHalls.Announce` tells every logged-on player, as `FactionWar.Announce` does: "[Halls] The Testers have driven the Order from the Den of Shadows." With no guild present it names the player who struck last. The client's `chatChannel.ts` `ANNOUNCEMENT` pattern gains `[Halls]`, so these lines stay in the Server tab instead of the combat tab. No announcement for the resets (default, to confirm): one every two hours would be noise.

## Order to build

0. **Cleanup:** 5, 6, 3, 2 and 1 (rank names and the moved powers). Also two bugs: `RID_GUILDH_MAX` is 716, so the foyer check in `user.kod` skips halls 17, 19 and 20; and Berg's globes.
1. **Halls:** 7, 8, 9, 11 and 4.
2. **Prestige and the guild bonus:** 20, 21 and 10.
3. **Recruiting boards:** 23 to 25.
4. **Fallen Halls:** 12 to 16, with the Order's forces as their garrisons (26), one hall at a time, starting with the Slaughtered Command.
5. **Finding the Fallen Halls** (28-33), in three parts:
   - **5a, the server:**
     - the quest system additions (31) and the eight daily hall quests (30);
     - the announcements (33);
     - the `UC_FALLEN_HALLS` packet and the "halls" command.
   - **5b, the Guild Masters:** the three NPCs (28) and the story chain (29).
   - **5c, the client:** the guild window's Fallen Halls and Guild Quests tabs (32), and `[Halls]` in the announcement pattern.
6. **Trophies:** 17 to 19, and the Inner Sanctum capstone (26).
7. **Cloaks:** 22, the art and the client overlay.
8. **Client:** the rest of the guild window (`GuildDialogs.tsx`). This means the new rank names, no Vote, and a Hall tab with the public toggle, chests, prestige and trophies. The recruiting board reads like any news globe.

## Consequences

- **No more raids.** A guild's hall and chests can't be lost to another guild. Guild wars remain consensual PvP outside halls, with red names (ADR 0021).
- **Halls become social spaces.** Public halls and trophy cases give a guild something to show visitors. The recruiting boards give solo players a way to find a guild.
- **Fallen Halls are a shared resource that resets every Meridian day (two hours).** With no instancing, the first group in each game day takes a hall's boss. That's fine at today's population, and it may need a lockout or instancing later.
- **New limits.** Hall chests now have a size limit where before they had none. On a fresh world this costs nothing; on a saved world it would only stop new deposits.
- **Saved worlds:** the rank numbers don't change. A guild renting one of the eight Fallen Halls loses it. Removed classes (`GuildLever`, the vote command) need stubs only on a saved world, and the plan is a fresh one.
- **Joining a guild still ends newbie protection** (`EvaluateNewbieStatus`). With no random PvP that matters only for guild wars.

## Left to settle when it's built

- Each Fallen Hall's theme, garrison and boss, and how hard they are.
- The cloak's art and where the client draws it.
- Rent's amount: halls still pay `viQuality × 50` an hour, doubled on non-PK servers. Whether to charge rent at all was settled under decision 4.
- What prestige buys beyond chest space.

## As built

- **Phase 0, the cleanup (shards-server 146967e0, 2026-10-22).** 44 files, about 1,800 lines out. The Kod builds cleanly.
  - **No conquest (5):**
    - `ghall.kod` keeps only `STATUS_UNOWNED` and `STATUS_OKAY`. Gone from it:
      - the lever, the conquest properties and timers, and `GuildLeverFlipped`, `CanRaidGuildhall`, `ConquerTimer`, `WarnGuildMembers`, `AreDefensesDown`, `DefensesUp` and `DefensesDown`;
      - the conqueror branches in `GetPurchaseValue`, `Delete` and `DefunctGuild`.
    - The halls' raid hooks are gone too:
      - hall 2's raid door, which now stays shut;
      - hall 4's flickering light;
      - hall 10's lowering maze, which now stays raised;
      - the alarm gongs in halls 12, 13 and 14;
      - every hall's lever position.
    - `gldlever.kod` is deleted. So are `Guild.GuildHallConquered` and the last-raid properties, the necromancer order's override, the abandon check in `gcaband.kod`, and `pbGuildHallRaids`/`piGuildHallRaidDelay` in `settings.kod`.
    - **Shatterlock** is deleted as well: `shttrlck.kod`, the Jasper general's and the Rebel teacher's offers, and its `SID_SHATTERLOCK` 139, which is kept reserved. The spell opened a hall's door to anyone, and hall chests only refuse use from the foyer. Prisms stay for the other group spells.
  - **Halls are safe (6):** `AllowBattlerAttack` refuses any attack on a player inside a `GuildHall`, with `player_no_hall_pvp`, and halls are no longer an exception to `MayAttackPlayer`. A player's minion in a hall is checked against its master, so it's protected the same way. `UserReqNewOwner` no longer turns away players below the PvP flag.
  - **Two members, no disbanding (3):**
    - `MINIMUM_MEMBERS` is 2, and maturity counts down with two.
    - The `piThreePersonWarning` countdown and its messages are gone from `Guild` and `NecromancerGuild`.
    - Frular's founding and maturity mails are rewritten: no conquest, two members, the new ranks, succession, and safe halls.
  - **Succession (2):**
    - `GuildVote` (`gcvote.kod`, `GCID_VOTE`, kept reserved), `Vote`, `CountVotes`, the `UC_VOTE` case and their messages are gone.
    - `Guild.CheckSuccession` runs each maintenance tick. With no Leader, or with the Leader away for `LEADER_INACTIVE_SECS` (30 days, `IsActiveMember`), `ChooseSuccessor` picks the highest-ranked active member, the longest-serving first.
    - `NewGuildMaster` now moves the old Leader down to Lord (Trusted), not Sir.
    - The necromancer order still gives its master's place to a member who kills them.
  - **Ranks (1):**
    - The default names are Commander, Lieutenant, Lord (Lady), Sir (Madame) and Apprentice: the old ones, with Commander in place of Guildmaster. The German and Portuguese names are kept, with Kommandant and Comandante added.
    - The roster is open to Recruits (`gcroster.kod`).
    - Abandoning the hall (`gcaband.kod`), leasing it at Frular (`GuildCreator.GetForSale`) and `UserCommandGuildRent` are the Leader's only.
  - **Fixes:**
    - `RID_GUILDH_MAX` is now 720. It was 716, so the foyer move check skipped halls 17, 19 and 20.
    - `UserCommandCreateGuild` now checks what Frular does: no guild yet, past newbie protection, and Frular in the room. Before, a guilded player could found a second guild.
    - A Leader's renounce now stops after its refusal message.
    - Berg's hall globe is now General News, and its inn has the Designers' News.
  - **Translations:** the German and Portuguese entries for removed or rewritten texts are removed, so those players see the English.
  - **Our client (this repo, uncommitted):** `GuildDialogs.tsx` loses the "Currently supporting" line and the vote button, and the create window offers the default rank names above.
  - **Not tried in the game.** It needs a fresh world, because a saved one still holds `GuildLever`, `GuildVote` and `Shatterlock` objects whose classes are gone.
- **Phase 1, the halls (shards-server f735b043, 2026-10-22).**
  - `ghall.kod`:
    - `pbPublic` with `SetPublic`, `IsPublic` and the new `CanEnter`;
    - `GetMemberRank`, `IsSanctumWord` and `IsDoorWord`;
    - `HallCommandSaid` for "hall public", "hall private" and "recall stone";
    - `AssignChestRanks`, `CanUseChest` (`ReqUseGuildChest` now names the chest) and `RecallTo`.
    - Halls 5, 12, 13 and 14 have their own `SomeoneSaid`, so they call `HallCommandSaid` and `IsSanctumWord` themselves. Hall 16's `ReqUseGuildChest` ends in `CanUseChest`. `f8.kod`'s balcony door uses `IsDoorWord`.
  - New chests in halls 1, 10 and 12.
  - `storebox.kod`: `piGuildRank` and the chest names. `user.kod UserObjectContents` asks the hall before showing a chest's contents.
  - New `object/item/passitem/grecall.kod` (`GuildRecallStone`). It crumbles in `Player.ResetGuildStuff`.
  - `guild.kod`:
    - `HasActiveMember`; the maintenance tick releases the hall of a guild with none (4);
    - the password is gone (`psPassword`, `ChangePassword`, `GetPassword`, and `SetGuildHall`'s argument);
    - Frular's mails describe chests, the sanctum, visitors and recall stones.
  - The password command is gone: `gcpword.kod`, with `GCID_SET_PASSWORD` kept reserved, and the `UC_GUILD_SET_PASSWORD` case. `UserCommandGuildRent` ignores the password the client still sends, and the guild info packet never carries one.
  - **Our client (this repo, uncommitted):** `GuildDialogs.tsx` drops the password from the Guildmaster tab and the rent window. The Guildmaster tab tells a guild with a hall about "hall public" and "hall private".
  - **Tried on the dev server over the maintenance port (a fresh world, Testers leasing the Hall of Explorers):**
    - its four boxes became two common chests, a members' chest and a vault; halls 1, 10 and 12 got theirs at the planned squares;
    - an Apprentice could enter the private hall and use only the common chest, and a stranger could neither enter nor use a chest;
    - a Lord could use the vault and say "open", but not make the hall public; the Commander could, and then the stranger could enter but still not use a chest;
    - an Apprentice got no recall stone; a Sir got one, used it from the Lake of Jala's Song and arrived inside the hall past the foyer five seconds later; a second use was refused for the cooldown, and the stone crumbled when the Sir left the guild;
    - with every member's last login backdated past 60 days, the next maintenance tick gave the hall back to Frular and kept the guild.
  - **Build trouble, for next time:**
    - `chest` and `guild` are class names, so they can't be parameter names.
    - A compile that failed partway left `kodbase.txt` with forward references and its classes out of order, and `bc` then crashed on every file. It was rebuilt from a good copy's class order (`deploy/.stage/gamedata/kodbase.txt`) with the current entries.
    - Files built during the bad run held stale IDs (`player.kod` didn't find the stone), so they were rebuilt.
  - **Not tried in the game client:** how the new chests look and where they stand, the messages, and the dialogs.
- **Phase 2, prestige and the guild bonus (shards-server 5fb122b5, 2026-10-22).**
  - `player.kod`: `GUILD_BONUS_XP_PERCENT` (20), the bonus in `AdvancementCheck` (its own `AddXP`, then "Guild member questing bonus experience: +X"), and `HasGuildmateOn`.
  - `monster.kod`: `plStruckBy` and `WasStruckBy`, kept in `AssessDamage`.
  - `guild.kod`: `piPrestige`, `GetPrestige`, `GetPrestigeTier`, `GetChestLimit`, `AddPrestige` and `GuildBonusKill`. Frular's maturity mail mentions prestige.
  - `ghall.kod`: `ChestHasRoom` and "prestige". `storebox.kod`: `GetItemCount`, and the room check in `ReqNewHold`.
  - **Tried on the dev server over the maintenance port:**
    - the tiers and chest limits from 0 to 499 prestige;
    - 50 bonus kills giving a point, and 300 giving only today's 5;
    - a common chest refusing a 51st mace, then taking more after the guild passed 50 prestige;
    - Shardbot killing an orc struck by both him and Scout: 99 XP with Scout in the room, 83 without (83 plus a fifth).
  - **Not tried in the game:** a real fight with two players, and the messages.
  - The build was clean.
  - Removed a stale `m Towns` forward reference from `kodbase.txt`, left by an earlier build; it made `LoadKodBase` warn on every boot.
- **Fixes from the phases 0-2 playtest (shards-server 5fb122b5, 2026-10-22).**
  - **The hall icon:** halls showed "PvP Combat Allowed". `GuildHall.SendRoomIcons` now shows the safe room's icon. The halls aren't made `ROOM_NO_COMBAT`, because that would also stop members casting buffs on one another (`PersonalEnchantment`).
  - **Hall 17** had `ROOM_GUILD_PK_ONLY` in place of the sanctuary flag, and now has `ROOM_SANCTUARY`. The running world was set by hand; a fresh one gets it when the hall is built.
  - **Frular's ALLIES paragraph** said allies enter "as if it were their own". It now matches decision 7: allies of the named rank and higher, and never your chests.
  - **"hall public" from a rank below Lieutenant** now says who may do it, instead of nothing. This wasn't tried: the test hall had been given up.
  - **Not bugs:**
    - a disbanded guild object stays until the next save's garbage collection;
    - a Leader has no renounce command, by design, so a raw command does nothing;
    - the rent window still lists the eight halls phase 4 turns into Fallen Halls;
    - texts that didn't show came from a stale `dist/assets/rsc0000.rsb`.
  - **Rent only for halls (2026-10-23):**
    - `AccrueRent` charges nothing without a hall and clears any debt, though prepaid credit stays.
    - The rent countdown takes the hall back (`AbandonGuildHall`) in place of deleting the guild.
    - `guild_rent_nonpayment`, `guild_rent_due`, Frular's `gcreator_*_til_rent` and the founding mail's RENT paragraph say so; their old translations are gone.
    - Tried over the maintenance port: no hall meant no rent, and 900 owed was cleared; a leased hall accrued rent; a run-out countdown released the hall and kept the guild; and -2000 of credit stayed.
- **The Necromancer/Hunter scenario's cleanup (27; shards-server dbf0e91a, 2026-10-23).** About 1,400 lines out of 30 files.
  - **Deleted:**
    - `NecromancerGuild` (`object/passive/guild/`, the whole folder) and its checks in `Guild`, `GuildCommand.ResetCommand` (its `necro` argument and `viNecro_enabled`), the six guild commands (with their refusals) and Frular;
    - `DeadLich`;
    - the QuestEngine's founding quest and its checks (`Q_R2_NUM_AMULETS`, `Q_R2_NECRO_GUILD_ACTIVE`), `QN_PRIZETYPE_ESTABLISH_NECROGUILD` and `QRW_NECRO_GUILD`;
    - `System`'s `poNecromancerBalance`, its PK counters and its creation;
    - the sword-against-amulet PvP branches in `Player` (`AllowBattlerAttack`, `KilledSomething`, `Killed`), with `UserKilled`'s `Sword`/`Amulet` messages;
    - the amulet's `OrderOfNecromancersDisbanded`;
    - the commented-out intruder warnings in the maze and the Necropolis;
    - the quest tool's `necroGuild` reward (this repo).
  - **Kept as empty stubs** for a saved world: `NecromancerBalance` (`util/necbal.kod`) and `NecroGuildQuest`. The first reload of a saved world logs their dropped properties and timer once.
  - **Kept:** Brax's rooms, maze, levers and globes, Queen Venya'cyr, the necromancer troops and effigies, Tendrath, and the Champion's Gifts (still undead to Final Rites, and the amulet's illusion slip).
  - **Stale bofs:** the server's `memmap` still held bofs for every class deleted since phase 0 (`GuildLever`, `GuildVote`, `Shatterlock`, `GuildSetPassword`, `NecromancerGuild`, `DeadLich`), so the server went on loading them. They were deleted. Deleting a class's source doesn't remove its bof from `run/server/memmap`.
  - The build was clean, and the dev world reloaded.
- **Phase 3, the recruiting boards (shards-server 0c0de565, 2026-10-23).**
  - New `object/passive/news/newsrecr.kod` (`NewsRecruiting`, newsgroup `NID_GUILD_RECRUIT` 21):
    - `GetNewsPermission`: Lieutenants and up of any guild, and DMs, may write;
    - `PostNews` keeps one notice per guild (`plGuildNotices`) and titles it with the guild's name;
    - `GetNewsBody` adds the live header;
    - `RemoveGuildNotice`, which `Guild.Delete` calls, and `DeleteMail`/`DeleteAllMessages` keep the list tidy.
  - The nine adventurers' halls: Tos's hall makes the board (in place of the General News `News`), and the other eight link to it, now named "Guild Recruitment". Their old translations are gone. `NID_TOS_HALL` stays, retired (25).
  - Frular's maturity mail has a RECRUITING paragraph.
  - **Tried on the dev server over the maintenance port** (the nine halls rebuilt with `Recreate`):
    - Tos holds the board and Barloque links to it, both named "Guild Recruitment";
    - a Commander may write and a guildless player only read;
    - a second post from the same guild replaced the first;
    - another guild's notice stood beside it, and went when that guild was deleted;
    - the title read "The Playtesters";
    - the header read "Led by Commander Shardbot.  Members: 1.  No hall yet.  Prestige: 0."
  - The notice bodies posted over the maintenance port were blank, because the port passes temporary strings. The client's posts are real strings, as for every globe.
  - **Not tried in the game client:** reading and posting through the globe window.
- **Phase 4, the Fallen Halls: the shared parts and the Slaughtered Command (shards-server, 2026-10-23, not yet committed).** The other seven halls are still guild halls.
  - New `room/ghall/fallenhall.kod` (`FallenHall is MonsterRoom`), built first in the folder:
    - states `READY`, `HELD`, `SANCTUM` and `CLEARED` (`piState`);
    - `GetGarrison` (the subclass's `[class, row, col, role]`, the roles `FALLEN_ROLE_HALL`, `_SANCTUM` and `_BOSS` in `blakston.khd`) and the classvars `viGarrison_level`, `viBoss_level`, `viBoss_hp_percent`, `viBoss_damage_percent` and `viPrize_seed`;
    - `SpawnGarrison` on the first player in after a reset. The boss carries the prize: `TreasureType.GenerateItemAtt` at `viPrize_seed`, unrolled (`raw`), from the necromancer treasure. It drops as the boss dies.
    - `LeaveHold` keeps the lists. The last of the hall's guard gone calls `StartSanctum` (`OpenSanctum` in the subclass), and the boss gone calls `BossSlain`: 2 prestige, once, to each guild with a member present who struck it (`WasStruckBy`, so spells count).
    - `NewGameDay` resets an empty hall at once (`ResetHall`), and otherwise sets `pbResetDue` for `LastUserLeft`.
    - The door shims: `plGuild_doors`, `plEntrance`, `ptEntrance`, `TimeStampDoor`, `CloseEntranceDoor`, `ClearDoor` and the door sounds. The outer doors open for anyone, and `CanEnter`, `GetGuildOwner` and `IsDoorWord` answer as for an open, unowned hall.
    - Not a `GuildHall`, so it isn't in Frular's list, isn't safe, and has no chests or news ball.
  - New `util/fallenhalls.kod` (`FallenHalls`, `SYS@GetFallenHalls`, made on demand). Each hall adds itself as it's built, and `System.NewGameDay` passes the day on. Over the maintenance port, `send object <FallenHalls> NewGameDay` resets them all.
  - **The Order's forces:**
    - `Monster.SetGarrisonStrength(level, hp, damage_percent)` sets offence, defence, damage and hit points for a level (`piGarrisonLevel`, which `GetLevel` returns, so kill XP follows it) and keeps the monster from being tidied away. `damage_percent` scales the damage alone.
    - `FactionTroop.pbHuntsAll`: hates every player, the nearest most, and leaves other monsters be.
    - New `OrderSoldier` (a `NecromancerTroop`) and `OrderMage` (a `FactionMage` of the Order, casting Qor's spells).
    - New `FallenMarshal` (a `CaptainKnight`), Marshal Corvane, the Slaughtered Command's boss.
    - Soldier shields and war deaths ignore the Order's kills (`soldshld.kod`, `Player.IsWarDeath`), since it isn't a liege.
  - **Hall 13, the Slaughtered Command (`GuildHall13 is FallenHall`):**
    - level 185; the boss at level 200 with five times the hit points (1,200) and 90% damage (12-18), after the timed fights below; the prize at difficulty 9;
    - the main hall: four Order soldiers, two Order mages, two half knights and two tusked skeletons;
    - the sanctum, behind the old secret wall (columns 26 and 27): two captain knights and Marshal Corvane;
    - "open" said beside the wall goes through it once the hall's guard has fallen, and back out at any time;
    - the chests are gone. Ko'catan south's porch check still works through `CanEnter`.
  - The effigy's treasure fix waits for a hall that uses effigies.
  - **Tried on the dev server over the maintenance port** (a fresh world; the old one is in `run/server/savegame-before-guild-phase4-2026-10-23`):
    - the first player in brought out all 13 at the planned squares, at level 185 with 222 hit points, and the boss carrying a magic short sword;
    - a level-1 player at the wall was killed by the guard;
    - "open" was refused while the guard stood. With it dead, the hall went to `SANCTUM` and "open" took the player into the sanctum;
    - the boss struck and killed by a Testers member: `CLEARED`, Testers 0 to 2 prestige, and the sword on the floor;
    - a day turned with players inside set `pbResetDue`, and their leaving reset the hall; the next entry brought the garrison back; a day turned on an empty hall reset it at once;
    - the porch from Ko'catan south still let a player in.
  - **Tuning the boss (2026-10-23)**, with timed fights through the AI playtester's headless body (`tools/agent/_bossfight.tmp.ts`, temporary). The fighters were maxed: 150 HP, 99 in every combat skill, plate, a knight's shield and helm, and a hammer. They were buffed with Bless, Super Strength, Magic Shield and Armor of Gort at spell power 99, which high-level players are expected to use.
    - **The goal (the user's):** a boss almost impossible solo and killable by two; tough halls that aren't impossible.
    - **What we learned:**
      - A monster's level isn't on the player's 150-HP scale. It sets offence and defence (4 x level + 8 x aim or agility), damage (level / 15 to level / 10) and hit points (1.2 x level).
      - At level 300 (offence and defence 1,600, damage 20-30) Corvane hit a maxed player about 96% of the time, and was hit about a third of the time. He killed a lone fighter in about 20 s, and a pair in under 50 s, losing only 18% of his health.
      - Armour takes a flat amount off each hit: about 8-9 for plate, shield and helm, and about 2 more for Gort. So small damage changes matter a lot. At 8-12 damage an armoured player barely lost health; at 13-20 one lost about 5-6 HP a second.
      - Knights resist slashing by 60% and bludgeoning by 40%, so hammers and maces beat swords against them.
      - Each death costs a test fighter max HP and drops its gear; the harness restores both before every fight.
    - **The settings and results** (all at level 200):

      | Damage | HP | Duo, buffed | Solo, buffed |
      |---|---|---|---|
      | 60% (8-12) | 960 | won in about 75 s, untouched | 5 min in, boss at 33% and player untouched |
      | 80% (10-16) | 960 | won in about 70 s, tank at 117 of 150 | won in about 130 s, at 72 of 150 |
      | 90% (12-18) | 1,200 | won in about 80 s, tank at 92 of 150 | died at about 155 s, boss at 18% |

    - Kept: 90% damage and 1,200 HP. Two buffed players win; one loses narrowly, so potions or a companion might let a solo player squeak through. **For the other halls:** bosses about 15 above their garrison's level, with their toughness in hit points and damage, not level.
    - The garrison: one maxed player killed one Order soldier (level 185) in about 29 s, losing 32 of 150 HP. Pulling the whole main hall at once would be deadly.
  - **Not tried in the game client:** a real fight against the garrison, with spells, heals and companions; the messages; and how the Order's soldiers and mages look.
- **Phase 4, the other seven Fallen Halls (shards-server, 2026-10-23, not yet committed).** All eight halls are now Fallen Halls. Seven read-only surveys mapped each hall's rooms, secret door and themed monsters first.

  | Hall | Garrison (level) | Sanctum guard | Boss (level, HP) | Prize | Sanctum door |
  |---|---|---|---|---|---|
  | 3 Den of Shadows | 4 Order soldiers, 3 Order illusionists, 3 shadowbeasts (90) | 2 illusionists | Mistress Ysolde, an Order illusionist (105, 630) | 5 | the bridge, sector 2 |
  | 11 Friends of the Forest | 3 soldiers, 2 Order mages, 2 diseased trees, 2 death spiders, a wolf (105) | a wolf, a death spider | Old Blackroot, a diseased tree (120, 720) | 6 | the floor at column 18, sector 2 |
  | 20 Muskgate Post | 3 soldiers, 2 mages, 3 ice elementals, 2 wendigos (120) | an ice elemental, a wendigo | Hrimvald, an ice elemental (135, 810) | 6 | a lift, sector 1 |
  | 7 Old Dwarven Hall | 4 soldiers, 2 mages, 2 daemon skeletons, 2 tusked skeletons (135) | 2 daemon skeletons | Thane Durrek, a giant daemon skeleton (150, 900) | 7 | the steps, sectors 1-6 |
  | 9 Abandoned Warehouse | 4 soldiers, 3 mages, 3 bandit snipers (150) | 2 soldiers | Captain Vesk, a bandit captain who doesn't flee (165, 990) | 7 | the floor at column 12, sector 2 |
  | 8 Sewer Hideout | 4 lupoggs, 3 dusk rats, 2 soldiers, a mage (165) | 2 mages | Grisk, the Sewer King, a lupogg king (180, 1,080) | 8 | walls 5-7 |
  | 13 Slaughtered Command | as above (185) | 2 captain knights | Marshal Corvane (200, 1,200) | 9 | the hidden wall, by speech |
  | 19 Wetland Fortress | 4 thrashers, 3 soldiers, 3 mages (200) | 2 thrashers | Lieutenant Morvaine, a dark angel (215, 1,290) | 10 | the floor at (5,28-29), sector 6 |

  - Every boss follows Corvane's tuning: about 15 levels above its garrison, five times the usual hit points, and 90% damage. Only Corvane was timed; the lower halls scale with the level, for lower-level players.
  - **New classes:**
    - `OrderIllusionist` (a Riija `OrderMage`); `OrderMage` now casts from the classvar `viSchool`, since a subclass's `Constructed` runs before its parent's;
    - the bosses `FallenIllusionist`, `OldBlackroot` (`monster/evilent/`), `Frostwarden` (`elemental/iceleme/`), `FallenThane` (`skel/gdaemskel/`), `SmugglerCaptain` (`human/bandit/bandcapt/`), `SewerKing` (`lupking/`) and `FallenLieutenant` (`dangel/`).
  - **Shared changes the surveys called for:**
    - The halls' secret doors closed themselves after 5-10 seconds, which could seal players in or let the boss out. Each hall's `OpenSanctum` now opens its door for good and `CloseSanctum` shuts it at the reset. Muskgate's door is a lift nobody could climb out of while it stayed down, so it keeps its old cycle, and "open" brings it down (`SanctumWordSaid`).
    - "open" said in a hall before then says the sanctum is sealed (`FallenHall.SomeoneSaid` â†’ `SanctumWordSaid`). Hall 13 overrides it with its walk-through wall.
    - A player who logs off in a sanctum and returns after a reset is moved to the hall's door (`InSanctum`, in each hall, checked in `Greet`).
    - `User.UserMove` asks every room numbered 701-720 `IsMoveOK`; `FallenHall` now answers TRUE (hall 13 had been missing it).
    - A garrison monster attacks everyone, even kinds that spare good-karma players (ents, wolves), and never fights through walls (dark angels): `Monster.ResetBehaviorFlags` when `piGarrisonLevel` is set.
    - `ClearDoor` moves only players off a closing door, not monsters.
    - The Den of Shadows' balcony door from F8 leads straight into its sanctum, so it opens only once the sanctum does (`FallenHall.IsDoorWord`, F8's `SomethingTryGo`).
    - Every hall lost its chests and wooden boxes, its news ball and foyer rules, and its dead guild classvars. Halls 7 and 19 lost their foyer move checks, and their outer doors open for anyone.
  - **Left out:** the necromancer effigy. It can't move, it targets any player in the room through walls, and it never deletes its spell timer, so it needs work first. Frogmen spare good-karma players and have their resistances swapped. Napalm slimes cast Earthquake as they die. Bandit snipers fight hand to hand, since they carry axes.
  - **Tried on a fresh world over the maintenance port** (the hall-13 world is in `run/server/savegame-guild-phase4-hall13-2026-10-23`): in all eight halls a player's entry brought out the 13 at their squares and levels, aggressive; clearing the main hall opened the sanctum; the boss's death cleared the hall and gave the player's guild 2 prestige (16 over the eight); the reset emptied it; no new server errors. Morvaine lost the dark angels' fight-through-walls flag.
  - **Not tried:** real fights in the lower seven halls; how the sanctum doors look when they stay open; the messages in the client.
- **Phase 5a, finding the Fallen Halls: the server (shards-server and this repo, 2026-10-23, not yet committed).** The user started 5a without changing the defaults in 28-33.
  - **The quest system** (31; ADR 0009 has the details):
    - `requires.inGuild` (`QBQ_IN_GUILD` 64);
    - `"start": "guild"` (`QBQ_ON_BOARD` 128), a quest with no giver taken from the guild window. `quest board` sends the board's offers as `UC_QUEST_OFFERS` with NPC 0, `quest board-accept <id>` takes one, and `QuestBook.BoardState` gives a quest's state for the window;
    - the `fallen` step (`QK_FALLEN` 24, `QuestBook.FallenHallCleared`, sent from `FallenHall.BossSlain` for each player there who struck the boss);
    - the `prestige` reward (`QRW_PRESTIGE` 6).
    - None of them needed a new column in the generated table.
  - **The eight daily hall quests** (30): `quests/fallen-daily-*.json`, ids 320-327, "Rank I: The Den of Shadows" to "Rank VIII: The Wetland Fortress".
    - Each is for a guild member at 80, 90 or 100 base HP, repeats every 24 hours, and is one `fallen` step.
    - Rewards: 0.5 to 0.85 `xpPoints` and 500 to 2,250 shillings, rising with the rank.
    - Unlocking a daily after its hall's story quest waits for 5b, which makes the story quests.
  - **Each hall** gives the window its rank (`viRank`), base health (`viMin_health`), daily quest (`viDaily_quest`) and door (`vrDoor`), and keeps who cleared it since its reset (`poClearedGuild`, `poClearedBy`).
  - **The guild window's data** (32): `UC_FALLEN_HALLS` 121, built by `FallenHalls.SendHalls`. It's asked for with "halls" (`User.ShardsCommand`) and sent after `board-accept`. `FallenHalls.Broadcast` pushes it to every guild member online when a sanctum opens, a hall is cleared or a hall resets. The seconds to the reset come from the clock (`SecondsToReset`), with a Meridian day of two real hours. The layout is in `docs/research/protocol.md`.
  - **Announcements** (33): `FallenHalls.Announce`, to everyone online:
    - "[Halls] %s%q has driven the Order of Necromancers from %s." for one guild;
    - "... and their allies ..." for several;
    - or the player's name when no guild struck the boss.
  - **The tool** (`tools/quests`): the schema, validation (a guild window quest's steps must be auto; the `fallen` step's objective is "Drive the Order from <hall>"), the catalogue's `guildBoard`, a new test, and `fallen` in the client's step kinds. The dashboard's quest tab edits the four additions, and now keeps renown and war effort rewards, which it used to drop on save.
  - **Tried on the dev server over the maintenance port**, with two players listening through the AI playtester's headless body (`tools/agent/_listen.tmp.ts`, temporary):
    - a guild member took the Den of Shadows' and the Wetland Fortress's dailies from the board, and a guildless player was refused;
    - a player at 25 base HP wasn't offered the Den's (it asks 80);
    - clearing the Den completed only the Den's quest, with 3,281 XP and 500 shillings, and its state became done for 86,397 seconds;
    - the guild gained the boss's 2 prestige, and both players heard the announcement;
    - no server errors.
  - **Two test traps:**
    - A guild made over the maintenance port has no name, because `quote` strings are temporary. Its announcement went out with an empty name and broke both test clients' connections.
    - `FallenHall` and `SendHalls` now treat a guild with no name as none. To name a test guild, set its message of the day (`SetGuildMOTD`), which stores a real string, then point `vrName` at that string.
  - **Not tried:** reading the new packet in a client, which waits for 5c's reader.
- **Phase 5b, the Guild Masters and the guild story (shards-server and this repo, 2026-10-23, not yet committed).**
  - **`GuildMaster is Human`** (`monster/human/guildmaster.kod`), the project's first new NPCs:
    - an NPC that never fights (`AI_NPC | AI_NOMOVE | AI_NOFIGHT`, `MOB_NOFIGHT`), built from player body parts;
    - each subclass fixes its looks with `viLooks_*`/`vrLooks_*` classvars (gender, hair, eyes, nose, mouth, beard, hair colour, skin, shirt and trousers), where `Human` picks at random;
    - the base class's name, "any Guild Master", is how the quests name all three ("Return to any Guild Master").
  - **The three** (`human/guildmaster/`), each made by its room's `CreateStandardObjects`:

    | Guild Master | Looks | Room, square |
    |---|---|---|
    | `DukeGuildMaster`, Master Aldric Vane | grey hair and a short beard, a purple shirt | the Chambers of Duke Akardius (952), 28,32 facing south |
    | `PrincessGuildMaster`, Dame Seraphine Dawnmere | platinum hair, an orange shirt | the Assembly Chamber (852), 33,25 facing north |
    | `RebelGuildMaster`, Brannoc the Red | red hair and a braided beard, a red shirt | Pietro's Wicked Brews, the Jasper tavern (371), 7,7 facing north |

    The squares were checked open on the room maps; the survey's 32,21 by the Princess is blocked.
  - **The guild story** (29): `quests/guild-story-*.json`, ids 330-338, given by `GuildMaster` (any of the three) with the three rooms named for the client.
    - 330, "A Guild's Calling": a guild member at 80 HP visits the Den of Shadows and reports back.
    - 331-338, "The Fallen Halls I-VIII": a `fallen` step for each hall in ladder order, handed in to any Guild Master, each needing the one before.
    - Each hand-in tells the next piece of the Order's plan: the grove's life drawn into vessels, bound spirits, the dwarves' runes smuggled through the Ports and the sewers, an army of the dead, and at last the Queen waiting in the Inner Sanctum below Castle Brax.
    - Rewards: 1.0 to 1.7 `xpPoints`, 1,000 to 4,500 shillings, and 2 to 9 prestige.
  - **The dailies now unlock with the story** (30, the default): each daily needs its hall's story quest.
  - **The tool:** room names now ignore case, as Kod's names do (`tools/assets/roomLinks.ts`). The Jasper tavern's name resource is spelt two ways and showed as "Room".
  - **Tried on the dev server over the maintenance port** (the Duke's Guild Master placed by hand, since the running world predates the class):
    - 330 was offered and taken, the visit counted, and the hand-in paid 1,640 XP and 250 shillings;
    - 331 was refused at 31 base HP (it asks 80), then taken at 150;
    - clearing the Den marked it done ("Return to any Guild Master"), and the hand-in paid 6,561 XP, 1,000 shillings and 2 prestige;
    - the Den's daily was then offered, and the Forest's wasn't;
    - the Guild Master offered 332 next;
    - no server errors.
  - **Seen in the browser client:** Master Aldric Vane beside the Duke, in his purple shirt, with the quest marker over his head.
  - **Test trap:** setting a player's `piBase_Max_Health` by hand doesn't last, because the next XP gain sets it back from their XP. Send them `ResetXPToLevel` afterwards.
  - **Not tried:** the Princess's and Jonas's Guild Masters in the game (they need a fresh world, or a hand placement), and the quest windows' look.
