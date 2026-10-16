# ADR 0015: Social on our server, and one command channel

- **Status:** accepted, 2026-10-15; `UC_SHARDS` built with fast travel, and the social move built 2026-10-16 (see "As built" at the end). It changes [ADR 0005](0005-friends.md) (friends), [0006](0006-pets.md) (pets) and [0007](0007-arena.md) (the arena), and the command channel of [0008](0008-player-homes.md)-[0012](0012-cosmetics.md).

## Context

The friends relay (`tools/gateway/relay.ts` on `/social`) was chosen while [ADR 0001](0001-direction.md) decision 4 still meant an unmodified blakserv:
- **0005:** Server 104's Kod has no friends, and frequent positions don't belong in blakserv.
- **0006:** pets are cosmetic, and need no server, Kod or protocol change.
- **0007:** one arena sim per server, and nothing reaches blakserv.

On 2026-10-15 the server became ours to change. The relay's costs are now worth weighing against that.

### What the relay does

Nine jobs. Only the arena streams.

| Job | Messages | State on the relay | Rate |
|---|---|---|---|
| Identity | `hello`, `challenge`, `welcome`, `time` | Nonce, key, name, server | Once a connection |
| Presence | `watch`, `visible`, `presence` | Each connection's watched keys (up to 500) | On change |
| Search, lookup | `search`, `lookup`, `results` | None (scans connections) | Lookup every 30 s per friend missing from the relay |
| Pairing | `send{request, accept, decline, cancel, remove}`, plus one in-game tell | None (forwards, stamped with the key) | Rare |
| Location | `send{loc}` | None | Each room change |
| Health | `send{hp}` | None | Up to 4/s, to friends in the room |
| Following | `send{follow, follow-refused, exit}` | None | Each exit the leader takes |
| Pets | `pet`, `petQuery`, `pets` | Each connection's pet; the first claim on a name wins | Room entry, change |
| Shared crowd | `send{ambient-ask, ambient}` (friends only), the relay's clock | None | Room entry |
| Arena | `arenaWatch`, `arenaLeave`, `arenaHour`, `arenaState`, `arenaTick`, `arenaOff` | One `ArenaSim` per server, watchers, seasons (`ARENA_STATE` on disk) | A tick every 100 ms per watcher, about 2 KB/s |

### What it costs

- **Identity is a claim.** The relay can't see the game login, so each character has an ECDSA key (`socialKeys.ts`, in IndexedDB). Pairing needs a challenge, a signed hello, and an in-game tell carrying a code and the key's fingerprint, which `hideFriendTells` hides.
- **Friends live in one browser.** They're kept in `localStorage`, and the key in IndexedDB. A new device, or cleared site data, means pairing again. Pets are first-come claims on a name.
- **A second server to run.** The gateway image carries our packages' sources (`register.mjs`), the arena's room and nav grid, and a state volume. A relay change means a gateway deploy, and a restart drops every relay connection.
- **Code:** `relay.ts` 350 lines, `socialClient.ts` 289, `friends.ts` 604, `social.ts` 384, `socialKeys.ts` 50, `socialProtocol.ts` 176, plus tests and `tools/headless/friend.ts`.

### What Kod already has

- **Who's online:** `SYS plUsers_logged_on`, `SystemUserLogonAdvertise` / `SystemUserLogoffAdvertise`, and `user.kod SomeoneLogon` / `SomeoneLogoff`. Guild members are already told when a guildmate logs on (`user.kod` L1527-1530).
- **Lists kept with the save:** `User.plCompletedPassiveQuestChains` is the pattern.
- **Anything to our client:** `AddPacket(1,BP_USERCOMMAND,1,UC_x,...)` and `SendPacket`.
- **No friends list anywhere,** and nothing from the client but the fixed messages in `blakserv/sprocket.c`.

### The command channel

ADRs 0008-0012 send their commands as hidden spoken `#` lines (`#travel`, `#quest`, ...), because client-to-server messages are fixed in C. Spoken commands:
- go through speech handling, its logs and flood limits;
- echo back, so our client must filter them out (`lineFilter`);
- carry no structure but the text.

