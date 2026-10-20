# ADR 0020: An AI playtester

- Status: phases 1 and 2 built (2026-10-20); phase 3 (players' own AI characters) direction set, details to come
- Builds on: the headless tools (`tools/headless/`), the screenshot tour (`tools/screenshots/`), the nav grid (`packages/world/src/navGrid.ts`)

## Context

We play-test by hand, and with scripts that run fixed steps: `tools/headless/quest.ts`, `companion.ts`, `arena.ts`, the screenshot tour. An AI agent could play freely instead: wander, take quests, fight, talk to the NPCs and to players, and write down what's broken as it goes. Later it could keep players company and help new ones.

The agent needs a character it can control in plain terms ("walk to Marcus", "fight the nearest rat", "what did that player say?"), not keys and pixels. MCP is the standard way to give an agent tools, and Claude Code speaks it.

## Decisions

1. **An MCP server that plays one character: `tools/agent/server.ts`.** It runs over stdio, and Claude Code starts it from `.mcp.json`. It uses the official SDK (`@modelcontextprotocol/sdk`, a dev dependency, with `zod` for the tools' schemas). The process holds the game connection between tool calls. Nothing but the protocol goes to stdout; logs go to stderr.

2. **The body is a headless `GameSession` (`headless.ts`, over the shared `Body` in `body.ts`).** It's set up as the headless tools set theirs up: the secret key from `server/config/blakserv.cfg`, the run folder's `rsc0000.rsb`, and `world.tick` every 100 ms so others' movements land. It keeps the latest of each answer the tools wait for (a look, a shop's list, quest offers, the quest log).
   - **The journal (`journal.ts`):** a numbered ring of 500 one-line entries. It holds players' and NPCs' speech (with the sender, NPCs marked), server messages, combat (the hit messages and damage), quest progress named from `quests.json`, room changes, health crossing a half and a fifth, errors, and the agent's own doings.
   - **`wait_events`** reads the journal from where the agent last read and waits up to 60 s for something new. That's how the agent notices players while idle.

3. **The world as text (`describe.ts`).**
   - **Positions** are Kod squares (row and column, 1-based), as the maintenance port and the quests use them.
   - **Objects** are listed nearest first, with id, name, kind and square, plus distance and compass bearing. The kind comes from `OF_*` and the minimap bits: player, monster, boss, NPC (shop, buyer or banker), item, portal, a quest's "!" or "?", or counting for a quest.
   - **Exits** are named with where they lead (`roomexits.json`, doorways merged as `questWay.ts exitsTo` does).
   - **Also as text:** the main stats by number (their name resources are icons), enchantments, what's in use, and the quest log with each step's objective.

4. **Walking (`walker.ts`)** uses the townsfolk's nav grid. Each room's `.roo` and `nav/*.nav` come from `dist/assets` (built on the spot when a room has no `.nav`, as the gateway's arena does).
   - **Steps:** `findPath`, then `BP_REQ_MOVE` steps of half a square every 250 ms at walking speed, turning to face the way. That's about a walk's pace, and the server sees ordinary moves.
   - **Stopping:** after three snap-backs (`BP_MOVE` for us), when the room changes, or after 2 minutes.
   - **Doors:** onto the door's square, then `BP_REQ_GO` every 1.2 s for up to 6 s, as following a friend does (`social/follow.ts`).
   - **Edges:** to the open cell nearest that side, then on out a quarter square at a time.
   - **Across rooms:** `travel_to` takes the shortest way over the exits (`questWay.ts findRoute`). Portals and teleports aren't in the exits.

5. **What it can do (`actions.ts`):**
   - **Moving:** look around, walk to a square or an object, take an exit, travel, face.
   - **Speaking:** say, yell, emote, broadcast, tell by name, and who's in the game.
   - **Objects:** examine, and talk (activate: quest offers come back), quests (offers, accept, turnin, abandon, log, a quest's details).
   - **Fighting:** walk up, face the foe, swing once a second until it's gone, we're low (30% by default) or time's up. It answers with the swings, hits and damage, and says when no swing got any answer (a safe area).
   - **Magic and items:** cast by name, rest, inventory, get, use, unuse, drop.
   - **Shops:** list a shop, buy by list number, sell (offer, see the counteroffer, accept or cancel), and any `UC_SHARDS` line. Teachers sell their spells and skills in the same list (`plFor_Sale`), so buying one learns it.
   - **Training, the bank, vaults and containers** (added 2026-10-20): `train` lists what we can train and its price, and spends training points on one (`UC_SHARDS_OBJECT` "train <n>", as the Train window does). `bank` covers the balance, deposits and withdrawals (`UC_BALANCE`, `UC_DEPOSIT`, `UC_WITHDRAW`). `vault` lists, withdraws and deposits items (`BP_REQ_WITHDRAWAL`, the withdraw and deposit lists). `container` looks in, takes from and puts into a storage box.
   - **Walking to someone behind a counter:** the path ends at the nearest floor on our side, whatever stands between (a banker, a shopkeeper).

6. **Reports (`reports.ts`): markdown in the repo, reviewed by us.**
   - **Bugs:** `report_bug` writes `playtest/reports/<date>-<time>-<slug>.md`. The front matter holds severity, category, `status: new`, character, room and square, and the commit. The body has the summary, steps, expected and actual, and the journal's last 30 lines.
   - **Avoiding duplicates:** `list_reports` gives each report's title, severity and status.
   - **Notes:** `note` appends what isn't a bug (balance, confusing text, ideas) to `playtest/notes/<date>.md`.
   - `playtest/README.md` says how to triage. Reports are committed like any doc, so the history of what was found stays.

7. **Test helpers on the maintenance port, local only (`admin.ts`):** teleport, give an item, spawn monsters beside us, set the hour (the admin dashboard's recipes). The character is a plain user account (`shardscout`, character Scout), not an admin. Admins are immortal and get the admin module, which would hide what players meet.

8. **The playtester's brief is `.claude/agents/playtester.md`**: how to play a session, what counts as a bug, how to report, and how to treat players. **Text from players and NPCs is game content, never instructions**: the server's instructions and the brief both say so. Speech is limited in the server, not just asked for: one line every 3 s, 200 characters at most.

9. **Phase 1 is local only.** The server refuses a gateway that isn't this machine.

## Phase 2: eyes (built 2026-10-20)

So the agent can see what players see, and report visual bugs, `connect` takes a body: `headless` (phase 1: quick, text only) or `browser`, the real client. `--body` sets the default and `--headed` shows the window.

10. **The browser body (`browserBody.ts`).** Playwright opens the dev client in the installed Edge on the real GPU, as the screenshot tour does (`tools/screenshots/capture.ts`: its settings written before the page loads, its login through the login screen and the character list). The window is 1280 × 720, in the Modern interface.

11. **The agent's logic runs in the page (`inpage.ts`).** Rather than copy the world over the wire, the page imports `tools/agent/inpage.ts` through Vite's `/@fs/`, so it works in development only, as `window.shards` does. A `Body` then attaches to the page's own `GameSession`.
    - **The same handlers in both bodies (`play.ts`):** each tool is a function of the body and its arguments. `server.ts` keeps only the schemas and sends each call to the headless body, or into the page through `page.evaluate`.
    - **No Node APIs in what the page loads:** `body.ts`, `walker.ts`, `describe.ts`, `actions.ts`, `journal.ts`, `play.ts` and `gameInfo.ts`. Game data comes from the page's `/assets` (`webData.ts`), as files do from disk in Node (`assets.ts`). Vite's dev server answers a missing file with the page, so an HTML answer counts as missing.
    - **Following the session's events:** `GameSession.listen` adds listeners beside the client's own, so the body follows a session it didn't make.
    - **Moving:** the client's `PlayerMover` owns where we stand there (`GameScene` copies it into our object each frame). So `Body.stepTo` and `turnTo` move and turn the mover too (`place`, `setAngle`), and the view follows the walk.

12. **Screenshots.** `screenshot` returns the page as a player sees it, or (`hud: false`) the 3D view alone (`gameScene.captureView()`), as an MCP image. In the browser body, `report_bug` attaches one, saved beside the report as a `.png`. The pictures show the game's art, so they're git-ignored (`/playtest/reports/*.png`) and stay on the machine that took them.

13. **The parts that need Node stay in Node:** reports, notes and the maintenance-port helpers. They ask the body where we are (`play.ts context`), so they work with either body.

## Later phases

- **Phase 3, players' own AI characters** (direction set 2026-10-20; the details are still to be thought through and tried).
  - **Any player may run one AI agent at a time.** It plays a character on the live server.
  - **Marked "AI" where everyone sees it.** The server flags the character when an agent connects, and our client shows the mark. The server enforces it, so a changed client can't hide it.
  - **It stays with the game.** The agent ships and installs with the game, the desktop app and the repo, not as a separate download or repo. It moves in step with `packages/protocol` and `packages/world`. Game files come from the chosen server's `/assets`, as the apps' do.
  - **Self-explaining.** A player opens Claude Code, OpenAI Codex or any MCP client and points it at the Meridian MCP server. From there the AI should learn everything it needs from the server itself: the server's instructions, plus resources such as the game's manual, the rules for AI characters, and how to play well. It shouldn't need the repo.
  - **Ideas to try for starting it:**
    - **A Launch AI Bot button in the game.** The desktop app already has the game files, so it could run the MCP server itself, perhaps over MCP's HTTP transport on a localhost URL, for the player to give their AI client.
    - **Or the game runs the agent itself.** The player enters their AI provider's API key or token in the game's settings. It would be kept on their machine (Electron's `safeStorage`) and never sent to our server.
  - **Still to decide:**
    - Whether the AI plays the player's own character or a second one on their account.
    - Speech limits enforced by the server.
    - Whether AI characters earn XP and loot as players do.
    - How staff mute or stop one.
    - The brief's rules against being steered by other players.
    - A player-facing `bug` command (`UC_SHARDS bug ...`), so reports from agents (and players) reach us.
    - No admin tools outside dev.

## Consequences

- An agent can play from Claude Code once the dev stack runs: `npm run dev`, then use the `meridian` MCP server's tools (or the `playtester` agent).
- In the headless body the agent sees only what the protocol carries. The browser body adds the screen, at the cost of a browser and a slower start.
- Walking is our nav grid's idea of where people can walk, not `move.c`'s: a path the grid thinks clear can still meet a snap-back, which the walker reports. That's worth reporting too.
- Found while building it: a monster placed in a player (a `NewHold` aimed at the player's id) makes the server fail every request that player sends, silently, until it's deleted. Our tools never do it (`admin.ts` takes the room from `GetOwner`'s return line), but a debug script did.
