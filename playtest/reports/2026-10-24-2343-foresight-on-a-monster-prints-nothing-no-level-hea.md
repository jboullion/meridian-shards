---
title: "Foresight on a monster prints nothing (no level/health/resistances line)"
severity: major
category: "other"
status: new
reported: 2026-10-25T04:43:47.406Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 25, col 37"
commit: dcdec20
---

# Foresight on a monster prints nothing (no level/health/resistances line)

Casting Foresight on a giant rat and on a training dummy costs mana and 2 uncut seraphym and prints only "Spellpower for foresight is N." Nothing else arrives, though forsight.kod ForesightMonsterStats sends "You read %s%s: level %i, with %i%% of its health left." plus resistance lines or "It has no resistances or weaknesses.", and "casts no spells."

## Steps to reproduce

Headless Scout in Outskirts of Raza (RID 330). admin_spawn GiantRat. cast foresight on it (also on a TrainingDummy). wait_events with no kind filter.

## Expected

Description: "On a monster, it reveals its level, its health, its resistances and weaknesses, and the spells it casts." Kod sends "You read the giant rat: level N, with N% of its health left." and the resistances / "casts no spells" lines.

## Actual

Only #11202 "Spellpower for foresight is 63." (no other server, look or chat event). Same on 4 casts on a rat and a dummy. Heading into the health-heal-back test, I could not read the monster's health with Foresight, so I used combat-message wording instead. Might be the headless tool dropping the message; worth a check in the real client.

## The journal before it

```
#11176 04:42:57 server Spellpower for fireball is 68.
#11177 04:42:57 combat The training dummy takes 19 damage.
#11178 04:42:59 combat Your fireball scorches the training dummy for 15 damage.
#11179 04:42:59 combat You hit training dummy for 15.
#11180 04:42:59 server Spellpower for fireball is 68.
#11181 04:42:59 combat The training dummy takes 16 damage.
#11182 04:43:02 combat Your fireball scorches the training dummy for 18 damage.
#11183 04:43:02 combat You hit training dummy for 18.
#11184 04:43:02 server Spellpower for fireball is 68.
#11185 04:43:02 combat The training dummy takes 18 damage.
#11186 04:43:04 server You don't have the reagents to cast fireball!
#11187 04:43:24 server Your illusion takes the form of shocking fury.
#11188 04:43:24 combat Your shocking fury shocks the giant rat for 11 damage.
#11189 04:43:24 combat You hit giant rat for 11.
#11190 04:43:24 combat The giant rat's attack misses you.
#11191 04:43:24 combat The giant rat is slightly wounded.
#11192 04:43:27 combat The giant rat's attack misses you.
#11193 04:43:28 server Your illusion takes the form of explosive frost.
#11194 04:43:28 combat Your explosive frost chills the giant rat for 11 damage.
#11195 04:43:28 combat You hit giant rat for 11.
#11196 04:43:28 combat The giant rat is seriously wounded.
#11197 04:43:31 combat The giant rat's attack claws you for 2 damage.
#11198 04:43:32 server Your illusion takes the form of explosive frost.
#11199 04:43:32 combat Your explosive frost cools the giant rat for 2 damage.
#11200 04:43:32 combat You hit giant rat for 2.
#11201 04:43:34 combat The giant rat's attack misses you.
#11202 04:43:36 server Spellpower for foresight is 63.
#11203 04:43:37 combat The giant rat's attack claws you for 2 damage.
#11204 04:43:40 combat The giant rat's attack misses you.
#11205 04:43:44 combat The giant rat's attack misses you.
```

## Coordinator check (2026-10-25, after the report)

Not reproduced with a scripted client (GameSession, as a player with Foresight and Uncut Seraphym): casting Foresight at a giant rat in the Outskirts printed all of: "You read the giant rat: level 30, with 72% of its health left.", "fire resistance -20% (a weakness)", "bludgeon resistance -10% (a weakness)", "slash resistance 20%", "The giant rat casts no spells.", then "Spellpower for foresight is 49.".

So the game sends the message; the playtester's MCP journal (its headless body) drops these multi-line, resource-formatted lines (the same thing that blanked the Faren priestess's attune replies). Treat as a tool problem, not a game bug. A side note from the same run: the breakdown for Foresight at noon reads "The moon's position: -16" then "A bonus can't go below zero: +16" (a negative term and its cancelling line), which is correct arithmetic but odd to read.
