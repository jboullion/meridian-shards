# ADR 0029: Monster pathfinding (A* on the server, one nav grid for everyone)

- Status: accepted (2026-10-30). Steps 1-5 built on the `monster-pathfinding` branch of both repos; see "As built".
- Builds on: the faction war's battles and seat assaults ([ADR 0021](0021-factions-and-the-faction-war.md) decisions 13 and 18), and the client's nav grid (`packages/world/src/navGrid.ts`; [ADR 0005](0005-friends.md), [ADR 0006](0006-pets.md), [ADR 0020](0020-ai-playtester.md)).

## Context

Monsters on the server don't plan a route. Watching the first seat assault at the Bourgeois Castle (2026-10-30), the Duke's soldiers couldn't find their way across the bridge to the Princess's guard, so the armies' starting squares had to be moved to make it a fight.

### How a monster moves today

Blakod picks what to do, and the server picks the step:

- **Blakod** (`shards-server` `kod/object/active/holder/nomoveon/battler/monster.kod`, `kod/object/passive/brain.kod`):
  - Each state has its own Kod timer (`MoveTimer`, `ChaseTimer`, `AttackTimer`), about `10000 / (viSpeed × 4)` ms a step (`GetMoveTime`). Troops and companions at speed 18 step about every 134 ms. There is no server tick: blakserv fires timers one at a time from a heap (`timer.c` `ServiceTimers`).
  - The brain calls `DoRandomWalk`, `MoveTowards`, `MoveAway`, `MoveToMaster`, `DoGoTowardsLocation` or a patrol's `GotoCoords`.
  - **One door to the step:** `Monster.MoveTowardsCoords` is the only Kod caller of the builtin `GetStepTowardsBSP`, and every mover but two reaches it:
    - chasing (`MoveTowards`), the main case, battle troops and arena fighters included;
    - following a master (`MoveToMaster`): companions, animated and seduced monsters, reflections, the dragonfly brood, the evil twin;
    - going to a point (`DoGoTowardsLocation`) and patrols (`GotoCoords`);
    - fleeing and keeping range (`MoveAway`), which aims at a mirrored point.
  - The two that don't: `DoRandomWalk` (a random short step, checked by `Room.ReqSomethingMoved`), and the town wanderers, which teleport between rooms.