`sprocket.c usercommand_def_table` already takes a string from the client in `UC_MINIGAME_STATE` (`{4, TAG_OBJECT}, {0, TAG_TEMP_STRING}`). One more row costs a few lines of C.

## Decisions

The user decided these on 2026-10-15.

### 1. `UC_SHARDS`, one command channel

1. **blakserv:** a new `UC_SHARDS` user command, `{ {0, TAG_TEMP_STRING}, {0, DONE_PARM} }`, in `sprocket.c` and the C and Kod headers (`kod/include/protocol.khd`). It builds on Windows and in the Linux image.
2. **Kod:** `user.kod`'s user-command switch hands the string to a `ShardsCommands` dispatcher, which routes on the first word: `travel`, `quest`, `home`, `follower`, `friend`, `pet` and so on. Each feature registers its own verb and checks its own arguments.
3. **Our client:** `buildUcShards(line)` in `packages/protocol`, and `GameSession.shardsCommand(line)`. Answers come back as `UC_*` packets, as the ADRs already plan.
4. **ADRs 0008-0012 use it:** their `#` commands become `UC_SHARDS` commands with the same verbs and arguments. Nothing is spoken, so nothing needs hiding.

### 2. Social moves into Kod

| Job | Where it goes |
|---|---|
| Friends list, pairing | `User.plFriends` and `plFriendRequests`, saved with the game. `friend request/accept/decline/cancel/remove <name>` over `UC_SHARDS`; `UC_FRIEND_LIST` back. Works on every device. |
| Identity | The logged-in player. `socialKeys.ts`, the challenge, the pairing tell and `hideFriendTells` go. |
| Presence, search | The logon and logoff hooks send `UC_FRIEND_STATUS` to online friends. Search uses `plUsers_logged_on`, skipping hidden admins as `ToCliPlayers` does. |
| Location | Sent to online friends on each room change. |
| Health | Sent to friends in the same room, on change, throttled in Kod as now (at most 4/s, at least every 5 s). |
| Following | The server sees the leader take an exit and tells followers its room and exit. `FollowPlanner` and the walking in `gameScene.ts` stay. |
| Pets | The chosen kind and colour are a `User` property, sent to the room's players on entry and on change. No more claims on names. |
| Shared crowd | Kod sends a room seed and start time on entry, so everyone in a room sees the same crowd, friends or not. `AmbientStepper` stays; the relay's clock goes. |

### 3. The arena stays in Node

- **Why:** the sim (`arenaSim.ts`, about 1,400 lines, plus its data) is floating point and steps every 50 ms. Kod's integers are 28-bit, and the sim would run under blakserv's single lock. Making it deterministic on every client instead would need identical floating point in every browser.
- **What stays:** the gateway runs the sim and streams `arenaState` and `arenaTick` to watchers, anonymously. It needs no identity, presence or pets. `relay.ts` shrinks to the arena watch; the rest of the relay goes.
- **The hour** still comes from the watchers' sun (`arenaHour`), until Kod sends it.

### 4. Moving existing friends

- On the first login after the update, our client sends a `friend request` for each friend in its `localStorage` list, then deletes the list and the key.
- Both sides' old lists do this, so most pairs reconnect without anyone doing anything.

## Consequences

- **Friends and pets follow the account** across the desktop app, the phone and the browser.
- **The server can enforce friends,** for example ADR 0008's guests.
- **Saves change** (new `User` properties), so it's tried on a copy first ([ADR 0008](0008-player-homes.md) 3.3).
- **The gateway is simpler to deploy,** but still carries the arena.
- **`UC_SHARDS` is a protocol:** our client and our Kod change together, and `docs/research/protocol.md` lists the verbs.
- **The order:** `UC_SHARDS` is built first, with fast travel ([ADR 0011](0011-fast-travel.md)). The social move comes after fast travel.
- **Docs to update** when it's built:
  - `AGENTS.md`: Friends, Pets, the arena, Hosting;
  - ADRs 0005-0007: status lines pointing here;
  - `deploy/README.md`;
  - `docs/research/protocol.md`.

