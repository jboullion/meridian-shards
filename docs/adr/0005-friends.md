# ADR 0005: Friends, a relay of our own, and shared ambient life

- **Status:** accepted, 2026-10-12. Parts 1-5 (the relay, keys, the Friends window, follow, health bars: section 7 steps 1-4) built 2026-10-12, and shared ambient life (6) the same day, simplified as below. See "As built" at the end. The arena's fights are no longer shared by seed (6): since [ADR 0007](0007-arena.md) the relay runs one arena for everyone on a server. **Superseded in part, 2026-10-16:** friends, presence, following, health and the shared crowd moved onto our server, and the relay, keys and pairing tell are gone ([ADR 0015](0015-social-on-our-server.md), "As built"). What friends do is unchanged; how it's carried is 0015's.
  - Note 2026-10-17: "follow" and "followers" here still mean following a friend. The monsters that fight beside a player ([ADR 0010](0010-followers.md)) were built as **companions** so the words don't clash.

## Context

We want things players of this client can do together that the server knows nothing about: friends, seeing where they are, following them, and their health over their heads. The server can't be asked: Server 104's Kod has no friends, and positions every few seconds don't belong in blakserv.

So the clients need a way to talk to each other. We looked at:
- **In-game tells** (`GameSession.sayTo`, `BP_SAY_GROUP`): no infrastructure, and the server vouches for the sender. But every update is a message through blakserv and its logs. Fine for a rare handshake, not for positions every few seconds.
- **PeerJS / WebRTC:** a new dependency, a broker we'd host anyway (the public one is unreliable), TURN for players behind strict NATs, and it gives every friend your IP address, which is a poor fit for a feature about sharing where you are.
- **A relay of our own:** a small WebSocket service beside the gateway, using the `ws` package we already have. Every player already holds a WebSocket to that machine.

What we have to build on:
- `WorldState.players` (`packages/world/src/state.ts`): who's online, from the server.
- `BP_PLAYER`: our room (its file and RID; `roomId` is an object id, renumbered by saves, so never share it).
- `navGrid.ts` (`findPath`, `nearestCell`) and `PlayerMover`: ambient townsfolk already walk rooms with them.
- `roomexits.json` (`tools/assets/roomLinks.ts buildRoomExits`): every room's door squares and edge exits, and where they lead. `rooms.json`: every room's number, name and file.
- `AmbientLife` and `Critters` already take a seed (`seededRandom`); only `nature.ts` uses `Math.random` directly.

## Decisions

### 1. The relay

1. **A dumb relay of our own**, in the gateway's process: a second `WebSocketServer` on the path `/social` (`tools/gateway/gateway.ts`, the same HTTP server; the game connection keeps `/`). Caddy routes `/social` like `/ws`, and `GATEWAY_ORIGINS` applies to both. It can move to its own container later without the clients noticing.
2. **It knows nothing about the game.** It keeps, in memory only: who's connected, under which key, character name and game server. It forwards messages between keys and answers searches. No database; a restart drops everyone, and clients reconnect (with backoff) and announce themselves again.
3. **Messages are JSON text frames**, a few hundred bytes. Limits per connection: 4 KB a message, about 20 messages a second (dropped above that), one connection per key. The per-IP limit is the gateway's.
4. **Scoped by server:** every client says which server it's playing on (its game socket URL, as the mail and quick slots storage keys use), and searches, presence and forwarding stay within it. There is one game server, ours (ADR 0001 decision 3), so in practice that's one scope; the code keeps the key.
5. **The relay gives the time.** Its `welcome` carries its clock, so clients agree on time to within a round trip whatever their own clocks say (for 5. below).
6. **Without the relay, nothing breaks:** the game plays as now, the friends list shows everyone offline, and ambient life goes back to local seeds.

### 2. Who's who

