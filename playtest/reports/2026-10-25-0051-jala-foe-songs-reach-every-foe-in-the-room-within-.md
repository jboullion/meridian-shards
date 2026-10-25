---
title: "Jala foe songs reach every foe in the room: \"within hearing\" ignores distance (hit at 30 squares)"
severity: major
category: "combat"
status: new
reported: 2026-10-25T05:51:24.374Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 24, col 37"
commit: dcdec20
---

# Jala foe songs reach every foe in the room: "within hearing" ignores distance (hit at 30 squares)

Sacred/Profane Resonance, Disharmony, Civility, Conciliation, Warp Time, Truth and Spellbane say they affect foes "within hearing", and the code has a radius (viBaseRange 5 squares + up to 5 more with spellpower, about 8.3 squares at spellpower 65). In play the radius is not applied: foes 30 squares away are hit every pulse, both for a song already running when I walked away and for a song freshly cast from far away.

## Steps to reproduce

Admin_teleport to Outskirts of Raza (RID 330). admin_spawn TrainingDummy x5 on (24,38), another dummy on (23,24). Stand at (24,37), cast sacred resonance (spellpower 65). Walk west to (23,30) [8 sq], (23,29) [9 sq], (23,23) [15 sq], (23,8) [30 sq]. At each stop count the "The training dummy takes N damage." lines of each 5 s pulse. Then cast sacred resonance again from (23,8) (cancel with a second cast, recast).

## Expected

Description: "Every five seconds it sears your foes within hearing". radiusench.kod: CalculateRange = viBaseRange (5 squares) + viBaseRange*spellpower/99, so about 8.3 squares at spellpower 65. Foes further away should not be hurt, and a foe that is out of hearing at cast time should not get the song at all.

## Actual

All 5 dummies at (24,38) kept taking 3-5 damage per pulse at 6, 8, 9, 15 and 30 squares away (5 lines per pulse, plus the 6th dummy at 16 squares once I was at col 8). A fresh cast from (23,8), 30 and 16 squares from the dummies, also hit all 6. Real monsters too: the whole pack of rats/spiders/skeleton in the 70x70 field died while out of sight. Probable cause in radiusench.kod StartNewRadiusEnchantment (line ~440): the range check is Send(who,@SquaredFineDistanceToLocation3D,...) where who is the CASTER, measured to the caster's own square, so it is always 0 and every holder in the room passes; and CheckRadiusEnchantment does not seem to run (or to drop them) when the singer walks off. Used admin_teleport/admin_spawn.

## The journal before it

```
#14077 05:51:03 combat Your attack is parried by the orc.
#14078 05:51:04 combat Your punch pummels the orc for 6 damage.
#14079 05:51:04 combat You hit orc for 6.
#14080 05:51:04 combat The orc is clearly injured.
#14081 05:51:05 combat The orc's attack slashes you for 6 damage.
#14082 05:51:05 combat Your attack is parried by the orc.
#14083 05:51:06 combat Your attack is dodged by the orc.
#14084 05:51:07 combat Your punch pummels the orc for 8 damage.
#14085 05:51:07 combat You hit orc for 8.
#14086 05:51:07 combat The orc's attack misses you.
#14087 05:51:08 combat Your punch slaps the orc for 3 damage.
#14088 05:51:08 combat You hit orc for 3.
#14089 05:51:09 combat Your punch pummels the orc for 7 damage.
#14090 05:51:09 combat You hit orc for 7.
#14091 05:51:09 combat The orc is seriously wounded.
#14092 05:51:10 combat The orc's attack cuts you for 3 damage.
#14093 05:51:10 combat Your attack misses the orc.
#14094 05:51:11 combat Your punch pummels the orc for 5 damage.
#14095 05:51:11 combat You hit orc for 5.
#14096 05:51:12 combat The orc's attack misses you.
#14097 05:51:12 combat Your punch pummels the orc for 7 damage.
#14098 05:51:12 combat You hit orc for 7.
#14099 05:51:12 combat The orc is weak, and near death.
#14100 05:51:14 combat Your punch pummels the orc for 8 damage.
#14101 05:51:14 combat You hit orc for 8.
#14102 05:51:15 combat Your punch thrashes the orc.
#14103 05:51:15 server The orc crumples to the ground, never to rise again.
#14104 05:51:15 combat You can't carry any more, so you loot nothing from your fallen enemy, but you do find 28 shillings.
#14105 05:51:15 combat Your target is gone (dead, or it left).
#14106 05:51:16 health Health back to full (100).
```
