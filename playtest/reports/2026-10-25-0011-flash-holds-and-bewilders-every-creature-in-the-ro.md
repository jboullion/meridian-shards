---
title: "Flash holds and bewilders every creature in the room at any distance, with one message each"
severity: minor
category: "other"
status: new
reported: 2026-10-25T05:11:39.707Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 23, col 44"
commit: dcdec20
---

# Flash holds and bewilders every creature in the room at any distance, with one message each

Flash has no range: flash.kod GetTargets takes every Battler in the room, so a cast in the Outskirts of Raza (RID 330) printed 13 identical "Duration of hold is 2 seconds." lines, one per monster in the whole room (only 4 were within 12 squares). Each is held about 2 s and bewildered, far-off sleeping monsters included.</summary>
<parameter name="steps">Scout, Outskirts of Raza, spellpower 59 (morphed cow, no gear). A giant rat attacking me. cast flash (no target).

## Expected

Description: "Causes a bright flash, likely to interrupt the concentration of any foe casting a spell in the area, or to hold monsters for a moment." "In the area" and a quiet result, the brief says it holds monsters 1-3 s.

## Actual

#11324-#11336: thirteen lines "Duration of hold is 2 seconds." (no name of who was held), then "Spellpower for flash is 59." Hold time is 1 s + spellpower*20 ms (2.2 s here, 3 s at 99), chance 33 + 2/3 spellpower. Not blinded myself, and nobody else was around (no ally test possible: alone, no companion). Suggest a radius and a single summary line.

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
