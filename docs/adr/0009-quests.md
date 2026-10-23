# ADR 0009: Quests you can find

- **Status:** accepted 2026-10-15; build steps 1-6 (10) built 2026-10-16 and 2026-10-17, the QuestEngine switched off, with an admin dashboard tab for making quests; the new guide quests (8) are still to do. See "As built" at the end. Like [ADR 0008](0008-player-homes.md), it goes well past [ADR 0001](0001-direction.md)'s "Kod changes allowed later but kept minimal", and it uses 0008's spoken command channel (0008 section 8).
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

New quests by health band and region, written as data. What a band's quests send you to kill or collect suits it, judged by the creatures' Kod `viLevel` and hit points. Which quests, exactly, is settled as they're written.

**Decided 2026-10-17** (this replaces the first band list):
- **XP is how quests level you.** On our server XP buys health (`Player.AddXP`: past `GetXPForLevel` of the next point, `TryGainBaseMaxHealth`), so no reward gives health directly, but every main (gold) quest gives XP, scaled by the quest's band, so that **about a third of a character's levelling comes from quests** and two thirds from killing.
- **Hubs and a spine:** each town is a hub; a couple of its quests done, it sends you on to the next one (shape (c): a thin chain through the hubs, with local quests at each).
- **Early game, 20 to 50, the same for everyone:** Raza, then Marion, then Cor Noth. Their elders and innkeepers give the quests.
- **Mid game, 50 to 100, the faction hubs:** after Cor Noth the world opens; the hubs follow the faction: Jasper for Jonas's rebels, Barloque for the Princess, Tos for the Duke. Barloque's quests are mostly in the sewers, Tos's in the mountains around Castle Victoria, Jasper's in its forests and mountains. For now the faction leaders give them; other faction members split them up later. Places like the sewers are for killing quests.
- **Late game, about 90 to 130:** each faction has reasons to send its people into the orc caves and to the island, and the island (Ko'catan) is a hub for about 90 to 130; each also sends them to Brax for about 90 to 130.
- **Dailies:** from 50, each faction has a daily, and a player has at least one daily open to them all the way to 130. A daily from 100 to 150 (mollusks or other mainland creatures that can carry a character very high) is not about factions or story.
- **130 to 150** is for later, probably high dungeons.
- **Spawns follow:** once the bands are in, monster spawns are moved to suit them. Today a few maps are where everyone levels; quests that give XP should spread levelling over more places.
- **Text:** first drafts are plain story descriptions, cleaned up later, likely in the dashboard's Quests tab.

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

## As built (2026-10-16)

Build steps 1-4 (10): the data and the generator, the engine, the markers, the commands, the quest window, the Quests tab and the tracker, and areas on the maps. Step 5 (the guide chains) and the hunts, errands and story quests of step 6 followed the same day (below, "Porting"); the system quests and switching the QuestEngine off on 2026-10-17 (below, "The system quests"). The new guide quests (8) are still to do.

**The data** (shards-server `quests/`):
- `<key>.json` per quest: id, key, name, giver, band, prerequisites (quests, karma), repeat cooldown, time limit, text (offer, progress, complete), steps and rewards (XP, shillings, items). A step can have a `brief`, what the giver says as it starts.
- `givers.json`: placed givers (below). `retired.json`: ids never used again.
- An NPC is `{ "class": "TosInnKeeper" }` (every NPC of the class) or `{ "placed": "<key>" }`.

**The generator** (`tools/quests/`, tested): checks the shape, that every class exists and is the right kind (an NPC, a monster that isn't an NPC, an item), that rooms exist, that ids are unique and not retired, and that the server's text is Latin-1 without `\` or `%`. It writes `kod/util/questdefs.kod` (`QuestDefs`: the tables as literal lists, their text as resources, and the catalogue's hash) and `dist/assets/quests.json`. `server\build.cmd` runs it first; `npm run assets` writes the catalogue too.

**The engine** (`util/questbook.kod`, `QuestBook is QuestDefs`, `SYS@GetQuestBook`):
- The tables are cached on it and read again whenever the hash changes (a rebuild).
- **Per player:** `User.plQuestLog` (`[id, step, count, deadline]`) and `plQuestDone` (`[id, times, when]`), and `poQuestNpc`.
- **Talking to an NPC is activating it.** Kod can't turn a number in a text command back into an object, so `Monster.TryActivate` (for `AI_NPC`) calls `NpcActivated`: within 4 squares, the player gets `UC_QUEST_OFFERS` and the NPC is remembered. `quest accept <id>` and `quest turnin <id>` act on it, checked again (still in the room, still near).
- **Steps:** kill (from `Monster.Killed`, outside arenas, for the killer and everyone in the room's builder group with them; `IsClass` unless exact), collect (counted from what's carried, bags too; on pickup from `User.NewHold`; taken at the hand-in), talk, deliver (a `QuestParcel` named by the quest, given at the step's start, taken at the hand-in), visit (from `Player.NewOwner`). Each count sends a line ("Small rats slain: 7/20") and `UC_QUEST_PROGRESS`.
- **Rewards:** `AddXP`, shillings and items, into the pack or at the player's feet.
- **The cap** is 10 active quests. A deadline is checked on each command and at logon; a quest whose id is gone (retired) is dropped at logon.
- **Admin messages** for the dashboard: `AdminGrant`, `AdminSetStep`, `AdminFinishStep`, `AdminComplete`, `AdminReset`, `AdminState`.

**Placed givers:** `QuestGiver is Towns` (`monster/towns/questgiver.kod`), one per row of `givers.json`, placed by `room.kod Constructed` (`PlaceGivers`), with its own name and description and a picture borrowed from another NPC class.

**Markers:** `MM_QUEST_OFFER` 0x4000, `MM_QUEST_TURNIN` 0x8000, `MM_QUEST_SOON` 0x10000, `MM_QUEST_TARGET` 0x20000, and `MM_QUEST_PENDING` 0x100000 for the grey "?". `MarkerFor` ORs one onto `MM_NPC`, or `MM_QUEST_TARGET` onto `MM_MONSTER`. `RefreshMarkers` re-sends the room's NPCs and monsters to the player after any change, and after a health gain.

**The command channel:** `quest accept | turnin | offers | abandon | log` over `UC_SHARDS`; `UC_QUEST_OFFERS` (106), `UC_QUEST_LOG` (107) and `UC_QUEST_PROGRESS` (108) back ([protocol.md](../research/protocol.md), "Ours").

**Our client:**
- `game/quests.ts` (`QuestStore`): the catalogue, the log and what's tracked (up to 3, in `localStorage`; a quest taken on is tracked while there's room). A log whose hash isn't the catalogue's fetches the catalogue again; if it still differs, the game data is out of date.
- `ui/QuestDialog.tsx`: the quest window. Several quests are listed first. An offer has the band, the story, the objectives with where they are, the reward, Accept and Decline; a step ready shows Hand in (or Complete), then the next step's brief (or the completion and reward).
- `ui/QuestsPanel.tsx`: the Quests tab (Going, with objectives, time left, Track and Abandon; Suggested for you, by our maximum health; Done) in place of stat group 5's list, and the tracker under the Modern map (since 2026-10-17 the quest box, `ui/QuestBox.tsx`: every quest going, tracked first, moved and sized like the chat; a double click opens `QuestInfoDialog`).
- `game/markers.ts`: the gold "!" and "?", grey for not yet, over heads and on the minimap, and a gold ring round a target monster's dot. Options, Show Quest Markers.
- Double-clicking someone with a marker talks to them (before their shop for a gold "!" or "?"); so do the Use key and the Look window's Activate.

**The admin dashboard's Quests tab** (`apps/client/src/admin/QuestsTab.tsx`, `tools/dev/questApi.ts`): edit and save quests, place and move givers where you stand, apply (generate, build, `reload system`, rebuild the givers' rooms; files go back if it fails), retire, and try a quest on your own character. [docs/admin-console.md](../admin-console.md), "Quests".

**Tried on our server:**
- Rats in the Cellar end to end by typed commands (`tools/headless/quest.ts`): the offer, accepting, 20 kills (sent to `MonsterKilled` from the maintenance port), the "?", three hand-ins and the rewards.
- A placed giver made and placed from the dashboard's API, and a quest made there with talk, collect and visit steps, played through; a deliver quest, then retired.
- In the browser: the "!" and "?" over Paddock and on the minimap, refreshing as the quest changed; the quest window, accepting and handing in; the tracker; the Quests tab.

**Areas (5), built the same day:**
- **The generator** works out a kill step's area from the rooms whose spawn lists (`plMonsters`, a parent class's when the room has none) make the monster or one of its kinds, and the rooms whose Kod creates one (a boss: `Create(&GiantRatKing)`). The survival rooms are left out. A step's `rooms` replace that (kill or collect; a collect's area is never guessed), and `exclude` leaves rooms out. The area is in the catalogue (`CatalogStep.rooms`), not the Kod, which needs only a visit's rooms.
- **The way** (`packages/world/src/questWay.ts`, tested): while a step counts up, its area is the destination; once counted, and for talk and deliver, the rooms where it's handed in (the room Kod placing the NPC, or the placed giver's room). From the room we're in, a breadth-first path over `roomexits.json` (doors and sides), and the exits out of this room toward it. No path, no mark.
- **The maps** (`ui/MiniMap.tsx`, so the minimap and the full map; `game/questWays.ts` works it out per room and quest change): in a tracked step's area room the paper is washed gold under the objects; outside, a gold chevron on each exit to take that's on the map, or one at the map's rim toward the nearest. Options, Show The Way, on by default.
- **The dashboard** shows each step's area, and kill and collect steps have Where and Leave out.
- **Rats in the Cellar:** the small rats are in the cellar; the rat soldiers in the rat caves (`ratcave1.roo`, `ratcave2.roo`) and the rat king in the second, both reached from the cellar through `toshidden.roo`. The king also turns up in two Bergen caves (`Create` in `berg8.kod` and `golem_dungeon.kod`); `exclude` would leave them out.
- **Tried in the browser:** the arrow at the rim toward the cellar door from Familiars, the wash and the rat's ring in the cellar, and the chevron on the cellar's door back once the step was counted.

**Porting (7), built the same day.** The user decided on 2026-10-16:
- **this round** ports the ten guide chains and switches the old guide system off, and ports the hunts, the trade errands and the story quests; the quests that drive game systems stay on the QuestEngine, which keeps running until a later round gives the new engine their rewards;
- **each guide chain is given by the NPC it sent you to first**, and is one quest whose travel and action steps are done by themselves;
- **markers take the quest's tier's colour:** gold for the main and levelling chains, silver for story quests, bronze for trade errands and other repeatable, common quests.

- **What the engine gained:**
  - **tiers** (`tier`: main, story, errand), sent as `MM_QUEST_SILVER` 0x200000 and `MM_QUEST_BRONZE` 0x400000 (gold has neither); each kind of mark takes the best tier among its quests;
  - **auto steps** (`auto`), done as soon as they're counted, with no hand-in (the default for the action kinds); their turn-in NPCs never show "?";
  - **step rewards** (`rewards` on a step) and **training points**, at the step or the end;
  - **a random pick** (`rewards.oneOf`): one of a list, as the old prize lists;
  - **the guide chains' kinds:** `cast` (`Spell.CastSpell`, any spell), `deposit` and `stash` (the banker's and vault keeper's `User.MadeMoneyDeposit` / `MadeItemDeposit`), `buy` (`User.BoughtAnItem`), `equip` (`User.NewUsing`, any item), `health` (a base health), `hometown` (`User.CanChangeHomeroom` no longer), `nodes` (`Player.NumManaNodes`, checked on each node bonded); a deposit's or purchase's area is where its NPC stands;
  - **a faction requirement** (`requires.faction`: neutral, duke, princess, rebel, or any but neutral);
  - **NPCs by kind:** an NPC reference matches the class and its kinds (`IsClass`), so "any citizen of Ko'catan" is `KocatanTown`; a reference can name `rooms` when no room Kod creates the NPC (the faction leaders and the councillors, placed by the parliament: their rooms were asked of the running server);
  - **`replaces`:** old `QST_ID_`s and `HP*_CHAIN`s, written as `QuestDefs.GetReplaced`;
  - **chat lines:** our client says a step's `brief` as the quest moves on to it, as the old guide quests did.
- **The guide chains** (quests 10-20, `quests/guide-*.json`; names and text the old quests' own): Raza (Rodric, 10), the road through the towns (Priestess Xiana, 15 steps, 11), the Marion crypt (Ran er'Hoth, 12), Castle Victoria (Paddock, 13), the powers of Meridian (Princess Kateriina, neutral players, 14), the mana nodes (Esseldi, 15), the soldier's shield (one quest per faction leader for their own faction, 16-18), Ko'catan (the Duke, 19), and Brax (Paddock again, once Castle Victoria is done, 20). "Say this phrase" became "talk to them (double-click)".
- **The keepers** (quests 30-63, silver or bronze): the five Underworld key hunts and Aid in the War, the Bone Priestess, the eight trade errands (ore, apothecary, bar restock, catering, identify potion and wand, Ko'catan ale and arrows) and fourteen story quests (chicken soup, Frisconar's ailments, gems to polish, the stunted dwarf, the missing dress pattern, Moxal's two schemes, the council and war letters, the necklace of Jala, the lute, the aphrodisiac, both necromancer warnings).
  - **One giver each:** where the old quest drew an NPC from a list, one was chosen (the old lists would put a "!" on half a town).
  - **Couriers carry quest parcels,** not the old goods, so the outlaw penalties for keeping them are gone.
  - **Repeating:** errands and hunts every 2-3 hours, the keys every 12, story quests daily, the stunted dwarf once.
- **Switched off:** each ported template has `pbDisabled = TRUE` (rebuilt with `RecreateQuestEngine` and `RecreateQuestNodes` on a running server); `GameQuestMaintenance.EvaluatePlayer` returns at once.
- **Players' history** (`QuestBook.MigrateOld`, at logon): a finished old guide chain or QuestEngine quest counts as its new quest done (no rewards); the old guide quests are deleted and their lists emptied.
- **Left on the QuestEngine** (until the next round, below): joining and loyalty to the factions, the soldier ranks, the disciple and offering quests, the pupil quests, the insignia, raising the necromancer guild, taxes, murders, chess, the trading post and bowmaker, abstaining from PvP, the truth spell, the love letters, the guild shields, the mad scientist.
- **Found on the way:**
  - a Kod list literal holds at most 40 elements, so the generated tables come in groups of 30 (`QuestBook.Flatten`);
  - `IsClass` on a class (not an object) is always FALSE: stacked rewards made one item per count until the item was made first;
  - Kod names ignore case, so a parameter `spell` clashed with the class `Spell`, and `jasperTown` is `JasperTown` (the generator's class reader now resolves parents that way).
- **Tried on our server:** the road chain end to end (casts, the bank, the vaults, Rook, Barloque's smith, Paddock, a zombie, the Hall, the hometown) with every step's reward; tier bits on the errand givers (bronze "!" and "?") and silver on a story giver in the browser; a random pick (one stack of shillings, silver arrows); a Ko'catan citizen taking the "any citizen" step; an equip step; a finished old Raza chain counted as quest 10 at logon, and an old failure not counted.

**The system quests, and the QuestEngine off (2026-10-17).** The user decided:
- **factions:** the join quests are ported and make you a member; **membership no longer lapses** (no service timer, no resigning for a missed loyalty quest); the loyalty quests become optional favours a liege asks of members, still what a liege wants done before teaching;
- **dropped:** chess, the mad scientist, the outlaw penalties (couriers carry quest parcels), the boons (the offering chants' stat changes), and abstaining from PvP;
- **kept as rewards:** disciple robes made for the temple's school, guild shield insignia, and raising the necromancer guild;
- **the QuestEngine is switched off** altogether.

- **What the engine gained:**
  - **requirements** (`requires.intriguing`, `guildMaster`, `guildShield`, `noGuild`): `QB_NEEDS` bits checked by `QuestBook.MeetsNeeds` (`Player.PlayerIsIntriguing`, the guild's master with colours, `PossessesA GuildShield`, `GetGuild`);
  - **special rewards** (`rewards.joinFaction`, `insignia`, `necroGuild`), a sixth field of a reward list (`QBR_SPECIAL`, `QuestBook.AwardSpecial`): joining posts `ResignFaction` then `JoinFaction` as the old prize did; an insignia goes on the shield in use, else an unmarked one in the pack (`FindGuildShield`, `ChangeGuildInsignia`); the guild is raised by posting `DeadLich.EstablishNecromancerGuild` (the dead Lich in the Inner Sanctum);
  - **items made for a school** (`school` on an item: `[ class, count, SS_* ]`, `Create(..., #school=)`), for the disciple robes;
  - **teaching:** `Monster.HasDoneLearnQuest` also asks `QuestBook.HasDoneReplacing`: the quest that replaced the teacher's `viQuestID` done counts (the temples' disciple quests, the lieges' favours, the pupil quests);
  - **wandering NPCs** (the Minstrel, Maleval: `Wanderer`) have no room for the maps, though the god room's Kod makes them;
  - **the dashboard** edits the faction and the requirement boxes, the special rewards and an item's school; saving keeps `oneOf` and a faction-only `requires` (it dropped both before).
- **The quests** (70-112, `quests/faction-*`, `soldier-*`, `disciple-*`, `offering-*`, `insignia-*`, `pupil-*`, `guild-shield`, `necromancer-guild`, `errand-*`):
  - **main (gold):** joining each faction (70-72: a ruby for the Duke, a letter to Priestess Xiana for the Princess, a scimitar for Jonas; neutral, intriguing players), the soldier shields (76-78: one enemy soldier of each other side at the flagpoles), the four disciples (79-82: robes by school), raising Queen Venya'cyr (98, players in no guild), and the five pupils (99-103: Dementia, Fade, Sporeburst, the scimitar, the songs of Jala);
  - **story (silver):** the lieges' favours (73-75, every 12 hours), the five offerings (83-87, daily; Shal'ille for good karma, Qor for evil), the insignia (88-93 a tithe of reagents to each temple, Jala's to the Jala priestess in Bergholt rather than the wandering Minstrel; 94-96 a liege's spy errand for members), the guild shield for guild masters (97);
  - **errand (bronze):** the three tax couriers (104-106), the two love letters (107-108), the Ko'catan trading post and bow maker for good and evil karma (109-112);
  - where the old quest drew a target or cargo at random, one was chosen; talk and deliver steps name their NPC (the giver when it's the same one).
- **Factions** (`player.kod`): `FactionServiceRenew` returns before any timer or resign; `JoinFaction` and `ResignFaction` no longer touch the QuestEngine (the Princess's and the rebels' `DrawDefense`/`DrawOffense` stay).
- **The QuestEngine off** (`util/questengine.kod`): `RecreateQuestNodes` still builds the templates (players' old history reads them) but cancels any running quest, suspends the engine and starts no timer; `OnQuestTimer`, `OnQuestDeadlineTimer` and `ScheduleQuest` do nothing while it's suspended. On a running server: `RecreateClearQuests` and `ClearAllQuests` on the engine, `RecreateQuestEngine` on System, then `RecreateQuestNodes` on the engine (`piActive` 0, no timers). `DeadLich.Delete` no longer swaps an old quest node to the raised Lich. The old templates are left as they are (no `pbDisabled` needed with nothing scheduled).
- **Tried on our server:** the Shal'ille disciple quest (Xiana, Zuxana, back; a Shal'ille robe, `piSchool` 1; Xiana then teaches, Zuxana doesn't); joining the Duke as an intriguing player (faction 1, no faction timer); the Duke's insignia on a carried guild shield (`piInsigniaType` 7); a step's item reward (the Bone Priestess's feather) counting at once for the next step; the live QuestEngine rebuilt switched off.

**The guide's early game (2026-10-17).** Following section 8's decisions:
- **The monster table:** `npm run quests:bands` (`tools/quests/bands.ts`) writes [docs/research/monster-bands.md](../research/monster-bands.md) from the Kod: the XP each 10-health band costs and a third of it, every spawn room under the hub its exits reach first, and every monster with its level and the health it's worth fighting at (a kill gives about its `viLevel` in XP, only while your base health is below it).
- **XP that scales:** `rewards.xpPoints` (quest or step) is XP worth that many points of health at the quest's band minimum, `round(points × (min+1)²)` (`tools/quests/xp.ts`), added to `xp`. **The generator refuses a main quest that gives no XP**; the 22 main quests without any got `xpPoints` (0.75 for the disciples, 1 for the tours, joins and pupils, 1.5 for the soldiers and the necromancer guild).
- **The quests** (120-133, `quests/raza-*`, `marion-*`, `cornoth-*`), first-draft text, all main (gold):
  - **Raza (20-30):** Marcus the innkeeper's giant rats and the Farol road's centipedes; Rodric's restless graves (mummies in the mausoleum), which now lead to the old Shadow Mummy quest (10), then his letter to Ran er'Hoth in Marion;
  - **Marion (30-40):** Ran's spectral mummies in the crypt's first chamber, which lead to the old crypt tour (12), then the spiders of Farol and his report to Sergeant Rook; Morrigan the innkeeper's slimes on the shore and fungus in the Valley of Ileria;
  - **Cor Noth (40-50):** Cor Noth has no elder, so Sergeant Rook gives the elder's quests: spiders on the merchant way, orc raiders, then **Choosing a Side** (hear out the Duke, the Princess and Jonas, and come back): the faction split; D'Franco the innkeeper's fungus at the river's source and red ants in the hills.
  - **The hand-offs don't gate:** a hub's quests need only that hub's earlier ones, so a character who arrives another way isn't locked out; the letters are pointers.
  - **XP:** each hub's main quests come to about a third of its band (Raza 2,397 of 2,195; Marion 4,868 of 4,228; Cor Noth 6,459 of 6,928, counting the old tours there).
- **The dashboard** has an *XP worth* field (points of health at the band minimum), showing the XP it comes to.
- **Tried on our server:** Rats in the Stores from Marcus with kills counted (12), 331 XP and 50 shillings at the hand-in; Rodric then offering Restless Graves, with Word to Marion grey ("soon") below its band.

**Spawns for the mid game (2026-10-17).** The first spawn changes for the bands (`kod/object/active/holder/room/monsroom/`):
- **The sewers of Barloque** were giant rats and Lupoggs (125); they now level 50 to 90 with rats: the first room rat soldiers (60) with a few dusk rats (90) and giant rats, the second dusk rats and rat soldiers with a rare rat king (60, 700 hit points), the deepest mostly dusk rats with a few rat kings and Lupoggs. **The sewers of Jasper** got the same three rooms' rats the same day. The Lupogg King's crossing beyond both is unchanged.
- **The troll lands** (the Cragged Mountains both sides, the border of the Badlands, the Twisted Wood, Ukgoth) gain mutant ants (`RedAnt`, 65) at a fifth to a quarter of their spawns; Seafarer's Peak and the Hills had them already.
- **The Marion crypts** are left alone: they become high dungeons (130 and up).
- **Tried on our server:** the rooms rebuilt (`Recreate`) and visited: the deepest sewer made dusk rats, the first a mix of dusk rats, rat soldiers and a giant rat, the Twisted Wood trolls and mutant ants, Ukgoth mostly trolls with mutant ants; Jasper's sewers rat soldiers in the first room, dusk rats, rat soldiers and a rat king in the second, dusk rats in the deepest.

**The road to the island, and Ko'catan (2026-10-17).**
- **The orc caves start at 70, not 90** (the user's choice): their cave orcs and orc wizards are level 80, so they give XP only below 80; at 90 nothing in the caves but the pit boss (115) and the deep rooms' Shadowbeasts and Ogres (200) is worth fighting. Stronger orcs or raising the cave orcs were the other choices.
- **Each faction's cave chain** (main, faction members only, from the faction leader): 15 cave orcs then 10 orc wizards (70), then the orc pit boss (80; `RID_ORC_PIT`, a boss room, so the step names it). The Duke's (140-141) ends in the old Ko'catan tour, "The Descendants of Konima" (19), left open to everyone so players without a faction have a way to the island; the Princess's (142-143) in a letter to Cital ko'Manca (146), Jonas's (144-145) in a message to Xacal ko'Ixca (147). Each has its own story: the Duke's lost patrols, the Princess's mages sensing the orc wizards' magic, Jonas following the orcs' steel.
- **Ko'catan, 90-130** (150-155; no elder, so the captains, the innkeeper and the weapons master give them; the hand-offs don't gate them): Moxal's dragonflies on the cliffs (90) then the hive's queens (110); Cital's warrior avars (90) then the chieftains (115); Xacal's avar shamans (95); Kochtal's kriipa (125, after the chieftains).
- **XP:** a faction's cave chain comes to 18,789, about 43% of a third of 70-90 (the faction hubs are to give the rest); the island's to 87,481, about 53% of a third of 90-130 (Brax is to give the rest).
- **Tried on our server:** the Princess's letter carried to Cital (5,547 XP; Cital then offering the warrior avars and the old avar war), and Moxal's dragonflies at 95 health with 15 kills counted (8,281 XP). A character's health given by hand must have the XP to match, or the next XP reward sets health back from the XP total (`Player.AddXP`).
- **Object numbers move:** a `reload system` can renumber objects (the QuestBook was 6350, then 6325), so maintenance commands look objects up again after each reload.

**Brax (2026-10-17), 90-130.** The user decided Brax's quests start with the faction leaders for now, who send their people to Tendrath, the hunter ghost who sells spells outside Brax; he is the Brax hub.
- **The faction leaders** (160-162, faction members, 95): each sends you to Tendrath in the Cragged Mountains, for their own reasons (the Duke for Brax's treasure, the Princess for her people, Jonas for the people's memory).
- **The way down** (163, any faction): Brax is reached by G9's puzzle (walls of lightning on the pillars and the nine levers raise the platform, `monsroom/g9.kod`) and G8's far side into the Winding Caverns. Tendrath sends you to cast Lightning Wall (he teaches it) and to reach the Winding Caverns, and to come back.
- **Brax's dead** (164-168, Tendrath, after the way down): tusked skeletons in the Decaying City (95), Narthyl worms in the graveyard and city (100), daemon skeletons in the graveyard and on the castle walls (110), the Queen's necromancers in the castle ruins and dungeon (120), dark angels in the Inner Sanctum (125).
- **Tendrath lives in G8 now** (and since, `Room.Recreate` keeps any wanderer standing in a rebuilt room): he was a wanderer made in the god room who walked to G8 (his only destination), so rebuilding G8 (for the travel portal there) had deleted him. `g8.kod CreateStandardObjects` makes him at 38,38, and the god room no longer does. Any wanderer standing in a room that's rebuilt is lost the same way (the Minstrel, Maleval and the others wander several rooms); not fixed here.
- **The generator** no longer drops wanderers' rooms; it drops the god room from every NPC's rooms, so Tendrath's area is G8 and the Minstrel and Maleval still have none.
- **XP:** the Brax chain comes to 83,708; with the island's 87,481 that's 171,189, about 4% over a third of 90-130.
- **Tried on our server:** the Duke offering the start (with the cave chain and the old tours), Tendrath taking it (4,608 XP) and offering the way down; its cast step finished by `AdminFinishStep`, the Winding Caverns reached, the hand-in (9,216 XP, a point of health at 100), and Tendrath then offering the tusked dead and the worms.

**Jixa, the bandits, Berg, and 130-150 (2026-10-17).** As the user laid out:
- **The engine gained** two things:
  - `inRooms` on a kill step: only kills in its rooms count (the step's `QBS_EXACT` gets bit 2 and its rooms are written; `KillMatches` takes the room, the killer's for a kill and the monster's for its marker). For the bone faction's avar leaders, which are avar chieftains of one clan by room (`viAvar_clan`), the minotaurs of the crumbling ruins, the Valley of Death's daemon skeletons apart from Brax's;
  - `requires.notQuests`: not offered once any of those is done or going (`QB_EXCLUDES`, field 22), for the same errand from three givers.
  - The dashboard edits both.
- **Jixa (70):** the innkeepers of Tos, Barloque and Jasper (180-182) each send a letter to Jorgan Yesjor, the innkeeper of Jixa; doing one hides the others.
- **The bandits and Berg (100+):** each faction leader: fifteen bandits and ten snipers around the camps (100), five captains (115), and a letter to King Aaron Leone of Berg (100) (184-192). Plain bandits are level 100, so at 100 the snipers (120) and captains (140) are the ones worth fighting.
- **Berg's lands** (200-205): Bastiane the innkeeper's ranuculus in the Marsh (100) and giant eyes in the Desolate Mire (110); Roderick the smith's spinebeasts in the Jagged Hills (100); King Aaron's daemon skeletons in the Valley of Death (125), minotaurs of the wasteland (135) and of the crumbling ruins (145).
- **130-150:**
  - Tendrath: **Queen Venya'cyr** (169, after the Inner Sanctum): kill the `Lich`. She is in the sanctum only while raised, that is, while the necromancer guild stands (`DeadLich.EstablishNecromancerGuild` swaps the ghost for her); otherwise the quest can't be finished. Friends recommended.
  - Each faction leader: the thrashers of the Marion crypts' depths (210-212, 130) and Waylay Oasis's xeochicatl and golems across the desert (213-215, 135). Friends recommended.
  - The island: Cital's daily war on the noble avars' chieftains (170), Xacal's three leaders of the bone faction in the Chasm and the bone priestess's lair (171), Moxal's ogres of Chuk Creek (172), Kochtal's shadowbeasts in the orc caves' hollows (173) and daily kriipa hunt (174).
- **XP:** one player's 130-150 path (one faction, no dailies) comes to 142,493, about 8% over a third. 90-130 now offers 248,546 across the island, Brax, the bandits and Berg, against a third of 164,580: a player who does all of it levels faster than planned.
- **Tried on our server:** the Jixa letter from Paddock hiding Pritchett's (his marker bronze for his errands while it's going, gold once it's reset); a bone faction leader's kill not counted in Ko'catan town and counted in the bone priestess's lair.

**The Queen always, Castle Victoria, the mollusk daily (2026-10-17).**
- **90-130 keeps its plenty:** most players spend most of their time there, and the user wants variety (not everyone wants Brax or the island all the time), so its quests offer more than a third on purpose.
- **No necromancer guild:** Queen Venya'cyr (`Lich`) is always in the Inner Sanctum, like Far'Nohl's ghost in the throne room: `innersanc.kod` no longer makes the ghostly remains (`DeadLich`); `SpawnQueen` makes her when someone enters if she isn't there, and while anyone is in the room looks again every `QUEEN_CYCLE` (600 s, give or take 10%; Far'Nohl's is 120 s). The guild quest (98) is retired (`retired.json`), so nothing establishes the guild; the `necroGuild` reward and `DeadLich.EstablishNecromancerGuild` stayed in the code, unused, until the guild revamp removed them with the rest of the scenario (2026-10-23, [ADR 0022](0022-guilds.md) decision 27; `QBR_SPECIAL` kind 3 is kept unused). Tendrath's Queen quest (169) can always be finished.
- **Castle Victoria** (Drechx, the councillor who sells Second Wind, room 2; 220-223): fifteen skeletons in the castle's halls (50), ten of Far'Nohl's undead knights in his chambers (95), ten tusked skeletons in the antechamber (100), and Far'Nohl's ghost (130, level 220, friends recommended). Each counts only in its rooms.
- **The mollusk daily** (230, Fehr'loi Qan, the smith of south Barloque, 130+, bronze): six mollusks deep in the Forest of Farol and its underground lake, every day.
- **Dailies are bronze:** the island's two dailies (170, 174) moved from main to errand, the user's tier for repeatable, common quests.
- **Tried on our server:** the Inner Sanctum rebuilt: the remains gone, `SpawnQueen` making the Queen once (a second call finding her) and setting its timer; no necromancer guild stood on our server; Drechx showing a gold "!" to a 50-health character.

**Not yet tried:** fighting the Queen (it changes the world: tried by reading, the dead Lich is a talkable NPC), the offering and soldier quests end to end, kills by real fighting (only `MonsterKilled` sent by hand), shared kills in a builder group, a time limit running out, the dashboard's form driven by hand end to end in the browser (its routes were), and a save from before quests on the hosted server (new `User` properties: a copy first, 0008 3.3).

## Play-test changes (2026-10-18)

- **Raza's chain** (from the play test, QA_PLAYTEST.md; reworked the same day as the tutorial, with lots of hand holding, to reach 30 health quickly). Marcus, at the inn where newcomers arrive, starts it, and every hand-in leads to the next offer:
  1. Arms for the Road (134, Marcus): talk to Tomas (250 shillings, the step's reward), buy a small round shield from him, and show it to Marcus (a `buy` step with `auto: false`, handed in to Marcus). No skill to learn any more.
  2. The Elder of Raza (137, Marcus): talk to Rodric d'Stane in his hut.
  3. Restless Graves (121, the Elder): ten mummies in the mausoleum.
  4. The Shadow Mummy of Raza (10, the Elder), no longer optional, offered with 121 (both after 137), so one trip into the mausoleum does both.
  5. A Strong Arm for Raza (138, the Elder, after 121 and 10): back to Marcus.
  6. From Marcus at once: Rats in the Stores (120, the Outskirts) and The Farol Road (122, centipedes on the Western Edge of Farol beside it), eight each, both repeatable straight away (`repeat` with 0 hours) while base health is under 30 (`requires.healthBelow`); and A Way Home (135, attune to Raza's portal, travel point 3), unless already attuned.
  7. The Road to Marion (136, Marcus, from 30 health): talk to Tova, Marion's bartender, who sends you on to Morrigan and Ran er'Hoth.
  Quest XP to 30 health: the chain gives about 2,500 (and level-30 mummies, rats and centipedes give kill XP up to 30), so two or three rounds of both hunts finish it; 20 to 30 takes 6,585. Word to Marion (123) is retired (`retired.json`). The Western Edge of Farol spawns mostly centipedes (65%, rats 20%) for 122. The message of the day (`server/config/motd.txt`) sends newcomers to Marcus.
- **Marion's start** (the same day), from 30 health:
  - Tova (the bartender, where the Road to Marion ends) offers A Mace from Colhorr (139): talk to Colhorr at the smithy (100 shillings), buy a mace.
  - Morrigan offers Slime on the Shore (125, ten slimes) and Fungus in the Valley (126, no longer after 125, band from 30) together, both repeatable at once (`repeat` with 0 hours, no health cap). Both lie out of Marion's north-east corner: the Deep Woods of Ileria, the Valley of Ileria (fungus beasts, level 50), then the Great Ocean (slimes).
  - Ran er'Hoth offers Lady Aftyn's Remedy (148: talk to Aftyn, 100 shillings, buy a cure poison potion) beside The Crypt's First Chamber (124).
  - Aftyn then offers The Temple of Shal'ille (149): talk to Priestess Xiana in the Deep Woods of Ileria.
  - The Road Through Meridian (11, Xiana's long guide) is **paused**, to be broken into smaller quests.
  - Marion's crypt gives 5 s for the second lever (`marcryp1.kod SLAM_TIME`, from 2 s), as Raza's mausoleum does, so one player can open its gate.
- **Paused quests** (a quest file's `paused: true`, the `QBQ_PAUSED` need, 16): never offered (`MeetsNeeds` refuses it, so no marker either), but one a player has going can still be finished, and taking the flag off brings it back; retiring (`retired.json`) is for good. The catalogue says `paused` (only for those), so Suggested for you leaves them out. The dashboard's Quests tab has a Paused checkbox.
- **Markers:** the view's "!" and "?" grow as we near them, to 1.4 times their size within 2 squares, from 8 squares in (`gameScene.ts MARKER_NEAR_SCALE`), and have a 1px black outline (`styles.css --marker-outline`). The minimap's way chevrons stop growing with the zoom at 9 pixels (`MiniMap.tsx CHEVRON_MAX`): a small room's map is zoomed right in, and they covered it.
  - **Area exits on the maps:** Marion leaves for the Ileria woods only through areas its `SomethingMoved` watches (row < 32 and col > 66 to C4; row > 83 and col > 48 to C5), which `roomexits.json` didn't know, so the way to the ocean ran round through the plantation and the Forest of Farol. `tools/assets/roomLinks.ts areaExits` now reads every room's `if (new_row OP n) and (new_col OP m)` blocks that `UtilGoNearSquare` to a room as a door at the area's inner corner (19 rooms, the Deep Woods' way to the temple among them), for the quest way, the links and the townsfolk alike. Rebuild the assets after changing one.
- **A health cap on offers** (`requires.healthBelow`, the row's `QB_HEALTH_BELOW` 23): a quest is offered only while base health is under it (`CanOffer`), first time and repeats alike; one already going can still be finished. The band's max stays a suggestion. The dashboard's Quests tab edits it (Offered below health).
- **Two step kinds** (`QK_LEARN` 16, `QK_ATTUNE` 17):
  - `learn` (`skills`: skill classes) counts when the player learns any of them (`Player.AddSkill` → `QuestBook.SkillLearned`), and is done at once if they know them all (`CheckStateSteps`, `KnowsSkills`).
  - `attune` (`point`: a travel point) is a state step, done when attuned (`User.AttunePortal` → `CheckStateSteps`). A quest whose first step is one isn't offered to a player already attuned (`CanOffer`).
  - The generator writes the skills as the step's classes and the point as its amount; the dashboard's Quests tab edits both.
- **Signet rings as bronze quests:** a signet ring we carry is listed in the Quests tab and the quest box as "A Lost Signet Ring" (bronze), returnable to its owner, with their room. The server sends the list (`UC_SIGNETS` 114, `QuestBook.SendSignets`) at logon and whenever a ring reaches or leaves a player (`SignetRing.NewOwner` and `Delete` post `SignetMoved`). Returning one is the library's errand as before.
- **Suggested for you** is hidden behind a Show suggestions checkbox at the Quests tab's foot (`settings.questSuggestions`, off by default).
- **The way on the maps:** a doorway several squares wide is one chevron at its middle (`questWay.ts exitsTo`), not one a square.
- **Skipping the tutorial** (the character creator's Skip the tutorial, `start <city>`, `ShardsAbilities.StartCity`) attunes the new character to Raza's and Marion's portals (points 3 and 2), the ones the tutorial's road passes, so A Way Home is never offered to them.

## Play-test changes (2026-10-19)

- **Raza:** the Outskirts of Raza (`razaforest.kod`) spawn faster and fuller for Rats in the Stores (120): `piGen_time` 14000 (from 20000), 5-8 to start (from 3-7), at most 18 (from 15), and rats 75% (from 60, spider babies 25).
- **Marion:**
  - Marion's crypt gives 6 s for the second lever (`marcryp1.kod SLAM_TIME`, from 5). Its levers are further apart than in Raza's mausoleum, which stays at 5 s.
  - **Clearing the statues** (12, The Restless Dead of Marion, step 2) is now eight living statues on the crypt's second level (`kill` LivingStatue, `inRooms` RID_MAR_CRYPT2, handed in to Ran er'Hoth). It used to be a visit to level 3A, the thrashers' level, and the quest no longer sends anyone there. `marcryp2.kod` places 37 statues, and places them again when the room empties and someone comes back.
  - The Temple of Shal'ille (149) now ends with learning **Minor Healing** from Priestess Xiana: a `learn` step with `spells`. It's done at once if the player already knows it.
- **Free spells** (`Spell.IsFreeToLearn`, TRUE only for Minor Heal):
  - Anyone may learn one: `Player.PlayerCanLearn` says SUCCESS (or ALREADY) before the points, school and karma checks.
  - It doesn't count toward learn points: both counts (`PlayerCanLearn`, `GetTotalLearnPoints`) skip it, as they skip Blink and the utility spells.
  - It still costs a level-1 spell's 500 shillings.
- **`learn` steps take spells:**
  - A step's `spells` (spell classes) are written into the step's classes with its `skills`. The generator checks each kind.
  - `Player.AddSpell` calls `QuestBook.SkillLearned` as `AddSkill` does.
  - `KnowsSkills` looks in the spell list too.
  - The dashboard's Quests tab edits them ("or spells").
- **The `train` kind** (`QK_TRAIN` 19): spending training points on any spell or skill. `ShardsAbilities.Train` calls `QuestBook.AbilityTrained` once the points are spent. There are no classes: anything counts.
- **Cor Noth (40-50) teaches the game.** Rook (`CorNothSergeant`) and D'Franco (`CorNothInnkeeper`) offer small tutorial quests alongside the old monster quests (129-132).
  - **Rook:**
    - A Lesson from Rook (252): learn any of his skills. It rewards 400 training points.
    - Then, together: Put It to Practice (253, a `train` step) and Cor Noth's Portal (254, attune point 6).
    - Word to Cor Noth (128) now pays 500 shillings, enough for a level-1 skill.
  - **D'Franco:**
    - The Meridian Museum (255): visit the museum, then any historic town through its old portals.
    - The Hall of Genealogy (256).
    - Herbs from Solomon (257): buy anything from `CornothGrocer`.
  - **Rook's faction tour** replaces Choosing a Side (133, retired):
    - The quests are The Princess of Barloque (258), Jonas and the Rebels (259) and The Duke of Tos (260, from 48), all offered after 254.
    - Each explains the side's benefits and risks (the bonuses are in `parlia.kod`).
    - Each one's steps: attune that city's portal (5, 4, 1), talk to the liege in their room (852, 371, 952), then report back to Rook.
- **Already done before this round** (d444d1e2): ten slimes, repeatable slime and fungus hunts, and The Road Through Meridian paused.

## Mana node quests (2026-10-19)

- **One silver quest per mana node** (261-275):
  - Each is given by an NPC near the node, or a themed one, and finishes the moment the player bonds (a `node` step, no walk back).
  - It isn't offered to anyone already bonded with that node.
  - Esseldi's Hunt for the Mana Nodes (15) stays as the long goal.

  | id | Node | Giver |
  |---|---|---|
  | 261 | Vale of Sorrows, good | Xiana (Shal'ille) |
  | 262 | Vale of Sorrows, evil | Zuxana (Qor) |
  | 263 | the Underworld | starts on death |
  | 264 | Avar Village | Oxal, Ko'catan's bartender |
  | 265 | Martyr's Battleground | Qerti'nya (Kraanan) |
  | 266 | the icky cave | Paddock, Tos |
  | 267 | Seafarer's Peak | Widow Qesino, Jasper's inn |
  | 268 | Dreaded Caves of Ice | Quintor |
  | 269 | the Badlands | Pritchett, Barloque's inn |
  | 270 | Maze of the Mimic | Tendrath |
  | 271 | the Sentinel (H9) | Solomon, Cor Noth |
  | 272 | the ancient place (G9) | Pietro, Jasper's tavern |
  | 273 | Castle Victoria | Frisconar, Tos |
  | 274 | the Heart of Zjiria (I9) | Fehr'loi Qan, Tos |
  | 275 | the Collapsed Causeway | Meidei, Barloque's bar |

  - The two Vale quests first ask for a cast of the priestess's detect spell.
  - The guest node (Raza's mausoleum) isn't in the game.
- **The `node` kind** (`QK_NODE` 20):
  - A step's `node` (a NODE_ constant) becomes its amount: the node's bit. `world.ts` now reads hex constants too.
  - It's a state step: done when `Player.GetNodeList` has the bit (`CheckStateSteps`, which bonding already posts).
  - `CanOffer` refuses a quest with a node step the player already has.
- **Quests that start on a death:**
  - A quest file's `"start": "death"` sets the `QBQ_ON_DEATH` need (32). Its giver never offers it, and the catalogue says `onDeath`, so Suggested for you leaves it out.
  - `Underworld.NewDeath` (a real death: a player's corpse) posts `QuestBook.PlayerDied`. That starts each such quest `CanOffer` allows (death) while the log has room.
  - The Skull's Five Fires (263) explains the Underworld's brazier puzzle. Once it's done, or the node is bonded, it never comes back. Its giver (Xiana, whose voice it speaks in) is only for the catalogue.
- **The Vale of Sorrows** (`feyforst.kod`, `feyforst/c2.kod`):
  - **The gate is back:** the fey node shows only while all eight rooms are very good or all very evil. The elhai (good) or dirhai (evil) node is the same `NODE_FAERIE`. Its karma check (`FeyNode.LashOut`) stays off, so anyone may bond either way.
  - **Locks** (`FeyForest.CastLock`): casting Detect Evil (Shal'ille) in a vale room locks it good, and Detect Good (Qor) locks it evil, for a Meridian day (`FEY_LOCK_TIME`, 2 real hours). Potions don't count.
    - While locked, the room's karma holds at 100 or 0, it spawns only its own fey, and it doesn't drift.
    - The same spell again renews the lock. The opposing spell only breaks it.
    - So one to three players can lock all eight rooms and bond.
  - **The lock icon** is a room enchantment, `FeyLockGood` or `FeyLockEvil` (`passive/roomflagicon/feylock*`, with Shal'ille and Qor bane art). It's held for the lock's time, so every client shows it by the map. Its `EndSpell` (the timer, or `RemoveEnchantment` when broken) unlocks the room (`FeyLockEnded`).
  - A DM's room karma command breaks any lock.

## Graveyard, temples and faction ground (2026-10-19)

- **Tos graveyard** (Paddock, `TosInnKeeper`), both repeatable every 24 hours:
  - The Restless Dead of Tos (276): ten zombies.
  - Bones in the Graveyard (277): five skeletons.
  - Both count only in the Graveyard of Tos (`inRooms`), whose dead rise only late at night (`tosgrave.kod`, game hour < 5 or > 21). The text says so.
- **Where to learn a school** (talk steps to the teacher):
  - The Song of Jala (278): Luisane d'Ile, Berg's merchant → Priestess Themala.
  - The Temple of Riija (279): Quetzal, Ko'catan's language master → the Monk of Riija, past the ruins and the noble avars.
  - Each liege sends their own people (`requires.faction`) to a priestess:
    - The Duke's Priestess (280) → Zuxana. The Temple of Qor's door moves between the Sentinel and the Cragged Mountains.
    - The Princess's Priestess (281) → Tenuv'vyal in the Badlands.
    - Jonas's Priestess (282) → Qerti'nya at the Temple of Kraanan.
- **Faction ground** (283 Duke, 284 Princess, 285 Rebels), repeatable every 24 hours:
  - Gated on the faction and its soldier quest (77, 76, 78), which gives the SoldierShield a claim needs.
  - Steps: kill three troops of each rival faction (auto steps, no walk back), then claim any flagpole for your side.
  - The offer and step briefs explain the territory game: your faction's flag from your liege's hall, a pole next to land you hold, and eight minutes holding it.
- **The `claim` kind** (`QK_CLAIM` 21): an action step done by `Flagpole.ClaimAttempt` on a real claim, through `QuestBook.FlagClaimed`. It isn't hooked in `TerritoryGame.FlagClaimed`, which admin changes and recreates also call. Any pole counts.

## Marion repeats (2026-10-20)

- The Crypt's First Chamber (124, spectral mummies) repeats at once (`repeat` with 0 hours) while base health is under 40 (`requires.healthBelow`).
- The Restless Dead of Marion (12, the statues) is offered from 40 health and repeats at once while base health is under 60.
  - It no longer needs 124 done: 124 stops being offered at 40, and anyone who skipped it would otherwise never get 12.
- The Spiders of Farol (127) moves to Morrigan (`MarionInnkeeper`), beside the slimes and fungus beasts. It's offered from 35 health with no prerequisite, and its hand-in points the player to Ran er'Hoth.
- **Word to Cor Noth** (128, Ran er'Hoth) is offered to anyone from 40 health with no prerequisite. Reaching Cor Noth matters too much for it to hang on a skipped quest.

## Renown (2026-10-21, the faction revamp)

- Each player has a renown of 0 to 100 with their faction (`Player.AddFactionRenown`; the design page's D7-D10). It starts at 0 on joining and is cleared on leaving.
- **`rewards.renown`** (1 to 100) is a special reward, `[ 4, amount ]` (`QRW_RENOWN`). `AwardSpecial` posts it, so a quest that also joins a faction gives renown with the new one. Nothing for a neutral.
- **`requires.renown`** (1 to 100) is a quest's 24th field (`QB_RENOWN_MIN`): offered only from that much renown, never to a neutral. It can't go with `requires.faction: "neutral"`.
- The faction quests give it: the soldier quests 10, the zone chains 3 each, the faction ground dailies 3, the favours 2, the priestess pointers 2.
