# ADR 0011: Fast travel

- **Status:** proposed, 2026-10-15. Not built. It uses [ADR 0009](0009-quests.md)'s channel and markers:
  - hidden spoken `#` commands from our client (changed by [ADR 0015](0015-social-on-our-server.md): `UC_SHARDS` lines, `travel <id>`);
  - `BP_USERCOMMAND` `UC_*` packets back, sent to everyone;
  - per-viewer minimap bits.

## Context

We want fast travel:
- **Portals:** one in every city, and in Brax and Castle Victoria.
- **Attuning:** a player attunes to a portal by touching it once. From then on they can travel from any portal to any other they've attuned to.
- **Markers:** a portal you haven't attuned to shows a quest marker.
- **The PvP lockout:** no travel for 2 minutes after you last attacked, or were attacked by, another player.
- **The historic towns:** whose rooms are still in the game. A separate network, from the Cor Noth Museum, takes players to them.

### What Server 104 already has

Paths below are under `kod/` in our `shards-server` fork. `object/active/holder/` is shortened to `holder/`, and `holder/nomoveon/battler/` to `battler/`.

**Portals:**
- `object/active/portal.kod` (`Portal`, `MOVEON_TELEPORTER`) sends whoever steps on it to `piDest_room/row/col`, through `UtilGoNearSquare`, with a dry run before the real move.
- **A portal you click: `CorpseNode is Portal`** (`object/active/portal/corpnode.kod`):
  - `OF_ACTIVATABLE`, registered with `SYS@AddNode`;
  - its `TryActivate(who)` checks the player is in the room and within 3 squares, and keeps a record per player.
- **Activating:** `User.UserTryActivate` calls `TryActivate`. If it returns FALSE, the player is also told `user_activate_failed`.

**Moving players:**
- `Room.Teleport` uses the room's `viTeleport_row/col`.
- `User.TeleportTo(RID)`.
- `UtilGoNearSquare` (`util.kod`) searches outward from a square. For a player it checks only `ReqNewHold`, not whether the square is walkable, so arrival squares are picked by hand.

**Teleport spells:**
- **Elusion** offers a fixed list of cities, chosen by saying the name.
- **Rescue** goes to the guild hall or an inn.
- **Death Rift** returns to a bound spot.
- **Their PvP rule:** Elusion and Rescue refuse a player who recently attacked another player (`GetLastPlayerAttackTime() + TeleportAttackDelaySec`, 120 s in `util/settings.kod`). Rescue also refuses token carriers.
- **Dead code:** `TeleportationSpell`'s `vbIsCombatRestricted` and its "attacked recently" messages.

**No "no teleport" room flag.** What stands in for one:
- `Room.CanHavePlayerPortal()`, FALSE for the historic towns, guild halls, rented rooms, survival rooms, the Underworld and a few more;
- and some rooms' `ReqSpellCast`, which turns away particular spells.

**PvP times are already kept** (`battler/player.kod`):
- **`piTimeAttackedPlayer`:** when this player last attacked one. It's set in `CheckStatusAndSafety`, from `AllowBattlerAttack`: melee, spells, and minions through their master.
- **`piTimeAttackedByPlayer`:** when one last attacked this player. It's set by `DoPvpNotify`, only from melee (`TryAttack`) and targeted harmful spells (`spell.kod`).
  - Minions' and area damage don't set it.
  - Neither is set where `AllowBattlerAttack` returns early: the arena, chaos night, guild halls, token holders and a few more.
- **`User.IsRecentPvPCombatant()`** checks both against 900 s.

**Lists per player:** `User.plCompletedPassiveQuestChains` keeps ints (`Cons`, `FindListElem`). A new property is saved with the rest.

**The towns:**

| Town | Room(s) | RID |
|---|---|---|
| Tos | `tos.roo` | 50 |
| Barloque | `barln.roo`, `barls.roo` | 101, 102 |
| Cor Noth | `cornoth.roo` | 150 |
| Marion | `marion.roo` | 200 |
| Raza | `raza.roo` | 300 |
| Jasper | `jaseast.roo`, `jaswest.roo` | 350, 382 |
| Ko'catan | `settle1.roo`, `settle2.roo` | 2000, 2009 |
| Bergen | `bergcity.roo` (`BergCity`) | 2800 |
| Brax | `necarea3.roo` (`Necropolis3`, "Decaying City of Brax") | 828 |
| Castle Victoria | `castle1.roo` (`CASTLE1`) | 38 |

**The historic towns are real rooms nobody can reach.**
- **The rooms:** `holder/room/monsroom/oldtown/`, all `OldTown is MonsterRoom` (`monsroom/oldtown.kod`), in the region `RID_HISTORIC`, created at startup (`util/system.kod`):

  | Room | File | RID |
  |---|---|---|
  | Historic Jasper | `ojas.roo` | 9000 |
  | Historic Marion | `omar.roo` | 9001 |
  | Historic North Barloque | `obarln.roo` | 9002 |
  | Historic South Barloque | `obarls.roo` | 9003 |
  | Historic Cor Noth | `ocornoth.roo` | 9004 |
  | The Historic Hall of Genealogy | `ocoruniv.roo` | 9005 |

  Their files are in the server's rooms and in our `dist/assets`.