1. **A key pair per character per server:** ECDSA P-256 from WebCrypto, made on first use, non-extractable, kept in IndexedDB (`localStorage` can't hold a `CryptoKey`). Losing it (cleared site data, a new device) means pairing friends again.
2. **Connecting:** the relay sends a random challenge; the client answers with its public key, server, character name and the challenge signed. The relay checks the signature, so from then on it stamps every forwarded message with the sender's key, and receivers trust that stamp. Payloads aren't signed again or encrypted end to end: the relay is ours. (End-to-end encryption is a possible later step; ECDH on the same keys.)
3. **A name on the relay is only a claim.** Anyone could connect saying "Alice". It's good enough for the search list, never for friendship.
4. **Friendship is confirmed by one in-game tell**, the only tell this feature ever sends. When Bob asks Alice:
   1. Bob's client sends the request over the relay to the key claiming "Alice", and at the same time one tell to Alice's character: `[Meridian Shards friend request <code> <fingerprint of Bob's key>]`.
   2. Alice's client hides that tell (it's never shown or put in a chat tab) and matches it with the relay request. The server says the tell came from Bob, and it names Bob's key, so Bob is proven.
   3. If Alice accepts, her client answers over the relay with the code. Only the real Alice saw the code, so Alice is proven to Bob.
   4. No matching tell within 30 s, or a mismatch: the request is dropped as a fake.
5. **Friends are remembered by name and key** per character, in `localStorage` (`shards.friends.<game socket url>.<character>`): name, key, the per-friend toggles (3.), when we last saw them. A friend connecting with a different key shows as "needs pairing again", not as the friend.

### 3. The Friends window

A stone window (`kit.tsx`), from the ☰ menu (Actions → Friends…) and a key in the Configuration window's Interface tab (unbound in the original preset). Three parts:

1. **Find:** a search box. The relay returns the online characters on this server whose names start with the text (at least 2 letters, up to 20 results). **Only players of this client are listed**, because only they announce themselves to the relay. "Add" sends the request (2.4).
2. **Requests:** incoming ones with Accept and Decline; our outgoing ones with Cancel. Requests live only while both are online (no mail-like queue).
3. **Friends:** each friend's name, online or not (from the relay; the server's online list as a check), and with Locate on, the room they're in (by name, from `rooms.json`). Per friend:
   - **Locate:** show which room they're in (the list, and a hint on the full map).
   - **Map marker:** their pin on the minimap and full map while they're in our room.
   - **Follow** (4.), only enabled while they're in our room.
   - **Remove:** tells them over the relay and forgets them; they forget us too. If they're offline, the next connection drops it.

   And for everyone:
   - **Share my location** (on by default): off, friends see us online but not where. Turning it off stops location messages at once.
   - **Show health bars over friends** (on by default) (6.).
   - **Show me in search** (on by default): off, we only reach people who already know us.

Location messages go only to friends, only while sharing is on: `{ room file, RID, row, col }` on every room change, and every 2 s while a friend in the same room has marker or follow on. Removing a friend or turning sharing off stops them.

### 4. Follow

1. **Start in the same room:** Follow is only offered while the friend's object is in our room (the server tells us). The friend is told "X is following you" and can turn it away (a "Stop them" button; also refuse follows in the friends window).
2. **In the room**, no relay needed: the friend's object and its smoothed motion are in `WorldState`. Every ~0.5 s, plan with `findPath` to a spot a square behind them and drive `PlayerMover` along it, at the speed they move (walk or run). Movement goes through `move.c`'s rules, so the server and others see ordinary walking.
3. **Across rooms:** the leader's client, when followed, sends each exit it takes: `{ from room, door row/col or edge side, to room }`. The follower queues them (breadcrumbs), walks to the door square and sends `BP_REQ_GO`, or walks off the edge, and carries on in the next room. If the message is late, the door nearest where the leader vanished (`roomexits.json`) is a fallback.
4. **Nav grids for any room:** only `ambientRooms.ts`'s rooms have prebuilt ones; others are built in the client a slice a frame (as `AmbientLife` does), and kept with `GameScene.navGrids`. Whether to prebuild every room in `npm run assets` is left open.
5. **Following stops** (with a line in the chat saying why) when:
   - the follower moves, turns or uses an exit themselves;
   - the follower is hit or casts;
   - the leader's room change wasn't through a known exit (teleport, portal, death, a Kod-scripted door), or the follower can't find a path;
   - the follower falls three rooms behind;
   - either goes offline, removes the other, or the leader stops them.
