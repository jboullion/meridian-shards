# ADR 0009: Quests you can find

- **Status:** proposed, 2026-10-15. Not built. Like [ADR 0008](0008-player-homes.md), it goes well past [ADR 0001](0001-direction.md)'s "Kod changes allowed later but kept minimal", and it uses 0008's spoken command channel (0008 section 8).
  - Changed 2026-10-15 ([ADR 0015](0015-social-on-our-server.md)): our client sends its `#` commands as `UC_SHARDS` lines, the same words without the `#`, instead of speaking them. Nothing is spoken, so there are no lines to hide.

## Context

Quests exist, but players rarely find them. Most start only when you say a secret phrase near the right NPC, and nothing in the world shows that an NPC has one. We want:
- **Markers over NPCs:** "!" over an NPC with a quest for you, "?" over one where you can hand a quest in.
- **Markers on the minimap:** a dot for an NPC, or its "!" / "?".
- **Areas:** most new quests will be "kill N of these" or "collect N of this" somewhere, so the minimap should show where.
- **A guide:** quests that lead a character through the game, health band by health band.

### What Server 104 already has

Paths below are under `kod/` in our `shards-server` fork (github.com/jboullion/shards-server). `server/src` is a junction to it (`server/link-src.cmd`), so our Kod is in git.

**The QuestEngine** (`util/questengine.kod`, `object/passive/quest.kod` `QuestX`, `questnode.kod` `QuestNode`, `questtemplate.kod`):
- **A global pool.** Every 5 minutes `OnQuestTimer` → `ScheduleQuest` creates instances of each template, up to its `piMaxPlayers` (30) and its `piSchedulePct` roll. Each instance waits at an NPC picked at random from an occupation list (`Library.GetOccupationList`), in that NPC's `plActiveQuestNodes`.
- **The quests:** about 80 templates are created in `RecreateQuestTemplates`, one class each in `object/passive/questtemplate/`, with 83 `QST_ID_*` and 246 `QNT_ID_*` constants hand-numbered in `include/blakston.khd`.
- **Step types** (`QN_TYPE_*`): deliver a message, a given item, a new item of a class, or any item of a class you find; show up; a chess move; kill a monster (`MONSTER`, `MONSTER_ITEMCLASS`); bring a charmed monster.
- **Starting one:** within 5 squares of the NPC (`Q_NPC_CLOSE_ENOUGH`), `Monster.SomeoneSaid`, `SomethingEntered` or a give calls `QuestNode.CheckCompletionCriteria`.
  - **41 quests start with a spoken phrase** (a first node of `QN_TYPE_MESSAGE`): "pupil", "need a courier", "insignia", "defiled the land with your ways". The rest start by showing up.
  - There is no accept step and nothing marks the NPC.
- **Eligibility:** `QuestX.CheckPlayerCriteria`: `Q_PLAYER_*` bits (karma, faction, newbie, murderer, history) and `Q_R2_*` lists (guild, skill, spell, item, minimum health).
- **Kill counts** (`amount_needed`, added in our fork for `famsratsqt`, `avarkillqt`, the `*keyqt` quests and others):
  - The class must match exactly (`GetClass`), and only the killer gets credit.
  - No message as the count goes up.
  - Partial counts are lost on a recreate (`ReassignSavedQuests` keeps only "mob killed").
- **No areas.** Monster targets are global classes.
- **Rewards and failure:** `QuestNode.AwardPrizeOrPenalty` (items, XP, boons, factions, chaining). A missed deadline fails the quest by mail.

**The passive guide quests:**
- 38 classes, `object/passive/passivequest/hpNNpqM.kod`, ported from Open Meridian.
- `util/gamequestmaint.kod EvaluatePlayer` hands out the chains by health band (hp20 in Raza up to hp100 for Brax), on logon and on every health gain.
- Each has one condition (enter a room, kill one of something, deposit, buy, cast, equip, say a phrase), and no giver NPC.

**What helps:**
- **The Quests tab** is stat group 5 (`user.kod ToCliStats`): Passive, Active and Completed sections, names only. Looking at one calls `QuestTemplate.ShowDesc`, which adds "You need to slay N more" and the time left.
- **"Quest" said to townsfolk** gets canned lines pointing at the town's elder (`library.kod LT_quest`, `LM_haz_quest`).
- **Level is health:** `Player.GetLevel` returns `GetBaseMaxHealth`.
- **Minimap flags are worked out per viewer.**
  - `User.BuildMinimapDotFlag` returns a u32 for each object as this player should see it. NPCs (`AI_NPC`) already get `MM_NPC`, and our client already draws them as dots.
  - Bits up to `MM_NO_PVP` 0x2000 are used; 0x4000 and up are free.
