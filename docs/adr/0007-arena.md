# ADR 0007: The arena, one sim on the relay

- **Status:** accepted, 2026-10-12, and built the same day (see "As built"). Builds on the relay of [ADR 0005](0005-friends.md).

## Context

The Arena of Kraanan's fights began as part of ambient life (`ambientLife.ts`, 2026-10-11): each client ran its own fights, kept in step between friends by a shared seed and fixed ticks (ADR 0005 6). It looked good, but:
- Strangers saw different fights. Only friends shared a seed, and a late arrival's copy drifted.
- The spells were for show. Walls never stopped anyone, a web was a timer on its target, there was no Blind or Dazzle, the damage was made up, and the winner cheered with their sword still out.
- The arena was tangled into the generic crowd code, hard to change and impossible to configure.

We want real battles that everyone on our server watches together, using the game's spells and weapons with the numbers its Kod gives them, and a roster of fighters with records worth inspecting.

## Decisions

### 1. One sim, run by the relay

1. **The arena is its own sim** (`packages/world/src/arena/arenaSim.ts`), pure TypeScript that runs in Node and the browser. It steps in fixed 50 ms ticks from a seeded random stream: the same seed and calls give the same fights.
2. **The relay runs it** (`tools/gateway/arena.ts`, in the gateway's process): one arena per server string, the same scoping as everything else on the relay (in practice one: there is only our server). Everyone connected to the relay for that server who is in the arena's room with Ambient Life on watches the same fights, friends or not.
3. **State, not seeds.** The relay sends a watcher everything when it starts watching (`arenaState`), then what changed every 100 ms (`arenaTick`): figures' positions, poses and status, new walls and spells in flight (the client flies and animates them), events for sounds, and lines said. That's about 2 KB/s per watcher.
4. **Clients play it back about 220 ms behind** (a jitter buffer in `arenaView.ts`): each tick is applied when its time comes, and figures glide between ticks.
5. **With no relay** (or none answering within 4 s, or an older gateway that answers `arenaOff`), the client runs the same sim itself with the default settings and the season's roster. It's the same to look at, just not shared.
6. **The game's hours.** The arena is shut from 22 to 6 by the game's hour, which the relay can't see, so watchers tell it the hour their sun shows (`hour` in `arenaWatch`, then `arenaHour` when it changes). Everyone on a server sees the same sun, so the latest word holds, and an admin setting the time opens or shuts it. With no word yet, the relay guesses from the wall clock as blakserv's `SystemInitGameHour` does (`arenaHourAt`); a running server drifts from that guess.
7. **Only while watched.** The relay starts an arena when its first watcher comes and drops it a minute after the last one leaves; the next visitor gets a fresh round.
8. **Real players are never in it.** The sim doesn't see them, fights go on whoever is in the room, and nothing about the arena reaches blakserv or `WorldState` (arena figures are ambient objects, as before).

### 2. Real combat

The numbers come from the Kod, cited in `arenaData.ts`. The arena itself is ours. Spell power (Kod's `iSpellPower`, 0-99) comes from the archetype.

| What | How (Kod) |
|---|---|
| Fireball, lightning bolt | Projectiles at their speed, 9-15 and 13-18 damage |
| Wall of fire | 9 elements across the way a square ahead. Whoever's in one is burned for random(0, power/6) each 1.5 s cycle |
| Poison fog | Clouds two squares ahead. Odds of 50 + power/2 of poison: 0.5 health a second for the rest of the fight |
| Spider web | 9 webs in a square two squares ahead. Stepping into a new square in one holds you random(max-2, max) s, max = 3 + power/33, up to 5. You can't move while held. The webs' overlay (`webov.bgf`) goes on the legs |
| Bramble wall | 5 brambles in a line a square ahead. They bar the way (`CanPlayerAdvanceOnMe` FALSE: their cells are closed to paths), scratch whoever moves past for random(0, power/15), and have power/2 health (10-50), shown as their frame. Fighters cut through when the way round is long |
| Blind, dazzle | Projectiles (`blindring.bgf`, `dazzlestar.bgf`). The victim stumbles about and can neither fight nor cast (monsters' `AI_MOVE_RANDOM \| AI_NOFIGHT`) for the Kod's durations, 4-18 s. The spell's art circles their head |
| Weapons | Damage by kind (thrust 3-8, bludgeon 4-8, slash 7-13), ±1 for quality, plus the arm behind it, less the armour's soak |

Walls last their Kod duration times `fieldLife` (0.15 by default). The server's 20 s to over 4 minutes would choke the floor.

**Spells are chosen by what's going on:**
- webs and brambles at a fighter closing in
- blind or dazzle at someone about to swing
- bolts at range, and at the helpless
- fog when the foe is about two squares off

Fire and fog cells are avoided when finding a path, if there's a way round.

### 3. Sounds as the game makes them

- a swing (`swswish1-3`), and a miss (`swordmis`)
- a hit by how hard: flesh up to 3, leather up to 6, metal beyond (player.kod `DoHitMessageSound`)
- the victim's cry by how hurt (`GetOuchSound`, 1-4)
- each spell's own sound, and zaps for lightning landing
- `frying` for webs, brambles and fire (their Kod sounds), the fog's cough
- the death cries
- the stands' cheers and applause, as before

### 4. A roster for a Meridian year

1. **Seasons are Meridian years.** A game day is two real hours and a year 240 of them, so 20 real days. The relay can't read the server's year, so seasons count from 1 October 2026 (`arenaRoster.ts SEASON_EPOCH`).
2. **Each season has a roster** of 24 named fighters, made from the game server's name and the season number. Each one has:
   - an archetype (Warrior, Knight, Duelist, Kraanan war-mage, Faren battle mage, Qor shadowcaster, Shal'ille mystic, Riija trickster)
   - their looks
   - a favourite weapon (the one they carry)
   - a favourite spell (cast more often)
3. **Each round draws from the roster.** Wins, losses and the foes each beat are kept per season.
4. **At the season's end** the one with the most wins (then the fewest losses, then the most beaten) is remembered as its champion, and a new roster takes over from the next round.
5. **The relay keeps one file** (`ARENA_STATE`): per server, the season, its roster, its records and the champions (the last 20). It's written after each round and at the turn of a season, whole to a temp file and then renamed over the old one. The relay kept nothing on disk before; this file is the one exception.

### 5. Inspecting a fighter

Examine (right click, long press) on a fighter shows:
- their name and archetype
- their favourite weapon and spell
- their health on the floor
- this season's record
- the seasons they were champion of
- what they're doing (fighting, stuck in a web, stumbling about blinded, in the stands, savouring a victory)
- their mood

### 5a. The stands take sides (added 2026-10-13)

1. **Each spectator cheers for one fighter a round**, picked from those on the floor when the bout starts (or still standing, for one who arrives later). The beaten watching from the stands don't pick. Their inspect window says "Cheering for" and the fighter's name.
2. **Now and then a fan calls out for them by name** ("Come on, Bram the Bold!"), as the stands' other lines are said: over their heads, never in the chat, two speaking at most.
3. **Their fighter wins:** the fans cheer longest, and a couple of them say so. **Their fighter falls:** the fans boo (pointing at the floor), a couple aloud, and they've no one to cheer until the next round.
4. **On the wire:** `ArenaPersonWire.fav` and the last element of an `ArenaMove`, the fighter's id or -1. Relays from before send neither and clients from before ignore both, so a relay and its clients needn't update together.

### 6. Settings without code

`arena.json` (the path in `ARENA_CONFIG`) is merged over the defaults (`arenaConfig.ts readArenaConfig`) when the gateway starts. Anything it doesn't understand is logged and dropped. Every field:

| Field | Default | Meaning |
|---|---|---|
| `floor` | `[4, 8]` | How many fight a round |
| `spectators` | 14 | People always in the stands (the beaten besides) |
| `rosterSize` | 24 | Fighters in a season's roster |
| `mix` | warrior 3, knight 2, duelist 2, kraanan 2, faren 2, qor 1.5, shalille 1.5, riija 1.5 | The roster's archetypes, by weight (0 leaves one out) |
| `open` | `[6, 22]` | Game hours it's open |
| `roundMaxMs` | 240000 | A round this long ends: the healthiest left wins, the rest yield |
| `victoryMs`, `restMs` | `[5000, 7000]`, `[2000, 4000]` | The winner's moment, and the wait for the next lot |
| `beatenWatchMs` | `[60000, 120000]` | How long the beaten watch from the stands |
| `fieldLife` | 0.15 | Walls last their Kod duration times this |
| `damageScale` | 1 | Every hurt times this |
| `spells.<key>` | `arenaData.ts ARENA_SPELLS` | label, kind, mana, postCast (s), range (squares), sound, damage, curse, wall, projectile; new keys may be added |
| `weapons.<key>` | `ARENA_WEAPONS` | label, overlay, kind, quality, reach, swingMs |
| `armour.<key>` | `ARENA_ARMOUR` | label, files (player art), soak, dodge |
| `archetypes.<key>` | `ARENA_ARCHETYPES` | label, role (fighter or mage), hp, mana, manaRegen, might, power, hit, weapons, spells ([key, weight]), armour, shield, helm, temper (keepAway, castRange, castEvery) |

A new spell, weapon or archetype takes whatever it leaves out from the first default of its kind.

Note that the roster is made when a season starts and kept, so a changed `mix` or archetype looks shows from the next season. Fighting numbers apply from the next round.

## Consequences

- The relay does real work now: under a millisecond of CPU per simulated second per server with watchers. That's nothing next to blakserv.
- The gateway image carries our packages (`packages/{protocol,formats,world}/src`) and the arena's room (`tosarena.roo`, `nav/tosarena.nav`), and starts Node with `--import ./register.mjs` so `@shards/*` resolves to them. Node won't run TypeScript from `node_modules`.
- Clients without the relay see their own fights, as before. Clients with it see everyone's.
- The old lockstep arena (ADR 0005 6, for the arena) is gone. Shared seeds stay for the other crowds.

## As built (2026-10-12)

- **Packages:** `packages/world/src/arena/`:
  - `arenaData.ts` (spells, weapons, armour, archetypes)
  - `arenaConfig.ts` (defaults, `readArenaConfig`)
  - `arenaRoster.ts` (seasons, `makeRoster`, `championOf`)
  - `arenaWire.ts` (the messages)
  - `arenaSim.ts` (`ArenaSim`, `arenaHourAt`)
  - `arenaView.ts` (`ArenaView`: playback, figures, overlays, `describe`)
- **Relay:**
  - `tools/gateway/arena.ts` (`ArenaHost`)
  - `relay.ts` handles `arenaWatch` and `arenaLeave`, and answers `arenaOff` when it has no arena
  - `gateway.ts` reads `ARENA_ASSETS` (default `dist/assets`), `ARENA_STATE` (default `dist/arena-state.json`; `none` keeps nothing) and `ARENA_CONFIG`
- **Client:**
  - `SocialClient.watchArena` (watched again on reconnecting) and `SocialLink.watchArena`
  - `gameScene.ts updateArena` (the relay's feed, else `startLocalArena`), `describeAmbient`, and dev tools `arenaView`, `arenaSim`, `arenaSource`
  - `ambientSounds.ts arenaEvent`
  - `LookDialogs.tsx AmbientPersonDialog` (the fighter rows)
- **Hosting:** the gateway image's `state` volume holds `arena-state.json` and an optional `arena.json` (`deploy/README.md`).
- **Tests:**
  - `packages/world/test/arena.test.ts`: settings, seasons, the roster, determinism, rounds and records, closing at night, web holds, brambles barring the way and being cut down, the blind not fighting, and the view's playback, overlays and inspect info
  - `tools/gateway/arena.test.ts`: two watchers see the same ticks, it stops when unwatched, the season file and its turnover with a champion, and watching through a real relay
- **Tried live** on our server: Shardbot in the arena saw the relay's fights (`arenaSource` "relay"), and a second relay client under another name, not a friend, saw the same fighters. Webs, dazzle stars, bramble walls and the sounds were all there.