6. **No chains:** you can't follow someone who's following you (no loops). Someone who follows a follower is fine.
7. Following only ever goes toward a friend who agreed, and stops on danger; it isn't a bot. Cross-room pathing to a friend who isn't in our room (auto-path) is **not** part of this ADR.

### 5. Health bars over friends

1. Friends in the same room send their health as a percentage (rounded to a whole number; mana and vigor are never sent), on change, at most 4 a second, and every 5 s regardless. It's self-reported: a liar only fools their friends.
2. Drawn over the friend's sprite like names and speech bubbles (`gameScene.ts`, hidden by walls in front, scaled with distance): one thin health bar, the name in the friends colour. It also marks them as friends at a glance.
3. Hidden with the friends window's "Show health bars over friends".
4. Ours only; the bars mean nothing to other players and are never sent to the server.

### 6. Shared ambient life, for all players

Yes, and it doesn't need the relay beyond its clock (1.5): **the seed is a function of the room and the time**, so everyone with this client computes the same one without asking anyone.

1. **The seed:** a hash of the room file and the time slot (the relay's clock divided by the slot length, e.g. 10 minutes). Everyone in that room in that slot gets the same seed for `AmbientLife`, `Critters` and `Nature` (which moves from `Math.random` to `seededRandom`). Without the relay, seeds stay random as now.
2. **What that gives at once:** the same townsfolk with the same looks and the same plans (who walks to which door, which errands, the arena's lot and their bouts).
3. **Staying in step needs two more rules:**
   - **A fixed step** driven by the shared clock (e.g. 10 ticks a second, frames interpolating between them), not our frame `dt`. A client entering late catches up from the slot's start in coarse ticks, spread over a few frames; or, if that's too slow, the slot is shortened.
   - **The shared simulation never reacts to the local player.** Today walkers sidestep us, wave back, stare at fine armour, scatter from spells, and shop customers come near the player (`NEAR_PLAYER`). Those become presentation only: a temporary offset, turn or pose layered over the walker's shared state, relaxing back, so one player's reactions never change what another sees. The arena's "no other player in the room" rule (`AmbientFrame.others`) then has nobody to count: every player runs this client.
4. **What stays local:** squishing a critter (sent to friends in the room over the relay, so they see it too, and nobody else), speech bubble timing, and anything triggered by our own actions.
5. This is also what later shared games would build on (betting on arena bouts, critter races), since every client would agree on the outcome.

### 7. The order to build it

1. The relay (1.) and keys (2.), with tests: two headless clients pairing.
2. The Friends window (3.), search and pairing, location sharing and markers.
3. Follow (4.), in the room, then across rooms.
4. Health bars (5.).
5. Shared ambient life (6.), behind its own option at first, until two clients side by side agree.

## Consequences

- One more service on the VM (in the gateway's process), and a `/social` route in `deploy/web/Caddyfile`. The UE remaster could use the same relay later.
- The relay sees who's online with this client and where friends who share are. It keeps nothing on disk; that should be said in the friends window ("sent through the Meridian Shards server").
- Each friend request costs one tell through blakserv; nothing else does.
- Friendships are tied to a key in the browser's storage. Clearing it, or playing on a second device, means pairing again (as with mail). Syncing keys between devices is out of scope.
- Shared ambient life changes how `AmbientLife` steps and reacts; that's the biggest change to existing code here, and why it comes last.
- `AGENTS.md` and `docs/missing-features.md` need entries when each part lands.

## As built (2026-10-12)

Where the code is: the relay is `tools/gateway/relay.ts` (in the gateway's process, `/social`); the protocol, the relay client, the friends logic and the follow planner are `packages/world/src/social/` (`socialProtocol.ts`, `socialClient.ts`, `friends.ts`, `follow.ts`); the game side is `apps/client/src/game/social.ts` (`SocialLink`), `socialKeys.ts` (IndexedDB), `ui/FriendsPanel.tsx`, and the follow driving and friends' labels in `gameScene.ts`. `tools/headless/friend.ts` is a scripted friend for trying it alone.

Where it differs from the decisions above, or fills in what they left open:

- **Presence is mutual.** The relay tells a client a key is online only while both watch each other's keys, so watching someone's key (from the search list) says nothing until they've added you too. A friend removed while offline is told when next seen: the remover keeps watching that key until then.
- **In-room positions come from the server.** The map marker and following use the friend's object in `WorldState`, which the server already moves for us, so there's no 2-second location message (3); a location goes to friends on every room change and when a friend comes online.
- **"Needs pairing again"** (2.5): every 30 s the client asks the relay (`lookup`) whether a friend who's in the game but not online under their key is on it under another; the Friends tab then offers "Pair again".
- **Room numbers:** several rooms share a file (tos.roo is four), so the sender picks its RID by the room's name from `BP_PLAYER`, and the receiver names the room by that RID.
- **Exits** (4.3): the leader's client finds the door near its last square that leads to the new room, else an edge that does (`follow.ts exitTaken`); neither means a teleport or the like, and the follower stops. The follower walks onto the door's square (`BP_REQ_GO` needs it) and presses go every 1.2 s for up to 6 s.
- **Following stops** also when the follower uses an exit themselves, when the relay connection drops, and after a path can't be found for 3 s. The leader's "Stop them" and the window's "Refuse followers" are both there.
- **A tab, not a window** (3, changed 2026-10-12): Friends is a tab beside Inventory, Spells and the rest, in the Modern character window and the Classic and phone column; P, the menu's Friends… and the requests' notice open it. The page flows to fit the column: friends first, requests when there are any, then the search and the options.
- **A save** (`BP_INVALIDATE_DATA`, every half hour on our server) empties the room for a moment; the link and following carry on through it.

Shared ambient life (6), as the user scoped it on 2026-10-12: the fight in the arena must be the same for friends; the rest of the crowd may differ, and a late arrival needs syncing once, not keeping in step after.

- **The seed** (`packages/world/src/ambient/ambientStepper.ts`): a room's crowd is `{ seed, since, hour }`. Entering a room with ambient life, the client asks friends in the room which crowd they see (`ambient-ask`, answered by `ambient`, friends only, 1.5 s); with no answer it takes the room's for this 10-minute slot of the relay's clock (`slotSeed`, an FNV hash of the file and the slot), with `since` the slot's start and `hour` the game hour now. Without the relay (no clock in 2.5 s), a crowd of its own as before.
- **Ticks:** the crowd steps in fixed 50 ms ticks counted from `since` by the relay's clock (`AmbientStepper`), drawn between the last two ticks so it moves smoothly. A late arrival runs the ticks it missed a few ms a frame (about 70 ms of work for five minutes of the arena), showing nobody until it's done, then carries on alone.
- **The arena** (`spec.bouts`) is lockstep: every client gives its crowd the same inputs, with no player of ours to avoid or react to, no players as obstacles, the hour the crowd was made in, no weather, the usual size whatever the Ambient Life setting, and bouts that never pause for players (a friend's name can arrive a moment after their figure, which made one client pause and not the other). Waves and spells don't stir it. Two browsers in the arena, one there 30 s before the other, showed the same 27 figures on the same squares, mid-fight, and still did 30 s later.
- **Elsewhere** the seed is shared, so the same people set off on the same errands, but the crowd reacts to each player as before and drifts apart; nobody needs those to match.
- **Won't do** (decided 2026-10-12): only the human NPCs and the arena's fights are shared. Critters and nature keep each client's own random seeds (they spawn about each player anyway), and a squished critter isn't shown to friends; 6.1's seeds for `Critters` and `Nature` and 6.4's squish message are dropped.
