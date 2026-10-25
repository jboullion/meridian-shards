---
title: "Poison Gas fog does nothing to monsters (PvP-only), though the description doesn't say so"
severity: minor
category: "other"
status: new
reported: 2026-10-25T02:12:11.228Z
character: "Scout"
room: "The Inn of Raza [razainn.roo, RID 301]"
square: "row 3, col 8"
commit: dcdec20
---

# Poison Gas fog does nothing to monsters (PvP-only), though the description doesn't say so

Poison Gas (19 mana, 2 entroot berries, 1.6 s cast) creates a 9-square "thick fog" but monsters standing in it take no poison. Description: "Creates a pungent cloud of poisonous fog."</summary>
<parameter name="steps">Scout, Raza crypt (RID 306), spawn giant rats and mummies, cast poison gas, wait 25 s with rats and a mummy standing on fog squares (look_around lists 9 "thick fog" things around me, rat at row 8 col 26 is on one). Examine the rat before and after: "This monster will take you to 30 hitpoints." both times; no damage lines.</steps>
<parameter name="expected">The fog hurts creatures in it, or the description says it only affects players. Qor's level 3 area spell should work in PvE: the original poison fog cloud poisons monsters too.

## Actual

poisfogc.kod DoEffect calls Poison.MakePoisoned, which starts with "if not isClass(who,&Player) return;", so monsters are never poisoned. 19 mana + 2 berries for a cloud that cannot hurt anything but players. It also did nothing to me at the edge of it. Balance: today it is a useless PvE spell.</actual>

## Screenshot

![What the game showed](2026-10-24-2112-poison-gas-fog-does-nothing-to-monsters-pvp-only-t.png)

## The journal before it

```
#1050 02:11:23 combat The orc wizard's attack crushes you for 9 damage.
#1051 02:11:25 combat The mage of the Duke's army's attack misses you.
#1052 02:11:25 combat The orc wizard's attack crushes you for 6 damage.
#1053 02:11:27 combat The mage of the Duke's army's attack misses you.
#1054 02:11:27 combat The orc wizard's attack misses you.
#1055 02:11:33 combat The mage of the Duke's army's attack misses you.
#1056 02:11:36 combat The mage of the Duke's army's apprentice wand wounds you for 5 damage.
#1057 02:11:36 combat The orc wizard's attack crushes you for 5 damage.
#1058 02:11:37 combat The mage of the Duke's army's apprentice wand wounds you for 6 damage.
#1059 02:11:38 combat The orc wizard's attack crushes you for 8 damage.
#1060 02:11:39 server A shimmering field cloaks your body.
#1061 02:11:39 server Spellpower for invisibility is 72.
#1062 02:11:40 combat The mage of the Duke's army's attack misses you.
#1063 02:11:40 health Health 49/100: below 50%.
#1064 02:11:40 combat The orc wizard's attack crushes you for 6 damage.
#1065 02:11:42 combat The mage of the Duke's army's attack misses you.
#1066 02:11:42 combat The orc wizard's attack misses you.
#1067 02:11:44 combat The mage of the Duke's army's attack misses you.
#1068 02:11:44 health Health 44/100: below 50%.
#1069 02:11:44 combat The orc wizard's attack crushes you for 6 damage.
#1070 02:11:47 combat The mage of the Duke's army's apprentice wand wounds you for 8 damage.
#1071 02:11:47 combat The orc wizard's attack misses you.
#1072 02:11:47 server A curtain of silence falls across the room.
#1073 02:11:47 server Spellpower for silence is 72.
#1074 02:11:48 server The curtain of silence is lifted.
#1075 02:11:48 combat The mage of the Duke's army's apprentice wand wounds you for 7 damage.
#1076 02:11:49 combat The orc wizard's attack misses you.
#1077 02:11:50 combat The mage of the Duke's army's attack misses you.
#1078 02:11:51 room Entered The Inn of Raza [razainn.roo, RID 301].
#1079 02:11:51 server Marcus says, "Hello, Scout, and welcome to Meridian 59!"
```
