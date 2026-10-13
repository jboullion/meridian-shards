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
| `help`'s web pages | `A_HELP` (`StartHelp`) | The original opens its web help pages. Ours opens our own Help window instead (F1, `ui/HelpDialog.tsx`: controls, the HUD, the menus); there are no pages on the game's lore or classes. |

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
| The stats area's and the user area's treatments | `drawint.c` (IDB_S*, the personal enchantment treatment) | The window's stone edge, the view's border and corners, the map, the inventory and the graph bars have theirs; the stats list's thin frame and the frame round the face and bars don't yet. |
| The lag box's picture | `lagbox.c` (resource 19995, translated per latency band) | Our server's resources don't define 19995, so the meter is a coloured square in the original's place after the toolbar. |
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
| Minecraft's click to carry | Items move by drag and drop and double clicks, not by picking a stack up on the cursor and splitting it. |
| A separate spell bar | The remaster has items on the hotbar and spells on their own bar; ours mixes both in ten slots. |
| Searching the spell list | The remaster's spell and skill pages filter as you type. |
| The phone | The touch layout is unchanged, and stays in first person. |
| Our own actions in the outside views | Our sprite walks while we move. Whether the attack, cast and emote poses the server sends with `BP_CHANGE` show on it isn't checked yet (the UE remaster plays them, ADR 0012 M4). |
| The target's health and enchantment timers | The server sends neither. |
| The attack timer on the quick slots | The server's one timer covers attacks too (a weapon's swing keeps spells back for a moment), but only spells start our cooldown. |

## Ambient life (ours)

Townsfolk, inn patrons, the castles' people and the arena's fighters (`packages/world/src/ambient/`, `packages/world/src/arena/`, roadmap milestone 15) have no counterpart in the original. What they don't do yet:

| What | What it needs |
|---|---|
| Critters in rooms without a terrain | 19 rooms' Kod classes give no `viTerrain_type` and aren't in a town (castles, the Duke's, some guild halls): no critters there. |
| More places | Only the rooms in `ambientRooms.ts` have anyone: the main towns and their inns. Smaller villages, shops, halls and the guild halls have none. |
| Hats and things to carry in town | Townsfolk wear shirts, jerkins, royal shirts, leather, robes, trousers and skirts. Armour, helms, shields and weapons go only to guards, knights and fighters; nobody carries baskets or tools. |
| Someone sweeping outside the inn | The game has no broom to hold (`isweep.bgf` is a spell's icon), so no sweeper. |
| Footsteps and voices | Townsfolk walk silently and their speech bubbles have no voice; the chatter under them is a recording. A fireball landing is heard only in its victim's cry. |
| More of the arena's spells | [ADR 0007](adr/0007-arena.md): bolts, fire walls, poison fog, webs, brambles, blind and dazzle. Hold (`debuff/hold.kod`), heals and shields, and the other schools' spells aren't cast there yet; a new one needs its effect in `arenaSim.ts`, not just a row in `arenaData.ts`. |
| Players in the arena's fights | The sim never sees real players: they can't join a bout, bet, or get hit by a stray bolt. |
| The arena's champions in the game | A season's champion shows only in the inspect window; there's no notice, statue or board. |
| Real reflections in puddles | The puddles take a sheen of the sky's colour, brighter at a glancing look; they don't mirror the scene. |
| Walking round each other | They wait for us, but walk through one another. |
| Talking back | Their lines are canned and over their heads only; they don't answer what's said in the chat. |
| Rooms that change shape | The grid is built from the room file; a lift the server moves isn't seen. No town room has one. |

## Friends (ours)

Friends, the relay, following and health bars ([ADR 0005](adr/0005-friends.md)) have no counterpart in the original. What they don't do yet:

| What | What it needs |
|---|---|
| Friends on a second device | Keys live in one browser's IndexedDB; a new device or cleared data means pairing again. Syncing keys is out of scope. |
| End-to-end encryption | The relay is ours and sees friends' locations; ECDH on the same keys is a possible later step. |
| Walking to a friend in another room | Following starts only in the same room (ADR 0005 4.7). |
| Pet colours | [ADR 0006](adr/0006-pets.md) 6.4: every pet kind is in its own colours; recoloured ones come once each is looked at in the game. |
| Original-client players | Only players of this client are on the relay; the one tell they might see is readable. |

## Deliberately different or left out

| What | Why |
|---|---|
| Critters and nature shared between friends | Won't do (decided 2026-10-12): only the townsfolk and the arena's fights are shared ([ADR 0005](adr/0005-friends.md) 6). Critters, butterflies, fireflies, leaves and fish keep each client's own random seed, and a squished critter is seen by its squisher alone. |
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
| The intro's logo and splash | The original fades in `logo.bmp` (Near Death Studios' logo), then shows `splash.bgf`, which in the Server 104 files names that server. We skip the logo and show `xsplash.bgf`, the original Meridian 59 splash, with its music, filling the screen behind the login dialog, which is open from the start: no "Click here to log on!" button (2026-10-12). |
| One desktop app at a time | The original ran as many clients as you liked. Ours share one profile (storage, the asset cache), so a second start brings the first forward (`requestSingleInstanceLock`). |
| `/H` and `/P` | The original connects to that host and port; our desktop app takes the listed server with that host (and port), else `https://host:port` (http for localhost), or a whole origin, for this run only. |
| Mouselook | The original captures the mouse on a click or with A_MOUSELOOK until Esc. Ours captures it only while the right button is held and dragged to turn the view, in both interfaces; a right click without dragging still examines. |
| Chat tabs in the Classic interface | The original has one text window; ours has All, Chat, Combat and Server tabs, drawn as small stone buttons above its box. |
| The hands' shape | The original stretches the hands with the window; ours keep the shape they have at 4:3 (`screenOverlays.ts`). |
| The character screen's ad panels (`BP_AD_SELECTED`), Print Map, font and colour choices, the Graphics Options window (Enable MipMaps, Anti Aliasing) | Low value. Settings save themselves, so there's no Save Now. |
| More than 32 light sources | The original lights a room with up to 150 (`MAX_NUM_DLIGHTS`); our shader takes the 32 nearest the viewer (`ObjectsView.lights`). |
