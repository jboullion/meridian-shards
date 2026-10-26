# ADR 0026: The Office of the Justicar

- Status: built (2026-10-25), in shards-server f4d3764a, 9c530cfa, 864b36c8 and 7ae3dbdc, and this repo's client window. Tried on the local server with headless clients and in the browser client; see As built.
- Builds on:
  - the end of random PvP (`shards-server` 5fc7b863, 83e7ec38; [ADR 0021](0021-factions-and-the-faction-war.md))
  - the quest book ([ADR 0009](0009-quests.md))
  - the NPC service windows: the tailor and barber (`util/cosmeticsbook.kod`), the elders and smiths (`util/itemservicebook.kod`)
  - the arena bouts' timer and state machine ([ADR 0019](0019-arena-bouts.md), `util/arenabouts.kod`)

## Context

**What the Office was.** The Office of the Justicar is in North Barloque (`BarloqueCourt`, room 115, `barcourt.roo`). In Meridian 59 it ran the law of player killing:
- Caramo held elections each term.
- The elected Justicar stood in the courtroom and pardoned outlaws and murderers ("as justicar, I pardon …"), up to a limit per term.
- A murderer could also buy an indulgence.
- Every election and pardon went into the Book of Jala.
- The courtroom is walled off from a public gallery (`ReqInSpecialArea`, rows 7 and up), so spectators could watch a trial without being subject to the Justicar's commands.

**What is left.** With no random PvP there are no outlaws or murderers, and 83e7ec38 took out the elections, pardons, indulgences and records. The office now has:
- Caramo, who changes names by deed poll. The player says "change name", writes the new name on a scroll, offers the scroll once to hear the fee and again to pay it. The fee is 3,000,000 shillings from the bank, which almost nobody can pay.
- The Book of Jala.
- A sign saying the post was abolished for corruption.

The room has no reason to be visited. The user wants the office to be part of the game again. The decisions below are the user's, made on 2026-10-25.

## Decisions

### Name changes

1. **Caramo changes names through a service window,** as the tailor, barber, elders and smiths do.
   - Activating her opens a window (`UC_ITEM_SERVICE` kind 3: her and the fee) with the player's current name, a field for the new one and the fee. One Confirm does it. When she has bounties for the player, the quest window opens first with a "Change name…" button, as for the tailor and the smiths.
   - The window answers with `rename <new name>` over `UC_SHARDS`.
   - The server checks the player is still near her (`CosmeticsBook.ServiceNpc`).
   - It checks the name with `System.ValidateUserName` (length, characters, not taken, not a monster, NPC, guild or god, not obscene) and gives the reason when it refuses.
   - It charges the fee, records the change in the book, then renames with `System.ChangeUserName`.
