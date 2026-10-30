# ADR 0029: Monster pathfinding (A* on the server)

- Status: proposed (2026-10-30). Not built.
- Builds on: the faction war's battles and seat assaults ([ADR 0021](0021-factions-and-the-faction-war.md) decisions 13 and 18), and the client's nav grid (`packages/world/src/navGrid.ts`; [ADR 0005](0005-friends.md), [ADR 0006](0006-pets.md), [ADR 0020](0020-ai-playtester.md)).

## Context

Monsters on the server don't plan a route. Watching the first seat assault at the Bourgeois Castle (2026-10-30), the Duke's soldiers couldn't find their way across the bridge to the Princess's guard, so the armies' starting squares had to be moved to make it a fight.

### How a monster moves today

Blakod picks what to do, and the server picks the step:

- **Blakod** (`shards-server` `kod/object/active/holder/nomoveon/battler/monster.kod`, `kod/object/passive/brain.kod`):
  - Each state has a timer (`MoveTimer`, `ChaseTimer`, ...), about `10000 / (viSpeed × 4)` ms a step (`GetMoveTime`).
  - The brain (`GetMoveBehavior`, `GetChaseBehavior`) calls `DoRandomWalk`, `MoveTowards`, `MoveAway` or `MoveToMaster`.
  - `MoveTowards` and `MoveAway` both end in `MoveTowardsCoords`, which calls the builtin `GetStepTowardsBSP` and moves the monster to the step it returns (`Room.SomethingMoved`).
