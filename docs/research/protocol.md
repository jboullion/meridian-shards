# The Meridian 59 client/server protocol (as Server 104 speaks it)

What a browser client must do to talk to an unmodified Server 104 `blakserv`. Every `file:line` points into the reference tree `E:\2026_Experiments\meridian-unreal\Server-104` (our build copy in `server/src` is identical). They were checked on 2026-10-06. Everything marked **verified** was confirmed against our running server with the headless client (`tools/headless/client.ts`).

Our implementation lives in `packages/protocol/src/`.

## Transport

- Raw TCP, game port 5959 (`blakserv/config.c:69`). The maintenance (admin) port is 9998, localhost only (`config.c:70-71`).
- Browsers can't open TCP, so `tools/gateway/gateway.ts` bridges WebSocket to TCP and passes bytes through unchanged (the roBrowser/wsProxy pattern). **Verified.**
- All integers are little-endian. Strings are a `u16` length plus raw bytes, with no terminator.

## Framing

Every message after the connection opens has a 7-byte header (`clientd3d/com.c:240` `SendServer`, `com.c:410` `ProcessMsgHeader`):

```
u16 length | u16 crc-or-security | u16 length (again) | u8 epoch | body (length bytes)
```

- If the two lengths differ, the frame is corrupt (`com.c:435`). The server then switches to resync mode.
- The server fills the CRC slot with the low 16 bits of a standard CRC-32 of the body (`util/crc.c`). Neither side checks it (the checks are `#if 0`).
- The client sends **0 in the CRC slot in login mode**, and the **security word** in game mode (see below).
- **Epoch:** the server puts its current epoch in byte 7. The client must echo the most recent epoch it saw. A game message with a stale epoch is silently dropped (`blakserv/game.c:203`). Login-mode messages carry epoch 0.

## Connecting and logging in

**Correction to the plan:** the beacon handshake isn't part of a normal login. A new TCP connection goes straight into `STATE_SYNCHED` (`blakserv/async_windows.c:140`), which sends `AP_GETLOGIN` at once. **Verified.** The 9-byte beacon strings (`clientd3d/statstrt.c`, `blakserv/resync.c`, `trysync.c`) are only used to recover after a framing error. If you send the beacon on a fresh connection, the server reads it as a corrupt frame and answers `AP_RESYNC`.

The login sequence (`blakserv/synched.c`):

1. Server → `AP_GETLOGIN`.
2. Client → `AP_LOGIN` (format `clientd3d/protocol.c` login table, parsed at `synched.c:166`):
   - `u8 major (50)`, `u8 minor (55)`
   - 5 × `i32` OS/RAM/CPU info and `u16` screen width/height (logged only)
   - 3 × `i32` (`displays`, `bandwidth`, `reserved`; the low byte of `reserved` is the colour depth)
   - `string username`
   - `string password`: the **16-byte MD5 of the password, with each 0x00 byte replaced by 0x01** (`util/md5.c:302`)
   - `string secret`: must equal `[Login] SecretKey` in `blakserv.cfg`, or the server sends `AP_GETCLIENT` and hangs up (`synched.c:233`). It isn't a real secret; it ships in our JS.
3. If the username is unknown, the server **creates the account and its character slots automatically** (`synched.c:366-411`, `CreateAccountSecurePassword` at `:389`). The number of slots comes from `[Account] NumSlots` (default 4).
4. Server → `AP_LOGINOK u8 account_type` (`synched.c:518` `VerifyLogin`). The version check needs `major*100+minor >= [Login] InvalidVersion` (100). An `.rsb` hash is only compared if the client sends one, and ours doesn't.
5. Server → `AP_GETCHOICE` + 5 × `u32` **seeds** (`synched.c:818`), then `AP_CREDITS i32`.
6. Client → `AP_REQ_GAME i32 download_time, i32 catch, string hostname`. With downloads off, the server answers `AP_GAME` and switches to game mode (`synched.c:838`).

From `AP_LOGINOK` on, **every packet the server sends is type-byte-mangled** (see "Redbook" below), login-mode packets included. Until the first `BP_ECHO_PING` the token is 0, so nothing changes.

## Game mode: the two anti-spoof mechanisms

