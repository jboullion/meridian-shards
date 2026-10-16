# ADR 0014: Games in the inns

- **Status:** proposed, 2026-10-15. Not built.

## Context

We want things to do in Meridian's inns:
- **Table games** in pop-up windows, like the chess we have: dice, cards, dominoes.
- **Throwing games:** darts and bean bags. Everyone in the room sees each throw fly and land, using a single projectile sprite.
- **AI-made art** for the new games where they need it.

This ADR is the feasibility study and the design.

### What Server 104 already has

Paths below are under `kod/` in our `shards-server` fork. `object/active/holder/nomoveon/battler/player/user.kod` is shortened to `user.kod`.

**A general game object, used only by chess:** `MiniGame is PassiveItem` (`object/item/passitem/minigame.kod`).
- **Joining:** click it (`TryActivate`) to join as the next player, up to `viMaxPlayers`, or to watch once it's full.
- **Starting a player's window:** the server loads the game's window by name (`vrModule`, for chess `chess.dll`), then sends `UserGameStart` (`UC_MINIGAME_START`), the state (`GameStateSendUser`, `UC_MINIGAME_MOVE`) and the players' names (`UC_MINIGAME_PLAYER`).
- **Moves:** a player sends the new state as text (`UC_MINIGAME_STATE`: the game object and a string). The server stores it and passes it to the other players and to watchers still in the room (`GotNewState`). Reset is `UC_MINIGAME_RESET_PLAYERS`.
- **The server trusts the client completely.** It never checks turns or legality: "All move logic and turn order must be performed by the client." Every player and watcher gets the whole state.
- **`Chess is Minigame`** (`minigame/chess.kod`) only sets its art and window name. Bartenders sell boards (`bqbart.kod`, `jsbart.kod`), and no inn has one.
- **What this gives us:** a text channel from a player to a game object (`UC_MINIGAME_STATE`) that's already in blakserv's tables. New games need no C change to receive moves.

**Dice the server rolls:** `Dice is PassiveObject` (`object/passive/dice.kod`).
- Click within 3 squares, and the server rolls (`Random`) and tells everyone within 6 squares ("… rolls and gets a three and a five!"), with `dice.ogg` and a 1-second pause between rolls. It comes as a single die or a pair (`Create(&Dice,#pair=TRUE)`).
- **The result is only text.** `dice.bgf` and `die.bgf` each hold one picture (one bitmap, one group), and a roll never changes the object's look, so the dice look the same whatever they rolled.
- It's placed only in two guild halls: `ghall/guildh14.kod` has a die and a pair, `ghall/guildh17.kod` two of each. No inn has any.
- The art and the sound are in our game files. The dice clatter heard in inns comes from our client's ambient sounds (`ambientSounds.ts`), not from these.

**No gambling of any kind.** No bets, and nothing that holds stakes.

**Projectiles** (`BP_SHOOT`, sent by `Holder.SomethingShot` to everyone in a room):
- **Fields:** an icon, an animation, source and destination objects, a speed, and flags (`PROJ_FLAG_FOLLOW_GROUND`, `PROJ_FLAG_LIGHT_SOURCE`).
- **What it can't do:**
  - The destination must be an object, not a spot.
  - There's no arc.
  - Nothing remains when it arrives.
- **What it can do:** any object can be the target, a passive one included.

**Walls:**
- **Nothing hangs on a wall.** `OF_HANGING` hangs from the ceiling. Signs and lamps are floor sprites placed by a wall at fine coordinates.
- **Inn furniture:** `Table` is just something you can't walk through, and can't be clicked.

**The inns:**

| Inn | Room | RID |
|---|---|---|
| Tos, Familiars | `tosinn` | 52 |
| Tos, Abandoned Fountain Tavern | `tostavern` | 76 |
| Barloque, Brownestone Inn | `barinn` | 106 |
| Cor Noth, Cibilo Creek Inn | `corinn` | 153 |
| Marion, Limping Toad | `marinn` | 202 |
| Raza, the Inn of Raza | `razainn` | 301 |
| Jasper, Yonder Inn | `jasinn` | 370 |
| Jasper, Pietro's Wicked Brews | `jastavrn` | 371 |
| Ko'catan, Aerie Guest House | `kocinn` | 2001 |
| Ko'catan, The Barking Monster | `koctav` | 2008 |
| Bergen, Murky Fork Bar | `berginn` | 2805 |
| Jixa, Wandering Fiddler Pub | `jixa_inn` | 2905 |

### What our client has

