---
title: "Holy Weapon adds flat holy damage to every hit, not extra against the unholy"
severity: minor
category: "items"
status: new
reported: 2026-10-25T01:28:43.100Z
character: "Scout"
room: "The Inn of Raza [razainn.roo, RID 301]"
square: "row 3, col 8"
commit: dcdec20
---

# Holy Weapon adds flat holy damage to every hit, not extra against the unholy

Description: "Dedicates your weapon to Shal'ille, enhancing its effectiveness against the unholy." The revealed mace says "+1 to 5 holy damage on every hit (against players, only followers of Qor)" and "5 general spellpower". It is the same bonus on a rat as on a zombie, and the spellpower bonus (+5 to every Shal'ille spell while wielded) is not in the spell description.

## Steps to reproduce

Scout (Shal'ille, 99%). cast holy weapon on the mace (spellpower 86; "Your mace is now dedicated to Shal'ille."). Wield it, fight a zombie then a giant rat (holy touch off): holy mace vs zombie 10,12,12,8,12 (avg 10.8); vs rat 9,8,8 (avg 8.3); a plain mace vs zombie hit 7,7,3,3,3,7,6,4,4 (avg ~4.9). Wielding the holy mace, breath of life and spiritual hammer printed "Spellpower ... is 91" instead of 86; unwielded 86 again. Cast reveal on it: properties list above ("5 general spellpower", "+1 to 5 holy damage on every hit...").

## Expected

Extra effect mostly against undead/evil as the description says; mention of the spellpower bonus.

## Actual

Roughly +3 damage to everything (about +100% on a basic mace) and +5 Shal'ille spellpower. A player reading the description would not expect it to be a general damage boost.

## The journal before it

```
#789 01:27:27 combat The skeleton's attack misses you.
#790 01:27:28 companion {"type":"health","hp":4,"maxHp":16}
#791 01:27:29 combat The skeleton's attack stabs you for 6 damage.
#792 01:27:29 server This creature is the servant of another player - you are not yet experienced enough to fight it.
#793 01:27:32 combat The skeleton's attack pokes you for 4 damage.
#794 01:27:33 server Osric has fallen!  Restore Companion on the body brings it back, or it will recover at its leader's hall.
#795 01:27:33 companion {"type":"status","status":{"state":3,"flags":0,"id":0,"name":"Osric","kindName":"battle-mage of the Duke","kind":1,"hp":0,"maxHp":16,"bond":127,"tier":1,"tierFloor":0,"nextTier":300,"stance":2,"room":"","secondsLeft":0,"fee":600,"packCount":0,"packBulk":0,"bulkMax":2400,"look":{"gender":0,"hair":6,"eyes":2,"nose":1,"mouth":0,"beard":0,"hairColour":8,"skin":1,"colour1":0,"colour2":1},"palette":[7,6,12,9,10]}}
#796 01:27:33 companion {"type":"health","hp":0,"maxHp":16}
#797 01:27:35 combat The skeleton's attack misses you.
#798 01:27:37 health Health 8/24: below 50%.
#799 01:27:37 combat The skeleton's attack stabs you for 6 damage.
#800 01:27:38 room Entered The Inn of Raza [razainn.roo, RID 301].
#801 01:27:38 server Marcus says, "Hello, Scout, and welcome to Meridian 59!"
#802 01:27:42 server You concentrate on the mace, and gradually its secrets become plain for all to see!
#803 01:27:42 look mace: ~Bholy mace~n

Lethal in appearance, this weapon is actually only minimally effective.  Its spiked head is made of soft metal and its wooden shaft is thin and brittle.

The weapon glows with a pure, white light.  Enchanted by Scout, Master sanctifier.

This item has the following properties:
3 range
75 offense rating bonus
3-7 base damage
5 general spellpower
Deals bludgeon damage
Deals mundane damage
Deals holy damage
+1 to 5 holy damage on every hit (against players, only followers of Qor)
60 weight and 60 bulk

This mace is in excellent condition, but has been repaired before. (221/229)
#804 01:27:42 server Spellpower for reveal is 62.
#805 01:27:52 room Entered Outskirts of Raza [razaforest.roo, RID 330].
#806 01:27:52 server This place is permeated by a holy presence;  you can feel the eyes of Shal'ille watching you, warning you against calling upon the magical forces of Qor.
#807 01:27:52 combat The skeleton's attack stabs you for 5 damage.
#808 01:27:54 health Health 1/24: below 20%.
#809 01:27:54 combat The skeleton's attack stabs you for 5 damage.
#810 01:27:57 server The skeleton skewers you with a deft thrust.  Sluish!
#811 01:27:57 combat The skeleton's attack runs through you.
#812 01:27:57 server You are dead, poor soul.  Go now, and take revenge on the skeleton!
#813 01:27:57 server [###] Scout was just killed by a skeleton.
#814 01:27:57 room Entered The Underworld [uworld.roo, RID 1].
#815 01:27:57 health You died: you're in the Underworld.
#816 01:27:59 server Only a fallen companion's body answers restore companion.
#817 01:28:09 room Entered The Inn of Raza [razainn.roo, RID 301].
#818 01:28:09 server Marcus says, "Hello, Scout, and welcome to Meridian 59!"
```
