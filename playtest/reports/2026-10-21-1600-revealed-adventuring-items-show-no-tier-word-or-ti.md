---
title: "Revealed Adventuring items show no tier word or tier line"
severity: minor
category: "items"
status: new
reported: 2026-10-21T21:00:29.257Z
character: "Scout"
room: "The Temple of Shal'ille [temple.roo, RID 48/3028]"
square: "row 18, col 4"
commit: 7b6c6fd
---

# Revealed Adventuring items show no tier word or tier line

After reveal, the Adventuring hammer reads "adventuring hammer" with no "Slight/Moderate/Potent/Enormous magic" line, unlike the other weapons. Possibly by design, but the brief said every magic weapon has a tier.

## Steps to reproduce

Reveal the Adventuring hammer at Rodric d'Stane (reveal command), examine it.

## Expected

Name with tier word (e.g. "slight adventuring hammer") and a "<Tier> magic: +N to hit, +N damage" line, per the brief.

## Actual

Name "adventuring hammer"; properties list only "50 bonus XP per kill". The Adventuring gold round shield behaves the same. Also: inventory/examine headline uses raw markup "~Badventuring hammer~n" in the headless text.

## The journal before it

```
#156 20:58:19 combat You hit giant rat for 7.
#157 20:58:19 combat The giant rat is slightly wounded.
#158 20:58:20 combat Your short sword stabs the giant rat for 6 damage.
#159 20:58:20 combat You hit giant rat for 6.
#160 20:58:20 combat The giant rat is clearly injured.
#161 20:58:21 combat The giant rat's attack misses you.
#162 20:58:21 combat Your short sword stabs the giant rat for 7 damage.
#163 20:58:21 combat You hit giant rat for 7.
#164 20:58:21 combat The giant rat is weak, and near death.
#165 20:58:22 combat Your short sword runs through the giant rat.
#166 20:58:22 combat You killed the giant rat.
#167 20:58:22 combat You have gained 50 XP.
#168 20:58:22 combat You loot the corpse clean, and find 12 shillings.
#169 20:58:22 combat Your target is gone (dead, or it left).
#170 20:58:23 health Health back to full (20).
#171 20:58:44 room Entered Raza [raza.roo, RID 300].
#172 20:59:05 server You open the door and walk through.
#173 20:59:05 room Entered The Home of Roderic D'Stane [razahut.roo, RID 305].
#174 20:59:05 server Rodric d'Stane says, "Welcome, my son. Have you come to learn some magicks?"
#175 20:59:10 trade Rodric d'Stane sells 18 things.
#176 20:59:12 trade Rodric d'Stane sells 13 things.
#177 20:59:32 room Entered The Temple of Shal'ille [temple.roo, RID 48/3028].
#178 20:59:37 trade Priestess Xiana sells 4 things.
#179 20:59:47 trade Priestess Xiana sells 2 things.
#180 21:00:00 server System is saving; please wait.
#181 21:00:00 server The server is saving: wait.
#182 21:00:00 server System save completed; resume play.
#183 21:00:00 server [###] Your safety is now ON:  You can no longer strike innocents.
#184 21:00:00 server The server finished saving.
#185 21:00:00 room Entered The Temple of Shal'ille [temple.roo, RID 48/3028].
```