- **Chess** (`packages/world/src/chess.ts`, `ui/ChessWindow.tsx`):
  - The rules are a port of the original's.
  - The plumbing is general: `buildMinigameState`, and `MinigameEvent` in `session.ts`.
  - `GameView.tsx` opens the window when the server loads a window named `chess…`. Another game needs only its own name and its own window.
- **Projectiles** (`state.ts`, `gameScene.ts projectileViews`) fly in a straight line. Their height is a blend of the floor at both ends (`ViewObject.z`), so an arc is one more term: `+ height × 4p(1 − p)`, with no change to the renderer.
- **The arena's spells** (`packages/world/src/arena/arenaView.ts addShot`) are projectiles our client flies by itself from `{from, to, start, flight}`, with ambient ids. That's the model for a throw.
- **Sprites in the world** must be BGF files; `localRes` loads them by name, and ambient sprites can be drawn smaller (`ViewObject.scale`, as pets are).
- **Art we can reuse:** `arrow.bgf` (a dart, scaled down), `bagbean4.bgf` ("bag of beans"), `barrel`, `bucket` and `basket4.bgf`, `bullseyeico.bgf` (a red and white bullseye, 64 pixels), `dice.bgf` and `die.bgf`, `chestabl.bgf` (a game table), and the sounds `arrowswish1-3.ogg` and `dice.ogg`.
- **UI art:**
  - The asset build already takes PNG and WebP (`tools/assets/build-assets.ts` sources: the weather sprites, the login backgrounds).
  - Stone windows come from `ui/kit.tsx`.
  - AI image tools: iconforge (`shards-server/tools/iconforge/`), and `meridian-unreal/tools/aigen/restyle.py`.
- **The inns are known by room file** (`packages/world/src/ambient/ambientRooms.ts`, `inn(...)`).

## Decisions

The user decided these on 2026-10-15:
- **wagers are optional, and the server runs any game with a wager**: it rolls, deals and holds the pot;
- **no house cut**: winners take the whole pot;
- **the first table games:** liar's dice, Twenty-One, dominoes, Nine Men's Morris and Hnefatafl;
- and, as for every ADR now, **only our client and our server** have to work.

### 1. Games the server runs

1. **A new base class, `TableGame is MiniGame`**, for every game with hidden information or a wager.
   - It reuses joining, watching, the window by name, names and reset from `MiniGame`.
   - It replaces `GotNewState`: what a player sends is a **request** ("roll", "bid 3 fives", "play 4|6 left", "stand", "bet 200"), not a new state.
   - The server checks the request (whose turn it is, whether it's legal), rolls or deals with `Random`, and works out the new state.
2. **Each seat sees only what it may.**
   - The server sends each player their own view (`GameStateSendUser`, per player): their own dice or hand, and only counts for everyone else's. Watchers get the public view.
   - At the end of a round everything is shown.
3. **Turns run on a clock.** A seat that doesn't act in time (for example 60 s) folds or passes. One who leaves the room or logs off is out of the round.
4. **Wagers, held by the server:**
   - Before a round, the table's stake is agreed (the first player sets it, from a table's limits, for example 10 to 5,000 shillings).
   - Each player who joins pays it from the shillings they carry, into the game's pot (a number on the game, the shillings deleted).
   - The winner is paid the whole pot as new shillings (no cut). A tie splits it.
   - **Refunds:** if a round can't finish (everyone leaves, a reset, a server restart), everyone gets their stake back. The pot and who paid it are saved on the game, so a restart refunds it.
   - Every wager and payout is written to the server log.
5. **The window's name** (`vrModule`) is the game's name: `liarsdice`, `twentyone`, `dominoes`. Our client opens the right window from it. The `.dll` suffix is dropped (only our client matters).

### 2. The table games

1. **Liar's dice** (2 to 6 players; `LiarsDice is TableGame`):
   - Each player has five dice under a cup; the server rolls them.
   - In turn, players bid on how many of a face are on the whole table, or call the last bid a lie.
   - The loser of a call loses a die; the last player with dice wins the pot.
   - The dice in the window use the same six faces as the room dice (2.6), rendered to window art (5), so both look alike. The cups are new window art. Rolls play `dice.ogg`.
2. **Twenty-One** (2 to 6 players; `TwentyOne is TableGame`):
   - The innkeeper's table deals from a shuffled Meridian deck: four suits, ace to king, with suits named for the schools, settled in the art pass.
   - Each player draws or stands, trying to come closest to 21 without going over.
   - **Players play against each other, not the house:** the best hand takes the pot. With no house cut, the house never stakes money.
