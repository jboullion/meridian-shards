---
title: "Eavesdrop ends after about 2 seconds, too short to hear anything"
severity: major
category: "other"
status: new
reported: 2026-10-25T05:10:15.562Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 23, col 39"
commit: dcdec20
---

# Eavesdrop ends after about 2 seconds, too short to hear anything

Eavesdrop (Riija level 2) is a 1-2 second spell at 99% ability, so a caster can't listen to a conversation. eavesdrp.kod GetDuration returns 500 + (spellpower/10)*100 milliseconds, i.e. 1.0 s at spellpower 59 and at most about 1.4 s at spellpower 99.</summary>
<parameter name="steps">Scout in The Temple of Riija (RID 2151) at spellpower 59 (morphed). cast eavesdrop. Events: 04:54:52 "The sounds of a nearby room fill your mind." 04:54:54 "The distant sounds become impossible to hear." (2 s later, before I cast anything else).

## Expected

Description: "Riija grants the ability to hear distant conversations, allowing you to spy on others." Costs 7 mana, 1 vigor, 2 dragonfly eyes. A duration of seconds-to-minutes like other personal enchantments (anonymity is up to 10 minutes).

## Actual

Lasts about 2 seconds. Code (kod/object/passive/spell/persench/eavesdrp.kod line 142): GetDuration = 500 + ((iSpellPower / 10) * 100) ms. Looks like a units slip (hundreds of milliseconds instead of seconds). The description gives no duration. Eavesdrop also has no teacher in the Monk of Riija's list (assassin only, per the brief).

## The journal before it

```
#11780 05:08:44 combat The zombie is seriously wounded.
#11781 05:08:44 combat Your mace pollutes the zombie for 5 damage.
#11782 05:08:44 combat You hit zombie for 5.
#11783 05:08:44 combat The zombie shrugs off your attack.
#11784 05:08:46 combat Your mace maligns the zombie for 4 damage.
#11785 05:08:46 combat You hit zombie for 4.
#11786 05:08:46 combat The zombie shrugs off your attack.
#11787 05:08:47 combat Your mace maligns the zombie for 3 damage.
#11788 05:08:47 combat You hit zombie for 3.
#11789 05:08:47 combat The zombie is weak, and near death.
#11790 05:08:47 combat The zombie shrugs off your attack.
#11791 05:08:48 combat Your mace maligns the zombie for 4 damage.
#11792 05:08:48 combat You hit zombie for 4.
#11793 05:08:48 combat The zombie shrugs off your attack.
#11794 05:08:49 combat Your mace corrupts the zombie.
#11795 05:08:49 combat You killed the zombie.
#11796 05:08:49 combat You can't carry any more, so you loot nothing from your fallen enemy, but you do find 42 shillings.
#11797 05:08:49 combat Your target is gone (dead, or it left).
#11798 05:08:57 server The troll looks strangely dazed... and confused.
#11799 05:08:57 server Duration of vertigo is 21 seconds.
#11800 05:08:57 server Spellpower for vertigo is 57.
#11801 05:09:13 server Your illusion takes the form of splash of acid.
#11802 05:09:13 combat Your splash of acid sears the troll for 11 damage.
#11803 05:09:13 combat You hit troll for 11.
#11804 05:09:57 combat Your mace maligns the troll for 1 damage.
#11805 05:09:57 combat You hit troll for 1.
#11806 05:09:57 combat The troll is slightly wounded.
#11807 05:09:57 server The troll laughs off your pitiful blow.
#11808 05:09:57 server Scout disappears into a puff of smoke.
#11809 05:10:00 server The troll falls back to recover for a moment, then returns to the fight.
```