- **No way in, and hardly a way out:**
  - Historic Jasper and Historic Marion have no exits;
  - the two Barloques link only to each other;
  - Historic Cor Noth has its Hall's door and locked doors.
- **Combat is allowed** in the four outdoor towns; only the Hall has `ROOM_NO_COMBAT`.
- **`CanHavePlayerPortal`** refuses them on purpose: "No portals into historic (i.e. inaccessible, dead) areas".

**The museum was meant to be the way in.** `CorNothMuseum` (`holder/room/crnthrm/cormuseum.kod`, RID 158, "The Meridian 59 Museum", `ROOM_NO_COMBAT`) has:
- a sign "Visit the historical Cities!", whose text stops after its heading;
- five `Create(&Portal, ...)` lines, commented out, with their destinations never filled in.

### What our client has

- **Teleports need nothing new:** a room change arrives as `BP_PLAYER`, and `gameScene.ts` handles teleports already (`syncRoom`).
- **A destination list** can follow `TradeDialog` (`ui/Dialogs.tsx`) in a `kit.tsx` stone window.
- **Room names:** `rooms.json` names every room, 9000-9005 too.
- **A small bug, fixed 2026-10-15:** the admin console's Travel tab (`ui/AdminConsole.tsx`) sent Castle Victoria to 40, the Antechamber; it now sends 38, the castle.

### The website

- **The historic towns have wiki pages** (`104:location:historic-*`), with maps and room pictures. They say "Open PvP", from the Kod.
- **The world map** doesn't show them.

## Decisions

The user decided these on 2026-10-15:
- **travel is free**: only the PvP lockout limits it;
- **portals** in Raza, Tos, Marion, Jasper, Barloque, Cor Noth, Ko'catan, Bergen, Brax and Castle Victoria;
- **no faction tokens**: a player carrying one can't travel, as with Elusion and Rescue;
- **the historic towns are museum tours**: the museum's portal goes to any of them with no attuning, each has a portal back to the museum, and they're sanctuaries, with no monsters and no combat;
- and, as for every ADR now, **only our client and our server** have to work.

### 1. The network (Kod)

1. **`TravelNetwork`**, a singleton reached with `SYS@GetTravelNetwork`, keeps a table of travel points. Each has:
   - an id that never changes, and a name;
   - its network, `main` or `historic`;
   - its room, its portal's square, and the arrival square and facing beside it.

   Each square is picked by hand, place by place (8), because `UtilGoNearSquare` doesn't check that a player can stand there.
2. **`TravelPortal is Portal`:**
   - it's clicked, not walked onto: `OF_ACTIVATABLE`, and no `plTeleportArea`;
   - it registers with the network;
   - each room creates its own in `CreateStandardObjects`;
   - it uses the existing portal art for now (9).
3. **The main network:** one portal each in Raza, Tos, Marion, Jasper, Barloque, Cor Noth, Ko'catan, Bergen, Brax (the Decaying City, 828) and Castle Victoria (38). Barloque, Jasper and Ko'catan each span two rooms; each gets one portal, in the room the city pass picks.
4. **Attunement is a list on `User`**, `plAttunedPortals`: travel-point ids, not objects, so rebuilding rooms doesn't lose it.

### 2. Using a portal

1. **Touching it** (activating, within 3 squares, as `CorpseNode`):
   - **Not attuned yet:** the player attunes to it ("You attune to the portal of Tos"), with a sound and a flash, and its marker goes (3).
   - **Attuned:** the server sends `UC_TRAVEL_LIST`: this portal, and the attuned points on its network, each as an id and a name.
2. **Choosing:** our client says `#travel <id>`, standing by a portal. The server checks everything again:
   - the player is by a portal of that network;
   - they're attuned to the destination (on the main network);
   - they aren't locked out by PvP (4);
   - they carry no faction token (`Token`, as Rescue checks);
   - they aren't dead, phased or in a trance.
3. **The journey:**
   - a dry run, then `UtilGoNearSquare` to the destination's arrival square, facing its way, with the portal's sound at both ends;
   - a follower ([ADR 0010](0010-followers.md)) goes too;
   - no fee and no cooldown.
4. **A refusal is one line**, from the portal:
   - "You fought another player too recently: N seconds left."
   - "The portal won't carry a faction token."
   - "You aren't attuned to that portal."

### 3. Markers

1. **Two new per-viewer minimap bits**, after 0009's:
   - `MM_TRAVEL` 0x40000: a travel portal;
   - `MM_TRAVEL_UNATTUNED` 0x80000: one this player hasn't attuned to.

   `User.BuildMinimapDotFlag` gains a branch for travel portals, which asks the portal `IsAttunedBy(self)`. Today only monsters and players get per-viewer bits.
