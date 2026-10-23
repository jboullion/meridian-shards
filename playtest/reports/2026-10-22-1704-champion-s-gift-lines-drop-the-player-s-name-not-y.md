---
title: "Champion's Gift lines drop the player's name (\"Not yet, .\")"
severity: minor
category: "npc"
status: fixed
reported: 2026-10-22T22:04:58.409Z
character: "Scout"
room: "The Chambers of Duke Akardius [duke3.roo, RID 952]"
square: "row 30, col 33"
commit: 5f9ccba
---

# Champion's Gift lines drop the player's name ("Not yet, .")

Every line the liege says after "champion" has an empty name where the player's name should be: "Not yet, ." / "Rank alone does not earn my gift, ." / "You have served me well, , and strength deserves its reward."

## Steps to reproduce

Join the Duke (JoinFaction by maintenance port), get renown 10+ and say "champion" to Duke Akardius in his chambers (RID 952). Repeat with renown 70 before Act IV, and again after finishing Act IV (quest 303) so the gift is granted.

## Expected

The name of the player, e.g. "Not yet, Scout." (the template is "Not yet, %s.").

## Actual

Duke Akardius tells you, "Not yet, .  My gift is for those who have risen to Captain in my service." / "Rank alone does not earn my gift, .  See my war through with me first..." / "You have served me well, , and strength deserves its reward.  Qor's own darkness shaped this."  Likely cause: kod/util/championgifts.kod passes #parm1=Send(who,@GetName),#type1=STRING_RESOURCE in every SayToOne (lines ~198-232); GetName returns a plain string, and SayToOne's default type is STANDARD_RESOURCE (no other caller passes STRING_RESOURCE with GetName). Suggest dropping #type1.

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
