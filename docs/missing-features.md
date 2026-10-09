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

Phase 3 is done: the news globes, mail, stat reallocation and guilds. What's left:

| What | Original | What it needs |
|---|---|---|
| The mailbox in a file | `mailfile.c` (a file per message in the mail folder) | We keep it in the page's storage (`localStorage`, per server and character), which the browser can clear. The desktop and Android apps could keep it in a file instead, through `host.ts`. |
| Mail and news dates as the original shows them | `mailnews.c DateFromSeconds` | Nothing: we add Kod's time base (Unix time less 1760000000, `blakserv ccode.c`). The original client still adds an older base, so it shows dates about five years early against this server. Noted here so nobody "fixes" ours to match. |
| A guild hall's password, checked live | `guildmtr.c` | Written and sent on closing the window, but not tried: renting a hall needs a guild that has existed for a while, so our test guild couldn't. |

## Interface (phase 4)

Phase 4 is done: the toolbar, tooltips, map annotations, the profanity filter, the logout timer, the About box and the splash, the cursors, the stone borders, the resource language, quick start and the desktop command line. What's left:

| What | Original | What it needs |
|---|---|---|
| The window's edge treatment, the stats area's and the user area's | `drawint.c` (IDB_E*, IDB_S*, the personal enchantment treatment) | The view's corners, the map, the inventory and the graph bars have theirs; the stone edge round the whole window, the stats list's thin frame and the frame round the face and bars don't yet. |
| The drop cursor | `inventry.c`, `merintr.c EventSetCursor` (IDC_DROPCURSOR) | Dragging from the inventory uses the browser's drag and drop, whose cursor a page can't set. |
| Map annotations on the desktop or phone | `mapfile.c` | Kept in the page's storage per server and room checksum, like the mailbox; the desktop app could keep them in a file. |

## Mini-games and admin (phase 5)

Phase 5 is done: chess and the basic admin console. What's left:

| What | Original | What it needs |
|---|---|---|
| The admin console's object box | `admindlg.c` (IDC_OBJECTLIST, `adminprs.c`), IDD_ADMINMOVE, IDD_ADMINVALUE | A shown object's properties in a list, each editable (`set object`), its owner, Move... and Send...; left out of the basic console. Typed commands do the same. |
| The admin console's Refresh | `admindlg.c` IDC_REFRESH | Our user list follows who's on as it changes, so there's no button. |

## The Modern interface (ours)

The Modern layout (`ui/ModernHud.tsx`, `ui/CharacterWindow.tsx`) has no counterpart in the original; Classic is the original's. What it doesn't have yet:

| What | What it needs |
|---|---|
| A HUD scale | The clusters have fixed sizes; a slider (CSS `zoom`) would suit large or small screens. |
| Hiding the interface | A key to hide the HUD for screenshots. |
| Minecraft's click to carry | Items move by drag and drop and double clicks, not by picking a stack up on the cursor and splitting it. |
| A separate spell bar | The remaster has items on the hotbar and spells on their own bar; ours mixes both in ten slots. |
| Searching the spell list | The remaster's spell and skill pages filter as you type. |
| The phone | The touch layout is unchanged. |
| The target's health and enchantment timers | The server sends neither. |

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
| The intro's logo and splash | The original fades in `logo.bmp` (Near Death Studios' logo), then shows `splash.bgf`, which in the Server 104 files names that server. We skip the logo and show `xsplash.bgf`, the original Meridian 59 splash, with the same button and music. |
| One desktop app at a time | The original ran as many clients as you liked. Ours share one profile (storage, the asset cache), so a second start brings the first forward (`requestSingleInstanceLock`). |
| `/H` and `/P` | The original connects to that host and port; our desktop app takes the listed server with that host (and port), else `https://host:port` (http for localhost), or a whole origin, for this run only. |
| The toolbar and the view's border | The original has a button bar over the view (Help, Drop, Get, Rest/Stand, mail) and stone corners around it. We keep only Rest/Stand and the mail button, left of the portrait (Show toolbar still hides them), and the view fills its cell without the border. |
| The hands' shape | The original stretches the hands with the window; ours keep the shape they have at 4:3 (`screenOverlays.ts`). |
| The character screen's ad panels (`BP_AD_SELECTED`), Print Map, font and colour choices, mipmaps and anti-aliasing | Low value. Settings save themselves, so there's no Save Now. |
