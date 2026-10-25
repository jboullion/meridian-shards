---
title: "Martyr's Battleground: ally-on, ally-off and \"renewed\" messages never appear"
severity: minor
category: "text"
status: new
reported: 2026-10-25T03:11:05.185Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 31, col 42"
commit: dcdec20
---

# Martyr's Battleground: ally-on, ally-off and "renewed" messages never appear

The spell's Kod defines three player messages ("The gods' gaze settles upon you, and your arm grows sure.", "The gods' gaze leaves you.", "The gods honour the fallen, and you feel renewed.") but none ever reached the chat in about 8 casts and 20 kills, although the effects work.

## Steps to reproduce

Used admin_teleport to the Outskirts (RID 330), stood up, cast martyr's battleground (spellpower 99, Kraanan 99%). Spawned skeletons/orcs with admin_spawn and killed them with `fight`. Read every event kind with wait_events. Also entered the room again while it was on.

## Expected

martyrs.kod (martyrsbg_ally_on / _ally_off / _heal) sends these to each allied player: on at the cast and on entering, off when it ends or you leave, and "The gods honour the fallen, and you feel renewed." whenever a death heals you (GainHealthNormal > 0).

## Actual

Only "You suddenly feel as though you are being watched, and judged by intangible beings." (cast) and "The area feels less ordained..." (end) and, on re-entry, "You imagine you can feel the presence of the gods watching you." appear. Proof the heal works silently: with the mana shield off, an orc cut me for 3 (Health 96), I killed another orc at 03:06:52 and the very same second the log said "Health back to full (100)" with no "renewed" line. The companion's health also rose +6 on each of 3 kills, so the death heal is real; only the player-facing text is missing. Possibly the running server was built before these strings were added (the source also says viSpell_level 6 where the live description still shows LEVEL 3): rebuild and recheck.

## The journal before it

```
#3131 03:10:25 combat You find nothing easily lootable on your slain enemy other than 38 shillings.
#3132 03:10:25 combat The orc's attack cuts you for 1 damage.
#3133 03:10:25 companion {"type":"health","hp":47,"maxHp":70}
#3134 03:10:26 companion {"type":"health","hp":44,"maxHp":70}
#3135 03:10:29 companion {"type":"health","hp":40,"maxHp":70}
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
```