- **One object can be re-sent to one player:** `Send(player,@SomethingChanged,#what=obj)`, as `player.kod JoinBuilderGroup` does to refresh group halos.
- **Kod can send the client anything** with `AddPacket`. `BP_USERCOMMAND` sub-commands already go this way (`UC_GUILD_LIST`, `UC_MINIGAME_START`, `UC_SPELL_SCHOOLS`). The other direction is fixed in C (`blakserv/sprocket.c`'s tables), so new commands are spoken (0008 section 8).
- **The builder group** (`room.kod plBuilderGroup`, `AreGroupedHere`): players who fight together in a room with grouping on (`CF_GROUPING`, `Player.JoinBuilderGroup`).
- **Spawns** are in each room's Kod: `plMonsters = [ [&SmallRat, 100] ]` (`room/monsroom/toscellar.kod`) and `plGenerators`.

### What our client has

- **Over heads:** HTML overlays at `ObjectsView.topOf(id)`, pooled and hidden behind walls in `gameScene.ts` (`drawLabels`, `drawPetNames`, `labelRay`).
- **The minimap** (`ui/MiniMap.tsx`): Classic, Modern and the full map draw the current room only. Its `MM` dots are an if/else chain. Friends' pins and map annotations show how to draw over it.
- **Rooms:** `rooms.json` and `roomexits.json` (`tools/assets/roomLinks.ts`): every room's number, name, file, door squares and edge exits, and where they lead. The asset build already parses Kod with regexes.
- **Hidden lines:** `GameSession.lineFilter` is a single slot, set by `social.ts`.
- **The Quests tab** is `Sidebar.tsx StatList`.

### The website

- Its 70 quest pages are scraped from the fan wiki.
- No steps, counts, areas or health bands as data, and `MapFocus` highlights one room.

## Decisions

The user decided these on 2026-10-15:
- **a new engine**, not the QuestEngine;
- **quests are data files in git**, generated into Kod; the same files feed our client and the website;
- **the old quests worth keeping are ported**, and the guide chains with them; then the QuestEngine and the passive quests are retired, keeping each player's history;
- **an offer window** in our client;
- **only our client and our server have to work** (decided later the same day, with [ADR 0010](0010-followers.md)); original clients aren't supported, so nothing here offers them a way in or is checked against them;
- **every quest gets markers**, the secret ones too;
- **areas:** inside one, the minimap is tinted and the quest's targets ringed; outside, an exit arrow shows the way;
- **kills are shared** by the builder group in the room.

### 1. The engine (Kod)

1. **`QuestBook`**, a singleton reached with `SYS@GetQuestBook`, holds the generated table of quests (6).
   - There's no scheduling and no pool: every quest is a standing offer, at its giver(s), to every player it suits.
2. **Per-player state on `User`**, as plain integers, not objects, so saves stay small:
   - `plQuestLog`: for each active quest, its id, step, count and deadline;
   - `plQuestDone`: id, times done, when last done.
3. **A quest** has:
   - an id and a name;
   - its giver class(es), and the NPC class each step is handed in to;
   - a health band: the minimum, and the most it's suggested for;
   - prerequisites: quests done, faction, karma, guild, skill or spell (the useful part of `Q_PLAYER_*` and `Q_R2_*`);
   - repeating: once, or again after a cooldown;
   - a time limit, none by default;
   - its steps, rewards and text.
4. **Step kinds:**
   - talk to an NPC;
   - kill N;
   - collect N;
   - deliver an item given at the start;
   - visit a room or an area;
   - and the passive quests' triggers (use, equip, deposit, buy, cast), so the guide chains can be ported.
   
   A kill matches subclasses (`IsClass`) unless the step says exact.
5. **Hooks:**
   - monster deaths, where `QuestEngine.MonsterKilled` is called now;
   - the passive quests' `User` hooks: entering a room, deposits, buying, casting, equipping, speech.
6. **Shared kills:** the killer, and everyone in the room's builder group with them (`AreGroupedHere`) who is on a matching step, gets the kill.
7. **Progress is told:**
   - a kill or a find sends one line ("Avar warrior slain: 7/20");
   - `#quest abandon` drops a quest;
   - at most about 10 quests are active at once.

### 2. Markers

1. **New minimap bits**, in `blakston.khd` and our client:
   - `MM_QUEST_OFFER` 0x4000: "!", a quest for you.
   - `MM_QUEST_TURNIN` 0x8000: "?", a step ready to hand in.
   - `MM_QUEST_SOON` 0x10000: a grey "!", a quest within about 10 health of your band.
   - `MM_QUEST_TARGET` 0x20000: a monster that counts for one of your steps.
   
   An NPC in one of your quests whose step isn't ready yet shows a grey "?".
2. **Worked out in `BuildMinimapDotFlag`**, ORed onto `MM_NPC` and `MM_MONSTER` (it returns `MM_NPC` alone today). It asks `QuestBook.MarkerFor(viewer, object)`, which looks the class up in an index from giver and turn-in classes to quests.
   - Shown in this order: "?", then "!", then grey "?", then grey "!", then the plain dot.
3. **Kept fresh:** whenever a player's quests change (accepting, a step done, a health gain, a kill), the NPCs and monsters it affects in their room are re-sent to that player only (`SomethingChanged`). Entering a room sends everything fresh anyway.
4. **Our client:**
   - **Over heads:** a `drawQuestMarkers()` beside `drawPetNames` draws a gold "!" or "?" with a dark outline above `topOf`, grey for the grey states.
     - It doesn't depend on `OF_DISPLAY_NAME` or on NPC names being hidden.
     - Walls hide it, as they hide the labels.
   - **On the minimap:** a small "!" or "?" in place of the NPC's dot, and a gold ring round a target monster's dot.
   - **An option**, Show quest markers, on by default.

### 3. Offers and the command channel

1. **Our client to the server: spoken commands**, hidden, with a reserved prefix, as 0008 section 8 (changed by [ADR 0015](0015-social-on-our-server.md): `UC_SHARDS` lines, `quest offers <npc>` and so on, so nothing is spoken or swallowed):
   - `#quest offers <npc>`
   - `#quest accept <id>`
   - `#quest turnin <npc>`
   - `#quest abandon <id>`
   - `#quest log`
   
   `Monster.SomeoneSaid` (or `User`) takes them before they're passed on, and answers the speaker only. *To check*, as in 0008: that speech can be swallowed this way.
2. **The server to our client: new `BP_USERCOMMAND` sub-commands**, `UC_QUEST_OFFERS`, `UC_QUEST_LOG` and `UC_QUEST_PROGRESS`.
   - They carry ids and numbers only; the text is in the catalogue (6).
   - They go to every player: only our client connects.
3. **The offer window** in our client, a stone window (`kit.tsx`). A click or double click on an NPC with "!" or "?" opens it.
   - **Offers:** the name, the health band, the story, the objectives with their area's names, the rewards, Accept and Decline.
   - **Handing in:** the reward and Complete.
   - **An NPC with several** lists them first.

### 4. The quest log and tracker (our client)

1. **The Quests tab** is rebuilt from `UC_QUEST_LOG` and the catalogue:
   - **Active:** each quest's objectives with their counts, its area, the time left, Track and Abandon.
   - **Suggested for you:** the catalogue's quests whose band fits our health (`STAT_HP`'s `currentMax`, as pets use it, ADR 0006 "As built"), with the giver's town. This is what leads a player on.
   - **Completed.**
