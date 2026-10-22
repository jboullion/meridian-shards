---
title: "Faction War phase 1: static findings (in-game playtest not run)"
severity: major
category: "factions"
status: fixed
reported: 2026-10-22T02:10:00.000Z
character: "Scout"
commit: a9693567
---

# Faction War phase 1: static findings (in-game playtest not run)

The planned in-game playtest of Faction War phase 1 (shards-server a9693567) didn't happen. The session it ran in started in shards-server, so the meridian MCP server (meridian-browser/.mcp.json) never loaded, and the playtester had no game tools. No game state was changed: Scout is still neutral and logged off, with renown and the war counters at 0. These findings come from reading the code only.

## 1. A shielded soldier with safety on got no war death (fixed in 4c8f26a5)

`Player.Killed` checked the Frenzy and newbie no-drop branch first. That branch includes `NOT (piFlags & PFLAG_PKILL_ENABLE) AND NOT NewbiesDropLoot`, and `NewbiesDropLoot` is FALSE by default. `IsWarDeath` was only an `else if` after it. So a soldier wearing the shield with safety on, killed by an enemy troop, got a plain no-penalty death: no broken gear, no war-death record, no regroup and no renown loss. Scout has safety on (piFlags 0x400000, no 0x400), so the planned test would have hit this.

Fixed in shards-server 4c8f26a5: the war death is now checked first, except during a Frenzy or in an arena. I read the diff and it looks right. One small point: the new check calls `Send(poOwner,@IsArena)` before anything tests `pbLogged_on`. For an offline death (a necromancer) poOwner is `$`. The old `else if` made the same call, though, so this isn't new.

## 2. Notes for whoever runs the in-game playtest

- **Step 5 (put the shield away right after combat):** `SoldierShield.ReqUnuse` refuses only while `Player.IsInPvP`. That is set only by harm between players (`NotePvPHarm`). Fighting a FactionTroop won't block putting the shield away, so "refused right after combat" needs a hit from or on another player. Decide whether troop fights should count too. If not, the expected result after a troop fight is that the shield goes away.
- **Step 1 baseline:** Scout (object 6298 at the time; ids change after a save) has `piBase_Max_Health` 21 and `piDeathCost` 100. Check that the newbie honor string still isn't on the character, and with the fix it shouldn't matter.
- **Logoff while a soldier:** `SoldierShield.OwnerDied(logoff=TRUE)` costs renown (RENOWN_WAR_DEATH, without a message) and gives the last enemy the kill. It doesn't count a war death or break gear. That may be intended, but it's worth checking in play.
