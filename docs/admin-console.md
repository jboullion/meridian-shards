# The admin console

The admin console lets an administrator run server commands from inside the game: inspect any object, move characters, create items, message everyone, save the game and so on. It's our port of the original client's admin module (`module/admin`). The commands are the same ones the maintenance port takes (`tools/maint/maint.ts`), so anything you can do there you can do here, as your character, without leaving the game.

**Everything you type changes the live world at once.** There's no undo and no "are you sure". Read [Be careful](#be-careful) before using it on a server with real players.

On the local development server there's also the **admin dashboard**, at http://localhost:5173/admin.html in a tab of its own. Its tabs:
- **Spawn:** monsters by name with their pictures, on the Proving Grounds' pads or beside you.
- **Items:** items into your inventory.
- **Spells:** cast at what's in your room.
- **Rooms:** go to any room, rebuild it, or edit it.
- **World:** the server's time, and your client's weather, terrain and crowd.
- **Sprites:** a pixel editor for the game's sprites. Hair and facial hair are shown on a head in every hair colour. It can import a PNG and offer a new style in the character creator. Saves go to shards-server's `resource/graphics/shards` and show in game tabs straight away.
- **Music & Sounds:** every track and sound in the asset build, to play in the dashboard or in the game tab, with the rooms and Kod (or client code) that play it. A game track can be heard as written too: its XMI rendered with Windows' `gm.dls` or GeneralUser GS, its MIDI downloadable. Our own pieces (`tools/music/pieces`, `npm run music`) are rebuilt from here and game tabs fetch them anew.
- **Tuning:** ambient life's numbers, live.
- **Quests:** make and edit quests (below).
- **Companions:** manage your character’s companions (below).
- **Server:** build and reload the Kod, and any maintenance command.

It needs a game tab logged in as an admin for the things it does as you. It's for development only: no build has it (AGENTS.md has the details).

## Who gets it

Only characters on an **admin account** see it. The server sends admin characters the console (the "admin.dll" module) when they log on, along with the message "Welcome to the game, Administrator *name*". Ordinary players never get it, and the server refuses admin commands from any other account.

### Making an admin account

On our local server (`npm run dev`):

```bash
node tools/maint/maint.ts "create account admin <name> <password> none"
```

That prints the new account's number. Give it an admin character:

```bash
node tools/maint/maint.ts "create admin <account number>"
```

Log in once with that account to name the character, either in the client or with `npm run headless -- --user <name> --pass <password>`.

The local test admins are `shardadmin` and `shardadmin2` (password = name), described in [AGENTS.md](../AGENTS.md).

On the hosted server, run the same two commands through the container on the VM (see [deploy/README.md](../deploy/README.md)):

```bash
sudo docker compose -f deploy/docker-compose.yml exec blakserv maint "create account admin <name> <password> none"
```

Choose a strong password there: an admin account can do anything to the world.

## Opening and closing it

| To | Do this |
|---|---|
| Open it | Press **Shift+4** (the `$` key) in the game, when you're not typing in the chat line or a dialog, or choose **Admin console…** in the ☰ menu. |
| Hide it | **Esc**, or the **×** in its corner. Its text and command history are kept; Shift+4 brings it back. |
| Clear and close it | Type `quit` as a command. |

The window doesn't block the game: you can keep moving, chatting and fighting with it open.

## The window

| Part | What it does |
|---|---|
| **Command** | Type a command and press **Enter**. **Up** and **Down** step through the commands you've sent, newest first. Commands sent by the buttons and by looking at things land here too, so you can edit and send them again. `dm` and a DM command sends that (see [DM commands](#dm-commands)); `clear` empties the text. |
| **Text** | The server's answers. Each command is echoed first as `> command`, DM commands as `> dm ...` with the game's messages that answered them. It keeps the last 30,000 characters. **Clear** empties it. |

Under the text are four tabs, after the remaster's console (`meridian-unreal`):

