# Ambient sounds (ours)

The sounds of ambient life and the weather, none of them the server's: `apps/client/src/game/ambientSounds.ts`, played through `GameAudio.playAmbient` on a bus of their own (the **Ambient Sounds** option and its volume, under the Sound Volume; they never take the server's 24 voices). Positional sounds fall off to nothing at their range and pan toward where they are.

They play only where people live: the rooms in `ambientRooms.ts` (towns, inns, castles, the arena) and rooms whose terrain is a city, castle, guild hall, home, temple or shop (`SETTLED`). In the wilds (forests, fields, caves and the rest) nothing of ours plays, critters, fish and puddle steps included: the original's own sounds are enough there. Thunder is the exception: it goes with the lightning everywhere.

To hear one cue by itself in dev: `window.shards.gameScene.ambientSoundBoard.audition("thunder")` (it returns the list of cue names). `window.shards.audio.log` lists what played.

## Cues

| Cue (audition name) | When | File(s) | Volume | Notes |
|---|---|---|---|---|
| Town chatter (`town`) | Townsfolk within 14 squares (towns, castle courtyards); none in towns from 20 to 5 | `amb_town_talk.ogg` | 0.18 (0.15 in castles), less with fewer people | Loops from a random point; muffled and quieter in the rain outdoors |
| Inn hearth (`inn`) | Always, in an inn: no chatter there since 2026-10-27 | `amb_fireplace.ogg` | 0.6 | Fireplace #4, the steadiest of BigSoundBank's |
| Inn door (`inn-door`) | An inn, every 30-70 s: someone coming in or going out | `doropen1.ogg` (room.kod's `creaky_door_sound`) | 0.15-0.25 | Panned at random, muffled (lowpass 3000) so it is across the room, not our own door |
| Inn chair (`inn-chair`) | An inn, every 25-60 s | `amb_chair.ogg` | 0.15-0.25 | 2.2-3.5 s from a random point of the 55 s recording: its creaks come every second or so, never 2 s apart, so each piece holds one or two |
| Court cough (`court-cough`) | The court's gallery, every 20-40 s | `amb_cough_m.ogg`, `amb_cough_f.ogg` | 0.12-0.2 | One cough at a time: each recording holds several, and `COURT_COUGHS` lists each by its offset and length (found from the loudness). Panned at random, a little muffled |
| Hall and arena crowd (`hall`) | Courtiers under a roof; the arena | `amb_hall_talk.ogg` | 0.15 castles, 0.29 arena | |
| Weapon swing (`swing`) | An arena fighter's swing ([ADR 0007](adr/0007-arena.md)) | `swswish1`-`3.ogg` (stroke.kod's) | 0.45 | |
| Weapon miss (`miss`) | The swing misses | `swordmis.ogg` | 0.3 | |
| Weapon hit (`hit`) | The swing lands | flesh `fhit1b`-`3b` (up to 3 health), leather `lhit1b`-`3b` (up to 6), metal `mhit1b`-`3b` (more) | 0.55 | By how hard, as player.kod `DoHitMessageSound` |
| Cry of pain (`ouch`) | Whoever's hurt by a blow, a bolt, fire or brambles | `ouchm1`-`4`, `ouchf1`-`4.ogg` | 0.35 | By how hurt (player.kod `GetOuchSound`: 1 hale to 4 nearly done) |
| Spell cast (`cast-fire`, `cast-lightning`, `blind`, `dazzle`) | An arena caster casts | each spell's `sound` in `arenaData.ts`: fireball `ffirebal`, lightning bolt `fbolt`, fire wall and web `farenwala822m`, bramble wall `faren`, poison fog `qor`, blind `qblind`, dazzle `sdazzle` | 0.5 | The spells' own sounds (vrSucceed_wav) |
| Lightning lands (`zap`) | A lightning bolt arrives | `zaphit1`-`3.ogg` | 0.35 | Then the victim's cry if it hit |
| Frying (`frying`) | Stuck in a web, scratched by brambles, burned by a wall of fire | `frying.ogg` | 0.4 | web.kod, bramble.kod and wallfire.kod's own |
| Cough (`cough`) | Poisoned by the fog | `psncough.ogg` | 0.4 | poisfogc.kod's |
| Cheer (`cheer`) | Someone in the stands cheers (arms up) | `huzzah.ogg`, `arena.ogg`, `amb_cheer1`/`2.ogg` | 0.32-0.5 | At most one every 2.4-6 s |
| Applause (`applause`) | A round won: the last one standing in the arena | `amb_applause.ogg` (3-5 s of it), `huzzah.ogg` | 0.32 | |
| Death cry (`death`) | An arena fighter is beaten | `pdeath.ogg`, `pdeathf.ogg` (player.kod's) | 0.5 | |
| Running from a spell | Townsfolk scatter | `ouchm1`-`4`, `ouchf1`-`4.ogg` | 0.35 | Pitched up a little |
| Dice, drink (`dice`, `drink`) | An inn patron, now and then | `dice.ogg`, `drink.ogg` | 0.45, 0.175 | |
| Thunder (`thunder`) | After each lightning strike | `amb_thunder1`-`4.ogg` | 0.45-0.95 | 1.5-2.7 s after the flash, quieter and duller the further off, panned toward it |
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
| `amb_fireplace.ogg` | [Fireplace #4](https://bigsoundbank.com/fireplace-4-s2856.html) |
| `amb_chair.ogg` | [Chair](https://bigsoundbank.com/chair-s0666.html) |
| `amb_hall_talk.ogg` | [Crowd of 50-60 People #2](https://bigsoundbank.com/crowd-of-50-60-people-2-s3516.html) |
| `amb_cheer1.ogg`, `amb_cheer2.ogg` | [Shouts and Applauses of Teens #1](https://bigsoundbank.com/shouts-and-applauses-of-teens-1-s0236.html), [#2](https://bigsoundbank.com/shouts-and-applauses-of-teens-2-s0237.html) |
| `amb_applause.ogg` | [Applause: 150 People](https://bigsoundbank.com/applause-150-people-s0019.html) |
| `amb_cough_m.ogg`, `amb_cough_f.ogg` | [Man cough #1](https://bigsoundbank.com/man-cough-s0488.html), [Woman cough](https://bigsoundbank.com/sound-0654-woman-cough.html) |
| `amb_gavel1`-`3.ogg` | [Gavel, 1 blow](https://bigsoundbank.com/gavel-1-blow-s1588.html), [2 blows](https://bigsoundbank.com/gavel-2-blows-s1589.html), [3 blows](https://bigsoundbank.com/gavel-3-blows-s1590.html). The server plays these (`courtfolk.kod` `Gavel`), as a room sound |
| `amb_thunder1`-`4.ogg` | [Thunder #2](https://bigsoundbank.com/thunder-2-s3113.html), [#3](https://bigsoundbank.com/thunder-3-s3114.html), [#6](https://bigsoundbank.com/thunder-6-s3179.html), [#7](https://bigsoundbank.com/thunder-7-s3180.html) |

The chatter recordings are of French speakers; at their volume the words don't come through.