2. **A tracker:** up to 3 tracked quests under the minimap in the Modern HUD ("Avar warriors 7/20").
3. ~~**`lineFilter` becomes a chain** shared with `social.ts`, and hides the quest commands and their echoes.~~ Not needed with `UC_SHARDS` (ADR 0015).

### 5. Areas on the minimap

1. **A step's area is a list of rooms.**
   - For a kill step, the generator works it out from the rooms' spawn lists (`plMonsters`, `plGenerators`).
   - A quest can name its rooms itself (`rooms`) or leave some out (`exclude`). An area is never guessed.
   - Where each NPC stands comes from the room Kod that creates it. *To check* that it can be parsed; if not, the quest names the room.
2. **Inside an area room** of a tracked step:
   - the minimap's paper gets a gold wash, drawn after the walls and before the objects;
   - the targets are ringed (`MM_QUEST_TARGET`), so they're exactly what the server counts.
3. **Outside:**
   - the client finds a path over `roomexits.json` to the nearest room of the area, or to the room of the NPC to hand in to;
   - it marks the door or edge to take with a gold chevron, or with an arrow at the minimap's edge when it's off the map;
   - there's no arrow when there's no path: portals, and rooms with no fixed number (0008).
4. **The full map** shows the same. An option, Show the way, is on by default.

