---
title: "Battle banner isn't lit for a soldier who joined mid-session"
severity: minor
category: "interface"
status: fixed
reported: 2026-10-23T02:08:37.420Z
character: "shardscout"
room: "(not in the game)"
square: ""
commit: 5f9ccba
---

# Battle banner isn't lit for a soldier who joined mid-session

The battle banner's "our liege fights here" highlight (gold border) depends on the client knowing its liege, which it asks for once at logon. A player who joins a faction while playing (a quest, a token) sees the banner unlit until they open the War window or log in again.

## Steps to reproduce

1. Log in as a neutral (Scout). 2. Join the Princess without logging out (JoinFaction by maintenance port; a join quest does the same). 3. Call a Jonas-versus-Princess battle (StartBattle rid 603 attacker 3). 4. Look at the banner: dim border. 5. Send `war` (J, or the command): the banner turns gold at once.

## Expected

The banner lights as soon as our liege is one of the two sides, as it does for a player who logged in as a member (ADR 0021 decision 16).

## Actual

Dim border until `war` is requested. Probably the client should ask again when it hears "Your name is entered on the roll of membership…" or an UC faction change.

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
