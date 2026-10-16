# The admin console

The admin console lets an administrator run server commands from inside the game: inspect any object, move characters, create items, message everyone, save the game and so on. It's our port of the original client's admin module (`module/admin`). The commands are the same ones the maintenance port takes (`tools/maint/maint.ts`), so anything you can do there you can do here, as your character, without leaving the game.

**Everything you type changes the live world at once.** There's no undo and no "are you sure". Read [Be careful](#be-careful) before using it on a server with real players.

On the local development server there's also the **admin dashboard**, at http://localhost:5173/admin.html in a tab of its own. Its tabs:
- **Spawn:** monsters by name with their pictures, on the Proving Grounds' pads or beside you.
- **Items:** items into your inventory.
- **Spells:** cast at what's in your room.
- **Rooms:** go to any room, rebuild it, or edit it.
- **World:** the server's time, and your client's weather, terrain and crowd.
- **Tuning:** ambient life's numbers, live.
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
