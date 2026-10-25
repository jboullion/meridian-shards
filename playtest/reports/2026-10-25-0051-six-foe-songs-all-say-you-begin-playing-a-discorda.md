---
title: "Six foe songs all say \"You begin playing a discordant tune.\" / \"Your discordant tune fades.\""
severity: cosmetic
category: "text"
status: new
reported: 2026-10-25T05:51:47.322Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 24, col 37"
commit: dcdec20
---

# Six foe songs all say "You begin playing a discordant tune." / "Your discordant tune fades."

Sacred Resonance, Profane Resonance, Disharmony, Civility, Conciliation and Truth print the same cast message "You begin playing a discordant tune." and the same end message "Your discordant tune fades.", although hinder.kod defines "You begin playing a song against your foes." / "Your song fades." (hinder_cast, hinder_caster_ends). A hymn of holy fire, a courtly air and a soothing melody are not "discordant".

## Steps to reproduce

Cast each of the six songs in RID 330 and read the first server line. Cancel with a second cast.

## Expected

A message that fits the song (or hinder.kod's own text).

## Actual

"You begin playing a discordant tune." for all six (events 11965, 12292, 12628, 12992, 13062, 13105, 13190); end: "Your discordant tune fades." Probably a stale resource in hinder.lkod overriding hinder.kod. Warp Time and Spellbane have their own texts.

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
