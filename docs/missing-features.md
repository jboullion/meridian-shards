# Missing features: the parity checklist

What the original client (`clientd3d` and its modules `merintr`, `mailnews`, `stats`, `chess`, `char`, `intro`, `admin`) has that Meridian Shards doesn't yet. The plan for closing these gaps is milestone 13 in the [roadmap](roadmap.md), in phases 1–5, which are named in the tables below.

Remove an entry when it lands, and add one whenever we skip something. Options for many of these are in the Preferences and Configuration windows already (shown in *italics* there), and saved with the other settings, so they'll work as soon as the feature does.

Our own additions (the modern key preset, chat tabs, damage numbers, pixel-accurate picking, the latency meter in the title bar) stay; parity means the original's features are available beside them.

## World (phase 1)

| What | Original | What it needs |
|---|---|---|
| Rooms that change while you're in them | `roomanim.c`, `server.c:1586-1620` | `BP_SECTOR_MOVE` (floors and ceilings that lift: the Raza crypt's door and columns, guild halls' secret doors, temples, arenas), `BP_WALL_ANIMATE` (the Raza clock; walls that become passable), `BP_CHANGE_TEXTURE` (snow on the ground, rented rooms' carpets), `BP_SECTOR_CHANGE` (water freezing). Rooms are built once, and collision reads fixed heights. `BP_SECTOR_LIGHT` only needs parsing: the D3D client ignores flicker (`roomanim.c:622-638`). |
| Sloped-texture rotation | `d3drender.c` | The slope's texture angle (`roomGeometry.ts` `TODO(slopes)`). Sloped planes use the flat mapping. |
| Blur, waver and `EFFECT_XLATOVERRIDE` | `effect.c:62,148,158`, `d3drender.c:7699` | Post-effects. `WorldState` keeps the state already; nothing draws it. Waver comes from duskrat poison and vertigo, blur from drink. |
| Weather and fireworks | `d3dparticle.c`, `d3drender.c:1182-1210` | Rain, snow, sand and fireworks, with *Show weather effects* and *Particle density %* (`BP_EFFECT` flags already kept). |
| Flashing and bouncing objects | `d3dlighting.c:1199`, `moveobj.c:233-249` | `OF_FLASHING` (how detect-invisible shows invisible things) and `OF_BOUNCING` (fairies, wasps, seekers). |
| Projectiles following the ground | `project.c:141` | `PROJ_FLAG_FOLLOWGROUND`. |
| Remote view | `game.c:193`, `server.c:2077-2102` | `BP_SET_VIEW` / `BP_RESET_VIEW`, used only by the DM's Globe of Seeing. |
| Resync in the game | `com.c:380-400`, `statgame.c:139` | On `BP_RESYNC` (a framing or security error), the beacon handshake instead of closing. |
| Fighting in the crypt | | The mummies haven't been fought yet. |

## Commands and interaction (phase 2)

| What | Original | What it needs |
|---|---|---|
| The command table | `merintr.c:306-429`, `command.c`, `clientd3d/parse.c` | Unique-prefix matching (`b hi` broadcasts), "bad command" for unknown words, and the German aliases. Today unknown words are said aloud. |
| Missing commands | `command.c` | `use`, `drop`, `cast <spell>`, `time` (`UC_REQ_TIME`), `appeal` (`UC_APPEAL`), `tellguild` (`SAY_GUILD`), `suicide` (`IDD_SUICIDE`, `UC_SUICIDE`), `password` (`BP_CHANGE_PASSWORD`), `newgroup`, `delgroup`, `addgroup`, `tell <group>`, and the `safety`, `tempsafe`, `grouping`, `autoloot`, `autocombine`, `reagentbag`, `spellpower on/off` toggles. `help` opens the original's web help. |
| Command aliases | `alias.c:406-528` | `alias word = command` typed inline, prefix matching, and `~~` for the arguments. Real commands come first. |
| Emotes and moods | `actions.c:24-39`, `command.c:370-523` | `BP_ACTION` with one byte: Wave, Point, Dance, Happy, Sad, Neutral, Wry, typed and on the Actions menu. Typed, they say they're not in yet. |
| Resting and low vigor | `mermain.c:223-304` | Resting blocks moving, attacking and casting; below 10 vigor, running becomes walking. `UC_REST`/`UC_STAND` are sent, but there's no resting state. |
| The Spells menu | `spells.c:136` | `UC_SPELL_SCHOOLS` (sent at login): a menu per school that casts. |
| `UC_SEND_QUIT` | `merintr.c:1580` | The server's request to log off (after a suicide or a rescue). |
| Inventory | `inventry.c` | Reordering by drag (`BP_REQ_INVENTORY_MOVE`), dropping onto a container puts the item in it, double click on an appliable item starts "use on…", and the keys (arrows, Space/R/U use, L look, P put). |
| Chat line | `textin.c:229-249`, `say.c:98` | A 20-line history, and the outgoing filter (control characters, space and colour-code limits). |
| Ignored tells | `msgfiltr.c:230-242` | `BP_SAY_BLOCKED` to the server, and the `imp.ogg` ding on incoming tells. |
| Pick lists | `lookdlg.c:282` | The Find box. |
| Enchantments | `enchant.c:410` | Right click looks at one. |
| Tab Forward / Tab Backward | `A_TABFWD`/`A_TABBACK` | Keyboard focus moving between the view, the inventory and the chat line. The keys can be bound but do nothing yet. |

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
| `BP_ROUNDTRIP1`, `BP_SECTOR_ANIMATE` | blakserv and the Kod never send them. |
| The DM module | Staff tools (BGF editor, quest editor, G-Channel); staff use the maintenance port. |
| The character screen's ad panels (`BP_AD_SELECTED`), Print Map, font and colour choices, mipmaps and anti-aliasing | Low value. Settings save themselves, so there's no Save Now. |
