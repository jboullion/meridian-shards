---
title: "Guild halls show \"PvP Combat Allowed\" although fighting inside is now banned"
severity: minor
category: "other"
status: new
reported: 2026-10-22T18:53:51.852Z
character: "Scout"
room: "The Hall of Explorers [guildh2.roo, RID 702]"
square: "row 18, col 30"
commit: dcdec20
---

# Guild halls show "PvP Combat Allowed" although fighting inside is now banned

Standing in the Hall of Explorers (RID 702) the room flag line reads "PvP Combat Allowed" (the red-sword room icon). ADR 0022 decision 6 says halls are safe: AllowBattlerAttack refuses any player attack inside a GuildHall ("Nobody may fight inside a guild hall."). The icon contradicts the rule, and Frular's mature-guild mail calls halls "a sanctuary".

## Steps to reproduce

1. Log in as Scout (a stranger, no guild). 2. travel to South Barloque (RID 102), take_exit guildh2.roo (Hall of Explorers door at row 16.5, col 42) - you arrive in the foyer at row 18, col 32. (I reached Barloque with admin_teleport 101; the rest on foot.) 3. status (or look at the room icons).

## Expected

A guild hall is safe (ADR 0022 decision 6; ghall.kod viPermanent_flags = ROOM_SANCTUARY; Frular's mail says no one may fight inside), so the room icon should read like a safe room ("Safe Room", as in the Inn of Raza, RID 301).

## Actual

status says: "On the room: PvP Combat Allowed." System.GetRoomIcons (util/system.kod ~3106) shows RmCombat ("PvP Combat Allowed") for any room whose flags lack ROOM_NO_COMBAT, ROOM_GUILD_PK_ONLY and ROOM_KILL_ZONE; ghall.kod only sets ROOM_SANCTUARY, so the hall gets the combat icon. Rank at the time: stranger (no guild). Hall private.

## Screenshot

![What the game showed](2026-10-22-1353-guild-halls-show-pvp-combat-allowed-although-fight.png)

## The journal before it

```
#1 18:52:15 server You open the door and walk through.
#2 18:52:15 room Entered South Barloque [barls.roo, RID 102/3003].
#3 18:52:51 server You open the door and walk through.
#4 18:52:51 room Entered The Hall of Explorers [guildh2.roo, RID 702].
```