## As built (2026-10-16)

**Kod** (shards-server):
- **`util/shardssocial.kod`** (`ShardsSocial`, `SYS@GetShardsSocial`, made on demand) holds no state. It answers the `friend`, `pet` and `ambient` verbs of `UC_SHARDS` (`user.kod ShardsCommand`) and sends `UC_FRIENDS` (103), `UC_PETS` (104) and `UC_AMBIENT` (105). [protocol.md](../research/protocol.md), "Ours", has every field.
- **On each `User`:** `plFriends`, `plFriendsIn`, `plFriendsOut` (user objects), `piSocialFlags` (1 hide location, 2 hide in search, 4 refuse followers), `piLastSeen`, `poFollowing`, `plFollowers`, `psPetKind`, `piPetColour`, `psPetName`.
- **Hooks:** `UserLogon` clears follows; `UserLogoff` sets `piLastSeen` and ends follows both ways; `SomeoneLogon` and `SomeoneLogoff` tell friends (a line in the chat and a new list); `NewOwner` notes the square left from, then, once the client has the room, tells friends the new location, followers the exit, and the room the pets.
- **Requests** are kept with both characters, so they work while the other is offline. Asking someone who already asked us accepts. At most 100 friends and 50 requests.
- **The shared crowd:** each `Room` keeps `piAmbientSeed`, `piAmbientSince` (`GetTickCount`) and `piAmbientHour`. `GetAmbientCrowd` keeps a crowd half an hour while someone else is in the room and ten minutes in an empty one, then starts a new one.
- **Found on the way:** Kod names are global and ignore case, so parameters called `list`, `a` and `b` clashed with existing identifiers (`e5.kod`'s `A`), and `SendList` with an existing message. They're `members`, `user1`, `user2` and `SendFriendList`.

**Our client:**
- **`GameSession`** reads the three messages into a `social` event (`SocialEvent`), passed through `Game.tsx` to `GameView` and `SocialLink`.
- **`FriendsService`** (`packages/world/src/social/friends.ts`) keeps the server's word and sends its commands. Friends are known by name (`key` is the lower-case name). It keeps only each friend's Locate and Map marker, and Health bars, in `localStorage` (version 2). Following starts and stops as the server's list says.
- **`SocialLink`** (`apps/client/src/game/social.ts`): the pets of the players in the room by object, our own pet from the server, the room's crowd (`ambient`), and the arena through an `ArenaClient`.
- **Gone:** `socialProtocol.ts`, `socialClient.ts`, `socialKeys.ts`, the pairing tell, `hideFriendTells` and `GameSession.lineFilter`; the friends window's "Pair again".
- **Moving over (4):** a version 1 friends save is asked again with `friend request`s once the server's list is in, and the IndexedDB `shards-social` keys are deleted. A pet kept only in this browser goes up to a server that has none.

**The arena (3):** `tools/gateway/relay.ts` is now `ArenaRelay`: `arenaWatch {server, room, hour}`, `arenaLeave`, `arenaHour`, with no sign-in, on `/social` as before. `packages/world/src/arena/arenaClient.ts` connects only while watching.

**Tried on our server:** two characters (`tools/headless/friend.ts`, rewritten for the server, and the browser):
- a request, an accept, a remove and asking again;
- logon and logoff notices, and last-seen times;
- locations on every room change, hidden while a player hides theirs;
- health between friends in a room;
- following, and the exit through the Raza inn's door worked out to its square;
- search, hiding from it, and the options;
- pets on entering a room and on a change;
- the same crowd seed for two asks, with the time since it began;
- the arena through the new feed.

**Not yet tried:** friends on the hosted server (the save changes, so a copy of the VM's save first, as [ADR 0008](0008-player-homes.md) 3.3 says), and two real browsers following each other across several rooms.
