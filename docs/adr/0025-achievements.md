# ADR 0025: Achievements

- Status: built (2026-10-25). Tried on the local server with the scripted client (`tools/headless/achievements.ts`): the logon catch-up, hit point levels 50, 100 and 150, a world boss kill, the Duke's quest chain, repeat awards (refused) and a reset all gave the right lists and toasts. The window and toast have not been looked at in the browser by a person, and the guild, faction-join and spell-school hooks were only tried through the logon catch-up.
- Builds on: the guild trophies (`shards-server` `util/guildtrophies.kod`, [ADR 0022](0022-guilds.md)), the faction revamp ([ADR 0021](0021-factions-and-the-faction-war.md)), the quest book ([ADR 0009](0009-quests.md)) and the War window's wiring.

## Context

The game had no player achievements. Guild trophies are the nearest thing, but they belong to a guild, not a character. Players wanted marks for the big deeds: bosses, joining and finishing a faction, a guild, hit point milestones and a top spell in each school.

## Decisions

1. **The server keeps who earned what; the client keeps the words.** A character's list is `User.plAchieved`, newest first, `[ id, when ]`. Names, descriptions and icons are in `apps/client/tables/achievements.json` (until 2026-10-25 in `achievements.ts`; now served with the game's files, so every client reads the same), so wording and icons change without a server build. Old saves load with the empty default.
2. **One id per deed** (`ACH_*` in `blakston.khd`). A boss's id is its guild trophy's (1-8 the Fallen Halls, 21-32 the world, 41 the capstone), so a boss added later needs one trophy id and one catalogue line.
3. **The catalogue, 48 in all.**
   - Bosses: every trophy boss (8 Fallen Hall, 12 world, the capstone), Delver of the Fallen Halls (all 8) and Slayer of the World's Beasts (all 12).
   - Factions: joined any, joined each of the three lieges, finished each liege's fifth act (quests 304, 309, 314).
   - Guild: joined one, and leads one (a founder, or a member handed the guild; the logon check can't tell the two apart).
   - Level: 50, 100 and 150 hit points.
   - Schools: a level 6 spell in each of the six schools (one achievement each; a character may never have all six).
   - Quests: the first, 10, 50, and the soldier's quest for all three lieges.
   - Glory: 10 achievements, 25, and all of the rest.
4. **Each deed has one hook** that calls `SYS@GetAchievements`: `Monster.Killed` (`BossDied`: the same test as a guild trophy, so no copies, minions, event, survival or arena spawns, and only players in the room who struck it), `Player.JoinFaction`, `Player.SetGuild`, `Player.GainBaseMaxHealth`, `Player.AddSpell` and `QuestBook.Complete`. The checks that look at state are posted, so they see the change.
5. **Catch-up at logon.** `PlayerLoggedOn` checks level, schools, faction, guild and quests against the character, quietly (no toasts), then sends the list. Characters from before this keep what they have earned. Boss kills can't be recovered and count from launch. A faction chain is found from the quest done list, which outlives the renown reset.
6. **Titles.** Eight of the headline deeds also add an honor string to the character's look (`AddHonorString`): 150 hit points, the capstone, both boss sets, the three chains and all achievements. They are resources in `achievements.kod`. The title text is also in the client catalogue.
7. **Protocol.** `UC_ACHIEVEMENTS` (125), server to client. Kind 1 is the whole list: the server's time now DWORD, a WORD count, then each id WORD and when DWORD. Kind 2 is one just earned: id WORD, when DWORD. Kod's `GetTime()` is no calendar, so the client works a date out from the gap between `now` and `when`. The server sends kind 1 at logon and on `achievements` over `UC_SHARDS`; kind 2 is the toast.
8. **Client.** The Achievements window (key `U`, or typed `achievements`) has a tab for All and each kind; earned ones come first, newest first, then what is left, locked. A toast (`AchievementToast`) shows each new one for five seconds, one at a time, and a click opens the window. Icons are emoji. The `U` key is added by a settings migration only if nothing else uses `U`.
9. **Rewards are titles only.** No shillings, items or stats, so there is nothing to balance.
10. **Testing aids.** `User.AdminAchieve id` and `User.AdminResetAchievements` over the maintenance port, and `tools/headless/achievements.ts`.

## Order built

Server core and hooks, then the protocol reader, store, window and toast, then this record. One piece of work, two repositories: Kod in `shards-server`, the rest here.

## Consequences

- A new boss, school or deed means a Kod hook (or a trophy id for a boss), a line in the Kod `GetAll` list (for the count achievements) and a catalogue line.
- Players on the original Windows client get the titles on their look, and no window or toast.
- The Glory deeds count every deed in `GetAll`; keep it in step with the catalogue.

## Left to settle when it's played

- The wording and icons, and whether emoji should give way to the game's own art (iconforge) later.
- Whether more deeds are wanted (arena wins, war record, the invasion events, the Inner Sanctum for more than the capstone).
- Whether the logon catch-up should toast what it finds the first time.
