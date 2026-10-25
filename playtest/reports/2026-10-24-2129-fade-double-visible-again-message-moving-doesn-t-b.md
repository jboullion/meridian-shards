---
title: "Fade: double \"visible again\" message; moving doesn't break it; a cast made while faded is swallowed"
severity: minor
category: "other"
status: new
reported: 2026-10-25T02:29:40.969Z
character: "Scout"
room: "The Inn of Raza [razainn.roo, RID 301]"
square: "row 3, col 8"
commit: dcdec20
---

# Fade: double "visible again" message; moving doesn't break it; a cast made while faded is swallowed

Fade's description says "doing anything at all breaks it". Casting or attacking does; walking does not. When it breaks you get two lines, and a spell cast to break it is lost.

## Steps to reproduce

Scout in the Raza crypt (RID 306) at hour 0. cast fade ("Spellpower for fade is 65/67"). 1) walk_to a square 1 away and 9,22: still faded. 2) cast darkness: "Your physical form is visible once more." and "You lose your concentration and become visible once more." and darkness is NOT cast (no spellpower line, no mana spent). Cast darkness again: works. 3) Faded again, attack a rat with acid touch on: same two lines, the attack lands. 4) Skeleton already chasing me, cast fade: it stopped attacking within 12 s (good).

## Expected

One message when Fade ends (fade.kod has both fade_off and fade_broke_trance). The brief: "doing anything at all breaks it". Breaking the trance with a spell should either cast it or say the cast was lost.

## Actual

Two lines every time it breaks: "Your physical form is visible once more." then "You lose your concentration and become visible once more." Walking does not break the trance, so the description overstates. The breaking cast is silently dropped, which wastes a turn in a fight (same for Silence per the dev). Fade lasts 120+5*spellpower seconds (about 445 s at 65) and costs no mana while held: description's "as long as your trance is maintained" suggests a drain that doesn't exist.

## Screenshot

![What the game showed](2026-10-24-2129-fade-double-visible-again-message-moving-doesn-t-b.png)

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
