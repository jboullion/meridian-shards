---
title: "Temple of Riija: the Monk (only Riija teacher) can't be reached or shopped, even after Dispel"
severity: major
category: "npc"
status: new
reported: 2026-10-25T04:56:56.918Z
character: "Scout"
room: "The Temple of Riija [ke1.roo, RID 2151]"
square: "row 47, col 31"
commit: dcdec20
---

# Temple of Riija: the Monk (only Riija teacher) can't be reached or shopped, even after Dispel

Playtest of Riija teachers (item 9). The Monk of Riija (id 3162, row 10 col 31 in ke1.roo, RID 2151) teaches 19 Riija spells (kcrjmonk.kod SetForSale) but the walker finds no route to him or to the front door (rows 23-24, cols 30-31), and `shop` on him answers "doesn't sell anything".

## Steps to reproduce

1. admin_teleport 2151 (lands row 49 col 31) or travel_to 2151 / take_exit via kd2.roo. 2. look_around lists the Monk of Riija at row 10 col 31 and an exit "ke1.roo door at row 23.5, col 30.5". 3. talk 3162 -> "Couldn't get close: No way to object 3162". take_exit ke1.roo -> "No way to the door at row 24, col 30". walk_to row 30 col 31 -> "No way". walk_to row 40/44/45 col 31 stops at row 46-47 "as close as the floor allows". 4. Cast dispel illusion (temprii.kod DispelIllusions: the monk becomes a "spooky little girl", id 3162, says "Are you prepared for enlightenment?") -> still no path, and `shop 3162` -> "spooky little girl doesn't sell anything." (before the dispel: "Monk of Riija doesn't sell anything.")

## Expected

Per the brief and ADR 0009 (quest 279 sends players to the Monk of Riija) a player can reach the Monk and see his spell list and prices. The Kod puts the teacher's spells in plFor_Sale.

## Actual

No route north of row ~46 for the nav grid; the front door at 23-24 is not walkable from the arrival area. Could be the room's Bridge of Faith (ROOM_OVERRIDE_DEPTH1) being invisible to the walker (then a walker limit), but then the test tools can't learn Riija spells here. Also temprii.kod NewHold teleports any non-immortal player who is PLACED in rows 4-30, cols 13-44 back to Ko'catan North, so admin_teleport can't help either. I could not obtain the shop list or prices. Teachers by Kod: Anonymity, Apparition, Seduce (needs Bait ability >= 89), Forget, Morph, Reflection, Illusionary Form, Foresight, Vertigo, Denial, Illusionary Wounds, Flash, Shadow Form, Illusionary Fire Wall, Bait, Feign Death, Elusion, Evil Twin, Transmogrify Monster.

## The journal before it

```
#11391 04:49:43 room Entered The Temple of Riija [ke1.roo, RID 2151].
#11392 04:49:43 server The Monk of Riija says, "Are you prepared for enlightenment?"
#11393 04:50:28 room Entered Territory of the Noble Avars [kd2.roo, RID 2142].
#11394 04:50:30 room Entered The Temple of Riija [ke1.roo, RID 2151].
#11395 04:50:30 server The Monk of Riija says, "Are you prepared for enlightenment?"
#11396 04:50:44 server You fade back to your own colors.
#11397 04:51:26 server Spellpower for foresight is 59.
#11398 04:54:52 server The sounds of a nearby room fill your mind.
#11399 04:54:52 server Spellpower for eavesdrop is 59.
#11400 04:54:54 server The distant sounds become impossible to hear.
#11401 04:54:56 server You phase out of existence, confident that you can hold onto reality for another 640 seconds.
#11402 04:54:56 server Spellpower for phase is 59.
#11403 04:55:02 server You take a moment to recollect your senses.
#11404 04:55:02 server Spellpower for phase is 59.
#11405 04:55:02 server Only 633 seconds away from losing your grip on reality, you phase back into existence.
#11406 04:55:02 server Your alternate form wears off; you return to your normal self.
#11407 04:55:10 server Spellpower for foresight is 57.
#11408 04:55:19 server Spellpower for foresight is 52.
#11409 04:55:24 server Spellpower for foresight is 57.
#11410 04:55:34 look mace: ~Bunholy mace~n

Lethal in appearance, this weapon is actually only minimally effective.  Its spiked head is made of soft metal and its wooden shaft is thin and brittle.

The weapon seems to reek of malevolence.  Enchanted by Osric, Master supplicant of Qor.

This item has the following properties:
3 range
75 offense rating bonus
3-7 base damage
5 general spellpower
Deals bludgeon damage
Deals mundane damage
Deals unholy damage
+1 to 5 unholy damage on every hit (against players, only followers of Shal'ille)
60 weight and 60 bulk

This mace is slightly tarnished but in generally good condition. (174/211)
#11411 04:55:45 server Your illusion takes the form of shocking fury.
#11412 04:55:45 combat Your shocking fury fries the training dummy for 22 damage.
#11413 04:55:45 combat You hit training dummy for 22.
#11414 04:55:45 combat The training dummy takes 23 damage.
#11415 04:55:52 health Health back to full (100).
#11416 04:56:02 server You have a funny feeling that attacking is pointless.
#11417 04:56:02 server You cross your eyes momentarily to make the illusions in the area fade away.
#11418 04:56:02 server Spellpower for dispel illusion is 90.
#11419 04:56:02 server The spooky little girl says, "Are you prepared for enlightenment?"
#11420 04:56:20 server The Monk of Riija says, "Are you prepared for enlightenment?"
```