### Client → server: the LCG security word

Each game-mode message puts a security word in the header's CRC slot (`com.c:240-277`; the server checks it at `blakserv/game.c:173-201`):

```
streams[i] = (streams[i] * 9301 + 49297) % 233280   for i in 0..4   (uint32 arithmetic)
r = streams[ streams[4] % 4 ]
word = (r & 0xffff) ^ length ^ ((WORD)(signed char)body[0] << 4) ^ crc16(body)
```

- The streams are seeded from `AP_GETCHOICE` (`com.c:561`, `575`; server side `game.c:236`).
- The streams step **once per message sent**, so you must never skip a message or send one out of order.
- `body[0]` is a signed `char` in both C programs. Type bytes ≥ 0x80 sign-extend before the shift. This matters for `BP_USERCOMMAND` (155), `BP_REQ_DEPOSIT` (230) and other types above 127.
- One mismatch sets `seeds_hacked` and, with the default `[Security] HangupSpoofs Yes`, **hangs up the session**.
- Implementation: `packages/protocol/src/security.ts` `RandomStreams`. **Verified:** a 5.5-minute soak sent hundreds of game messages with no hang-up.

### Server → client: the redbook token

The server XORs the first byte of every outgoing packet with `secure_token & 0xFF`. It then advances the token by `redbook[i] & 0x7F` and moves `i` to the next character, wrapping at the end (`blakserv/commcli.c:140` `SecurePacketBufferList`). The client undoes this before dispatching (`clientd3d/server.c:542` `DesecureByServerToken`).

- `BP_ECHO_PING` (the reply to our `BP_PING`) carries `u8 (token ^ 0xED)` and `u32 redbook_resource_id` (`game.c:370` `GameEchoPing`). It is itself mangled with the *old* token. After handling it, the client resets: `token = byte ^ 0xED`, and the redbook pointer goes back to the start of the string.
- The redbook string is the **lang 0 string of that resource in `rsc0000.rsb`**. On our server it's resource #20147, `system_success_rsc` = `"Success."` (`[Security] RedbookRsc`, `game.c:764`). If the id is 0 or unknown, both sides use `"BLAKSTON: Greenwich Q Zjiria"` (`game.c:809`, `server.c:157`).
- So the client needs the **same `.rsb` the server was built with**. This is the first hard dependency on matching assets.
- We hit this ourselves: before the `.rsb` lookup was wired up, the first packet after each echo decoded fine and the second didn't. That pattern means "wrong redbook string". **Verified** after the fix.

### Keepalive

- The server hangs up after `[Inactive] Game` seconds (30) without any game message (`game.c:98`).
- The original client pings every 5 s (`clientd3d/ping.c:15`). Background tabs throttle timers, so the browser client must ping from a Web Worker.

## Entering the world

What our server sent when the bot connected (**verified**):

1. After `AP_GAME`: `BP_LOAD_MODULE <rsc "char.dll">`. The client's char module answers `BP_SEND_CHARACTERS`.
2. `BP_CHARACTERS`: `u16 n`, then n × (`u32 id`, `string name`, `u8 flags`). After that come `string motd`, `u8 num_ads` and the ad strings (`module/char/char.c`).
   - **`flags == 1` means the slot still needs character creation** (Kod `IsFirstTime`). The comment in `blakserv/game.c` `GameSendEachUserChoice` says the opposite; it's wrong.
3. Creating a character: `BP_SYSTEM, BP_NEW_CHARINFO`, then:
   - `u32 slot id`, `string name`, `string description`, `u8 gender (1 male, 2 female)`
   - `u16 n` + n × `i32` face-part resources (5 parts, or 0 for the default face)
   - `u8 hair xlat`, `u8 skin xlat`
   - `u16 n` + `i32` stats (6 values, each 1–50, sum ≤ 220 on our server)
   - `u16 n` + `i32` spells, `u16 n` + `i32` skills

   Sources: `module/char/char.c`, `blakserv/sprocket.c:92`, and `kod/util/system.kod` `ReceiveClient` / `player.kod` `PlayerNewCharInfo`. Invalid face parts or stats fall back to defaults instead of failing. The server answers `BP_CHARINFO_OK u32 id`, or `BP_CHARINFO_NOT_OK` (for example, the name is taken).
