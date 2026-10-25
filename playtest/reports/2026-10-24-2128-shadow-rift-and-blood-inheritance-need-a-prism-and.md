---
title: "Shadow Rift and Blood Inheritance need a prism and other casters: solo cast just wastes reagents"
severity: minor
category: "other"
status: new
reported: 2026-10-25T02:28:14.916Z
character: "Scout"
room: "Mausoleum [razacrypt.roo, RID 306]"
square: "row 11, col 24"
commit: dcdec20
---

# Shadow Rift and Blood Inheritance need a prism and other casters: solo cast just wastes reagents

Both spells go through multicst.kod (Prism). A lone caster who casts them is left chanting with "You begin to chant and a prism nearby starts to glow!" and then nothing happens until another spell cast breaks the chant. Reagents and mana are spent first.

## Steps to reproduce

1. Scout (Qor spells at 99%, vigor 80/80) in the Raza crypt (RID 306). admin_give Prism, then cast shadow rift: "You can't find a prism nearby to focus your energies on." (the prism was in the inventory).
2. item drop prism, cast shadow rift again: "You begin to chant and a prism nearby starts to glow!", "Spellpower for shadow rift is 74." Then 3 minutes of nothing (no messages, no portal). Walking does not end it. Casting another spell prints "The prism darkens and a blanket of silence seems to settle over you as the chant ceases." Mana went 89 -> 60 (29, as listed), and did not drain further.
3. admin_give Axe, cast blood inheritance on the axe: first "You are too tired to cast blood inheritance!" at vigor 45 (it costs 50); after resting, "You focus your whole will on casting blood inheritance" for 16.8 s, then "You begin to chant and a prism nearby starts to glow!" and nothing more. Inventory afterwards: shaman blood 136 -> 117, entroot berries 151 -> 119, orc teeth 159 -> 142 (about 16 of each gone), 50 vigor and mana spent. The axe got nothing.

## Expected

Shadow Rift's description says "Subsequent castings with the same prism cause a mystical portal to form"; Blood Inheritance says "Infuses a weapon with the malevolent power of Qor ... it will always be deadly." Neither says that several casters must feed a prism lying on the floor (multicst.kod: FindPrism only looks at floor items; the spellpower needed is shared between casters). A solo player expects the spell to work or to be told it can't.

## Actual

A lone caster pays the whole cost, gets no effect and no hint about needing company. "You can't find a prism nearby" is misleading when the prism is in the pack. Blood Inheritance's description doesn't mention a prism at all, though it needs one. Suggest: say "needs a prism on the ground and other casters" in both descriptions, and refuse the cast before reagents are taken when no other caster is present.

## Screenshot

![What the game showed](2026-10-24-2128-shadow-rift-and-blood-inheritance-need-a-prism-and.png)

## The journal before it

```
#1436 02:27:26 combat You cannot attack your own minion!
#1437 02:27:26 combat The mummy's attack misses you.
#1438 02:27:27 combat You cannot attack your own minion!
#1439 02:27:28 combat You cannot attack your own minion!
#1440 02:27:29 combat You cannot attack your own minion!
#1441 02:27:30 combat The mummy's attack misses you.
#1442 02:27:32 server You focus your whole will on casting blood inheritance.
#1443 02:27:34 combat The mummy's attack misses you.
#1444 02:27:34 combat You killed the mummy.
#1445 02:27:34 combat You spit on the corpse of your unworthy foe.
#1446 02:27:34 combat You find nothing easily lootable on your slain enemy other than 11 shillings.
#1447 02:27:34 combat The battered skeleton has valiantly slain the mummy!
#1448 02:27:42 combat The mummy's attack misses you.
#1449 02:27:46 combat The mummy's attack misses you.
#1450 02:27:47 server You begin to chant and a prism nearby starts to glow!
#1451 02:27:47 server Spellpower for blood inheritance is 75.
#1452 02:27:50 combat The mummy's attack misses you.
#1453 02:27:52 server The prism darkens and a blanket of silence seems to settle over you as the chant ceases.
#1454 02:27:53 combat The mummy's attack misses you.
#1455 02:27:57 combat The mummy's attack misses you.
#1456 02:28:00 combat The mummy's attack misses you.
#1457 02:28:04 combat The mummy's attack nicks you for 1 damage.
#1458 02:28:05 combat The mummy is seriously wounded.
#1459 02:28:08 combat The mummy's attack misses you.
#1460 02:28:09 health Health back to full (100).
#1461 02:28:11 combat The mummy's attack misses you.
#1462 02:28:11 combat The mummy is weak, and near death.
#1463 02:28:14 combat You killed the mummy.
#1464 02:28:14 combat You can't carry any more, so you loot nothing from your fallen enemy, but you do find 11 shillings.
#1465 02:28:14 combat The battered skeleton has valiantly slain the mummy!
```
