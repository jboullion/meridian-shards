---
title: "A Guild Master turns a guildless player away with no hint"
severity: minor
category: "npc"
status: fixed
reported: 2026-10-24T00:36:30.237Z
character: "shardscout"
room: "(not in the game)"
square: ""
commit: 5f9ccba
---

# A Guild Master turns a guildless player away with no hint

The Guild Masters are the only thing in the game that explains the Fallen Halls and the story chain, but a player with no guild (even at 100 health) gets only "They have no work for you right now." from them, and a guild member below 80 health gets the same. Nothing says "come back with a guild" or "come back at 80 health".

## Steps to reproduce

1. Log in as a player with no guild (Shardscout, 20 then 100 base health). 2. Go to the Chambers of Duke Akardius (RID 952) and activate Master Aldric Vane (the same for Dame Seraphine Dawnmere and Brannoc the Red). 3. Compare with a guild member at 100 health: "A Guild's Calling" is offered with the Order of Necromancers story.

## Expected

A line from the Guild Master for those who can't take the quest, for example one that says guilds are founded with Frular in Barloque, or that the guild's calling is for those with 80 health, so a new player learns that guilds and the Fallen Halls exist. ADR 0022 (28) says the Guild Masters are how players "come to talk to their faction and find their faction's Guild Master too".

## Actual

The generic "They have no work for you right now." and no quest list. (A guildless player is also given no "!" marker, as designed, so there is nothing to draw them to the Guild Master in the first place.)

## The journal before it

```
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
#529 22:05:10 server Your liege has no use for one such as you, lacking in prowess or devotion.  Your name has been stricken from the roll of membership.
#530 22:05:10 server You put your soldier's shield away. Enemy soldiers will pass you by while it stays off; take it up again to rejoin the Faction War.
#531 22:05:10 server You are not worthy to hold a soldier shield!
#532 23:36:58 server Welcome to the world of Meridian 59! (type "help" to see the manual).
#533 23:36:58 room Entered The Chambers of Duke Akardius [duke3.roo, RID 952].
#534 23:37:21 server Welcome to the world of Meridian 59! (type "help" to see the manual).
#535 23:37:21 room Entered The Chambers of Duke Akardius [duke3.roo, RID 952].
#536 23:37:21 server You have 8 pieces of new mail.
#537 23:37:21 quest Signet rings carried: none
#538 23:37:21 companion {"type":"none"}
#539 23:37:24 quest Duke Akardius has: [16] Rise in the Ranks (offered, step 1); [19] The Descendants of Konima (offered, step 1); [73] The Duke's Taxes (offered, step 1); [104] A Late Tax (offered, step 1); [140] The Orcs West of Tos (offered, step 1); [160] The Ghost in the Mountains (offered, step 1); [184] Bandits on the Roads (offered, step 1); [186] The City of Berg (offered, step 1); [210] The Depths of the Marion Crypts (offered, step 1); [213] Waylay Oasis (later (more health), step 1); [240] A Soldier at Your Side (offered, step 1); [280] The Duke's Priestess (offered, step 1); [283] Ground for the Duke (offered, step 1); [302] Ground for Blackstone (offered, step 1)
#540 23:37:27 server You take on the quest Ground for Blackstone.
#541 23:37:28 server [Battle] Princess Kateriina marches on Valley of Ileria, held by Duke Akardius!  The armies meet there in 1 minutes.  Soldiers of either liege, take up your shields.
```