### 6. Quests as data, and the generator

1. **One JSON file per quest**, `quests/<id>.json` in `shards-server`, beside the Kod made from it.
2. **A generator** in `tools/quests/` (Node and TypeScript, like the asset tools), with tests. It checks:
   - every class exists in Kod;
   - every room is in `rooms.json`;
   - ids are unique and never reused.
3. **It writes:**
   - `kod/util/questdefs.kod`, generated and never edited by hand; `server/build.cmd` runs the generator before compiling;
   - the client catalogue, `dist/assets/quests.json`, in `npm run assets`.
   
   They deploy together. `UC_QUEST_LOG` carries the catalogue's hash; if it differs from the one our client loaded, the client says its game data is out of date and to restart.
4. **Text** is Latin-1, with the original's markup (`~B` and the rest).
5. **The website** (meridian-shards-website) later builds its quest pages from the same catalogue:
   - the giver, the band, the steps with their counts, and the rewards;
   - the areas, highlighted on the world map (`MapFocus` with a set of rooms).
   
   Only once it's built, by that repo's rule on honest copy.

### 7. Porting and retiring

1. **The keepers** are chosen quest by quest (11). Each one ported has its old template disabled (`pbDisabled`) in the same deploy.
2. **The guide chains** (hp20 to hp100) become quests with real givers and NPCs to hand in to.
   - The library's "the town's elder would have a use for you" makes the elders the hubs.
   - `GameQuestMaintenance` goes once they're ported, and `plPassiveQuests` is emptied by a migration.
3. **History:** a table in the generator maps old `QST_ID`s to new ids, so what a player finished stays finished. Old quests still active when one is retired run out (their limits are 3 hours at most).
4. **Saves change** (new `User` properties), so `reload system` and a restart are tried on a copy first (0008 3.3).

### 8. The guide

New quests by health band and region, written as data:
- Raza (20)
- Tos, Marion and Jasper (30 to 50)
- Barloque and Cor Noth (50 to 90)
- Ko'catan (90 to 120)
- Brax (100 and up)

What a band's quests send you to kill or collect suits it, judged by the creatures' Kod `viLevel` and hit points. Rewards are XP, shillings and items, scaled by band; never health directly. Which quests, exactly, is settled as they're written.

### 9. Other ideas, not decided

- Daily quests: repeatable with a real-day cooldown.
- A group quest step that everyone in the builder group finishes together.
- Quest-only drops for collect steps, seen only by players on the step.
- Showing a friend's quests in the Friends tab (over the relay, as claims only).

### 10. The order to build it

1. The generator, the schema, and `QuestBook` with talk, kill, collect and visit steps. Rats in the cellar (`famsratsqt`) ported end to end, played with typed commands.
2. The marker bits and keeping them fresh; our client's markers over heads and on the minimap.
3. The `#quest` commands and `UC_QUEST_*`; the offer window, the new Quests tab and the tracker.
4. Areas: the spawn lists, the minimap's wash and rings, and the exit arrow.
5. The guide chains ported; `GameQuestMaintenance` off.
6. The keepers ported; the QuestEngine off.
7. The new guide quests, band by band (8).
8. The website's quest pages from the catalogue.

### 11. Left to settle when it's built

- Which old quests are keepers (7.1).
- Who gives the guide chains (7.2).
- The cap on active quests, and the repeat rules (1.7, 1.3).
- Whether collect steps make quest-only drops (9).
- The bits' final values and names (2.1).

## Consequences

- **The biggest Kod change after 0008**, with a save migration.
- **Original clients aren't supported.** The new quests replace stat group 5's list for our client; whether Kod keeps sending that group is settled when the QuestEngine goes.
- **The commands are a protocol.** The catalogue and the Kod deploy together, and the `#quest` commands and `UC_QUEST_*` change in both places at once.
- **The website's quest pages** move from the scraped fan wiki to the catalogue.
- **Docs to update** as each part lands:
  - `AGENTS.md` and `docs/missing-features.md`
  - `docs/admin-console.md` (granting and resetting quests)
  - `docs/research/protocol.md` (`UC_QUEST_*`)
  - the website's wiki
