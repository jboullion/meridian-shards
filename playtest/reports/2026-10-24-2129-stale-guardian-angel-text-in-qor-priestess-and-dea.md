---
title: "Stale \"guardian angel\" text in Qor priestess and Death Rift; \"pile of bones's remains\" in Animate"
severity: cosmetic
category: "text"
status: new
reported: 2026-10-25T02:29:41.173Z
character: "Scout"
room: "The Inn of Raza [razainn.roo, RID 301]"
square: "row 3, col 8"
commit: dcdec20
---

# Stale "guardian angel" text in Qor priestess and Death Rift; "pile of bones's remains" in Animate

Wording left over from the guardian angel system, and an awkward Animate line.

## Steps to reproduce

Read qorprst.kod (qorpriestess_not_powerful) and deathrift.kod (DeathRift_no_angeled). Cast animate on a skeleton's pile of bones in the Raza crypt.

## Expected

No mention of guardian angels (they are gone), and a sensible name in the Animate line.

## Actual

1) Priestess Zuxana's refusal for Poison Gas: "Come back when you have rid yourself of that pathetic guardian angel and are ready to kill others for the glory of the Dark Mistress." 2) DeathRift_no_angeled: "You cannot call upon such an evil pact while your guardian angel watches over you." (vbAngeledCast = TRUE bypasses it, but the text remains.) 3) Animate on a skeleton's bones prints "The pile of bones's remains come alive and rise up from the ground." 4) Unholy Touch kill line "Dark evil energy escapes from the giant rat, ripping apart their soul." (their, for a rat).

## Screenshot

![What the game showed](2026-10-24-2129-stale-guardian-angel-text-in-qor-priestess-and-dea.png)

## The journal before it

```
#1453 02:27:52 server The prism darkens and a blanket of silence seems to settle over you as the chant ceases.
#1454 02:27:53 combat The mummy's attack misses you.
#1455 02:27:57 combat The mummy's attack misses you.
#1456 02:28:00 combat The mummy's attack misses you.
#1457 02:28:04 combat The mummy's attack nicks you for 1 damage.
#1458 02:28:05 combat The mummy is seriously wounded.
#1459 02:28:08 combat The mummy's attack misses you.
#1460 02:28:09 health Health back to full (100).
#1461 02:28:11 combat The mummy's attack misses you.
#1462 02:28:11 combat The mummy is weak, and near death.
#1463 02:28:14 combat You killed the mummy.
#1464 02:28:14 combat You can't carry any more, so you loot nothing from your fallen enemy, but you do find 11 shillings.
#1465 02:28:14 combat The battered skeleton has valiantly slain the mummy!
#1466 02:28:18 room Entered Raza [raza.roo, RID 300].
#1467 02:28:28 room Entered Mausoleum [razacrypt.roo, RID 306].
#1468 02:28:28 server You no longer have resistance to good.
#1469 02:28:36 combat The orc wizard's attack misses you.
#1470 02:28:36 server You focus your whole will on casting hold.
#1471 02:28:37 server The orc wizard is now held in place by a magical force.
#1472 02:28:37 server Duration of hold is 4 seconds.
#1473 02:28:37 server Spellpower for hold is 75.
#1474 02:28:50 server A curtain of silence falls across the room.
#1475 02:28:50 server Spellpower for silence is 75.
#1476 02:29:07 server The curtain of silence is lifted.
#1477 02:29:11 room Entered The Inn of Raza [razainn.roo, RID 301].
#1478 02:29:12 server Marcus says, "Hello, Scout, and welcome to Meridian 59!"
#1479 02:29:16 server You focus your whole will on casting nodeburst.
#1480 02:29:18 server You open all your mana links to the maximum and mana floods down the links.
#1481 02:29:18 server Spellpower for nodeburst is 67.
#1482 02:29:18 server You lose your connection to the mana node in The Badlands.
```
