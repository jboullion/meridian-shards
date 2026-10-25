---
title: "Poison is in the Qor spell list with a description, but casting it does nothing, silently"
severity: minor
category: "other"
status: new
reported: 2026-10-25T02:12:11.017Z
character: "Scout"
room: "The Inn of Raza [razainn.roo, RID 301]"
square: "row 3, col 8"
commit: dcdec20
---

# Poison is in the Qor spell list with a description, but casting it does nothing, silently

Poison (Qor level 1) appears in Scout's spell list as "poison (needs a target)", has a description in playtest/spells/descriptions-qor.md ("Costs: 9 mana, 4 vigor") and a mana cost, but cast on a rat three times it prints nothing: no spellpower line, no mana or vigor spent, no refusal.</summary>
<parameter name="steps">Scout in the Raza crypt (RID 306), spawn giant rats with admin_spawn. cast poison on a rat (target id). Repeat three times with 2 s gaps. wait_events shows only monster attacks.

## Expected

Either a working spell (the description promises "Like fire under your skin, the poison burns...") or a spell that isn't listed or described. The Qor priestess does not teach it either (qorprst.kod SetForSale has no SID_POISON).

## Actual

poison.kod says "Players can't actually cast poison directly" and sets pbAccessible = FALSE. The cast is swallowed: mana went 76 -> 81 -> 82 while I cast it, so nothing was spent. A real player could never learn it; only the test fixture shows it. The description file should drop it, and the list should not offer a spell that does nothing.

## Screenshot

![What the game showed](2026-10-24-2112-poison-is-in-the-qor-spell-list-with-a-description.png)

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
