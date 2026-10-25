---
title: "Holy Symbol shows no visible effect on skeletons or zombies"
severity: minor
category: "combat"
status: new
reported: 2026-10-25T01:44:53.947Z
character: "Scout"
room: "The Inn of Raza [razainn.roo, RID 301]"
square: "row 3, col 8"
commit: dcdec20
---

# Holy Symbol shows no visible effect on skeletons or zombies

Description: "frightens nearby undead, though a botched tracery may enrage them instead." In 8 casts on skeletons and zombies (spellpower 86 and 77) nothing visible happened: no flee, no message, attack rhythm unchanged, and no "botched" message either.

## Steps to reproduce

Outskirts of Raza (RID 330), admin_spawn Skeleton then Zombie next to Scout (Shal'ille 99%, base health 24). Cast holy symbol 5 times at the skeleton and 3 times at the zombie. After each cast, waited 5-10 s and looked: the monster stayed adjacent and kept attacking every ~3 s ("The zombie's attack misses you." at 01:36:17, :20, :23, :27, :30). Only message from the spell: "Your hands weave through the air in a delicate tracery, speaking through motion the purity of Shal'ille, a ward against the unholy." Source: holysymb.kod sets poHolySymbolCaster via TurnedBy; monster.kod IsFrightenedOf only matters if the AI consults it.

## Expected

The undead run away from the caster for about spellpower/10 seconds (8 s), or, on a bad roll, get angry; some message or visible change either way.

## Actual

No change at all, and nothing tells the caster whether the tracery worked.

## Screenshot

![What the game showed](2026-10-24-2044-holy-symbol-shows-no-visible-effect-on-skeletons-o.png)

## The journal before it

```
#1 01:43:54 health Health 7/25: below 50%.
#2 01:43:57 server You feel more attuned to the darkness of the hearts around you.
#3 01:43:57 server Spellpower for detect evil is 77.
#4 01:44:29 health Health back to full (25).
#5 01:44:29 server Shal'ille's holy magic rejuvenates you, restoring 8 hitpoints.
#6 01:44:29 server Spellpower for hospice is 77.
#7 01:44:33 room Entered Mausoleum [razacrypt.roo, RID 306].
#8 01:44:38 server You start your rescue preparations.
#9 01:44:38 server Spellpower for rescue is 69.
#10 01:44:40 server You feel a holy force rescue you from your current situation.
#11 01:44:40 server Scout vanishes in a burst of protective light!
#12 01:44:40 room Entered The Inn of Raza [razainn.roo, RID 301].
#13 01:44:40 server You have been sent to a safe place.
#14 01:44:40 server Marcus says, "Hello, Scout, and welcome to Meridian 59!"
```