2. **Our client:**
   - an un-attuned portal gets 0009's gold "!" over it and on the minimap;
   - an attuned one gets a small portal sign on the minimap only;
   - the drawing is shared with 0009's markers, whichever is built first.
3. **Attuning re-sends the portal** to that player (`SomethingChanged`), so the "!" goes at once.

### 4. The PvP lockout

1. **One test:** `Player.IsInPvP()` is TRUE for `TeleportAttackDelaySec` (120 s, already a setting) after either `piTimeAttackedPlayer` or `piTimeAttackedByPlayer`. There's no new flag: the two times are the state.
2. **The gaps are filled,** so being attacked always counts.
   - **What counts:** any harm one player does another, whether by melee, any harmful spell (area spells and room enchantments too), their minions or their follower (ADR 0010). It sets both players' times.
   - **Where:** in one place on the damage and harmful-effect path, so both are set even where `CheckStatusAndSafety` returns early.
   - **The exception:** Kod's arena rooms (`IsArena`), which are by consent and closed off.
   - *To check*: which paths area damage and room enchantments take to players.
3. **Elusion and Rescue** use `IsInPvP` too, so being attacked locks them out as well as attacking. A small change in how they behave.
4. **Our client** gets `UC_PVP_UNTIL <time>` when the lockout starts or is extended, and shows crossed swords with a countdown by the minimap.

### 5. The historic towns, from the Cor Noth Museum

1. **One `TravelPortal` in the museum,** on the `historic` network, where the commented-out portals were.
   - It lists all six historic rooms, with no attuning and no marker for them.
   - The commented-out `Create(&Portal, ...)` lines go.
   - The sign's text is finished, for example: "Touch the portal to visit the cities as they once were."
2. **A portal back in each historic town,** to the museum only. The two Barloques, and Historic Cor Noth and its Hall, keep their links to each other.
3. **Sanctuaries:**
   - `OldTown` gains `ROOM_NO_COMBAT` and `ROOM_SAFELOGOFF`, and stays without monsters;
   - no exits to the living world. *To check*: that `OldCorNoth`'s exits to `RID_G4`, `RID_G5` and `RID_COR_INN` stay closed;
   - someone who logs off inside comes back there, and can always leave by its portal.
4. **`CanHavePlayerPortal` stays FALSE** there, so Death Rift and the like still can't open into them. Only the travel portals lead in.
5. **The same rules:** the PvP lockout and the token rule apply in the museum too, so it's no escape route.

### 6. Our client

1. **A Travel window** (a `kit.tsx` stone window, like `TradeDialog`), opened by `UC_TRAVEL_LIST`:
   - the destinations by name, with this one marked, Travel and Cancel;
   - greyed out, with the seconds left, while `UC_PVP_UNTIL` is ahead;
   - it closes if the player walks away from the portal.
2. ~~**The `#travel` lines are hidden** through `lineFilter` (the chain from 0009).~~ `travel` goes as a `UC_SHARDS` line (ADR 0015): nothing to hide.

### 7. The website

- **A Fast travel page** on the wiki once it's built: the network, and how to attune.
- **The historic towns' pages** show them as sanctuaries, once the Kod is imported again.
- **The world map** marks the portals.
- Nothing is written before it's built (that repo's rule on honest copy).

### 8. The order to build it

1. `Player.IsInPvP`, the filled gaps, and Elusion and Rescue moved onto it.
2. `TravelNetwork`, `TravelPortal`, `plAttunedPortals`, attuning and `#travel`, tried between Tos and Marion with typed commands.
3. `UC_TRAVEL_LIST` and the Travel window; `UC_PVP_UNTIL` and the crossed swords.
4. The marker bits, and our client's "!" and portal sign.
5. The city pass: each portal's square and arrival square, Brax and Castle Victoria too.
6. The museum: its portal, the portals back, `OldTown`'s sanctuary flags, and the sign.
7. The website.

### 9. Left to settle when it's built

- Each portal's square, arrival square and facing (8.5).
- Which room in Barloque, Jasper and Ko'catan (1.3).
- The portal's art: the existing portal, or new (1.2).
- Whether Raza's museum (RID 308) gets a historic portal too.

## Consequences

- **Elusion matters less.** Accepted: it still works from anywhere, not just at a portal.
- **Saves change** (a new `User` property), so it's tried on a copy first ([ADR 0008](0008-player-homes.md) 3.3).
- **PvP locks out more:** counting every attack on a player means more players can't use Elusion and Rescue for 2 minutes. That's intended.
- **The historic towns can be visited**, for the first time on our server, as sanctuaries.
- **The commands are a protocol:** `#travel`, `UC_TRAVEL_LIST` and `UC_PVP_UNTIL` change in our client and our Kod together.
- **Docs to update** as each part lands:
  - `AGENTS.md` and `docs/missing-features.md`
  - `docs/admin-console.md` (attuning a player, listing the network)
  - `docs/research/protocol.md`
  - the website's wiki
