# The admin console

The admin console lets an administrator run server commands from inside the game: inspect any object, move characters, create items, message everyone, save the game and so on. It's our port of the original client's admin module (`module/admin`). The commands are the same ones the maintenance port takes (`tools/maint/maint.ts`), so anything you can do there you can do here, as your character, without leaving the game.

**Everything you type changes the live world at once.** There's no undo and no "are you sure". Read [Be careful](#be-careful) before using it on a server with real players.

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

The local test admin is `shardadmin` (password `shardadmin`), described in [AGENTS.md](../AGENTS.md).

On the hosted server, run the same two commands through the container on the VM (see [deploy/README.md](../deploy/README.md)):

```bash
sudo docker compose -f deploy/docker-compose.yml exec blakserv maint "create account admin <name> <password> none"
```

Choose a strong password there: an admin account can do anything to the world.

## Opening and closing it

| To | Do this |
|---|---|
| Open it | Press **Shift+4** (the `$` key) in the game, when you're not typing in the chat line or a dialog. |
| Hide it | **Esc**, or the **×** in its corner. Its text and command history are kept; Shift+4 brings it back. |
| Clear and close it | Type `quit` as a command. |

The window doesn't block the game: you can keep moving, chatting and fighting with it open.

## The window

| Part | What it does |
|---|---|
| **Command** | Type a command and press **Enter**. **Up** and **Down** step through the commands you've sent, newest first. Commands sent by the buttons and by looking at things land here too, so you can edit and send them again. |
| **Text** | The server's answers. Each command is echoed first as `> command`. It keeps the last 30,000 characters. |
| **Go to room** | Asks for a room number, then teleports you there (`send object <you> teleportto rid int <number>`). |
| **Reset data** | Makes the server send your client everything again (`send object <you> invalidatedata`), as after a save. |
| **Users** | Everyone logged on. Pick one and the **Object** label shows their object number. |
| **Show** | `show object` for the chosen user: every property of their character. |
| **Go to** | Teleports you to the chosen user (`admingotoobject`). |
| **Rescue** | Sends the chosen user somewhere safe (`admingotosafety`), for players stuck in a wall or a broken room. |

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
