# ADR 0018: Seasons, enhanced water and glowing windows

- Status: built (2026-10-18)
- Builds on: [ADR 0017](0017-lighting-moods.md), the moods; the UE remaster's seasons, water and window glow (meridian-unreal `tools/ue/environment_materials.py`, `data/environment/moods.json`, `facades.json`)

## Context

The play test asked for:
- seasons, with seasonal effects on the mainland only;
- water like the remaster's;
- the remaster's glowing windows.

What the server already does:
- It keeps a calendar (`util/system.kod`: `piDay` 0-239, `piYear`; a game day is 2 real hours, so a year is about 20 real days). The season is `piYear % 4`.
- It uses the season only for storms, by weather mask: the mainland snows in winter; Ko'catan's jungle never snows.
- It never sent the season to clients.

## Decision

### The season, from the server
- **`UC_SEASON` (115):** a BYTE season (0 spring … 3 winter), a WORD year, a WORD day of the year.
- **Sent by** `System.SendSeason`:
  - at logon (`User.UserLogon`);
  - to everyone when the year turns (`NewGameYear`);
  - to everyone when an admin sets it (`SetYear`).
- **On the client:** `GameSession` keeps it as `world.season`.

### Seasonal looks (the **Seasons** option, on by default)
**Where:**
- the mainland only (`apps/client/src/game/seasonZone.ts hasSeasons`);
- not Ko'catan (JUNGLE terrain or `koc*`), the desert (BADLANDS, `desert*`, `waylay*`), the lava rooms (LAVA) or the ice cave (TUNDRA).
- No season sent yet means summer, the original look.

**The surfaces:**
- Foliage walls (`tools/assets/foliage.json`: 45 textures named for trees, hedges, ivy, grass…, from the remaster's catalog) and grass floors (`floortextures.json`) take the season.
- The tint is the remaster's `SEASON_HLSL`, ported (`packages/render/src/surfaceEffects.ts`, `seasonTint` in GLSL and TS):
  - only green and yellow-green pixels change;
  - spring is greener;
  - fall is gold to red, by a world-space noise (grass golden rather than red);
  - winter is pale and grey.
- `RoomView` marks each triangle (the `aFx` attribute) from `roomSurfaceTextures`, which `GameScene` fills before building rooms.

**Ground detail and Nature:**
- Ground detail's tufts take the same tint, and are shorter in winter (`GroundCover.setSeason`).
- Falling leaves take the season's colours (`Nature.setSeason`).
- Butterflies, fireflies and leaves come in the remaster's numbers by season (`SEASON_NATURE`).

**Snow:**
- It lies only while it snows (your choice, and the remaster's).
- `gameScene.snowCover` builds over `snowBuildS` (300 s) while the server snows in a room with sky, and melts over `snowMeltS` (900 s).
- Floors and roofs facing up whiten (`snowCover` in the shader), and so do the tufts.

### Enhanced Water (the **Enhanced Water** option, on by default, apart from Enhanced Lighting)
**Which floors:** floors with a water texture (`watertextures.json`). Their sector's depth darkens them a little.

**The shader** keeps the texture's own colours and scroll, and adds:
- **waves:** six moving sine waves in world space (`waterSlope`), which shade it light and dark (`waterWaves`) and waver its picture a little (`waterWobble`);
- **a sky reflection:** fresnel, brighter toward the horizon (`waterReflect`; the colour is the mood's haze, or a plain one by the room's light without Enhanced Lighting);
- **glints:** the sun's or moon's, under open sky, with Enhanced Lighting.

The rain's rings on water (`puddles.ts`) are as before.

### Glowing windows (part of Enhanced Lighting's moods)
**The data:** `tools/assets/windows.json` holds 69 textures' windows (and the Raza clock face), from the remaster's `facades.json`, in the picture's pixels (the transpose of the stored texture).

**The masks** (`packages/render/src/windowMask.ts`):
- each outline is `facades.py opening_outline`'s, rasterised into a mask the stored way round and blurred by a pixel;
- the gain is the remaster's: `clamp(0.04 / the glass's mean linear luminance, 1, 4)` × the texture's own gain.

**The shader:** `glass × (1, 0.62, 0.3) × windowGlow × gain + glass × (0.85, 0.92, 1) × windowDaylight`.

**The mood:** two new fields.
- `windowGlow`: 1.0 outdoors at night, 0.5 at dusk, 0 by day;
- `windowDaylight`: 0.6 indoors by day, 0 at night; a storm scales it by 0.35.
- The `moodWindows` knob scales both.

### Knobs and testing
- **Knobs** (`RENDER_TUNING`): Seasons (`seasonStrength`, `snowBuildS`, `snowMeltS`), Water (`waterReflect`, `waterWaves`, `waterWobble`), Moods (`moodWindows`).
- **Dev:**
  - `gameScene.seasonPin` (and the dashboard's World tab Season select) shows a season without the server; `send object 0 SetYear year int <n>` changes the server's.
  - The screenshot tour has an `eval:` step for trying effects (`eval:shards.gameScene.snowCover = 1`).

## Consequences

- **Sprites stay as they are:** the trees drawn as ornaments (the round trees in Raza) don't change with the seasons. Only walls and floors do.
- **Window coverage:** only the 69 textures in `facades.json` have windows. Interior textures mostly aren't there, so daylight through windows shows in few rooms. Adding a texture means adding its openings to `windows.json` (or to the remaster's `facades.json`, and copying it again).
- **Water identification:** water is identified by texture only. Floors with a depth flag but no water texture (wheat fields, wet sand) aren't water.
- **What's left out:** the remaster's ice on water in winter, its lightning flash in windows, and its chimney smoke are left for later.
