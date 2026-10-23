# ADR 0022: Guilds, halls, Fallen Halls and trophies

- Status: partly built (2026-10-22). Built: phase 0, the cleanup (shards-server 146967e0), and phase 1, the halls (f735b043). Neither has been tried in the game client. Planned: phases 2-7, paused until the faction revamp work lands.
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

10. **Chests get a size limit that prestige raises:** 50 items, plus 25 per prestige tier, up to 150 (a count in `ReqNewHold`, alongside bulk and weight). A chest already over its limit keeps its contents but takes nothing new.

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
    - **Tiers** at 0, 50, 150, 300 and 500 set the chest limit (10). That's its only use for now.

### The guild bonus

21. **+20% experience for monster kills with a guildmate.**
    - **When it applies:** in `AdvancementCheck`, when another member of your guild is in the room, in the monster's `plAttackers`, and on another account.
    - **How much:** 20% of the kill XP, before the flat item and monster bonuses.
    - **What the player sees:** "Guild member questing bonus experience: +X" after the usual XP message.
    - **What doesn't count:** quest XP, allied guilds, and arena kills.
    - **Prestige:** each bonus kill counts towards prestige (20).

### Cloaks

22. **A guild cloak in the guild's colours** for every member, once the Leader has set them (`HasGuildColors`). It's taken free from the hall and is for looks only: it's worn over armour and put on or off with a command. It uses ADR 0012's dye code: cloth is `GetPrimaryGuildColor` and trim is `GetSecondaryGuildColor`. The shield's insignia becomes a hotspot-51 decal when decals arrive. It needs new art through `garmentforge` and a client overlay above the torso, because nothing draws a cloak today.

### Recruiting boards

23. **The globes in the nine adventurers' halls become Guild Recruitment boards:** Tos (`toshall`, which holds the master), Barloque, Cor Noth, Jasper, Jixa, Ko'catan, Marion, Raza and Berg. They link to a new `NID_GUILD_RECRUIT` board (`NewsRecruiting`). Inns keep `NID_ANNOUNCEMENTS`. Berg's swapped pair is put right.

24. **One notice per guild.** An Officer or the Leader posts it, and a new one replaces the old. The server heads it with the Leader, member count, hall, prestige and trophy count. Anyone can read it. The notice goes when the guild does.

25. **The General News board (`NID_TOS_HALL`) retires,** because the adventurers' halls were its only globes.

## Order to build

0. **Cleanup:** 5, 6, 3, 2 and 1 (rank names and the moved powers). Also two bugs: `RID_GUILDH_MAX` is 716, so the foyer check in `user.kod` skips halls 17, 19 and 20; and Berg's globes.
1. **Halls:** 7, 8, 9, 11 and 4.
2. **Prestige and the guild bonus:** 20, 21 and 10.
3. **Recruiting boards:** 23 to 25.
4. **Fallen Halls:** 12 to 16, one hall at a time, starting with the Slaughtered Command.
5. **Trophies:** 17 to 19.
6. **Cloaks:** 22, the art and the client overlay.
7. **Client:** the guild window (`GuildDialogs.tsx`). This means the new rank names, no Vote, and a Hall tab with the public toggle, chests, prestige and trophies. The recruiting board reads like any news globe.

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
- Rent: halls still pay `viQuality × 50` an hour, doubled on non-PK servers. Should it change now that halls can't be lost?
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