2. **The fee is 50,000 shillings** (`Settings.piNameChangeCost`). It's taken from the purse first, as every other service is, and otherwise from the player's bank account, as the old deed poll was. There is one bank account: every banker in the game (Tos, Raza, Jasper, Berg, Ko'catan) uses the same bank (`BID_TOS`, which `BANK_BASIC` also equals), so money banked anywhere pays the fee, from any room. Barloque has a vaultman (items only) and no banker, so a Barloque player banks elsewhere. A refused name costs nothing.
3. **The deed-poll scroll is retired** (`NameChangeScroll`), along with Caramo's wanted items and her warn-twice list. Caramo no longer listens for "change name" in speech.
4. **The Book of Jala is the register of names.** Every change posts a title ("A's name has been changed") and "Let it be known that A has changed their name before the Office of the Justicar, to B. So it has been spoken, so shall it be done. -- Caramo". The book keeps 200 posts rather than the usual 75: `News.GetMaxMessages` answers for the limit and `NewsJusticar` overrides it, so a saved world keeps 200 too (a property is saved with the world and would keep the old 75). Only Caramo and DMs write in it.
5. **The sign** in the office (`BarloqueCourt_sign_desc`) points citizens to Caramo for name changes, the court's bounties and the Assizes.

### The court's bounties

6. **Eight daily bounties,** all with Caramo (`BarloqueClerk`) as the giver, framed as warrants of the Office.
   - They are ordinary quest files (`quests/*.json`, `tier: errand`, `repeat.cooldownHours: 24`), so the quest book and the client need no change.
   - Each is a kill bounty in a known area (quests 339-346): Barloque's sewer rats and then their king, the shore's fungus beasts, the cave orcs past Tos, Castle Victoria's skeletons, death spiders, orc shamans, the Badlands' ground worms and Bergholt's bandits.
7. **They cover 40 to 100 hit points.** Each has a band minimum and `requires.healthBelow` for its top, because the quest book never checks `QB_BAND_MAX`. Every player from 40 to 99 has at least two on offer, which fills the gap between the newbie quests and the faction dailies for players not in a faction.
8. **Rewards** are XP (`xpPoints` 0.4 to 0.6) and 150 to 1,000 shillings, in line with the Tos, faction and Fallen Hall dailies. There is no renown, so neutral players aren't shut out.

### The Barloque Assizes

9. **An NPC court is always in session** while anyone is in the room. It cycles through eight scripted trials. The players watch and don't take part.
10. **The cast** are one new class, `CourtFolk` (a `Human`, so they can be dressed: the judge in a black robe). They are a judge, a prosecutor, a defender, the accused, two witnesses, a bailiff and six spectators in the gallery.
    - They have `MOB_NOFIGHT | MOB_NOMOVE | MOB_FULL_TALK` and `AI_NPC`. `FULL_TALK` lets the gallery hear the bench past the usual say radius.
    - Caramo is the clerk of the court, and the old Duke's guard is the second bailiff.
11. **A small script engine runs on the server** (`util/courtassizes.kod`, owned by the room).
    - A trial is a list of `[role, line, delay, action]` steps, played one per timer firing. Speech goes through the room's `SomeoneSaid`, so every client gets the chat line and our client the speech bubble.
    - Actions:
      - a gavel or a point (the `PANM_CAST` and `PANM_POINT` animations)
      - turning to face a speaker
      - a witness taking or leaving the stand
    - A one-minute recess separates the trials. The accused and witnesses are renamed and redressed for each trial.
    - This is not the arena show's client-side sim: that only reaches our client and has no chat lines.
12. **It pauses while the room is empty** (`FirstUserEntered` / `LastUserLeft`) and picks up where it stopped, so it costs nothing on an empty server.
13. **The eight trials:**
    1. The Crown v. Bartholomew Tanner (watered ale; guilty)
    2. The Theft of the Duke's Signet (innocent)
    3. The Rebel Pamphleteer (guilty, banished)
    4. Necromancy in the Cemetery (innocent, the cemetery sealed)
    5. Two Farmers and One Cow (split the herd)
    6. The Forged Writ of Passage (guilty)
    7. The Missing Apprentice of Jasper (innocent, the apprentice turns up)
    8. Breach of the Wartime Truce (guilty, stripped of rank)

    Each runs about four minutes, so the full cycle with recesses is about 40 minutes.

### Rejected

- **Renaming by a chat phrase** ("change my name to …" and "yes"). It needs no client work, but it's easy to mistype, and the window can show the fee and refuse a bad name before anything is paid.
- **A free first rename,** or keeping 3,000,000.
- **A rotating board** (three of twelve bounties posted each day). It would need a new rule in the quest book and changes to the quest tool and the client.
- **A separate bounty officer** standing beside Caramo.
- **Letting spectators sway the verdict** by calling out guilty or innocent, and **rewards for watching** a whole trial. These could be added later, since each trial already ends in a single verdict step.
- **Bringing back an elected Justicar** with new powers: pardons for lost renown, server-wide edicts, or arbitrating guild wars. A mostly single-player world doesn't have the voters.

## Order to build

0. This ADR.
1. **The Assizes:**
   - the `CourtFolk` class, the engine and the first two trials;
   - check the placement and pacing in the game;
   - then the other six trials.
2. The bounties.
3. The name change: the server service, then the client's window (`ui/NameChangeDialog.tsx`, modelled on the guild-creation dialog).

## Consequences

- **Others see a new name at once.** blakserv's `SetResource` sends every client `BP_CHANGE_RESOURCE` (`blakres.c` `ChangeDynamicResource`), and our client updates `dynamicResources` from it. A second client watching saw the name change live.
- **The new room objects need a fresh world or a recreated room.** The live world only rebuilds room 115's objects when the room is recreated (`RecreateAllRooms` with nobody online), so the cast arrives with a fresh world or a recreate of that room.
- **Protocol:** no new UC code. `UC_ITEM_SERVICE` gains kind 3 (Caramo's object id, the fee), and the client answers with `rename <new name>` over `UC_SHARDS`. Our client knows its own name.
- **Existing worlds need a fresh one.** blakserv stops loading a saved game at an object whose class is missing, and the item templates hold a deed poll, so a world saved before 7ae3dbdc loses everything after it. `Settings.piNameChangeCost` also keeps its old value (3,000,000). (The Book of Jala's 200 posts no longer depend on a fresh world: see decision 4.)
- **The sign, the book and the scroll are shards-server content.** The scroll's `.lkod` translations go with it. The new court lines are English only.

## Left open

- The court's look in the game: the cast's squares and dress were placed from `barcourt.room.json` and only checked by object position; the stand, gavel and pointing haven't been looked at by a person.
- Fixing only a name's capitals is refused (`StringEqual` and the window both ignore case), and the fee can't be split between purse and bank.
- ~~The bounties' kills, turn-ins and 24-hour repeat haven't been played.~~ Played on 2026-10-25 by the playtester: Rats Under the Court (both steps, the Rat King included) and Castle Victoria's skeletons were killed, counted and handed in, paying 756 and 1,301 XP and 200 and 400 shillings (the files' shillings; the XP scales with the band). The same quest can't be taken again and drops out of Caramo's offers. Two fixes came out of it:
  - The eight files said `tier: main` (gold markers) against this ADR's errand (bronze). They say `errand` now.
  - A refused repeat gave only "You can't take on that quest." The quest book now says "You've done that one recently.  It will be offered again in N hours." (`QuestBook.TellCooldown`, used by `Accept` and `BoardAccept`: whole hours rounded up, then "about an hour", then minutes). Quests that are refused for another reason still get the plain line.

## As built

- **Server (shards-server):**
  - `util/courtassizes.kod` and `human/courtfolk.kod`: the court.
  - `quests/court-bounty-*.json`: the bounties.
  - `towns/barlqtwn/bqclerk.kod` and `util/itemservicebook.kod` (`SendRenameMenu`, `Rename`): the name change.
  - `barlqrm/barcourt.kod`: the room, the sign and the book's description.
  - `news/newsjust.kod`: the 200 posts.
  - `util/settings.kod`: the fee.
- **Client (this repo):**
  - `packages/world/src/itemservice.ts`: the `rename` kind, `renameCommand`, and the name limits.
  - `apps/client/src/game/ui/NameChangeDialog.tsx`: the window.
  - `GameView.tsx`: the wiring and the "Change name…" label.
  - `ItemServiceDialog.tsx`: takes `ItemMenuEvent` now.
  - `packages/world/test/itemservice.test.ts`: the tests.
- **Tried:**
  - A headless spectator heard all eight trials and the cycle wrap round, and the court paused when the room emptied.
  - Caramo offered the right warrants at 45, 62, 92, 99 and 100 health.
  - Renames were refused for the same name and for missing money, and paid from the purse and from the bank. A second client saw the change live.
  - The browser window opened from Caramo and from the quest window's button.
