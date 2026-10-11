# Plan: Meridian Shards on the Shards server (the original protocol)

Branch: `shards-server`. Decision: [ADR 0005](../adr/0005-shards-server.md).

**Reference for every wire difference:** the server repo's [protocol-dialect.md](https://github.com/jboullion/meridian-shards-server/blob/master/docs/protocol-dialect.md), from here on "the dialect doc". Its `server104` column is what this client does today; its `original` column is the target.

**Paths:**
- `u:` is the upstream code in `J:\meridian-shard-server`. That is the code to port from now, and it replaces the Server 104 tree as the source of `file:line` citations.
- Paths without a prefix are in this repo.

Each step leaves the client building and testable. Finish each with `npm run check`.

## Status (2026-10-11)

Steps 0, 1 and 2 are done, and most of Step 3: `npm run check` passes (181 tests, 9 skipped), and the headless client plays on the local Shards server through the gateway:
- It logs in and gets `AP_SHARDS_INFO` (protocol 1).
- It creates a character, enters the Raza Inn (`guest1.roo`), and decodes the room's objects.
- The room checksum the server sends matches our parse.
- A 45 s walking soak sent 170 game messages, with 8 pings and 8 echoes, no resync and no hang-up.

Left:
- **Step 3:**
  - check the browser UI by hand with the user (see Verification)
  - schools and stat-group values (Telepathy, no Crafting, 4 groups) wherever the UI names them
  - point the skipped room tests at upstream rooms
- **Step 4:** deploy (`tools/deploy`, `deploy/`) and the 104 `server/` tooling, which the deploy still uses; then the coordinated cutover.

Notes from doing it:
- **Room ids differ.** Upstream's Raza Inn is the newbie area `guest1.roo` (`RID_NEWB1`), not 104's Raza town (RIDs 300–308). Anything keyed to 104 room ids or file names needs a look.
- **Room bounds.** 261 of the 265 upstream rooms have the two-corner things section 104 used for room bounds, but upstream's client never reads it, so `IsInRoom` now uses the room's grid (`move.h`).
- **Room checksums.** Upstream adds the raw bytes of node planes, leaf points and wall ends; 104 didn't.
- **Preferences.** Upstream keeps "Can attack innocent players" in the client (`config.aggressive`) and has no Game Options group.

## Step 0: The dev stack points at the Shards server

**Server side (in the server repo):** let localhost maintenance sessions run `create account` and `create admin`, so tools can make test accounts. Today only the Windows admin window can (`u:blakserv/adminfn.c:509`).

**Here:** a `SHARDS_SERVER_DIR` setting, defaulting to `J:\meridian-shard-server`.
- **Remove the 104 server folder:** `server/build.cmd`, `server/setup-run.cmd`, `server/setup-client.cmd` and `server/src` (the git-ignored 104 copy). Builds use the server repo's `tools\build.cmd` and `tools\setup-run.cmd`.
- **`tools/dev/dev.ts`:** starts `run\server\blakserv.exe` with `run\shards` as its working directory when port 9999 isn't listening.
- **`tools/gateway`:** target `127.0.0.1:5960`.
- **`tools/maint`:** default port 9999.
- **`tools/assets/build-assets.ts`:**
  - `rsc0000.rsb` from the server repo's `run\localclient\resource` (made by its `tools\setup-client.ps1`)
  - rooms from `resource\rooms`
  - art from the Steam install (`MERIDIAN_ART_DIR`, default `H:\Steam\steamapps\common\Meridian 59\resource`)
  - Kod-derived JSON (`roomlinks`, `itemslots`, `spelltimes`) from the server repo's `kod\`
- **Test accounts:** `tools/dev` creates `shardbot`, `shardpal` and `shardadmin` (password = name) over the maintenance port if missing, instead of relying on first-login creation.

## Step 1: File formats (`packages/formats`)

- **`rsb.ts`:** RSC **version 4**: magic, version, count, then (id, NUL-terminated string). There is no language field (`u:util/rscload.c:39-80`). Keep the bundle API, so `get(id)` works unchanged, and drop the language list.
- **`roo.ts`:** ROO **versions 12 and 13** (`u:clientd3d/bspload.c`).
  - Values are `readValue`: ints before v13, floats from v13 (`bspload.c:48-53`). Wall length is a u16 before v13 and an f32 after (`:463-475`).
  - Diff the rest of `u:clientd3d/bspload.c` against `server-104`'s port function by function: sidedefs, sectors (slopes), things, and the v14/15 additions to remove.
  - Every upstream room must parse and pass its checksum: 265 in `u:resource/rooms`, and the 266 in the Steam install.
