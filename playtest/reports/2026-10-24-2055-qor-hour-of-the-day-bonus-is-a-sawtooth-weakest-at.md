---
title: "Qor \"hour of the day\" bonus is a sawtooth: weakest at midnight, strongest at 23:00"
severity: major
category: "other"
status: new
reported: 2026-10-25T01:55:16.628Z
character: "Scout"
room: "The Inn of Raza [razainn.roo, RID 301]"
square: "row 3, col 8"
commit: dcdec20
---

# Qor "hour of the day" bonus is a sawtooth: weakest at midnight, strongest at 23:00

Qor spellpower rises steadily with the server hour (hour+2) instead of peaking at night, then drops by about 20 at hour 0. Midnight is the worst hour for Qor, 23:00 the best, and noon sits in the middle. A Qor mage in a bright field at noon is as strong as one in a dark crypt at midnight.

## Steps to reproduce

Scout, Qor spells at 99%, full vigor, Inn of Raza (RID 301). admin_hour N (helper), then cast Unholy Resolve (self cast, 2 mana) and read "Spellpower for unholy resolve is X".
Also Vampiric Drain / Unholy Resolve in the Raza crypt (RID 306) and Outskirts (RID 330).

## Expected

spell.kod GetSpellPower comment: "Qor strength determined by day or night." The brief and README say dark-school spellpower is worst at noon. I expected the hour bonus to peak around midnight and fall toward noon.

## Actual

Inn of Raza, spellpower by server hour: 0:60, 1:59, 3:61, 5:61, 6:61, 9:63, 12:66, 15:69, 18:72, 20:74, 22:77, 23:79 (then back to 60 at hour 0). Crypt (dark): hour 12 -> 74, hour 0 -> 64. Outskirts (field): hour 0 -> 66, hour 12 -> 68 (those two were at slightly different vigor). The code is `iPrimaryBonus = (2 + Send(SYS,@GetHour))` (spell.kod line 2557), GetHour being 0-23: a ramp from 2 to 25 that resets at midnight. So a Qor mage at noon in a sunlit field (68) is stronger than at midnight in the dark crypt (64), and hour 0 is the worst moment of the whole day. The description file was apparently taken at game hour 9 (hour +11 = 2+9), not noon.

## Screenshot

![What the game showed](2026-10-24-2055-qor-hour-of-the-day-bonus-is-a-sawtooth-weakest-at.png)

## The journal before it

```
#92 01:53:28 server The spirit of Qor enters your body, protecting you from the forces of good.
#93 01:53:28 server Spellpower for unholy resolve is 74.
#94 01:53:34 server The spirit of Qor enters your body, protecting you from the forces of good.
#95 01:53:34 server Spellpower for unholy resolve is 64.
#96 01:53:48 room Entered The Inn of Raza [razainn.roo, RID 301].
#97 01:53:48 server Marcus says, "Hello, Scout, and welcome to Meridian 59!"
#98 01:53:50 server The spirit of Qor enters your body, protecting you from the forces of good.
#99 01:53:50 server Spellpower for unholy resolve is 60.
#100 01:53:52 server The spirit of Qor enters your body, protecting you from the forces of good.
#101 01:53:52 server Spellpower for unholy resolve is 61.
#102 01:53:54 server The spirit of Qor enters your body, protecting you from the forces of good.
#103 01:53:54 server Spellpower for unholy resolve is 72.
#104 01:53:55 server The spirit of Qor enters your body, protecting you from the forces of good.
#105 01:53:55 server Spellpower for unholy resolve is 79.
#106 01:54:06 server The spirit of Qor enters your body, protecting you from the forces of good.
#107 01:54:06 server Spellpower for unholy resolve is 77.
#108 01:54:08 server The spirit of Qor enters your body, protecting you from the forces of good.
#109 01:54:08 server Spellpower for unholy resolve is 59.
#110 01:54:10 server The spirit of Qor enters your body, protecting you from the forces of good.
#111 01:54:10 server Spellpower for unholy resolve is 61.
#112 01:54:11 server The spirit of Qor enters your body, protecting you from the forces of good.
#113 01:54:11 server Spellpower for unholy resolve is 60.
#114 01:54:21 server The spirit of Qor enters your body, protecting you from the forces of good.
#115 01:54:21 server Spellpower for unholy resolve is 63.
#116 01:54:23 server The spirit of Qor enters your body, protecting you from the forces of good.
#117 01:54:23 server Spellpower for unholy resolve is 69.
#118 01:54:25 server The spirit of Qor enters your body, protecting you from the forces of good.
#119 01:54:25 server Spellpower for unholy resolve is 74.
#120 01:54:27 server The spirit of Qor enters your body, protecting you from the forces of good.
#121 01:54:27 server Spellpower for unholy resolve is 61.
```