- **The step** (`blakserv/roofile.c` `BSPGetStepTowards`):
  1. Aims straight at the target, 16 fine units (a sixteenth of a square). If `BSPCanMoveInRoom` allows it, takes it.
  2. Blocked, it picks a side (by the wall's angle, or at random against an object) and turns 22.5° at a time, up to 135°, then tries the other side.
  3. If every try fails, it stays put.
  - The only memory between steps is two bits in the monster's `piState`: whether it's dodging, and which way.

### Why monsters get stuck

- **Greedy steps:** every tick aims straight at the target again, so a step that slid along a wall is undone by the next one.
- **No knowledge of the room:** a doorway off to one side, a U-shaped wall, a bridge over water or a corridor that doubles back leaves a monster pinned or swaying.
- **No pathfinding anywhere on the server:** blakserv has BSP geometry (line of sight, move checks, heights, blockers) but no search. Nothing in Kod searches either.

### What we already have, in the client

`packages/world/src/navGrid.ts` is a complete A*:

- **Cells:** half a square (`NAV_CELL`), walkable where the floor is dry, there's headroom and it's clear of walls. Which walls block copies the original client's `move.c` (step height, ceiling, passable).
- **Links:** 8-way, kept where the floors are within a step and the way between is clear. Diagonals need both sides.
- **Areas:** connected areas, flood-filled, numbered largest first.
- **Search:** `findCells` is A* (binary heap, octile distance, a visit cap). `findPath` snaps both ends to the same area, searches, and pulls the path tight with line checks.
- **Who uses it:** the ambient townsfolk, pets and friends, and the AI playtester. 79 town rooms have grids built ahead of time (`nav/<room>.nav`); the rest are built in the client a slice per frame.

It's proven, but it's the client's idea of where one can walk, not the server's. ADR 0020 reports server snap-backs from it, and ADR 0011 found it marked Tos's open street as closed.

## Decision

Pathfinding goes in **blakserv, in C, as a builtin**. Kod uses it only when the straight step would fail.

### 1. The grid: built by the server, from the server's own move rule

- **When:** the first time a monster in a room asks for a path. It is kept with the room's data (`roomdata.c`) and freed with it (`BSPFreeRoom`).
- **Cells:** half a square, as the client's. A large room (64 × 64 squares) is 128 × 128 cells: a byte of links each, about 16 KB.
- **A cell is walkable** when `BSPGetLocationInfo` finds a floor there with headroom for a monster (`OBJECTHEIGHTROO`).
- **A link exists** between neighbouring cells only when `BSPCanMoveInRoomTree` (walls only, not blockers) allows the step between their centres. Paths can then never lead where the server would refuse the step. That is the mismatch the client's grid has.
- **Diagonals** need both side links, as the client's.
- **Areas** are labelled once, as the client's, so a search between two areas fails at once instead of searching the whole room.
- **Objects that block** (`BSPBlocker*`) aren't in the grid; the step itself still checks them. A monster blocked by another steps around it with today's dodge.
- **Rooms that change shape** (`BSPMoveSector`: doors, lifts, moving floors): the grid is marked stale and rebuilt on the next request.
- **Building cost:** about 16,000 cells × 8 move checks for a large room, built once. If that's too slow on the VM, it's built a slice of rows per request, falling back to the straight step until it's done.

### 2. The search: a new builtin

`C_GetPathStepBSP(room, from row/col/fine, to row/col/fine, monster)` returns the next point to walk to: the farthest point on the path that can be reached in a straight line. If there's no path, it returns `$`.

- **A\*** as the client's `findCells`: a binary heap, the octile heuristic, a visit cap (a few thousand cells), and both ends snapped to the nearest walkable cell in the same area.
- **Smoothing** as the client's `findPath`: the returned point is pulled as far ahead as `BSPLineOfSight` and the move checks allow, so monsters walk lines, not zigzags.
- **Registering it:** beside `GetStepTowardsBSP` in every place that knows the builtins:
  - its number in `include/bkod.h`;
  - the compiler's list, `blakcomp/function.c`, so Blakod can call it;
  - the server's `blakserv/ccode.c` and `ccode.h`, and its dispatch in `sendmsg.c`;
  - the decompiler's name, `blakdeco/blakdeco.c`;
  - the admin listing in `adminfn.c`, if `GetStepTowardsBSP` is there.

  It's the first new C builtin in a while, and needs the compiler and the server rebuilt (README).

### 3. Kod: the path only where the straight step fails

In `Monster.MoveTowardsCoords`:

1. **Direct first:** if the target is in line of sight (`Room.LineOfSight`) and today's step succeeds, take it as now. Most monsters in open ground never search.
2. **Otherwise, follow a path:** ask `GetPathStepBSP` for a waypoint and step toward it with today's `GetStepTowardsBSP`.
   - The waypoint is kept on the monster (`plPathWaypoint`, `piPathAt`) and reused until it's reached, the target has moved more than `PATH_REPLAN_SQUARES` (3) from where it was planned to, or `PATH_REPLAN_SECONDS` (2) have passed.
3. **No path:** the target is unreachable (across water, behind a wall with no way round). Today's dodge, and the brain's existing give-up rules (losing interest, going back to wandering) decide.

**What uses it, in order:**
1. **Battle troops** (`FactionTroop` in a battle: `FactionWar.PickTarget` and `KeepTargets`). These are what started this.
2. **Every chasing monster** (`ChaseTimer` → `MoveTowards`).
3. **Later:** fleeing (`MoveAway`, toward a point found on the grid, not a mirrored vector), keeping range (`AI_MOVE_OPTIMAL_RANGE`), companions following (`MoveToMaster`) and the ambient wanderers.

### 4. Limits, so a battle can't stall the server

- **A budget per tick:** at most `PATH_SEARCHES_PER_TICK` searches (start at 8) and a visit cap per search. A monster refused a search this tick takes today's straight step and asks again next tick.
- **Staggered re-plans:** each monster's re-plan time is offset by its object id, so 25 troops don't all re-plan on the same tick.
- **A cache:** the last few searches per room are kept, keyed by from-cell and to-cell, so troops chasing the same captain share a result.

### What stays as it is

- **The client's nav grid:** townsfolk, pets and the playtester keep it. Making the client read the server's grid instead is left open.
- **Walk-through-walls monsters** (`AI_MOVE_WALKTHROUGH_WALLS`) and anything with `MSTATE_MOVE_OUTSIDE_BSP` keep today's step, since walls don't stop them.
- **Line of sight for targeting and spells:** unchanged.

## Consequences

- **Monsters find their way:** round walls, through doorways, over bridges. Battles at seats and fronts become fights instead of crowds at a wall, so the seats' starting squares could go back to the natural places: the castle door for attackers, the liege's door for defenders.
- **Harder monsters:** a monster that used to be shaken off behind a wall now follows. Some fights get harder, and kiting monsters around corners stops working. Monsters that should stay easy can be left on the direct step with a behaviour flag (`AI_NO_PATHING`).
- **Server cost:** memory for the grids of rooms with monsters in them (about 16 KB for a large room), and CPU for searches, bounded by the budget. This needs watching on the e2-micro VM, where a 100-player load test already runs close to the limit (2026-10-24).
- **Server change:** the first change to blakserv's C in a while, so it needs a full rebuild and a new server binary in the deploy. The release is not just Kod.

## Building it

1. **The grid in C**, with a maintenance command to dump a room's grid as text, to compare against the client's `nav/<room>.nav` for the same room.
2. **The search builtin**, with a maintenance command to ask for a path between two squares and print it.
3. **Kod: battle troops only**, behind a setting (`Settings.pbMonsterPathing`), so it can be turned off on the live server.
4. **Try it:**
   - **The Bourgeois Castle:** put the Duke's attackers back at the castle door, then across the bridge, and watch them reach the guard.
   - **The other seats:** the Courtyard of Blackstone Keep and the Temple of Kraanan.
   - **Elsewhere:** a front in the open lands.
   - **The cost:** with the playtester and a 25-troop battle, how long searches take.
5. **Every chasing monster**, then the later users.
6. **Record it:** this ADR's "As built", and ADR 0021 for the seats' squares.

## As built

Not built yet.