4. `BP_USE_CHARACTER u32 id`. The server answers with roughly 40 messages:
   - `BP_CHANGE_RESOURCE` (dynamic resources such as the player's name)
   - `BP_LOAD_MODULE merintr.dll`, then `mailnews.dll`
   - `BP_PLAYER`, `BP_LIGHT_SHADING`, `BP_ROOM_CONTENTS`
   - stats, enchantments, `BP_PLAY_MUSIC`, background overlays, and so on

New characters start in **The Inn of Raza** (`razainn.roo`, Kod `viTeleport_row/col 3,8`). That's handy: the slice zone is the starting zone.

### `BP_PLAYER` (`clientd3d/server.c:650`)

`u32 id, u32 icon_rsc, u32 name_rsc, u32 room_obj_id, u32 room_rsc (.roo), u32 room_name_rsc, u32 room_security, u8 ambient_light, u8 player_light, u32 background_rsc, u32 wading_sound_rsc, u32 room_flags, u32 depth1, u32 depth2, u32 depth3`

- `room_security` is the `.roo` checksum. The client blinds the player on a mismatch, comparing the lower 28 bits only (`clientd3d/game.c:295-296`).
- Raza's values on our build: `razainn.roo` 4188566272, `raza.roo` 4192869060.

### Objects (`server.c:324` `ExtractObject`, `server.c:433` `ExtractNewRoomObject`)

Object fields, in order:

1. `u32 id`. The top 4 bits are a tag; tag 1 means an `u32 amount` follows.
2. `u32 icon_rsc, u32 name_rsc, u32 flags, u8 drawing_type, u32 minimap_flags, u32 name_color, u8 object_type, u8 moveon_type`
3. Light: `u16 flags`, plus `u8 intensity, u16 color` only if `flags != 0`.
4. Optional palette prefix: a `u8 9` (translation) or `u8 10` (effect) followed by `u8 value`. Any other byte isn't consumed.
5. Animation: `u8 type`, then
   - `NONE`: `u16 group`
   - `CYCLE`: `u32 period, u16 low, u16 high`
   - `ONCE`: `u32 period, u16 low, u16 high, u16 final`
6. `u8 n` overlays, each: `u32 icon, u8 hotspot`, the optional palette prefix, then an animation.

A room object then adds:

- `u16 row, u16 col`: **Kod fine units, 1-based**. 64 per square, so square 1 starts at 64. Row comes first.
- `u16 angle`, in units of 4096 per circle.
- The optional palette prefix, an animation and overlays again (the "motion" state).

`BP_ROOM_CONTENTS` is `u32 room_obj_id, u16 n, n × room object` (`server.c:693`).

## Movement and exits

`BP_REQ_MOVE` is `u16 row, u16 col, u8 speed, u32 room_obj_id`, in Kod fine units, 1-based, row first (`clientd3d/protocol.h:69`). Speeds are 25 to walk and 55 to run (`clientd3d/move.c:72-73`). The original client sends one at most every 250 ms.

**Correction to the plan: the server does check part of the destination.**

- `user.kod` `UserMove` (`user.kod:4036`) rejects any destination that isn't inside a room sector, or any move while the player is flagged no-move (`user.kod:4072`). It rejects by **teleporting the player back** with a `BP_MOVE` to the old position.
- It does *not* check walls along the way or speed: the movement-bucket check is commented out (`user.kod:4159`), and `room.kod:2373` says user moves are "already been checked by client (HAHA!)".
- So the browser still needs `move.c`-faithful collision, but an out-of-room position can't desync us silently.

**Exits work two ways:**

- **Doors and portals (`plExits`):** stand *on* the exit square and send `BP_REQ_GO` (empty). The server checks `plExits` for the current square (`room.kod:3420` `SomethingTryGo`, `user.kod:7623` `UserGo`). For example, the inn's door is `[9, 6/7] → RID_RAZA (8, 27)` (`razainn.kod:78-79`).
  - **Verified:** the bot walked to (9.05, 6.5), sent `REQ_GO`, got `BP_PLAYER` for Raza and appeared at (8.5, 27.5).
  - The original client sends `REQ_GO` on the "go" action, after `MoveUpdatePosition` (`clientd3d/intrface.c:440`).
- **Room edges (`plEdge_exits`):** moving outside the room's thing-box triggers `StandardLeaveDir` (`room.kod` `SomethingMoved`). The client sends a move to the off-room position at most once a second (`move.c:372`).

## World updates (milestone 3)

- **`BP_CREATE`:** one room object (same layout as in `BP_ROOM_CONTENTS`). **`BP_REMOVE`:** `u32 id`.
- **`BP_CHANGE`** (`server.c` HandleChange, `game.c` ChangeObject): an object (as above) followed by the optional palette prefix, an animation and overlays for its motion state. The position stays the same.
- **`BP_MOVE`:** `u32 id, u16 row, u16 col, u8 speed` (bit 7 = turn to face). **`BP_TURN`:** `u32 id, u16 angle`.
- **Lighting:**
  - `BP_LIGHT_AMBIENT`: `u8`.
  - `BP_LIGHT_PLAYER`: `u8`.
  - `BP_LIGHT_SHADING`: `u8 intensity, u16 sun angle, u16 (unused)`.
  - `BP_BACKGROUND`: `u32` sky resource; `2skyX.bgf` selects `skyX.bsf`.
- **Room ambient** comes from Kod `room.kod GetRoomLight`: `base light + outside factor × (brightness − 50) / 4`. The "brightness" is the time of day.
- **Object light** (`ExtractDLighting`): `u16 flags`; if non-zero, then `u8 intensity, u16 colour` (5:5:5, red in the high bits). Every object with a colour and intensity is a light source: invisible `blank.bgf` lights mark the inn's torches. Its reach is `DLIGHT_SCALE(intensity) / 2` = `(intensity × 14000 / 255 + 4000) / 2` fine units (`d3dlighting.h`).
- **`BP_CHANGE_RESOURCE`:** `u32 id, string`. Dynamic resources such as player names arrive this way, so look names up there before the `.rsb`.
- **Xlat ids:** objects and overlays carry `xlat.h` translation ids. Player bodies use the guild-colour range (0x87–0xFF = `0x87 + i × 11 + j`, red ramp → ramp i, blue ramp → ramp j), e.g. 236 = grey shirt with a skin-coloured blue ramp.

## Actions and text (milestone 4)

- **Client → server:**
  - `BP_REQ_GO` (empty: open the door / take the exit on our square)
  - `BP_REQ_LOOK u32 id`, `BP_REQ_GET u32 id`
  - `BP_REQ_DROP u32 id [u32 amount for number items]`
  - `BP_REQ_USE / UNUSE / ACTIVATE u32 id`
  - `BP_REQ_INVENTORY`
  - `BP_SAY_TO u8 kind, string` (kinds: 1 say, 2 yell, 3 broadcast, 6 emote)
- **Server → client, text:**
  - `BP_MESSAGE` / `BP_SYS_MESSAGE`: `u32 format resource` + parameters.
  - `BP_SAID`: `u32 sender, u32 sender name rsc, u8 say type, u32 format resource` + parameters.
  - `BP_LOOK`: an object, `u8 flags`, a format resource + parameters, and an inscription message if `flags & 3`.
  - The formatter is `srvrstr.c CheckServerMessage`, ported in `packages/world/src/text.ts`. Text then carries `~`/`` ` `` colour and style codes (`~B` bold, `~I` italic, `~U` underline, `~n` reset, letters for colours).
- **Inventory and players:**
  - `BP_INVENTORY`: `u16 n` + objects; `INVENTORY_ADD`: an object; `INVENTORY_REMOVE`: `u32 id`.
  - `BP_PLAYERS`: `u16 n` + (`u32 id, u32 name rsc, string name, u32 flags, u8 drawing type, u32 minimap flags, u32 name colour, u8 object type, u8 moveon type`). `PLAYER_ADD` is one of those; `PLAYER_REMOVE` is `u32 id`.
- **Movement units:** `MOVEUNITS` = 256 fine units per 85 ms (walk; run ×2), divided into steps of up to 20 for wall checks. The player's half-width is 248 and the step-up limit is 384. `movement.ts` cites each constant.

## The interface (milestone 5)

- **What the client asks for on entering** (the server sends the player and room by itself):
  - `BP_REQ_INVENTORY` (`game.c` GameInit). Without it the inventory stays empty until something changes.
  - `BP_SEND_STAT_GROUPS`, `BP_SEND_SKILLS`, `BP_SEND_SPELLS` (`mermain.c` InterfaceInit).
  - `BP_SEND_ENCHANTMENTS u8 1` (player enchantments, `enchant.c`).
  - When `BP_STAT_GROUPS` arrives, `BP_SEND_STATS u8 1` (the main bars). The other groups are asked for when their tab opens (`BP_SEND_STATS u8 group`).
- **Ids: tagged and untagged.**
  - A number item's id has `CLIENT_TAG_NUMBER` (1) in its top 4 bits. Plain id fields (`PARAM_ID`: look, get, use, buy, offer target, cast...) are sent **without the tag** (`protocol.c` `GetObjId`). Sending the tagged id for `BP_REQ_GET` makes the server ignore it.
  - Object fields (`PARAM_OBJECT`, `PARAM_OBJECT_LIST`: drop, buy items, offer items) send the full tagged id plus a `u32 amount` for number items. List entries with amount 0 are left out.
  - The server is inconsistent too: it removes a dropped stack of shillings with an untagged `BP_REMOVE`. The client compares ids with the tag masked (`object.c` CompareIdObject); `WorldState`'s `ObjectMap` does the same.
- **`BP_CHANGE` also updates the inventory** (`game.c` ChangeObject): that's how a stack of shillings learns its new amount after you buy something.
- **Stats** (`merintr.c`):
  - `BP_STAT_GROUPS`: `u8 n` + `n × u32` name resources (Condition, Stats, Spells, Skills, Quests).
  - `BP_STAT_GROUP`: `u8 group, u8 n` + statistics.
  - `BP_STAT`: `u8 group` + one statistic, replacing the one with the same number.
  - **Statistic:** `u8 num, u32 name rsc, u8 type`. For type 1 (numeric): `u8 tag, i32 value`, then if tag 1 (int) `i32 min, i32 max, i32 current max`; tag 2 means the value is a resource string. For type 2 (list): `u32 object id, i32 value, u32 icon rsc`.
  - **Group 1 (the main bars):** 1 health, 2 mana, 3 vigor, 4 experience. Their name resources are the icons (`heal.bgf`, `ankh.bgf`, `bolticon.bgf`, `exp.bgf`). Health and mana run from min to *current max*; vigor shows its limit bar (current max) in red and turns red below 10; experience reads "N XP / M XP".
  - **Group 2** is the numeric stats (Might... resistances). **Groups 3 and 4** list spells and skills with their percentage. **Group 5** is quests: entries with value 0 are headers.
- **Spells:** `BP_SPELLS u16 n` + (an object, `u8 targets, u8 school` 1-based); `SPELL_ADD` is one spell; `SPELL_REMOVE u32 id`. **Skills:** `BP_SKILLS u16 n` + objects. `BP_REQ_CAST u32 spell` + an object list of targets.
- **Enchantments:** `BP_ADD_ENCHANTMENT u8 kind` + object (1 = on the player, 2 = on the room); `BP_REMOVE_ENCHANTMENT u8 kind, u32 id`. Room enchantments (Safe Room, PvP Combat Allowed) arrive with each room.
- **Use list:** `BP_USE_LIST u16 n` + ids; `BP_USE u32 id`; `BP_UNUSE u32 id`.
- **Trade** (`buy.c`, `offer.c`):
  - **Buying:** `BP_REQ_BUY u32 seller` → `BP_BUY_LIST`: the seller object, `u16 n`, then (object, `u32 cost`). Shopkeepers with nothing for sale (Marcus the innkeeper) don't answer. `BP_REQ_BUY_ITEMS u32 seller` + object list.
  - **Selling** is an offer: `BP_REQ_OFFER u32 target` + object list → `BP_OFFERED` (our items back) → `BP_COUNTEROFFER` (their object list, e.g. shillings) → `BP_ACCEPT_OFFER` or `BP_CANCEL_OFFER`. Tomas the smith pays 27 for a torch he sells for 36.
  - **Vaults:** `BP_REQ_WITHDRAWAL u32 banker` → `BP_WITHDRAWAL_LIST` (same layout as the buy list); `BP_REQ_WITHDRAWAL_ITEMS` and `BP_REQ_DEPOSIT u32 banker` + object lists. Bentu charges 60 shillings to store gear.
  - **Bank money** goes through user commands typed in chat: `deposit N`, `withdraw N`, `balance`.
- **User commands:** `BP_USERCOMMAND u8 command` + parameters (`include/proto.h` UC_*: 5 rest, 6 stand, 35 deposit `i32`, 36 withdraw `i32`, 37 balance).
- **Sound** (`server.c` HandlePlayWave):
  - `BP_PLAY_WAVE`: `u32 rsc, u32 object, u8 flags, i32 row, i32 col, i32 radius, i32 max volume`. The resource string is a file name in the client's resource folder.
  - Flags: 1 loop until you leave the room, 2 random pitch (ignored), 4 Kod chose a random spot.
  - Position: the object's, else the middle of big square (row, col), else at the player (2D).
  - `BP_STOP_WAVE u32 rsc, u32 object`. `BP_PLAY_MUSIC` / `BP_PLAY_MIDI u32 rsc`.
  - Raza sends `ambcntry.ogg` as a loop at square (1, 1), then random birds, gulls and waves every few seconds. The smithy sends `smithy.ogg` music and the fireplace loop.
- **Still not decoded:** guilds, mail and news, background overlays (`BP_ADD_BG_OVERLAY`: the sun and moon), and `BP_USERCOMMAND` replies such as preferences.

## Combat and creation (milestone 6)

- **`BP_REQ_ATTACK`:** `u8 kind (1 = normal), u32 target` (untagged id). The server answers with messages ("Your mace bashes the baby spider for 4 damage."), sounds and `BP_PLAYER_OVERLAY` swing animations. Kills give XP, unbound energy and auto-loot shillings.
- **`BP_PLAYER_OVERLAY`:** `i8 hotspot`, then an object without lighting whose id is the slot (1 or 2). Wielding the mace sends slot 2, hotspot 5 (south-east), `povmace.bgf` group 5. Each swing sends the overlay again with a new animation.
- **`BP_EFFECT`:** `u16 effect` + parameters: `i32 duration` for invert, shake, pain, whiteout, blur and waver; `i32 duration, i32 xlat` for the flash; `i32 xlat` for the override; nothing for paralyze, release, blind, see and the weather switches. Dying sends clear-weather, clear-sand and pain.
- **`BP_SHOOT`:** `u32 icon`, translation, animation, `u32 source, u32 dest, u8 speed (squares per second), u16 flags`, then lighting. **`BP_RADIUS_SHOOT`:** `u32 icon`, translation, animation, `u32 source, u8 speed, u16 flags, u8 range, u8 number`, lighting; the ring reaches `range × 1000` fine units.
- **`BP_REQ_CAST`:** the spell's object id, then an object list of targets (amount 1).
- **Death:** `pdeath.ogg`, then `BP_PLAYER` for the Underworld (`undrwrld.ogg`, a lava loop). Walking into its "rip in space" (a teleporter) brings you back, in the Inn of Raza for a new character.
- **The creator:** `BP_SYSTEM, BP_SEND_CHARINFO` → `BP_CHARINFO`:
  - `u8 n` hair translations, `u8 n` face (skin) translations;
  - per gender (male, female): `i32 n` hair rscs, `u32` head, `i32 n` eyes, `i32 n` noses, `i32 n` mouths;
  - `i32 n` spells and `i32 n` skills, each `i32 id, u32 name rsc, u32 description rsc, i32 cost, u8 school`.
  - `BP_NEW_CHARINFO` sends the face parts in the order head, hair, eyes, nose, mouth, then the hair and skin translations, the six stats, and the chosen spell and skill ids (Kod numbers, not objects).

## Rooms that change, trading and resync (milestone 13)

- **Room changes** (`server.c HandleSectorMove` and the rest, `roomanim.c`). Walls and sectors are named by their server id; every one with that id changes.
  - `BP_SECTOR_MOVE`: type BYTE (`ANIMATE_FLOOR_LIFT` 4 or `ANIMATE_CEILING_LIFT` 5), sector WORD, height WORD (Kod units, × 16 for client units), speed BYTE (Kod units per second; 0 = at once).
  - `BP_WALL_ANIMATE`: wall WORD, an animation (as in objects), action BYTE (`RA_PASSABLE_END`, `RA_IMPASSABLE_END`, `RA_INVISIBLE_END`).
  - `BP_CHANGE_TEXTURE`: id WORD, texture WORD, flags BYTE (`CTF_*`: above, normal, below, floor, ceiling).
  - `BP_SECTOR_CHANGE`: sector WORD, depth BYTE, scroll BYTE (`CHANGE_OVERRIDE` 4 keeps the old value).
  - `BP_SECTOR_LIGHT`: sector WORD, type BYTE (flicker on or off). The D3D client keeps the sector's own light, so it changes nothing.
  - The original reloads the room on every `BP_PLAYER`, and the server follows every `BP_PLAYER` with the room's changes again at speed 0 (`user.kod ToCliPlayer`). So a client can start from the file's room on each `BP_PLAYER` and apply what follows.
  - The Raza crypt's door is sector 3, a ceiling that lifts (84 shut, 172 open); the Raza clock is wall 1, its hour as the bitmap group.
- **Trading with another player** (`offer.c`, `user.kod`). The offerer sends `BP_REQ_OFFER`; the receiver gets `BP_OFFER` and must answer with `BP_REQ_COUNTEROFFER` (an object list, possibly empty), which the server echoes to them as `BP_COUNTEROFFERED` and sends the offerer as `BP_COUNTEROFFER`. Only then may the offerer send `BP_ACCEPT_OFFER`; an earlier accept is logged as an "ALERT" and the offer cancelled. Both sides get `BP_OFFER_CANCELED` when the trade completes, which closes their dialogs.
- **The remote view** (`BP_SET_VIEW`: object ID, flags DWORD, height DWORD, light BYTE; `BP_RESET_VIEW`): see through another object's eyes. Only the DM's Globe of Seeing uses it (`player.kod SetPlayerView`).
- **Resync.** After a bad frame the server sends ten `BP_RESYNC`s and waits for the beacon (`blakserv/game.c GameSendResync`, `GameSyncInputChar`); the client sends `BP_RESYNC` first if it found the bad frame itself, then the beacon every 2 s (`com.c Resynchronize`, `statstrt.c`). **In Server 104 the handshake can't complete**: `GameSyncInputChar` and `resync.c ResyncInputChar` compare a signed `char` with the beacon's byte 255, and blakserv isn't built with `/J`. Clients wait out the 60 s `BEACON_TIMEOUT` ("Couldn't connect to server!") or the server hangs up first.

## Mail, news, stats and guilds (milestone 13)

- **News** (`module/mailnews`). Looking at a globe gets `BP_LOOK_NEWSGROUP`: newsgroup WORD, permissions BYTE (`NEWS_READ` 1, `NEWS_POST` 2), the globe as an object, then a server-formatted description. `BP_REQ_ARTICLES` (newsgroup WORD) brings `BP_ARTICLES`: newsgroup WORD, part BYTE, parts BYTE, then a WORD count of articles (number DWORD, time DWORD, poster, title). `BP_REQ_ARTICLE` (newsgroup WORD, number DWORD) brings the text as one or more `BP_ARTICLE` parts, which don't say which article they belong to. `BP_POST_ARTICLE` is newsgroup WORD, title, text; `BP_DELETE_NEWS` newsgroup WORD, number DWORD.
- **Mail.** `BP_REQ_GET_MAIL` asks for the next message; `BP_MAIL` is the server's index DWORD, sender, time DWORD, a WORD count of recipients, then the formatted text, whose first line is "Subject: ..." by convention. A `BP_MAIL` with no recipients means there are no more. The server keeps a message until the client sends `BP_DELETE_MAIL` (the index), so the client must keep it first. `BP_SEND_MAIL` is a WORD count of recipient ids, the ids, then the text; the ids come from `BP_REQ_LOOKUP_NAMES` (the names joined by commas) and `BP_LOOKUP_NAMES` (a WORD count of ids, 0 for a name that isn't a player).
- **Times** in mail and news are Kod's `GetTime()`: Unix time less 1760000000 in this blakserv (`ccode.c C_GetTime`). The client source adds 211458440 + 1388534400, an older base.
- **Stat changes** (`module/stats`): `BP_REQ_STAT_CHANGE` (156) is the six stats then the eight school levels, a BYTE each; the answer `BP_CHANGED_STATS` (157) has the same layout.
- **Guilds** are user commands (`merintr.c user_msg_table`). `UC_GUILDINFO`: name, a BYTE saying whether a hall password follows (only for the guildmaster of a guild with a hall), the password, the `GC_*` command flags DWORD, the guild's id, five (male, female) rank names from lowest, the member we support DWORD, then a WORD count of members (id DWORD, name, rank BYTE, gender BYTE). `UC_GUILD_LIST`: a WORD count of (id, name), then four WORD-counted id lists: our allies, our enemies, guilds that consider us allies, and enemies. `UC_GUILD_SHIELD`: the guild's id (0 for an unclaimed design), a name, colour 1, colour 2 and pattern BYTEs; `UC_CLAIM_SHIELD` sends the same three BYTEs and a claim BYTE (0 only asks who has it). Colours 9 and 9 together aren't allowed. `UC_GUILD_ASK` carries the price and the secret price; `UC_GUILD_CREATE` answers with the name, the ten rank names (male, female, lowest first) and the secret BYTE. `UC_GUILD_HALLS`: a WORD count of (id, name resource, cost, rent).
- The guild window only opens for members (`UC_REQ_GUILDINFO`; otherwise "You do not belong to a guild."). Creating one needs `PFLAG_PKILL_ENABLE` and the price in shillings; on our server, `send object <player> SendCreateGuild` and `SendBuyGuildHall` on the maintenance port open the two dialogs without going to Frular.

## Mini-games and the admin console (milestone 13)

- **Chess** (`minigame.kod`, `module/chess`). Using the board (`TryActivate`) sends the user, in order: `BP_LOAD_MODULE` (chess.dll), `UC_MINIGAME_START` (the game object, a BYTE player number: 1 white, 2 red, more for observers), `UC_MINIGAME_MOVE` (the game, then the state string, empty before the first move) and a `UC_MINIGAME_PLAYER` per player (number BYTE, name). A player's move is `UC_MINIGAME_STATE` (the game, the new state string); the server stores it and sends it to the other player and the observers still in the room, not back to the mover, and unloads the module for observers who left. `UC_MINIGAME_RESET_PLAYERS` (the game) starts over with new players. Picking the board up, or the board leaving the room, unloads the module.
- **The state string** (`board.c`) is 67 bytes: the squares top row first, each the piece (1 to 6, 7 empty) with the colour in bit 7, then turn and castling flags, en passant (bit 1, then the square's row in bits 2-4 and column in 5-7), and resignations, each flag byte with bit 0 set. It's sent as an ordinary string, so it must stay byte-exact (Latin-1).
- **Admin commands:** `BP_REQ_ADMIN` (a string) runs a maintenance-port command for an `ACCOUNT_ADMIN` account (`blakserv/game.c`), which echoes it as "> command" and answers with `BP_ADMIN` (162, a string with "\n" line ends). Admin characters (`create admin <account id>` on the maintenance port) get "admin.dll" (and "dm.dll") on logon.

## Sources

- The reference source: `meridian-unreal/Server-104` (`blakserv`, `clientd3d`, `module`, `kod`, `include/proto.h`), and M59's own `doc/protocol.txt`, which is older than the code. Trust the code.
- `cyberjunk/meridian59-dotnet` (C#, GPL-3): the full protocol plus BGF/ROO/RSB readers. Read it for cross-checking only.
- `tpeppers/m59-harness` (Node.js): a current headless protocol client with notes.
- roBrowser and its wsProxy, and websockify: prior art for the WebSocket-to-TCP gateway.