| Tab | What it has |
|---|---|
| **Travel** | **Cities**: one click teleports you to Tos, Barloque, Marion, Cor Noth, Raza, Jasper, Ko'catan, Castle Victoria, Brax or the Underworld. Below, every room by number, name and file (`rooms.json` from `npm run assets`); type in **Find** to narrow it (a name, a file or a number), then double-click a room, or pick one and press **Go there** or Enter. A number the list doesn't have still works. **Where am I?** prints the room's name, file and number and your square. **Reset data** makes the server send your client everything again (`send object <you> invalidatedata`), as after a save. **Proving Grounds** takes you to the test room (below). **Edit this room**, in development builds only, opens the room you're in in the room editor, where saving puts it back in the game (meridian-editor's README, "Editing Shards' rooms live"). |
| **Players** | Everyone logged on. Pick one and the **Object** label shows their object number. **Show** (every property of their character), **Go to** (teleport to them), **Bring here** (teleport them to you), **Rescue** (somewhere safe, for a player stuck in a wall or a broken room) and **Tell** (starts a tell on the chat line). |
| **Self** | Immortal or mortal, boost stats, get every spell or skill, clear abilities; hidden, invisible, plain (back to normal), stealth, anonymous; karma and appeals; get an item by name or a class of items (money, weapons, armor, reagents, potions, scrolls); clear inventory (press it twice); disguise as a monster. |
| **World** | The time of day for everyone (until **Real time**), make or call a monster, rumble, place scenery or a light (**Lights?** and **Scenery?** list the names), an event sign, a message to everyone or to this room, and the server's who, status, clock, save game and help. |

The Self and World buttons are DM commands. Their text fields send with their button or Enter.

### DM commands

Admin characters also get the original's DM commands, said with `SAY_DM` (`dm.kod` and `admin.kod` `UserSay`). Type `dm` and the command on the command line, such as `dm item long sword`, `dm monster orc`, `dm night` or `dm place brazier`. `dm help` lists them; `dm help lights`, `dm help scenery` and `dm help messages` list more. Their answers are game messages: they show in the chat's Server tab and, for a few seconds after a DM command, in the console too.

### The Proving Grounds

Ours: a room for trying things, RID 4300 (shards-server's `room/provgrnd.kod`, its geometry `resource/rooms/src/provgrnd.room.json`). Only admins and DMs can enter. Its exits on the west side lead to Tos (row 12) and the God room (row 13).

| Zone | Where | For |
|---|---|---|
| The pen | rows 2-10, cols 2-14 | Five spawn pads (the lighter squares) to fight monsters on |
| The spell range | rows 2-10, cols 18-31 | Three training dummies, 2, 5 and 10 squares east of the casting mark (row 6, col 19). They never move, fight back or die, and each hit tells you its damage ("The training dummy takes 12 damage.") |
| The terrain | rows 14-17 | Grass, earth, rocky ground, cobbles, shallow water, deep water, painted water (a water texture on a dry floor) and grass, west to east: for Ground Detail, critters, fish and puddles |
| The hall | rows 19-23 | Under a roof: indoor light and bats |

Its helpers, for the command line (`send object 0 FindRoomByNum num int 4300` gives the room's number):

```text
send object <room> SpawnMonster what class Orc pad int 1 count int 3
send object <room> ClearMonsters
send object <room> ClearItems
send object <room> ResetDummies
```

- **Spawning:** pads 1-5 are top left, top right, bottom left, bottom right and the middle of the pen. Up to 10 monsters at a time, kept from the room's disposal sweep.
- **Clearing:** ClearMonsters deletes every monster but the dummies.
- **Answers:** each helper returns how many it made or deleted.
- **Other ground (development builds only):** the room counts as fields, so wild critters and ground detail appear. In the browser's console, `shards.gameScene.setTestRoom({ terrain: ["CAVES"] })` tries it as other ground, and `setTestRoom({ crowd: { kind: "town", count: 6, place: "tos", guards: 1, livery: 0 } })` adds a town's crowd. `undefined` puts either back.

### Fast travel

Ours ([ADR 0011](adr/0011-fast-travel.md)): a travel portal in each town, attuned to by touching it, and one in the Cor Noth museum to the historic towns. For a player (their object number from `show user <name>`, which changes at every save):

```text
send object <player> AttunePortal id int 3
set object <player> plAttunedPortals nil 0
show object <player>
set object <player> piTimeAttackedPlayer int 0
set object <player> piTimeAttackedByPlayer int 0
```

- **What each does:**
  - `AttunePortal` attunes them to one point. The ids are 1-10 for the towns, 90 for the Proving Grounds, and, on the museum's network, which needs no attuning, 111-115 for the museum's five portals and 101-106 for the historic towns.
  - `set object ... plAttunedPortals nil 0` forgets them all.
  - `show object` lists `plAttunedPortals`.
  - The two `piTimeAttacked...` lines end their PvP lockout.
- **Where the points are:** shards-server's `util/travelnet.kod GetPoints`.
- **The dashboard:** its World tab has the same for your own character.
- **Moving a portal** (the dashboard's World tab, "This room's portals"):
  - **To move one:** stand on the square you want and press **Move portal here** on that portal's row. A room with several (the museum's five) lists each, with where it leads.
  - **The museum's fine positions:** a moved portal stands in the middle of its square.
  - **The arrival:** stand on the square, face the way players should face, and press **Arrival here**. The facing is rounded to the nearest of the eight compass points.
  - **What it does:** rewrites that point's row in `GetPoints`, builds the Kod and runs `reload system`, which saves the game. A portal move also rebuilds the room, since rooms place their portals when they're built.
  - **What it won't do:**
    - put the portal on the arrival square, or the arrival on the portal's;
    - change a point's id;
    - add a point to a room without one, which needs a new id and a name string, added by hand;
    - build while the table has a line it can't read (a half-done hand edit).
  - **If the build fails,** the file goes back as it was.
  - **Commit it:** the change is a source edit in shards-server.
- **Admins are immortal,** so fighting never locks them out. `set object <you> pbImmortal int 0` to try the lockout, and `int 1` after.

### Quests

Ours ([ADR 0009](adr/0009-quests.md)): quests are data, shards-server's `quests/<key>.json`, generated into `kod/util/questdefs.kod` (`npm run quests`; `server\build.cmd` runs it too) and into our client's `dist/assets/quests.json`. Players talk to a giver by activating them (double-click).

**The dashboard's Quests tab** (`admin.html`, development only) is the quick way to make them:
- **New quest / Edit:** the name, the giver (an NPC class, with where the room Kod places it, or a placed giver), the health band, a time limit, repeating, quests needed first, what the giver says (the offer, while it's going, on completing), the steps and the rewards.
  - **Steps:** kill N of a monster (its kinds count too, unless *This class only*), collect N of an item, talk to someone, deliver a parcel to someone, or visit a room (**This room** adds the one you're in). Each is handed in to the quest's giver unless you pick someone else. A step after the first can have what the giver says as it starts.
  - **More step kinds** (the guide chains'): cast a spell, deposit shillings with a banker, leave something with a vault keeper, buy from someone, use one of some items, reach a base health, choose a hometown, bond with every mana node. These are **done by themselves** (no handing in); any step can be made so with its tick box. A step can have its own reward (experience, shillings, training points).
  - **Only kills in its rooms count** (a kill step's box): for a region's own monsters, set with the step's rooms. **Not offered once any of these is done or going:** for the same errand from several givers.
  - **XP worth:** the quest's XP as points of health at its band minimum (shown as the XP it comes to), so it scales with the quest's level; a main quest must give XP. A hub's main quests should come to about a third of its band's levelling ([monster-bands.md](research/monster-bands.md) has the numbers).
  - **Who can take it:** a faction (or neutral players only), and boxes for players of interest to the court (who can join a faction), guild masters, players carrying a guild shield, and players in no guild. **Special rewards:** joining a faction, an insignia on the player's guild shield, raising the necromancer guild; a reward item can be made for a school (the disciple robes). A reward the player chooses at the last hand-in (`choice`) is edited as the items are.
  - **Tier:** the markers' colour: Main (gold) for the levelling chains, Story (silver), Errand (bronze) for repeatable, common quests. **Replaces from before** names old `QST_ID_` or `HP*_CHAIN` constants: players who finished those have this quest done.
  - **Areas:** each step shows its *Area on the map*: for a kill, the rooms where the monster spawns or is created, worked out from the Kod. **Where** replaces it (a collect step has an area only if you give one); **Leave out of the area** drops rooms from a kill's. Players see the area washed gold on their map, and gold arrows on the exits toward it (Options, Show The Way).
  - **Save** writes the file; **Save and apply** also builds the Kod and runs `reload system` (saving the game). Text only our client shows (the offer, the briefs) needs no build. Commit the files in shards-server.
  - **Retire** deletes the file and adds its id to `quests/retired.json`: ids are never used again. Players who had it lose it at their next logon.
- **Placed givers:** **New giver** takes a name, a look (an NPC whose picture it borrows) and a description, and **Place giver here** stands it on your square, facing your way. **Move here** moves one. They're `quests/givers.json`, placed by `room.kod Constructed` (`QuestBook.PlaceGivers`), so their room is rebuilt when they change.
  - Ours ([ADR 0012](adr/0012-cosmetics.md)): a giver's optional `"service": "barber"` or `"tailor"` (set in the file; moving it keeps it) makes it cut hair or dye clothes. Pellam the barber, in Madelia's shop in Barloque, is one.
- **Try it out (you):** pick a quest, then **Give me it**, **Go to step**, **Count step done** (fills a kill count or a visit; a collect step counts what you carry), **Complete it** (with its rewards), **Forget it** or **Forget all**. You still hand steps in at the NPC.
- **If the generator or the build fails,** every file goes back as it was, and the problems are listed.

**On the maintenance port**, for a player (`<qb>` from `send object 0 GetQuestBook`):

```text
send object <qb> AdminGrant who object <player> id int 1
send object <qb> AdminSetStep who object <player> id int 1 step int 2
send object <qb> AdminFinishStep who object <player> id int 1
send object <qb> AdminComplete who object <player> id int 1
send object <qb> AdminReset who object <player> id int 0
send object <qb> AdminState who object <player>
```

`AdminReset` with id 0 forgets every quest. `AdminState` returns a list (`show list <n>`): the log (`[id, step, count, deadline]` each) and the quests done (`[id, times, when]`).

### Companions

Ours ([ADR 0010](adr/0010-followers.md)). Players ask a faction leader (or Kraanan's priestess) for one from 50 health; the dashboard skips the rules.

**The dashboard's Companions tab** (`admin.html`, development only), for the character in the game tab:
- **Give me one** of a kind (the Duke's soldier, the Princess's knight, a rebel fencer, Kraanan's warrior-priest, Shal'ille's healer, Qor's dark caster, Faren's mage), whatever the rules.
- **Set bond** to a number, or **Tier 1-5** (bond 0, 300, 1000, 2500, 5000): its health, fighting and gear follow.
- **Bring here** (from limbo or its hall), **Kill it** (leaves a corpse for Restore Companion for 10 minutes, then it recovers at its leader's hall), **Revive** (back beside you, full health), **Recover now** (ready to fetch at its hall), **Remove** (its pack comes to you; the bond is lost).

**On the maintenance port**, for a player (`<book>` from `send object 0 GetCompanionBook`; each returns 1 or 0):

```text
send object <book> AdminGrant who object <player> kind int 1    (1-7)
send object <book> AdminSetBond who object <player> points int 1000
send object <book> AdminBringHere who object <player>
send object <book> AdminKill who object <player>
send object <book> AdminRevive who object <player>
send object <book> AdminRecoverNow who object <player>
send object <book> AdminRemove who object <player>
send object <book> AdminState who object <player>
```

`AdminState` returns a list (`show list <n>`): state (0 none, 1 with its owner, 2 waiting, 3 fallen, 4 recovering), kind, bond, tier, health, maximum, room number (0 in limbo) and how many things its pack holds.

### The Debug tab

Admin characters get a **Debug** tab in the chat window, beside Server. It's the client's own log, for tracking things down. For now it lists every sound as it starts:

- **server**: the server asked for it, with the object it comes from (and its number) or the square it plays at. **loops** means it plays until you leave the room; **random sound** is one of the room's random sounds. Preferences can switch both kinds off (Play looping sounds, Play random sounds).
- **server: music**: the room's music track.
- **ambient (ours)**: our ambient sounds (chatter, the arena, thunder and the like), which the Ambient Sounds option and its volume control.
- **client**: sounds the client plays itself (a tell's ding, wading, a squished critter).

It isn't in the All tab, and nobody else sees it.

### Looking at things

While the console is showing, **looking at something sends `show object <its number>`** instead of opening its description. That works with a right click in the view or on an inventory item, and with the Look key. It's the quickest way to find an object's number. Hide the console (Esc) to look at things normally again.

## Commands

A command is a verb, usually a subject, then values. Type `help` for the list of verbs, or a verb on its own (`show`, `send`, `create`...) to list what it takes:

```text
> send
object       IS     P Send object by ID a message
users        R        Send logged in people a system message
...
```

The letters say what follows: **I** a number, **S** a word, **R** the rest of the line, **P** message parameters.

### Sending a message to an object

Most of the power is in `send object`, which calls a Kod message on an object:

```text
send object <object number> <message> [<parameter> <type> <value>]...
```

Each parameter is a name, a type and a value. The types are `int` (a number, which may be negative), `object` (an object number), `class` (a class name), `string`, `resource` and `nil`. In the game, `object SELF` means your own character.

```text
send object 6981 TeleportTo rid int 303
send object 9713 NewHold what object 9765 new_row int 4 new_col int 8
send object 6981 SetHealth amount int 50
```

Message and class names are those in the Kod source (`server/src/kod`); `show class <name>` and `show message <class> <message>` describe them.

### Useful commands

| Command | What it does |
|---|---|
| `who` | Every account logged on. |
| `show user <name>` | A user's account number, object number and class. |
| `show object <number>` | Every property of an object. Its owner (`poOwner`) is the room or the holder it's in. |
| `show instances <class>` | Every object of a class, such as `show instances Chess`. |
| `show status` | The server's version, uptime and load. |
| `show clock` | The server's time. |
| `create object <class>` | Makes a new object and prints its number. It's nowhere until you put it somewhere, such as with `NewHold` (below). |
| `send object <room> NewHold what object <thing> new_row int <row> new_col int <col>` | Puts an object in a room at a square. A room's number is a player's `poOwner`. |
| `send object <player> NewHold what object <thing>` | Puts an object in a player's inventory. |
| `send object <thing> Delete` | Removes an object from the world. |
| `send object <player> TeleportTo rid int <room>` | Moves a logged-on character to a room. |
| `send users <text>` | A system message to everyone logged on. |
| `say <text>` | A message to the other admins only. |
| `save game` | Saves now (and renumbers objects: see below). |
| `reload motd` | Reads the message of the day again. |

Some rooms by number: 1 the Underworld, 50 Tos, 102 Barloque, 200 Marion, 300 Raza, 301 the Inn of Raza, 302 the Adventurer's Hall, 303 the smithy, 306 the Raza crypt, 330 the Outskirts, 332 the vault, 333 the bank, 350 Jasper. The full list is the `RID_` constants in `server/src/kod/include/blakston.khd`.

### Examples

Give yourself a stack of shillings. A number item takes its amount when it's made, and `create` prints its object number:

```text
create object Shillings number int 1000
send object <your number> NewHold what object <the shillings' number>
```

Your own number is in the Users box (pick yourself), or `show user <your name>`. `SELF` won't do here: it only works as a parameter value, not as the object a message is sent to.

Put a chess board on the floor beside you: `show object <your number>` gives your room (`poOwner`) and square (`piRow`, `piCol`):

```text
create object Chess
send object <room> NewHold what object <board> new_row int <row> new_col int <col>
```

Bring a stuck player to safety: pick them under **Users** and press **Rescue**.

## Be careful

- **It's the live world.** Commands run straight away on the server everyone is playing on, as you. Deleting the wrong object, or sending a player `Killed`, can't be undone.
- **Object numbers change when the game saves.** Every save (automatic, or `save game`) compacts object numbers, and every client is told to ask for its data again. A number you found before a save may now be a different object, so `show object` it again first.
- **Test on our own server first.** Try anything unfamiliar on the local server (`npm run dev`) before using it on the hosted one.
- **Never point it at the live Server 104.** Our accounts exist only on our servers, as the project's rules require.
- The maintenance port's own help (`help`) is refused there, but works in the console.

## Not included

The original's console also had an **Object** box that listed a shown object's properties to edit in place, with Move and Send dialogs. Ours leaves those out; `set object <number> <property> <type> <value>` and `send object` do the same by typing. The original's Refresh button for the users list isn't needed, because ours follows logons as they happen. See [missing-features.md](missing-features.md).

Admin characters also get the original's DM module ("dm.dll": the BGF and quest editors and the G-Channel), which Meridian Shards doesn't have. Staff use the console and the maintenance port instead.