3. **Dominoes** (2 to 4 players; `Dominoes is TableGame`): a double-six set, seven tiles each, blocking and drawing. The first to go out, or the lowest hand when blocked, takes the pot.
4. **Nine Men's Morris and Hnefatafl** (2 players):
   - Games where everything is in view, ruled in our client like chess (`MiniGame`, client-ruled), **with no wagers**.
   - Each gets a rules module like `chess.ts` and a board window.
5. **The room dice** (the existing `Dice`) stay free, social rolls with no window and no wager, and go into the inns (3.4).
6. **The room dice show what they rolled:**
   - **The art:** `die.bgf` gains six groups, one per face, each showing that face on top. They're made with iconforge and installed under the same name, so the guild halls' dice get faces too. Optionally a seventh group, a few frames of a tumbling die.
   - **One die:** `Dice` keeps the face it rolled (`piFace1`) and sends it as its animation group (`SendAnimation`: `ANIMATE_NONE` with that group).
   - **A pair:** one object, with the second die as an overlay on the first (`die.bgf` again, its own face as the group) at a hotspot added to the art beside the first die (`bgf.py` adds it), and its face in `piFace2`. `dice.bgf` stays as the pair's inventory-style picture for looking at it.
   - **The roll:** the dice tumble (`ANIMATE_CYCLE` over the tumbling frames) for about half a second while `dice.ogg` plays, then settle on their faces. The server re-sends the dice to the room each time (`SomethingChanged`), and the text line still goes out.
   - **They stay showing** the last roll until someone rolls again, so anyone walking up sees it.
   - Our client needs no change: groups, cycles and overlays are drawn already.

### 3. Where the games are

