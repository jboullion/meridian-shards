---
title: "Conciliation makes a monster stop fighting for good, not \"a few moments\""
severity: major
category: "combat"
status: new
reported: 2026-10-25T05:51:31.203Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 24, col 37"
commit: dcdec20
---

# Conciliation makes a monster stop fighting for good, not "a few moments"

Conciliation's description: "each monster within hearing that would fight you may lose interest for a few moments". Kod: EnterStateWait(delay=4000). Observed: an adjacent Orc that was fighting me went silent for 60+ seconds and never attacked again until I hit it.

## Steps to reproduce

RID 330. admin_spawn Orc; fight it 2 s so it is attacking (it attacks every ~2.5 s). Cast conciliation (spellpower 65, so 20+65/3 = 41% per 5 s pulse). Watch the events. Cancel the song (cast again), keep waiting 25 s. Then hit the orc once.

## Expected

A 4 second pause with 41% chance per pulse, then the orc is back at it ("falls back to recover for a moment, then returns to the fight"). Without the song it should fight on.

## Actual

Run 1: last orc attack 05:26:55, then nothing for 43 s, then "The orc falls back to recover for a moment, then returns to the fight." at 05:27:38, and still no attack afterwards (until 05:28:45 when I ended the song, and 25 s more); it attacked again only when I struck it (05:29:14). Run 2: attacks at 05:29:48-05:30:01, "falls back to recover..." at 05:30:14, then no attack for 50+ s with the orc adjacent. Cause: Monster.EnterStateWait sets poTarget = $ and piHatred = 0, so the monster forgets the singer and is passive until provoked; the message even says it "returns to the fight" while it does not. So one successful 41% roll de-aggros any monster permanently for 1 ruby + 1 elderberry + 0.6 mana/s (and the song is not even needed afterwards). Very strong against single monsters. Used admin_spawn.

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
