---
title: "Final Rites gives no damage or kill feedback and ignores \"nearby\""
severity: minor
category: "combat"
status: new
reported: 2026-10-25T01:28:43.116Z
character: "Scout"
room: "The Inn of Raza [razainn.roo, RID 301]"
square: "row 3, col 8"
commit: dcdec20
---

# Final Rites gives no damage or kill feedback and ignores "nearby"

Final Rites damages every undead in the room, but the caster sees no damage numbers (other spells print "for N damage"), and the "shrieks in pain" line (FinalRites_hurt) is never used. The description says "nearby undead".

## Steps to reproduce

Admin_spawn 3 Zombie and 1 GiantRat next to Scout in the Outskirts (RID 330). Cast final rites 3 times (spellpower 86). Events each cast: "You crush the reagents into a fine powder...", "With a solemn murmur Scout casts a handful of dust heavenward.", "The zombie staggers backwards from the blow." x3, then "You killed the zombie." Cast 2 and 3 killed the zombies, the rat was untouched. No "hit for N" lines, no wounded-state lines.

## Expected

A hit line per undead like Holy Blaze's ("... for N damage" and "The zombie is clearly injured."), per finlrite.kod damage 12-20 + spellpower/6 (26-34 at 86). Description says "nearby" but GetTargets takes every undead in the room.

## Actual

No numbers shown. Whole-room range. 3 zombies died in 3 casts (57 mana, 6 emeralds, 9 elderberries), about 2 casts per zombie.

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