1. **Each inn gets game tables:**
   - a table object (`InnGameTable`, clickable, using `chestabl.bgf`) for each game, placed in its room's `CreateStandardObjects`;
   - the bigger taverns (Pietro's, the Barking Monster, the Limping Toad) get more;
   - which games go in which inn is settled in an inn pass (8).
2. **The tables can't be picked up** (`ReqNewOwner` returns FALSE), unlike chess boards, and they don't count as clutter.
3. **Chess boards from the bartenders stay as they are.** A chess table in each inn is part of the inn pass.
4. **The room dice move out into the inns.** Today they're only in two guild halls. The guild halls keep theirs, and the inns get them too:
   - a die and a pair on a table in every inn and tavern of the list above, placed in each room's `CreateStandardObjects` as the guild halls place them;
   - the busy taverns (Pietro's, the Barking Monster, the Limping Toad, Familiars) get a second set;
   - the exact squares are chosen in the inn pass.

### 4. Throwing games: darts and bean toss

1. **The target** is a server object, so every player sees it:
   - **Darts:** a `DartBoard` placed by a wall at fine coordinates, as signs are, using `bullseyeico.bgf` drawn larger, or one board sprite from iconforge.
   - **Bean toss:** three or four `BeanTarget`s (the existing `bucket`, `barrel` and `basket4` art) at stepping distances, worth more the farther they are.
2. **The throw line** is a square or two in front of the target. Clicking the target there joins the game (`TryActivate`, as dice check range). Two to four players take turns, three throws each, for a set number of rounds.
3. **Aiming** (our client): a small throwing window.
   - A marker sways over a picture of the target. Holding the throw button builds power, and letting go throws.
   - It sends `throw <x> <y> <power>` with `UC_MINIGAME_STATE`.
4. **The server decides where it lands:**
   - the aimed point, moved by a random spread that shrinks with the thrower's Aim, and by how far the power was off;
   - then it scores the landing: the rings of the board, or which bucket the bag fell into;
   - so a modified client can't hit a bullseye every time, and wagers are safe.
5. **Everyone sees the throw.** The server sends everyone in the room `UC_MINIGAME_THROW`:
   - the game, the thrower, the sprite, where it lands (fine coordinates and height against the target), the flight time, the arc's height, and the score.
   
   Each client then flies it itself, as the arena's spells fly:
   - an ambient projectile from the thrower's hand to the landing point, along an arc (`z + height × 4p(1 − p)`);
   - with `arrowswish*.ogg`, and a thud or a soft landing;
   - the score said over the board.
6. **What landed stays.** Darts stick in the board, and bags stay on the floor or in the bucket, as ambient sprites until the round ends (`UC_MINIGAME_THROW` with a "clear" flag). Someone who walks in mid-round is sent the round's landings.
7. **One new sprite at most:**
   - a dart can be `arrow.bgf` drawn at about a third of its size, and the bag `bagbean4.bgf` drawn small, so the first version needs no new art;
   - a proper dart and bag from iconforge can replace them later, by name.
8. **Wagers** work as at the tables (1.4): the highest score takes the pot.

### 5. The art

1. **The windows' art** (not world sprites): dice faces and cups, a Meridian card deck (52 faces and a back), domino tiles, Morris and Tafl boards and pieces, a picture of the dart board for aiming.
   - Made with an image model from a style brief, as iconforge's batches are, and reviewed the same way.
   - Kept as PNG or WebP in `shards-server/resource/ui/games/`, committed there as iconforge's results are, because raw art doesn't go in this repo.
   - The asset build takes them under `ui/games/` (one more source in `build-assets.ts`), and windows load them with `assets.url`.
2. **One deck design** for all card games, so later card games (8) cost no new art.
3. **World sprites** (the game table, the dart board, a dart, a bag) come from existing art first (2, 3, 4), and from iconforge if new ones are wanted.
4. **The die's six faces** (2.6) are the first iconforge job here: one BGF, with a tumble and a hotspot for the pair's second die.

### 6. Our client

1. **One `GameWindow` host,** chosen by the window's name (`liarsdice`, `twentyone`, `dominoes`, `morris`, `tafl`, `chess`, `darts`, `beantoss`), with the chess window's frame: the names, players and watchers, Reset, and a stake field.
   - Each game draws its own board in it.
   - For server-run games it sends requests, not states.
2. **Arcing projectiles:** `UC_MINIGAME_THROW`, ambient projectiles with an arc (the arena's `addShot` with a height), and landed sprites per target until cleared.
3. **The throwing window:** the target picture, the swaying marker, and the power bar.
4. **Rules modules** for Morris and Tafl, beside `chess.ts`, with tests.

### 7. The website

- An Inn games page on the wiki: which games, where, and how to play. Only once they're built.

### 8. Other games to consider later

- **Backgammon** (old "tables"): two players, dice, wagers. Server-run.
- **Hazard**, the medieval dice game: one roller against the table, quick rounds, wagers.
- **A trick-taking card game** (for four, in partners) on the same deck.
- **Arm wrestling:** two players at a table, decided by Might and a timing bar, shown with emotes.
- **A drinking contest:** rounds of ale, decided by Stamina and a little luck, with the inn's drink sounds.
- **Knife throwing:** darts with a heavier sprite and a wooden target, the same code as darts.
- **Lawn bowls or quoits** outdoors in the towns: bean toss's code with a different sprite and targets.

### 9. The order to build it

1. The room dice: the six faces and the tumble, the faces on `Dice`, and dice placed in the inns (2.6, 3.4). A quick win that needs no new protocol.
2. `TableGame`: requests, views for each seat, turns on a clock, the pot with its refunds, and the log. Liar's dice end to end, first with no wager, then with one.
3. `GameWindow`, and the liar's dice window with the dice art.
4. Darts: the board, the throw line, aiming, the server's landing, `UC_MINIGAME_THROW` and the arc, all with existing art.
5. Bean toss, on the same code.
6. Twenty-One and the deck art; dominoes and the tile art.
7. Morris and Tafl, client-ruled.
8. The inn pass: tables, dart boards and bean toss in each inn.
9. Later games (8).

### 10. Left to settle when it's built

- Which games go in which inn (3.1).
- The table limits and the turn clock (1.3, 1.4).
- The card suits' names and the deck's look (2.2).
- The darts rules: a simple best-of-three, or a counting-down game like 301 (4.3).
- How much Aim narrows the spread (4.4).
- Whether watchers may bet on others' games.
- Which squares the inns' dice go on, and which taverns get a second set (3.4).

## Consequences

- **Real money moves:** wagers put shillings at risk between players, through the server's pot with refunds. Mistakes here lose players' money, so the pot code gets its own tests, and every move is logged.
- **No house cut:** gambling moves shillings between players and neither creates nor removes them. Twenty-One is player against player for the same reason.
- **The server runs the rules** of every wagered game: more Kod, but nothing a modified client can cheat.
- **Saves change:** the games' pots and the new classes, tried on a copy first ([ADR 0008](0008-player-homes.md) 3.3).
- **New UI art,** paid image calls, and a server repo folder of window art.
- **The commands are a protocol:** the game requests, `UC_MINIGAME_THROW` and the window names change in our client and our Kod together.
- **Docs to update** as each part lands:
  - `AGENTS.md` (beside the chess notes) and `docs/missing-features.md`
  - `docs/research/protocol.md` (`UC_MINIGAME_THROW`, the request texts)
  - the website's wiki
