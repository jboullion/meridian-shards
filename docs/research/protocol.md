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

## Messages we haven't decoded yet

`BP_MESSAGE` and `BP_SAID` formatting (`srvrstr.c`), stats, spells and skills, enchantments, sounds and the background are all still to decode. The handler list is `clientd3d/server.c:51` `game_handler_table`, plus `module/merintr` and `module/char`. Formats on the server side come from Kod `AddPacket` calls.

## Sources

- The reference source: `meridian-unreal/Server-104` (`blakserv`, `clientd3d`, `module`, `kod`, `include/proto.h`), and M59's own `doc/protocol.txt`, which is older than the code. Trust the code.
- `cyberjunk/meridian59-dotnet` (C#, GPL-3): the full protocol plus BGF/ROO/RSB readers. Read it for cross-checking only.
- `tpeppers/m59-harness` (Node.js): a current headless protocol client with notes.
- roBrowser and its wsProxy, and websockify: prior art for the WebSocket-to-TCP gateway.
