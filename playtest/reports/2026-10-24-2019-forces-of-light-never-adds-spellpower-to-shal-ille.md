---
title: "Forces of Light never adds spellpower to Shal'ille spells"
severity: major
category: "combat"
status: new
reported: 2026-10-25T01:19:40.334Z
character: "Scout"
room: "Mausoleum [razacrypt.roo, RID 306]"
square: "row 11, col 23"
commit: dcdec20
---

# Forces of Light never adds spellpower to Shal'ille spells

Spell Forces of Light says it makes "her spells more potent", but with the room enchanted a Shal'ille spell's spellpower is unchanged (54 in the crypt before and after). Source cause found: spell.kod GetSpellPower asks the room IsEnchanted(what=SID_FORCES_OF_LIGHT) (a number) while Room.IsEnchanted/GetEnchantmentState compare against the stored spell object, so the test never matches.

## Steps to reproduce

Used admin_teleport to Mausoleum (RID 306), admin_spawn GiantRat. Scout: cast holy blaze on a rat -> "Spellpower for holy blaze is 54." Cast forces of light (events: "This place is infused with the spirit of Shal'ille." / "You are filled with the spirit of Shal'ille." / "Spellpower for forces of light is 54."; status shows "On the room: ... forces of light"). Cast holy blaze twice more -> "Spellpower for holy blaze is 54." both times. Same in the Outskirts (86 before and with the enchantment up).

## Expected

Per forceslt.kod's own text ("adds %i spellpower to all Shal'ille spells cast in the area") and spell.kod lines 2538-2552: spellpower + (state/10) = +5 at 54, folded into the secondary (light) bonus which caps at +10, so about 59 in the crypt (+8 for a 86-power cast, but only +1 in the field because light already gives +9 and the cap is 10). The cast breakdown should also list a Forces of Light line.

## Actual

No change at all, and no Forces of Light line. Source: spell.kod:2539 `Send(oRoom,@IsEnchanted,#what=SID_FORCES_OF_LIGHT)` vs room.kod:3860 `GetListNode(plEnchantments, 2, what)` (list holds the spell object). Even if fixed, in a bright field the effect is nearly nil (+1) because the bonus shares the light bonus's cap of 10, so the spell only helps in dim places. Companions (monsters) also get nothing: StartEnchantment only reaches players. Duration was as formula (174 s at 86).</actual>

## The journal before it

```
#495 01:19:17 server Spellpower for forces of light is 54.
#496 01:19:18 combat The giant rat's attack misses you.
#497 01:19:18 combat Your holy blaze purifies the giant rat.
#498 01:19:18 combat You killed the giant rat.
#499 01:19:18 combat You have gained 50 XP.
#500 01:19:18 combat You can't carry any more, so you loot nothing from your fallen enemy, but you do find 13 shillings.
#501 01:19:18 server Spellpower for holy blaze is 54.
#502 01:19:21 combat The giant rat's attack misses you.
#503 01:19:22 companion {"type":"health","hp":12,"maxHp":16}
#504 01:19:24 combat The giant rat's attack misses you.
#505 01:19:24 combat Your holy blaze purifies the giant rat.
#506 01:19:24 combat You killed the giant rat.
#507 01:19:24 combat You have gained 50 XP.
#508 01:19:24 combat You can't carry any more, so you loot nothing from your fallen enemy, but you do find 18 shillings.
#509 01:19:24 server Spellpower for holy blaze is 54.
#510 01:19:25 companion {"type":"health","hp":12,"maxHp":16}
#511 01:19:27 combat The giant rat's attack misses you.
#512 01:19:29 companion {"type":"health","hp":10,"maxHp":16}
#513 01:19:30 combat The giant rat's attack misses you.
#514 01:19:32 combat You killed the mummy.
#515 01:19:32 combat You find nothing easily lootable on your slain enemy other than 12 shillings.
#516 01:19:32 server You absorb a small amount of the energy released from Scout's slaying of the mummy.
#517 01:19:32 combat You have gained 10 XP.
#518 01:19:33 companion {"type":"health","hp":8,"maxHp":16}
#519 01:19:33 combat The giant rat's attack misses you.
#520 01:19:37 combat The giant rat's attack misses you.
#521 01:19:39 combat You killed the mummy.
#522 01:19:39 combat You can't carry any more, so you loot nothing from your fallen enemy, but you do find 19 shillings.
#523 01:19:39 server You absorb a small amount of the energy released from Scout's slaying of the mummy.
#524 01:19:39 combat You have gained 10 XP.
```
