# ADR 0017: Lighting moods and a sun for Enhanced Lighting

- Status: built (2026-10-18)
- Builds on: Enhanced Lighting (AGENTS.md, "Graphics"); the UE remaster's moods (meridian-unreal `data/environment/moods.json`, its ADR 0005) and the Godot version's conversions of them

## Context

The Unreal and Godot versions look better mostly for their lighting moods:
- warm mornings, orange dusks, blue moonlit nights;
- haze outdoors;
- warm inns and cold crypts;
- graded colour;
- a sun that lights the town and casts shadows.

The browser client drew the original's grey palette light:
- the sector light;
- the server's day/night ambient, which brightens only sectors above 127;
- the flames' light maps;
- fog to black;
- no colour and no grading.

The original's own directional shading (`BP_LIGHT_SHADING`, `uSun`/`uShade`) is 2D only, and the server turns it on in four rooms (Ko'catan, its south, `ke4`, `canyon2`).

## Decision

**Moods belong to Enhanced Lighting.** Enhanced off stays the original, exactly: every mood term is behind `uMoodOn`, and with it off the shaders compute what they did before.

**We port the ideas of moods.json, not its numbers.**
- A mood is a set of plain numbers (`packages/render/src/moods.ts`):
  - the sun's colour and strength;
  - the light's tint, and its scale under open sky;
  - haze (colour, density, start) and the colour the original's fog fades to;
  - the sky's tint;
  - the flames' scale;
  - the grading (exposure, saturation, contrast, shadow and highlight gains), bloom and vignette.
- Cycles are `[hour, mood]` keys, smoothstepped and wrapping over midnight (Unreal's `StateFor`).
- Storms are `mul`/`add` overlays blended in over 8 s, outdoors only (`storm_rain`, `storm_snow`).
- The colours come from moods.json; the strengths are ours, for a renderer that keeps the original's light and adds to it.
- The dusk is keyed an hour earlier than Unreal's (18.5): the server's dusk is 18 to 20.

**Which cycle a room follows** (`apps/client/src/game/moodZone.ts`):
- outdoor when at least half its floor (by area) is under open sky (Unreal's `zone_configs.py` rule);
- an inn by `ambientRooms.ts`;
- underground for caves, dungeons, sewers, crypts and NECROPOLIS;
- the Underworld its own;
- otherwise an interior.

A roofed room's courtyards still get the day's sun.

**The sun moves smoothly** (`sunPath.ts`):
- The server moves the sun once a game hour (5 real minutes).
- `GameClock` times the hours from the sun overlay's changes. The server's own formulas (`sun.kod`) on the fractional hour give the light's direction, and the drawn sun disc follows it.
- By night the light is the moon (its overlay, or from high in the south when it's down), faded across the horizon.

**On surfaces** (`lighting.ts`, shared `moodUniforms`, one write a frame):
- the original light is tinted, and scaled under open sky;
- surfaces under open sky add the sun by `n·L` (a new `aSky` attribute: the face normal, and whether it stands under sky);
- the original's fog fades to the mood's colour, then haze;
- the original's own sun shading is off while a mood is on.

**Figures** take the tint and, under sky, the sun as a billboard does: more from in front, less backlit. Their shadow stretches away from the sun when they stand in it. The ground detail and the hands take the same.

**Grading** is PostFx's composite: exposure, saturation, contrast about 0.3, and shadow and highlight gains. A lightning strike lifts the exposure.

**Sun shadows on floors** (`sunShadow.ts`):
- A map of an eighth of a square per texel over the room's sky floors.
- Each texel marches a ray toward the sun. It's stopped by the room's drawn wall triangles (RoomView's own, so textures that don't tile up the wall are as tall as drawn), by floors, and by roofs.
- Mostly see-through textures (over 45% transparent: railings, grates) cast none; drawn eight squares tall, Raza's railings had darkened the whole square.
- Baked 3 ms a frame for this hour, then the next, and the shader crossfades the two by the hour's fraction. It fades in once baked.
- Walls use the map at the floor in front of them, fading out up the wall.
- In the towns about 75-90% of the sky floor is in sun at noon.

**Knobs:** `RENDER_TUNING`'s "Moods" group (sun, shadow darkness, haze, tint, grading, the room-change fade) is live in the admin dashboard. The moods themselves stay in code. In dev, `gameScene.mood` shows the frame's kind, hour and mood, and `gameScene.ambientHour` pins the hour.

## Consequences

- **Cost:** about 0.4 ms a frame on top of Enhanced Lighting once a room's sun maps are baked, and 3 ms a frame while they bake (Raza's two take about a second of frames; the desert's largest rooms about six).
- **Screenshot tours:** their manifests take `"settings"` (e.g. `{ "enhanced": false }`) to compare with the original's look.

**Left for later:**
- shadows on walls from other buildings, beyond the floor-in-front guess;
- moonlight shadows;
- windows glowing at night (Unreal's `WindowGlow`);
- the lamps' light following the hour;
- moods for particular places (a room-file override table in `moodZone.ts` is where they'd go);
- `BP_LIGHT_SHADING`'s sun height is still not read (the overlay gives it).
