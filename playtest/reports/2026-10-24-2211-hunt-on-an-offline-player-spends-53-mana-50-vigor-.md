---
title: "Hunt on an offline player spends 53 mana, 50 vigor and 4 claws and says nothing"
severity: minor
category: "other"
status: new
reported: 2026-10-25T03:11:05.204Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 31, col 42"
commit: dcdec20
---

# Hunt on an offline player spends 53 mana, 50 vigor and 4 claws and says nothing

Casting Hunt with a name that is not in the game succeeds, takes all costs, gives a "hunt" enchantment and ends 22 s later with no tracking message at all.

## Steps to reproduce

Used admin_give Prism and dropped it in the room (hunt first said "You can't find a prism nearby to focus your energies on." with the prism in the inventory only). cast hunt, then said "Shardpal" (no such player online; only Scout was).

## Expected

The description says the hunters "receive periodic notification of the hunted player's whereabouts". For a name that is not logged in I'd expect a refusal before the costs, or at least a "not found" line.

## Actual

"You begin to chant and a prism nearby starts to glow!", "Spellpower for hunt is 25." (an Anti-magic Aura was up), mana 579 -> 526 (description: 48), 4 kriipa claws, 50 vigor, status shows a "hunt" enchantment, then 22 s later "The prism darkens and a blanket of silence seems to settle over you as the chant ceases." No notification ever came. The description also does not say the prism must stand in the room (carrying it is not enough).

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
