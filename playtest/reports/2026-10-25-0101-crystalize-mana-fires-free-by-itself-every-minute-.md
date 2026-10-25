---
title: "Crystalize Mana fires free by itself every minute: ~129 mana, no reagents, health or vigor"
severity: major
category: "combat"
status: new
reported: 2026-10-25T06:01:43.146Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 24, col 37"
commit: dcdec20
---

# Crystalize Mana fires free by itself every minute: ~129 mana, no reagents, health or vigor

When a song's per-pulse upkeep, or any other cast, can't be paid, Crystalize Mana triggers by itself ("With your spiritual energy depleted and your soul quiet, you find yourself able to hear a vast and distant song... Incredible energies roar through you!"). The triggered surge costs no reagents, no vigor and no health, and gives max mana + 40 (129 for max 89) about every 59 seconds (wait time (396 - 2*ability)*300 ms). A bard can therefore keep a 2 mana/s song going forever.

## Steps to reproduce

Mana set to 14 by the developer. Cast jig (10 per pulse) in RID 330 with nothing else. 05:53:38 first surge (mana 5, shown 127/29 afterwards), then jig kept playing: surge again 05:54:48 and 05:55:49. Jig ran more than 2 minutes on a 14 mana start. At 06:01:23 with mana 4, cast minor heal on myself: the surge fired first (mana 4 -> 122/29), the heal worked (+5 HP), health 100, vigor 77 unchanged.

## Expected

The description calls the surge "exhausting"; an earlier stage saw health fall after it. Some cost (health, vigor, reagents) was expected, so it is not unlimited free mana.

## Actual

No cost visible for triggered surges: health stayed 100/100 at every surge (05:53:38, 05:54:48, 05:55:49, 06:00:10, 06:01:23), vigor unchanged. Only drawback: max mana shown 29/89 for about a minute (natural regen of about 1 mana/s still ran: 3 -> 26 in 24 s). A manual cast at 13 mana was refused ("Your spirit is too weak to summon another surge of energy at this time.") because a pulse had just triggered it. Net: free 129 mana per minute (2.2 mana/s, more than Mana Convergence's 1.8/s). With the cooldown running and mana unable to pay the upkeep, each song just ends at its own pulse ("You stop playing your little jig.", "Your woozy, drawn out song fades.", no health loss). Used the developer's mana setting.</actual>
<parameter name="screenshot">false

## The journal before it

```
#14680 06:01:26 combat The giant rat's attack misses you.
#14681 06:01:27 combat The giant rat's attack misses you.
#14682 06:01:28 combat The giant rat's attack misses you.
#14683 06:01:28 combat The giant rat's attack misses you.
#14684 06:01:29 combat The giant rat's attack claws you for 3 damage.
#14685 06:01:29 combat The baby spider's attack gnaws you for 2 damage.
#14686 06:01:29 combat The giant rat's attack misses you.
#14687 06:01:30 combat The giant rat's attack misses you.
#14688 06:01:31 combat The giant rat's attack misses you.
#14689 06:01:31 combat The giant rat's attack misses you.
#14690 06:01:32 combat The giant rat's attack misses you.
#14691 06:01:32 combat The giant rat's attack misses you.
#14692 06:01:33 combat The baby spider's attack misses you.
#14693 06:01:33 combat The giant rat's attack misses you.
#14694 06:01:34 combat The giant rat's attack misses you.
#14695 06:01:34 combat The giant rat's attack misses you.
#14696 06:01:35 combat The giant rat's attack misses you.
#14697 06:01:36 combat The giant rat's attack misses you.
#14698 06:01:36 combat The giant rat's attack misses you.
#14699 06:01:37 combat The baby spider's attack gnaws you for 1 damage.
#14700 06:01:37 combat The giant rat's attack misses you.
#14701 06:01:38 combat The giant rat's attack misses you.
#14702 06:01:38 combat The giant rat's attack misses you.
#14703 06:01:39 combat The giant rat's attack misses you.
#14704 06:01:40 combat The giant rat's attack misses you.
#14705 06:01:41 combat The giant rat's attack misses you.
#14706 06:01:41 combat The giant rat's attack misses you.
#14707 06:01:41 combat The giant rat's attack misses you.
#14708 06:01:41 combat The baby spider's attack misses you.
#14709 06:01:42 combat The giant rat's attack misses you.
```
