---
title: "Riija wording: no spellpower line for Wounds, wasted Vertigo recast, odd Forget/Transmogrify text"
severity: cosmetic
category: "text"
status: new
reported: 2026-10-25T05:11:50.754Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 23, col 44"
commit: dcdec20
---

# Riija wording: no spellpower line for Wounds, wasted Vertigo recast, odd Forget/Transmogrify text

Small text and feedback oddities seen casting the Riija school (spellpower 57-63).

## Steps to reproduce

Cast the spells named below on a training dummy / orc in the Outskirts of Raza.

## Expected

Consistent feedback: every cast prints "Spellpower for X is N." (README); correct grammar; no cost when a spell can't take effect.

## Actual

1) Illusionary Wounds never prints "Spellpower for illusionary wounds is N." (about 12 casts; every other Riija spell does). 2) Vertigo on a target already vertigoed: "The training dummy already appears to be freaking." and the 11 mana was still spent. 3) Forget on a single orc: "You glare at the orc and they appear momentarily confused." (they). 4) Transmogrify: "The orc warps and reforms into The cow!" (capital The). 5) Dement on a monster: "You sense an unsavory presence." (says nothing of the target). 6) Morph never printed "Spellpower for morph is N.". 7) The Illusionary Wounds and Illusionary Fire Wall descriptions have no "At your spellpower:" numbers, unlike Vertigo.

## The journal before it

```
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
#11861 05:11:39 combat The troll's attack misses you.
#11862 05:11:41 combat The training dummy takes 3 damage.
#11863 05:11:41 combat The troll's attack wounds you for 9 damage.
#11864 05:11:42 combat The training dummy takes 1 damage.
#11865 05:11:43 combat The troll's attack misses you.
#11866 05:11:43 combat The training dummy takes 20 damage.
#11867 05:11:45 combat The training dummy takes 1 damage.
#11868 05:11:45 combat The troll's attack wounds you for 6 damage.
#11869 05:11:46 combat The training dummy takes 15 damage.
#11870 05:11:47 combat The troll's attack misses you.
#11871 05:11:48 combat The training dummy takes 2 damage.
#11872 05:11:49 combat The troll's attack wounds you for 8 damage.
#11873 05:11:50 combat The training dummy takes 8 damage.
```