- Tests: add a v12 and a v13 fixture read from the real files (skipped when the assets aren't built), as the format tests do now.

## Step 2: Protocol (`packages/protocol`)

**Ids** (`constants.ts`):
- `BP_REQ_GET_FROM_CONTAINER = 239`.
- Remove 104-only ids: `BP_SECTOR_CHANGE`, `BP_RADIUS_SHOOT`, `BP_STOP_WAVE`, `BP_DELETE_NEWS`, `BP_AD_SELECTED`, the stat-change ids, `AP_CLIENT_PATCH(_OLD)`.
- User commands: `UC_SAFETY = 7`; remove `UC_REQ_PREFERENCES`, `UC_SEND_PREFERENCES`, `UC_RECEIVE_PREFERENCES` and `UC_REQ_TIME`.
- Add `AP_SHARDS_INFO = 60`.

**Object flags:** an `OF` table with upstream's bits (`u:include/proto.h:357-411`):
- moveon mask `0x3`
- `OF_SAFETY 0x2000`
- player-type mask `0x1C000` (`PF_*`)
- `OF_HANGING 0x10000` for non-players
- bouncing = `0x60000`
- draw effect = `(flags >> 20) & 0x1F`
- `OF_ENEMY`, `OF_FRIEND`, `OF_GUILDMATE`

**`readObject`:** upstream layout: id, [amount], icon, name, flags, **rarity (4)**, [light], translation, animation, overlays (`u:clientd3d/server.c:319`). Then a `normalizeFlags` that fills the existing model:
- `moveOnType = flags & 3`
- `drawingType = (flags & 0x01F00000) >> 20`
- `objectType` from the `PF_*` bits: killer 1, outlaw 2, DM 3, creator 4, super 5, event 7
- `nameColor` as `u:clientd3d/color.c:619` `GetPlayerNameColor`:
  - DM cyan, killer red, outlaw `252,128,0`, creator yellow, super green, event magenta, otherwise white
  - black when the draw effect is `BLACK`
- `minimapFlags` as `u:clientd3d/map.c:399` `MapDrawObjects`:
  - player dot for `OF_PLAYER`
  - enemy, friend or guildmate dots from those bits
  - monster dot for attackable non-players
- `flags` rewritten to the bit meanings the renderer reads (`OF.HANGING` and so on), so `objectsView.ts` doesn't change; or update the few readers instead, whichever is smaller.
- Keep `rarity` on the model.

**Login:**
- `buildLogin` has no secret key.
- Read `AP_SHARDS_INFO` (version, server name) in the connection's login handling, and keep the version on the session.

**Smaller layouts:**
- `BP_PLAYERS` / `BP_PLAYER_ADD` entries: id, name rsc, name, flags. Normalize them like objects.
- `readCharInfo`: skills have no school byte; spells keep theirs.
- `UC_LOOK_PLAYER`: the fixed text is a plain string, followed by the URL.
- `BP_REQ_DROP`: an object list (`writeObjectList`).
- `BP_REQ_INVENTORY_MOVE`: two u16 *positions* counted from the end of the inventory (`u:module/merintr/inventry.c:1231-1234`).
- `BP_PLAY_WAVE`: unchanged.

**Tests:** update `test/interface.test.ts` and add decode tests built from upstream layouts.

## Step 3: World, session and UI

- **Safety:**
  - Send `UC_SAFETY` (1 = on) from the setting on entering the game and when it changes, as `u:module/merintr/mermain.c:38` `SendConfiguredSafety` does.
  - Show safety from our own object's `OF_SAFETY`.
  - Remove the other preferences (temp-safe, grouping, auto-loot, auto-combine, bags, spell power) from `settings.ts` and `OptionsDialogs.tsx`, and list them in `docs/missing-features.md`.
- **Removed from the session and world:**
  - stat reallocation (`statChange`, the elder dialog)
  - radius shots and sector change in `state.ts` and `roomAnim.ts`
  - stop-wave
  - delete-news
  - the Language menu and per-language lookups (`languages.ts`, `setLanguage`)
- **Schools:**
  - no Crafting spell school
  - skill schools gain Telepathy (12), with Thievery at 13
  - check every place that names schools or stat groups (4 groups: no Quests tab)
- **Stat groups:** 4 (condition, stats, spells, skills).
- **Errors:** `AP_GETCLIENT` and the version text come from the upstream server.

## Step 4: Tools, docs, release

- **`tools/headless`:** no secret key; port 5960 via the gateway. `npm run smoke` and `npm run soak` against the Shards server.
- **Docs:**
  - `AGENTS.md`: the server, test accounts, commands and "Known traps", reviewed for 104 facts.
  - `README.md`, `docs/roadmap.md`, `docs/missing-features.md`.
  - `docs/research/protocol.md`: replace the 104 facts with a pointer to the dialect doc plus anything client-specific.
- **Deploy (`deploy/`, `tools/deploy`):** blakserv from the server repo's `deploy/Dockerfile`, port 5960. Prepare it, but switching the hosted VM is a separate, coordinated step with the first `shards-server` desktop release. Desktop players auto-update.

## Verification

- `npm run check` passes after each step.
- **Formats:** every upstream room parses and passes its checksum, and `rsc0000.rsb` (v4) loads.
- **Headless:** against the local Shards server, `shardbot` logs in, gets `AP_SHARDS_INFO` (protocol 1), creates a character, enters the Inn of Raza, walks, changes rooms and chats. `npm run soak` runs 5 minutes with no resync or hang-up.
- **Browser (manual, with the user):** log in, create a character, then check each of these:
  - names and colours, the minimap, invisibility and other draw effects
  - looking at players and objects
  - inventory moves, drop and pick up
  - buy and sell, cast, fight
  - mail, guilds, chess
  - safety on/off
- **Side by side:** the upstream Windows client sees the browser player correctly, and vice versa.
