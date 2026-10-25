---
title: "Drop message reports the whole stack (\"drop 546 emerald.\") not the amount dropped"
severity: cosmetic
category: "items"
status: new
reported: 2026-10-25T03:11:12.228Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 31, col 42"
commit: dcdec20
---

# Drop message reports the whole stack ("drop 546 emerald.") not the amount dropped

item drop with an amount drops the right number but the reply names the stack total before the drop.

## Steps to reproduce

Inventory had 546 emerald. item drop emerald amount 300 -> reply "drop 546 emerald."; inventory afterwards showed 246. Same for every stack (asked 250 of 290 orc teeth: reply "drop 290 orc tooth.", 40 left).

## Expected

"drop 300 emerald." (what was dropped).

## Actual

The total held. Looks like I dropped everything for a moment, which is confusing. Tool-level text, so may be the playtester tool rather than the game.

## The journal before it

```
#3136 03:10:33 companion {"type":"health","hp":33,"maxHp":70}
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
```
