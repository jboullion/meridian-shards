---
title: "Song descriptions list only the starting cost; the per-pulse mana drain is not mentioned"
severity: minor
category: "text"
status: new
reported: 2026-10-25T05:52:24.198Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 24, col 37"
commit: dcdec20
---

# Song descriptions list only the starting cost; the per-pulse mana drain is not mentioned

The "Costs:" line of every sustained song shows only the start-up cost (e.g. warp time "4 mana, 2 diamonds"), but the song then drains mana every 5 s until stopped. A new bard reading "Costs: 4 mana" will not expect Warp Time to cost 1 mana/s, Spellbane 1.6/s, Mana Convergence 1.8/s, Jig 2/s, a damage/debuff song 0.6/s.

## Steps to reproduce

Read descriptions-jala.md (or look at the spell); cast warp time (RID 330) and compare status Mana before/after 25 s: 647 -> 642 in about 7 s (5 per pulse). Sacred resonance: 896 -> 852 over about 55 s. Songs also never end by themselves; the text does not say that resting, or casting the song again, stops it.

## Expected

Costs line (or description) mentions the upkeep ("then 3 mana every 5 seconds") and how to stop the song.

## Actual

Kod classvars viManaDrain per song: foe songs 3, Warp Time 5, Spellbane 8, Mana Convergence 9, Jig 10, Rejuvenate 1, Invigorate/Restorate/Mirth/Melancholy 0 per viDrainTime 5000 ms. None of it is in the Costs line or the description.

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
