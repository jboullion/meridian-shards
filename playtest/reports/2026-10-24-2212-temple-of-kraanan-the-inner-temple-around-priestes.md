---
title: "Temple of Kraanan: the inner temple around Priestess Qerti'nya is unreachable"
severity: minor
category: "movement"
status: new
reported: 2026-10-25T03:12:58.750Z
character: "Scout"
room: "The Temple of Kraanan [tempkra.roo, RID 801/3054]"
square: "row 29, col 29"
commit: dcdec20
---

# Temple of Kraanan: the inner temple around Priestess Qerti'nya is unreachable

In the Temple of Kraanan (RID 801) every path I asked for to the priestess (rows 6-30, cols 12-26 behind the pillar ring) stops outside it, so she can't be talked to or shopped with. May be the walker's nav grid, but she offers a quest ("!").

## Steps to reproduce

admin_teleport 801 (arrive at row 47, col 40). talk id Qerti'nya: "You must stand closer to speak with them." walk_to_object -> "As close as the floor allows, 8.0 squares away (a counter or wall between). At row 7, col 15". walk_to (13,22) -> stops at (13,28); (10,24) -> (8,26); (13,18) from the west -> (13,12); (28,20) -> (32,20); (16,21) -> "No way to row 16, col 21 from row 13, col 28". Cells right of col 28 and the west and north rims are fine.

## Expected

A way in to the priestess (the Kraanan temple is where Bless, Mana Shield, Martyr's Battleground... are taught).

## Actual

The area around her, about cols 13-27 by rows 7-30, is never reachable. Please check the room's pillar ring/exits and whether a real player can enter. Separately: `shop` on her (and on Marcus) says "<Name> doesn't sell anything." because I know every spell they teach; "has nothing more to teach you" would read better, and I could not see Kraanan prices in game.

## The journal before it

```
#3137 03:10:35 companion {"type":"health","hp":29,"maxHp":70}
#3138 03:10:36 companion {"type":"health","hp":24,"maxHp":70}
#3139 03:10:36 combat The orc's attack misses you.
#3140 03:10:37 companion {"type":"health","hp":19,"maxHp":70}
#3141 03:10:37 combat You killed the orc.
#3142 03:10:37 combat You find nothing easily lootable on your slain enemy other than 28 shillings.
#3143 03:10:37 companion {"type":"health","hp":25,"maxHp":70}
#3144 03:10:39 combat The orc's attack misses you.
#3145 03:10:41 combat The orc's attack misses you.
#3146 03:10:43 companion {"type":"health","hp":23,"maxHp":70}
#3147 03:10:43 companion {"type":"health","hp":20,"maxHp":70}
#3148 03:10:44 combat The orc's attack scrapes you, failing to cause any real harm.
#3149 03:10:46 server Osric disappears into a puff of smoke.
#3150 03:10:46 combat You killed the orc.
#3151 03:10:46 combat You can't carry any more, so you loot nothing from your fallen enemy, but you do find 40 shillings.
#3152 03:10:46 companion {"type":"health","hp":26,"maxHp":70}
#3153 03:10:47 companion {"type":"health","hp":23,"maxHp":70}
#3154 03:10:54 combat You killed the mummy.
#3155 03:10:54 combat You find nothing easily lootable on your slain enemy other than 12 shillings.
#3156 03:10:54 companion {"type":"health","hp":29,"maxHp":70}
#3157 03:10:59 combat You killed the orc.
#3158 03:10:59 combat You find nothing easily lootable on your slain enemy other than 31 shillings.
#3159 03:10:59 companion {"type":"health","hp":36,"maxHp":70}
#3160 03:11:00 companion {"type":"health","hp":32,"maxHp":70}
#3161 03:11:08 companion {"type":"health","hp":29,"maxHp":70}
#3162 03:11:09 server Osric disappears into a puff of smoke.
#3163 03:11:10 combat You killed the orc.
#3164 03:11:10 combat You find nothing easily lootable on your slain enemy other than 31 shillings.
#3165 03:11:10 companion {"type":"health","hp":35,"maxHp":70}
#3166 03:11:15 room Entered The Temple of Kraanan [tempkra.roo, RID 801/3054].
```
