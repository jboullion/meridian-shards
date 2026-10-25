---
title: "Feign Death: undocumented 5 mana per 5 s drain, and monsters recover to full health while you feign"
severity: minor
category: "other"
status: new
reported: 2026-10-25T05:11:39.738Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 23, col 44"
commit: dcdec20
---

# Feign Death: undocumented 5 mana per 5 s drain, and monsters recover to full health while you feign

Feign Death works (monsters stop attacking; no item or XP loss; ends when you attack, not when you move), but its description says "Costs: 4 mana, 1 vigor" and nothing of the upkeep: fdeath.kod drains 5 mana every 5 s while it holds. Also the monsters I had wounded "fall back to recover" and heal while I feign, undoing Illusionary Wounds ("a monster's wounds don't heal back").

## Steps to reproduce

1. Giant rat (id 6880) at ~10 HP after 3 Illusionary Wounds (examine: "suffering from deep wounds"). 2. cast feign death. 3. Server messages: 05:46:27, :33, :39 "The giant rat falls back to recover for a moment, then returns to the fight." examine after 10 s: "wounded, but is still relatively strong", after 16 s "injured, but is still relatively strong". 4. In an earlier run the first rat healed from ~10 HP to full within about a minute (it then took 28 damage from my mace and was only "near death"). A control rat hurt by the mace alone (not feigning) stayed "suffering from deep wounds" for 60+ s. Mana: 511 -> 485 in about 25 s of feigning.

## Expected

Description (fdeath): "Costs: 4 mana, 1 vigor." and Illusionary Wounds: "a monster's wounds don't heal back."

## Actual

Mana drains ~1 per second while held (code: viManaDrain = 5 every viDrainTime = 5000 ms), not in the description. Monsters that lose sight of you heal fully, which also undoes Illusionary Wounds; the troll "falls back to recover" in normal fights too. Also: a global "[###] Scout was just killed by a giant rat." line is broadcast to the yell zone when you feign (fine, by design, but it is printed even in a solo room).

## The journal before it

```
#11831 05:11:14 combat The troll's attack misses you.
#11832 05:11:15 combat The training dummy takes 3 damage.
#11833 05:11:16 combat The troll's attack misses you.
#11834 05:11:16 combat The training dummy takes 6 damage.
#11835 05:11:18 combat The training dummy takes 18 damage.
#11836 05:11:18 combat The troll is clearly injured.
#11837 05:11:19 combat The troll's attack misses you.
#11838 05:11:19 combat The training dummy takes 13 damage.
#11839 05:11:21 combat The troll's attack misses you.
#11840 05:11:21 combat The training dummy takes 18 damage.
#11841 05:11:22 combat The training dummy takes 5 damage.
#11842 05:11:23 combat The troll's attack wounds you for 6 damage.
#11843 05:11:24 combat The training dummy takes 11 damage.
#11844 05:11:25 combat The troll's attack misses you.
#11845 05:11:25 combat The training dummy takes 6 damage.
#11846 05:11:27 combat The training dummy takes 8 damage.
#11847 05:11:27 combat The troll's attack wounds you for 9 damage.
#11848 05:11:28 combat The training dummy takes 13 damage.
#11849 05:11:29 combat The troll's attack wounds you for 6 damage.
#11850 05:11:30 combat The training dummy takes 11 damage.
#11851 05:11:31 combat The troll's attack misses you.
#11852 05:11:31 combat The training dummy takes 13 damage.
#11853 05:11:33 combat The training dummy takes 2 damage.
#11854 05:11:33 combat The troll's attack wounds you for 7 damage.
#11855 05:11:34 combat The training dummy takes 10 damage.
#11856 05:11:36 combat The troll's attack misses you.
#11857 05:11:36 combat The training dummy takes 8 damage.
#11858 05:11:37 combat The troll's attack misses you.
#11859 05:11:37 combat The training dummy takes 11 damage.
#11860 05:11:39 combat The training dummy takes 1 damage.
```
