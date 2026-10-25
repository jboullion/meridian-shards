---
title: "Profane Resonance lets health climb to twice the maximum (173/100 seen), no cap but 200%"
severity: major
category: "combat"
status: new
reported: 2026-10-25T05:51:37.255Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 24, col 37"
commit: dcdec20
---

# Profane Resonance lets health climb to twice the maximum (173/100 seen), no cap but 200%

Profane Resonance: "a little of what it takes flows back to you as health". Each pulse the singer gains 1 health per foe hurt, through Player.GainHealth, which is the vampiric path and allows health up to 200 x max. With 6 foes (the training dummies never die) I reached Health 173/100 in about 45 seconds, and no text warns of it.

## Steps to reproduce

RID 330 with 6 training dummies (spawn 5 + 1) in the room. Cast profane resonance (spellpower 65). After 9 pulses end it (rest). status: "Health 173/100". It fell back to 164, 150 and 100 over the next minute while rats hit me (decays slowly).

## Expected

Description gives no overheal; a healing song normally stops at max health (Restorate/Rejuvenate use bRespectMax). Max health 100 should cap at 100, or the overheal should be written up and capped lower.

## Actual

player.kod GainHealth caps at 200*piMax_health. 1 HP per foe in the room per 5 s (the whole room, see the range report) is +1.2 HP/s with 6 foes, so a bard standing among a pack gets a temporary double health bar. Note also that foes that cannot die (dummies) turn it into free overheal. Used admin_spawn.

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
