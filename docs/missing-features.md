# Missing features: the parity checklist

What the original client (`clientd3d` and its modules `merintr`, `mailnews`, `stats`, `chess`, `char`, `intro`, `admin`) has that Meridian Shards doesn't yet. The plan for closing these gaps is milestone 13 in the [roadmap](roadmap.md), in phases 1–5, which are named in the tables below.

Remove an entry when it lands, and add one whenever we skip something. Options for many of these are in the Preferences and Configuration windows already (shown in *italics* there), and saved with the other settings, so they'll work as soon as the feature does.

Our own additions (the modern key preset, chat tabs, damage numbers, pixel-accurate picking, the latency meter in the title bar) stay; parity means the original's features are available beside them.

## World (phase 1)

Phase 1 is done: rooms that change, sloped textures, blur and waver, the xlat override, weather and fireworks, flashing and bouncing objects, projectiles' heights, the remote view and resync. What's left:

| What | Original | What it needs |
|---|---|---|
| A side-by-side check against the original client | | Screenshots from the same spots in both (our build of the original is in `server/src/run/localclient`). |

## Commands and interaction (phase 2)

Phase 2 is done: the original's command table, emotes and moods, resting, the Spells menu, inventory reordering and keys, chat history and filtering, ignored tells, the Find box, Tab focus, password changes and suicide. What's left:

| What | Original | What it needs |
|---|---|---|
| `help` | `A_HELP` (`StartHelp`) | The original opens its web help pages; we say they aren't in yet. |

## Social systems (phase 3)

| What | Original | What it needs |
|---|---|---|
| News globes | `mailnews.c:278-305`, `newsread.c`, `newssend.c` | `BP_LOOK_NEWSGROUP`, the article list and reading (`BP_REQ_ARTICLES`/`ARTICLES`, `REQ_ARTICLE`/`ARTICLE`), posting and deleting. The Inn and the Hall of Raza each have one; looking at it does nothing today. |
| Mail | `mailread.c`, `mailsend.c`, `mailfile.c` | `BP_MAIL`, `REQ_GET_MAIL`, `DELETE_MAIL`, `SEND_MAIL`, name lookups, and the read and send windows. The original keeps the mailbox on the client after the server deletes it, so we need a local store per character. Every new character gets mail. |
| Stat reallocation | `module/stats` | `BP_STAT_CHANGE` from an elder (Raza's Rodric) and `BP_CHANGED_STATS` back: the stats page with the school levels, which can only go down. |
| Guilds | `guild*.c` | `UC_GUILDINFO` and the rest: the guild window (members and ranks, allies and enemies, invite, guildmaster, the shield), creating a guild, renting a hall. The Actions window has a placeholder. |

## Interface (phase 4)

| What | Original | What it needs |
|---|---|---|
| *Show toolbar* | `toolbar.c` | The button bar (with the buttons the modules add). Its actions are spread over our menu and keys. |
| *Show tooltips* | `tooltip.c` | Tooltips on the interface column's buttons, stat bars and enchantments. |
| *Map annotations* | `annotate.c`, `map.c:567,813` | Notes on the map, kept per room. |
| *Filter text profanity*, *Profanity Options and Policy...* | `profane.c`, `IDD_PROFANITY` | The word list and the dialog. |
| Logout timer | `logoff.c`, `IDD_TIMEOUT` | Logging off after a time idle. |
| About box and intro | `about.c`, `module/intro` | The credits, and the splash before login (`splash.bgf`, `main.ogg`). |
| Cursors | `cursor.c` | The original's cursor bitmaps. The wait cursor while the server saves is done (CSS `wait`). |
| Interface borders | `drawint.c` | The stone treatments around the view and the column (the dialogs have them). |
| Resource language | `language.c`, `loadrsc.c:368` | Choosing the strings' language (German is in the `.rsb`). |
| Quick start | `charpick.c:77-82` | Entering straight away with exactly one character. |
| Desktop command line | `config.c:389-440` | `/H /P /U /W`-style switches, and a single instance. |

## Mini-games and admin (phase 5)

| What | Original | What it needs |
|---|---|---|
| Chess | `module/chess` | `UC_MINIGAME_*`, the board and promotion dialogs, opened and closed by `BP_LOAD_MODULE`/`BP_UNLOAD_MODULE` (now passed on as the session's `module` event). |
| Admin console | `module/admin` | For admin characters: a text console sending `BP_REQ_ADMIN` and showing `BP_ADMIN`. |

## Deliberately different or left out

| What | Why |
|---|---|
| Objects under the cursor | The original takes everything whose on-screen rectangle holds the cursor; we take the objects with an opaque pixel there, so a list comes up only when sprites really overlap. Rectangles would ask too often. |
| Ignore list by name resource | The original keys ignores by name resource; we use the name, which survives across sessions. |
| The client patcher (`download.c`, `AP_DOWNLOAD`) | Our game files come from the asset manifest, and the desktop app updates itself. `AP_DOWNLOAD` now ends the login with the server's reason. |
| Guest login (`AP_GUEST`) | blakserv never sends it. |
| Typed lines | The original treats every line as a command ("What?" for anything else; speech needs "say"). That's the Original Command Typing option (on with the original key preset). By default a line is said unless its first word is a command's whole name, and commands that take no words only count typed alone; a "/" in front parses like the original. |
| `alias word = command` | The original keeps the "=" as part of the command (so the alias fails); we drop it. |
| Group members on line | The original shows them in red; the chat line marks them with *. |
| `BP_ROUNDTRIP1` | blakserv never sends it. `BP_SECTOR_ANIMATE` isn't sent either, but it's handled. |
| Blur and waver over the hands | The D3D client blurs the whole frame, hands and screen flashes included; ours blurs the 3D view, since the hands are drawn on a 2D canvas over it. |
| Sector flicker (`BP_SECTOR_LIGHT`, `SF_FLICKER`) | The D3D client keeps the sector's own light while flickering, so it's parsed and has no effect, as there. |
| The DM module | Staff tools (BGF editor, quest editor, G-Channel); staff use the maintenance port. |
| The character screen's ad panels (`BP_AD_SELECTED`), Print Map, font and colour choices, mipmaps and anti-aliasing | Low value. Settings save themselves, so there's no Save Now. |
