# Ambient sounds (ours)

The sounds of ambient life and the weather, none of them the server's: `apps/client/src/game/ambientSounds.ts`, played through `GameAudio.playAmbient` on a bus of their own (the **Ambient Sounds** option and its volume, under the Sound Volume; they never take the server's 24 voices). Positional sounds fall off to nothing at their range and pan toward where they are.

They play only where people live: the rooms in `ambientRooms.ts` (towns, inns, castles, the arena) and rooms whose terrain is a city, castle, guild hall, home, temple or shop (`SETTLED`). In the wilds (forests, fields, caves and the rest) nothing of ours plays, critters, fish and puddle steps included: the original's own sounds are enough there. Thunder is the exception: it goes with the lightning everywhere.

To hear one cue by itself in dev: `window.shards.gameScene.ambientSoundBoard.audition("thunder")` (it returns the list of cue names). `window.shards.audio.log` lists what played.

## Cues

| Cue (audition name) | When | File(s) | Volume | Notes |
|---|---|---|---|---|
| Town chatter (`town`) | Townsfolk within 14 squares (towns, castle courtyards) | `amb_town_talk.ogg` | 0.18 (0.15 in castles), less with fewer people | Loops from a random point; muffled and quieter in the rain outdoors |
| Inn chatter (`inn`) | Patrons about | `amb_inn_talk.ogg` | 0.45 | |
| Hall and arena crowd (`hall`) | Courtiers under a roof; the arena | `amb_hall_talk.ogg` | 0.15 castles, 0.29 arena | |
| Weapon swing (`swing`) | An arena fighter's swing | `swswish1`-`5.ogg` | 0.45 | |
| Weapon hit (`hit`) | Half the swings land | metal: `mhit1b`-`3b`, `swrdmtl1`-`3`; leather: `lhit1b`-`3b`; flesh: `fhit1b`-`3b` | 0.55 | By the struck fighter's armour; a pain cry (`ouchm`/`ouchf`) one time in five |
| Spell cast (`cast-fire`, `cast-lightning`) | An arena mage casts (every 6-14 s in a fight) | fireball `ffirebal.ogg`, lightning bolt `fbolt.ogg`, fire wall and web `farenwala822m.ogg`, bramble wall `faren.ogg`, poison fog `qor.ogg`, ring of flames `frngfir.ogg` | 0.5 | The spells' own cast sounds |
| Lightning lands (`zap`) | A lightning bolt arrives | `zaphit1`-`3.ogg` | 0.35 | Fireballs land silently for now |
| Cheer (`cheer`) | Someone in the stands cheers (arms up) | `huzzah.ogg`, `arena.ogg`, `amb_cheer1`/`2.ogg` | 0.32-0.5 | At most one every 2.4-6 s |
| Applause (`applause`) | A round won: the last one standing in the arena | `amb_applause.ogg` (3-5 s of it), `huzzah.ogg` | 0.32 | |
| Death cry (`death`) | An arena fighter is beaten | `pdeath.ogg`, `pdeathf.ogg` (player.kod's) | 0.5 | |
| Running from a spell (`ouch`) | Townsfolk scatter | `ouchm1`-`4`, `ouchf1`-`4.ogg` | 0.35 | Pitched up a little |
| Dice, drink (`dice`, `drink`) | An inn patron, now and then | `dice.ogg`, `drink.ogg` | 0.45, 0.175 | |
| Thunder (`thunder`) | After each lightning strike | `thunderclap.ogg`, `amb_thunder1`-`4.ogg` | 0.45-0.95 | 1.5-2.7 s after the flash, quieter and duller the further off, panned toward it |
| Critters (`critter`) | A critter within 8 squares, every 5-14 s; never a rat (they only squeal dying) | its Kod "aware" sound (`bsp_awr`, `cnt_awr`, `ant_awr`, `scp_awr`, `bunny_awr`) | 0.28 | Pitched up, as they're small |
| Fish (`splash`) | A fish leaps and lands | `splash.ogg` | 0.25 / 0.45 | |
| Puddle steps (`step`) | Walking or running through a puddle | `weatstp1.ogg` (Raza's wading sound) | 0.3 | Every 430 ms walking, 300 ms running |

Birds, bats, butterflies, fireflies and leaves make no sound anywhere.

The rain itself is the server's (`room.kod room_rain_sound`, `rain.ogg`), as are the terrain loops (forest, beach, cave, sewer) and the room's music.

## Recordings that aren't the game's

`npm run sounds` (`tools/assets/fetch-sounds.ts`) downloads them into `dist/sounds`; `npm run assets` puts them in `dist/assets` with the manifest. Like the game's sounds they never go in git. Run both on a new machine, and deploy the server before a release (CI takes the game files from the VM).

All are **CC0** (public domain) from [BigSoundBank](https://bigsoundbank.com) by Joseph Sardin; credit is appreciated, not required.

| Our file | BigSoundBank sound |
|---|---|
| `amb_town_talk.ogg` | [Outside Talks #6](https://bigsoundbank.com/outside-talks-6-s3096.html) |
| `amb_inn_talk.ogg` | [Small Restaurant Conversations](https://bigsoundbank.com/small-restaurant-conversations-s3542.html) |
| `amb_hall_talk.ogg` | [Crowd of 50-60 People #2](https://bigsoundbank.com/crowd-of-50-60-people-2-s3516.html) |
| `amb_cheer1.ogg`, `amb_cheer2.ogg` | [Shouts and Applauses of Teens #1](https://bigsoundbank.com/shouts-and-applauses-of-teens-1-s0236.html), [#2](https://bigsoundbank.com/shouts-and-applauses-of-teens-2-s0237.html) |
| `amb_applause.ogg` | [Applause: 150 People](https://bigsoundbank.com/applause-150-people-s0019.html) |
| `amb_thunder1`-`4.ogg` | [Thunder #2](https://bigsoundbank.com/thunder-2-s3113.html), [#3](https://bigsoundbank.com/thunder-3-s3114.html), [#6](https://bigsoundbank.com/thunder-6-s3179.html), [#7](https://bigsoundbank.com/thunder-7-s3180.html) |

The chatter recordings are of French speakers; at their volume the words don't come through.