- **The step** (`blakserv/roofile.c` `BSPGetStepTowards`):
  1. Aims straight at the target, 16 fine units (a sixteenth of a square). If `BSPCanMoveInRoom` allows it, takes it.
  2. Blocked, it picks a side (by the wall's angle, or at random against an object) and turns 22.5° at a time, up to 135°, then tries the other side.
  3. If every try fails, it stays put.
  - The only memory between steps is two bits in the monster's `piState`: whether it's dodging, and which way.
- **Monsters only move in rooms with players.** When the last player leaves, a room's monsters stop (`Brain.LastUserLeft`) unless they have `AI_MOVE_WHEN_ALONE`.

### Why monsters get stuck

- **Greedy steps:** every tick aims straight at the target again, so a step that slid along a wall is undone by the next one.
- **No knowledge of the room:** a doorway off to one side, a U-shaped wall, a bridge over water or a corridor that doubles back leaves a monster pinned or swaying.
- **No pathfinding anywhere on the server:** blakserv has BSP geometry (line of sight, move checks, heights, blockers) but no search. Nothing in Kod searches either.

### What we already have, in the client

`packages/world/src/navGrid.ts` is a complete A*:

- **Cells:** half a square (`NAV_CELL`), walkable where the floor is dry, there's headroom and it's clear of walls (`CELL_CLEARANCE`, 280). Which walls block copies the original client's `move.c` (step height, ceiling, passable).
- **Links:** 8-way, kept where the floors are within a step and the way between is clear. Diagonals need both sides.
- **Areas:** connected areas, flood-filled, numbered largest first.
- **Search:** `findCells` is A* (binary heap, octile distance, a visit cap). `findPath` snaps both ends to the same area, searches, and pulls the path tight with line checks.
- **Who uses it, and where they run:**

  | User | Runs in | Does the server see it? |
  |---|---|---|
  | Ambient townsfolk, inn patrons, courtiers | each client, deterministic from a shared seed (`UC_AMBIENT`) | no |
  | Critters | each client (walls only, no A*) | no |
  | Pets | each client, from the owner's position | no |
  | Arena fights | the gateway (`tools/gateway/arena.ts`), or the client's fallback | no |
  | Friends' Follow | the client, steering the real player through `PlayerMover` | as ordinary moves |
  | The AI playtester | `tools/agent`, stepping the real player with no `move.c` | as ordinary moves |

- **Where the grids come from:** 79 town rooms have grids built ahead of time (`nav/<room>.nav`, by `tools/assets/build-assets.ts`); the rest are built in the client a slice per frame.

It's proven, but it's the client's idea of where one can walk, not the server's. ADR 0020 reports server snap-backs from it, and ADR 0011 found it marked Tos's open street as closed. The rules are close: the server's move check (`BSPCanMoveInRoomTreeInternal`) has the same step height, headroom and passable tests, but it's a line test with no clearance, and it knows deep water only by sector depth.

## Decision

Pathfinding goes in **blakserv, in C, as a builtin**. Kod uses it only when the straight step would fail. The grid it searches is also **the one grid the client uses**: the server exports it as `.nav` files, and the client's own grid builder is deleted.

The client-side movers (townsfolk, critters, pets, arena fights, Follow, the playtester) **keep running where they run**, with the client's A*. Moving their pathing onto the server would cost CPU and traffic for things the server never sees, and would break the shared, deterministic crowd. What they needed from the server was the map, not the search.

### 1. The grid: built by the server, from the server's own move rule

- **When:** the first time a path is asked for in a room, or when the grids are exported (section 5).
- **Where it's kept:** on the room's `room_node` (`roomdata.h`), freed with it (`UnloadRoom`, `ResetRooms`).
  - Each loaded room object has its own geometry: `LoadRoom` makes a new `room_node` every time, so dynamic copies (survival rooms) get their own grid. Grids are never shared by resource, since a copy's sectors may have moved.
- **Cells:** half a square, as the client's. A large room (64 × 64 squares) is 128 × 128 cells: a byte of links and a byte of flags each, about 32 KB.
- **A cell is walkable** when:
  - `BSPGetLocationInfo` finds a floor there with headroom (`OBJECTHEIGHTROO`);
  - no wall that blocks is within the clearance (`CELL_CLEARANCE`, 280 fine ROO units, as the client's), so paths keep off walls and the same grid serves monsters and townsfolk.
- **A cell's flags:** deep water (the sector has depth). The server's monsters may cross it; the client treats it as closed.
- **A link exists** between neighbouring cells only when `BSPCanMoveInRoomTree` (walls only, not blockers) allows the step between their centres. Paths can then never lead where the server would refuse the step. That is the mismatch the client's grid has.
  - `BSPCanMoveInRoomTree` needs a prototype in `roofile.h`; `BSPCanMoveInRoom` adds the blockers and isn't what the grid wants.
- **Diagonals** need both side links, as the client's.
- **Areas** are labelled once, as the client's, so a search between two areas fails at once instead of searching the whole room.
- **Objects that block** (`BSPBlocker*`) aren't in the grid; the step itself still checks them. A monster blocked by another steps around it with today's dodge.
- **Rooms that change shape:** `BSPMoveSector` (doors, lifts, moving floors) and `BSPChangeTexture` (the move rule checks whether a side's upper and lower textures are set) mark the grid stale, and it's rebuilt on the next request.
- **Building cost:** about 16,000 cells × 8 move checks for a large room, built once. If that's too slow on the VM, it's built a slice of rows per request, falling back to the straight step until it's done.

### 2. The search: a new builtin

`GetPathStepBSP(room, from row/col/fine, to row/col/fine, *row, *col, *finerow, *finecol, monster)` sets the next point to walk to: the farthest point on the path that can be reached in a straight line. If there's no path, it returns `$`. Its outputs are written back the way `GetStepTowardsBSP`'s are.

- **A\*** as the client's `findCells`: a binary heap, the octile heuristic, a visit cap (a few thousand cells), and both ends snapped to the nearest walkable cell in the same area.
- **Smoothing** as the client's `findPath`: the returned point is pulled as far ahead as `BSPLineOfSight` and the move checks allow, so monsters walk lines, not zigzags.
- **Registering it:** as number 81, beside `GetStepTowardsBSP` (80) in every place that knows the builtins:
  - its number in `include/bkod.h`;
  - the compiler's list, `blakcomp/function.c`, so Blakod can call it;
  - the server's `blakserv/ccode.c` and `ccode.h`, and its slot in `sendmsg.c`'s `ccall_table`;
  - the decompiler's name, `blakdeco/blakdeco.c`;
  - the `show calls` names in `adminfn.c`, and `doc/kodccalls.md`.

  It's the first new C builtin in a while, and needs the compiler and the server rebuilt (README).

### 3. Kod: the path only where the straight step fails

In `Monster.MoveTowardsCoords`, so every mover that goes through it can use it:

1. **Direct first:** if the way to the target is clear (`Room.CanWalkLine`, walls and blockers) and today's step succeeds, take it as now. Most monsters in open ground never search.
2. **Otherwise, follow a path:** ask `GetPathStepBSP` for a waypoint and step toward it with today's `GetStepTowardsBSP`.
   - The waypoint is kept on the monster (`plPathWaypoint`, `piPathAt`) and reused until it's reached, the target has moved more than `PATH_REPLAN_SQUARES` (3) from where it was planned to, or `PATH_REPLAN_SECONDS` (2) have passed.
3. **No path:** the target is unreachable (across water, behind a wall with no way round). Today's dodge, and the brain's existing give-up rules (losing interest, going back to wandering) decide.

**What uses it, in order:**
1. **Battle troops** (`FactionTroop` in a battle: `FactionWar.PickTarget` and `KeepTargets`). These are what started this.
2. **Everything else through `MoveTowardsCoords`:** every chasing monster, arena fighters, companions and minions following a master (they lose their master at corners today), patrols and monsters going to a point.
3. **Later:** fleeing and keeping range (`MoveAway`, `AI_MOVE_OPTIMAL_RANGE`), toward a cell found on the grid away from the threat, not a mirrored vector.

### 4. Limits, so a battle can't stall the server

There's no tick to count in, so the budget is over time:

- **A budget per window:** at most `PATH_SEARCHES_PER_WINDOW` searches (start at 8) per 100 ms, counted in C with `GetMilliCount`, and a visit cap per search. A monster refused a search takes today's straight step and asks again on its next step.
- **Staggered re-plans:** each monster's re-plan time is offset by its object id, so 25 troops don't all re-plan on the same step.
- **A cache:** the last few searches per room are kept, keyed by from-cell and to-cell, so troops chasing the same captain share a result.
- **Only rooms with players** pay at all, since monsters elsewhere don't move.
- **Watching it:** the builtin's time shows in `show calls` (`ccall_total_time`) like every other.

### 5. The client's grid comes from the server

- **Export:** a maintenance command, `save navgrids`, builds the grid of every room the server has loaded (once per `.roo`) and writes `run/server/nav/<room>.nav`.
- **Format:** `NAV_FORMAT` 3, the client's v2 plus a flags byte per cell: "NAVG", the version, the room's checksum (`room.security`), cols, rows, the walkable bitset, a byte of links per cell, a byte of flags per cell.
- **Assets:** `build-assets` copies every exported `.nav` (every room, not only the 79 town rooms), checking each checksum against the `.roo` it ships.
- **The client's builder goes:** `navGridBuilder` and `buildNavGrid`, and the per-frame building in the ambient life, Follow, the arena's fallback and the playtester. The client keeps `findCells`, `findPath`, `nearestCell`, `randomCell`, `navWalls` and `walkable`.
- **Client-only preferences stay overlays** on the grid's `closed` cells, set when it's loaded: deep water, shallow water textures, and objects that block (`MOVEON_NO`).
- **A room with no `.nav`** has no grid: pets walk straight, Follow stops, and the playtester reports it.
- **Whenever the grid's rules change**, the files are exported again from the server (and `NAV_FORMAT` bumped if the layout changes).

### 6. Aggro and the leash (added 2026-10-30, tried and reverted the same day)

**Reverted:** played by the user, the monsters were less fun than the original's, so they act as they always did: the old aggro, the old give-up at vision + 5 squares, the chaser penalty, no leash, and the straight step alone. Pathing is for NPCs only (`MONSTER_PATHING_NPCS`, the default: battle troops and companions, `Monster.IsPathingNPC`). What follows is kept as the record of what was tried.

Watching an ant stuck behind a corner in the Flatlands showed where most stuck monsters come from: a monster took a player as its target when they moved anywhere within its vision (10 squares), measured through walls, so monsters on the far side of a wall gave chase. And with pathing, a monster that never loses its way never gives up either: a player could pull a whole room and drag it about. So, in the style of today's games:

- **Aggro:** a monster notices a player moving about only within `Settings.piAggroRadius` squares (6) and in its sight (`Monster.NoticesPasserby`, in `Brain.AttemptTargetSwitch` for `TS_MOVE`). Anyone may pull every monster in a room by running past them. Being struck still turns a monster on its attacker, seen or not.
- **The leash:** a chase begins where the monster stands when it takes a target. It ends when the monster is more than `piLeashSquares` (50; 20 in the first try was too short) from there, or hasn't seen its target for `piLeashLostSeconds` (6); sight is looked at once a second (`Monster.LeashBreaks`, from `Brain.GetChaseBehavior`). The monster then heals, walks back, and notices nobody for 10 seconds (`Monster.Evade`). This also bounds what pathing costs.
- **Monsters chase together:** the old rule that took each monster already chasing a player off every other monster's hatred (`Brain.piChaser_factor`) is gone, and so is the old give-up at vision + 5 squares for monsters on the leash.
- **Not for** battle troops, arena fighters or anyone's minion (`Monster.UsesLeash`): they're told their targets and keep the old rules.
- **Pathing for every monster** (`MONSTER_PATHING_ALL`, now the default): with the leash, pulls end, and a crowd chasing one running player shares searches: a kept search serves any goal within `NAV_GOAL_SHARE` (2) cells of its own.

### What stays as it is

- **Where the client-side movers run:** each client, the gateway and the playtester keep simulating their own. Only their map changes.
- **Walk-through-walls monsters** (`AI_MOVE_WALKTHROUGH_WALLS`) and anything with `MSTATE_MOVE_OUTSIDE_BSP` keep today's step, since walls don't stop them.
- **Random walking** (`DoRandomWalk`) and the town wanderers' teleports.
- **Line of sight for targeting and spells:** unchanged.

## Consequences

- **Monsters find their way:** round walls, through doorways, over bridges. Battles at seats and fronts become fights instead of crowds at a wall, so the seats' starting squares could go back to the natural places: the castle door for attackers, the liege's door for defenders. Companions keep up with their masters.
- **Harder monsters:** a monster that used to be shaken off behind a wall now follows. Some fights get harder, and kiting monsters around corners stops working. Monsters that should stay easy can be left on the direct step with a behaviour flag (`AI_NO_PATHING`).
- **One map:** townsfolk, pets, Follow and the playtester walk where the server's move rule says one can walk, so the playtester's snap-backs and the closed Tos street should go. Every room gets a grid, not just 79, and the client stops building grids at run time.
- **A build step:** the nav files now come from a running server (`save navgrids`), so a change to rooms or to the rule needs a re-export before the asset build.
- **Server cost:** memory for the grids of rooms with monsters in them (about 32 KB for a large room), and CPU for searches, bounded by the budget. This needs watching on the e2-micro VM, where a 100-player load test already runs close to the limit (2026-10-24).
- **Server change:** the first change to blakserv's C in a while, so it needs a full rebuild and a new server binary in the deploy. The release is not just Kod.

## Building it

1. **The grid in C**, with `show navgrid <roomdata>` to print a room's grid as text, and `save navgrids` to export them all.
2. **Compare** the exported grids with the client's for the 79 town rooms, then look at Tos's street and the Bourgeois Castle's bridge. Differences should only be where the clearance and water rules differ.
3. **The client on the exported grids:** `NAV_FORMAT` 3, `build-assets` from the export, the overlays, and the client's builder deleted.
4. **The search builtin**, with `show path <roomdata> row col row col` to print a path.
5. **Kod: battle troops only**, behind a setting (`Settings.pbMonsterPathing`), so it can be turned off on the live server.
6. **Try it:**
   - **The Bourgeois Castle:** put the Duke's attackers back at the castle door, then across the bridge, and watch them reach the guard.
   - **The other seats:** the Courtyard of Blackstone Keep and the Temple of Kraanan.
   - **Elsewhere:** a front in the open lands.
   - **The cost:** with the playtester and a 25-troop battle, how long searches take.
7. **Everything through `MoveTowardsCoords`**, then fleeing.
8. **Record it:** this ADR's "As built", and ADR 0021 for the seats' squares.

## As built

On the `monster-pathfinding` branches (2026-10-30). Steps 1 to 5 of "Building it" are built; 6 is tried headlessly only; 7 and 8 are still to do.

**Where it differs from the decision above:**
- **The grid hangs off `room_type`** (`roofile.h` `Nav`), not `room_node`: `BSPMoveSector`, `BSPChangeTexture` and `BSPFreeRoom` all take a `room_type`. `BSPChangeTexture` drops it only when a side's upper or lower texture comes or goes.
- **The clearance is the move check's own.** The step check already refuses a step ending within `WALLMINDISTANCE` (248) of a wall that blocks, so a cell is open when eight short steps out from its centre (32 units each, to make 280) pass. A first try with 280-unit rays came out about 528 clear.
- **Links are walked in 128-unit sub-steps** through `BSPCanMoveInRoomTree` (`NavCanWalkLine`), since a monster's real steps check the clearance at every step's end.
- **The search is one per goal, not per pair:** a Dijkstra out from the goal cell over the reversed links gives every cell its next step toward it (`NavSearchField`). A room keeps four, by goal cell, for a second (`NAV_FIELDS`, `NAV_FIELD_MS`), so troops chasing one foe share one search. No visit cap: a search is bounded by the room (13,000 open cells in the Bourgeois Castle: about 3-4 ms in the debug build).
- **A straight line is answered first**, before the grid or the budget: `GetPathStepBSP` returns the goal itself when `NavCanWalkLine` reaches it, so Kod needs no separate direct check.
- **The budget:** 8 searches per 100 ms over all rooms (`NAV_SEARCHES`, `NAV_WINDOW_MS`). `GetPathStepBSP` returns `FALSE` past it (step straight, ask again next step) and `$` when there's no way.
- **Kod** (`Monster.MoveTowardsCoords`): the plan is kept in `poPathRoom`, `piPathAt`, `piPathRow/Col/FineRow/FineCol`, `piPathGoalRow/Col` and `pbPathDirect`, and dropped after 2 to 3 s (`PATH_REPLAN_MS` plus a random half, which staggers a crowd), when its goal moves 3 squares, the room changes, the waypoint is reached (`PATH_REACHED`, 24 fine units) or a step fails. `Monster.UsesPathing` asks `Settings.piMonsterPathing` (`MONSTER_PATHING_OFF`, `_BATTLES`, `_ALL`; `_BATTLES` to start) and skips `AI_MOVE_WALKTHROUGH_WALLS` and the new `AI_NO_PATHING`. `FactionTroop.IsBattleTroop` is true in an army.
- **The export reads every room file** (`PATH_ROOMS` `*.roo`), not the loaded rooms: 359 rooms in 11.5 s. `build-assets` copies them from `run/server/nav` and warns about rooms the server has with none current.

**Maintenance commands:** `show navgrid <roomdata>` (the grid as text, with counts and its build time), `show path <roomdata> <row> <col> <to row> <to col>` (the waypoints, ignoring the budget), `save navgrids`. Room data ids change between boots: look them up with `show roomtable`.

**Compared with the client's grids** (the 79 town rooms, before the client's builder went): the client's walkable cells were all but 108 of 250,000 a subset of the server's. The server allows about 3.5% more, in two places: the tops of ledges (the client kept off any wall that blocks from either side, the server only off one that blocks from where the monster stands, so it may stand at an edge and step down), and cells right at the 248-280 boundary. Painted water is the client's overlay, as decided.

**Tried** (testbench sandbox, no players, 2026-10-30):
- `show path` across the Bourgeois Castle (`castle2b`) from the attackers' square (28, 9), the room's south edge (61, 47) and its north-west (6, 5) to the defenders' (29, 51): 6, 11 and 9 waypoints, round the walls.
- A troll with `AI_MOVE_WHEN_ALONE` sent from (28, 9) to (29, 51) with `GotoCoords`: with pathing off it stuck at (33, 33) for 50 s; with `MONSTER_PATHING_ALL` it reached (30, 50) in 37 s. Nothing in `error.txt`.
- The client: all 685 tests pass on the exported grids, `ambient.test.ts`'s `PlayerMover` walks along Tos's paths among them; typecheck and lint clean.

**Aggro and the leash** (decision 6, built 2026-10-30 on the same branches):
- Also fixed: the first waypoint is never within `PATH_REACHED` of the monster (`NAV_MIN_STEP`). An ant at a Flatlands corner was given its own cell's middle, "reached" it at once and never moved.
- Also fixed: `GetPathStepBSP` now answers a straight line before building the grid or searching, as section 2 said; before, every plan searched.
- Tried headlessly: the ant from that corner reaches the player's square in 9 s; paths across the Bourgeois Castle unchanged. Aggro and the leash need a player: not yet tried in play.

**Not yet tried:**
- A seat assault with players and both armies, its cost in `show calls` and on the e2-micro VM, and with the playtester (fewer snap-backs?).
- The seats' squares back at their natural places (decision 18 of ADR 0021): which squares is the user's call; the castle's entrances now have paths to the guard.
- `MONSTER_PATHING_ALL` in ordinary play, and fleeing (step 7).
- The live server needs a blakserv built from this branch and a fresh `save navgrids` for the asset build.

**Traps found:** blakserv's makefile has no header dependencies (a grown `room_type` corrupted memory until `blakserv/debug/*.obj` were deleted), and adding properties to `Monster` needs every subclass recompiled (a full Kod build). Both are in shards-server's AGENTS.md (the second was already a known Kod rule).
