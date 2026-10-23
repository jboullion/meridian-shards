---
title: "Campaign Act III and V closing lines are never shown"
severity: minor
category: "quests"
status: fixed
reported: 2026-10-22T22:04:58.467Z
character: "Scout"
room: "The Chambers of Duke Akardius [duke3.roo, RID 952]"
square: "row 30, col 33"
commit: 5f9ccba
---

# Campaign Act III and V closing lines are never shown

Quests whose last step is a battle, claim or siege complete the moment that step is done, so their "complete" text (the liege's closing speech) is never spoken and the player is never told to go back to the liege.

## Steps to reproduce

Duke campaign, Act V (quest 304 The Siege of Barloque): say "march" to the Duke, take part in the siege and win it (I killed the Princess captain with the maintenance port). Same for Act III's claim step (quest 302; I finished that step with AdminFinishStep, so this one is less certain).

## Expected

quests/duke-act5-the-siege-of-barloque.json has text.complete: Duke Akardius says, "Her walls cracked and her soldiers ran. Tos drinks to you tonight, Champion." Players should hear it (as the other acts, which are handed in to the Duke, do).

## Actual

On the win: "You complete the quest The Siege of Barloque." plus rewards (10000 shillings, 15 renown, XP) straight away, with no Duke speech at all. Same pattern as the Act I-IV hand-ins, which do end with the Duke, except the siege step has no turnin.

## The journal before it

```
#499 21:55:19 server You suddenly feel a little tougher.
#500 21:55:19 server You feel invigorated by your success.
#501 21:55:19 health Health back to full (134).
#502 21:55:19 combat You have gained 33708 XP.
#503 21:55:19 server You receive 10000 shillings.
#504 21:55:19 server You gain 15 renown with your liege (99 of 100).
#505 21:55:23 room Entered The Streets of Tos [tos.roo, RID 15/50/3013].
#506 21:55:32 look soldier of the Duke's army: This soldier proudly bears the colors of the Duke.


#507 21:55:34 server You suddenly feel wiser!
#508 21:55:34 server The celebrations for your liege lift your spirits.
#509 21:55:47 room Entered The Freelance Merchant and Menders Shop [tossmith.roo, RID 51].
#510 21:55:54 room Entered The Blacksmith of Raza [razasmith.roo, RID 303].
#511 21:55:54 server Tomas says, "Hello Scout, and welcome.  Have you come to trade blades?  Or to hone your skills perhaps?"
#512 21:55:59 trade Tomas sells 10 things.
#513 21:56:08 room Entered The Chambers of Duke Akardius [duke3.roo, RID 952].
#514 21:56:17 self You said: ledger
#515 21:56:17 server Duke Akardius opens the war ledger.  "These have served me best."
#516 21:56:17 server 1. Scout, Captain: 0 soldiers bested, 2 battles won of 3.
#517 21:56:20 quest Duke Akardius has: [16] Rise in the Ranks (offered, step 1); [19] The Descendants of Konima (offered, step 1); [73] The Duke's Taxes (offered, step 1); [104] A Late Tax (offered, step 1); [140] The Orcs West of Tos (offered, step 1); [160] The Ghost in the Mountains (offered, step 1); [184] Bandits on the Roads (offered, step 1); [186] The City of Berg (offered, step 1); [210] The Depths of the Marion Crypts (offered, step 1); [213] Waylay Oasis (later (more health), step 1); [240] A Soldier at Your Side (offered, step 1); [280] The Duke's Priestess (offered, step 1); [283] Ground for the Duke (offered, step 1); [304] The Siege of Barloque (offered, step 1)
#518 21:56:22 server You take on the quest The Siege of Barloque.
#519 21:56:23 self You said: march
#520 21:56:23 server [Battle] Scout leads Duke Akardius's army against Princess Kateriina, before the walls of North Barloque!  The siege begins in 2 minutes.
#521 21:56:23 server Your liege's army will be waiting for you at Outskirts of Barloque.  Lead it there.
#522 21:56:23 server Duke Akardius tells you, "Then go.  My army will be waiting for you.  Do not keep it waiting long."
#523 21:58:23 server [Battle] The armies of Duke Akardius and Princess Kateriina clash at Outskirts of Barloque!
#524 22:00:00 server System is saving; please wait.
#525 22:00:00 server The server is saving: wait.
#526 22:00:00 server System save completed; resume play.
#527 22:00:00 server The server finished saving.
#528 22:04:23 server [Battle] Word comes from Outskirts of Barloque: the day belongs to Princess Kateriina.
```
