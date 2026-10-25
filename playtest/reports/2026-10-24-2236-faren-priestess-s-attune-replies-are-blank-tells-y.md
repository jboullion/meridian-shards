---
title: "Faren priestess's attune replies are blank: tells you, \\\"\\\" (all cases)"
severity: major
category: "npc"
status: new
reported: 2026-10-25T03:36:46.458Z
character: "Scout"
room: "The Badlands [badland1.roo, RID 45/3009]"
square: "row 44, col 63"
commit: dcdec20
---

# Faren priestess's attune replies are blank: tells you, \"\" (all cases)

Every reply Priestess Tenuv'vyal gives to "attune", "attune flame" and "attune frost" shows as an empty quote, so a player never sees the explanation, the warning that the choice is permanent, the confirmation, or the "already bound" refusal.

## Steps to reproduce

Headless body, Scout. Go to The Badlands (RID 45, admin_teleport, then take_exit k5.roo, walk_to 30,55 and talk to Priestess Tenuv'vyal at 44,59). 1) say "attune" before doing Disciple of Faren; 2) say "attune flame"; 3) do Disciple of Faren (accept, hand in to Tova in RID 202, hand in to the priestess); 4) say "attune" and "attune flame" again; 5) say "attune frost" afterwards.

## Expected

farnprst.kod: farenpriestess_attune_not_disciple ("You have not walked Faren's path as my disciple..."), _explain ("Faren's gifts run three ways. ... Choose well. Faren does not let you choose twice."), _done ("So be it. Faren's flame is yours, and you are its.") and _already ("You are bound to flame already. Faren does not unmake his gifts.").</expected>
<parameter name="actual">All five replies, before and after the quest: `Priestess Tenuv'vyal tells you, ""`. The attunement itself works (after "attune flame", spellpower for fireball went 62 -> 71 while lightning bolt stayed 67 and fireball burns its target), so it is only the text. I did not see which of the four cases was which. Possibly the nested resource id isn't resolved by this client (dist/assets/rsc0000.rsb does contain the strings), or the server sends it wrongly; worth checking in the browser client.</actual>
</invoke>

## The journal before it

```
#4321 03:35:30 server Spellpower for fireball is 77.
#4322 03:35:30 combat The orc is slightly wounded.
#4323 03:35:32 combat The orc's attack misses you.
#4324 03:35:34 server You channel the power of Faren and unleash a barrage of fire!
#4325 03:35:34 combat Your fire storm scorches the training dummy for 24 damage.
#4326 03:35:34 combat You hit training dummy for 24.
#4327 03:35:34 combat Your fire storm scorches the orc for 24 damage.
#4328 03:35:34 combat You hit orc for 24.
#4329 03:35:34 server Spellpower for fire storm is 77.
#4330 03:35:34 combat The training dummy takes 24 damage.
#4331 03:35:34 combat The orc is seriously wounded.
#4332 03:35:34 combat The orc's attack misses you.
#4333 03:35:36 combat The training dummy takes 2 damage.
#4334 03:35:37 combat The orc's attack cuts you for 2 damage.
#4335 03:35:37 server You channel the power of Faren and unleash a barrage of fire!
#4336 03:35:37 combat Your fire storm scorches the training dummy for 34 damage.
#4337 03:35:37 combat You hit training dummy for 34.
#4338 03:35:37 combat Your fire storm incinerates the orc.
#4339 03:35:37 combat You killed the orc.
#4340 03:35:37 combat You find nothing easily lootable on your slain enemy other than 28 shillings.
#4341 03:35:37 server Spellpower for fire storm is 77.
#4342 03:35:37 combat The training dummy takes 34 damage.
#4343 03:35:39 combat The training dummy takes 3 damage.
#4344 03:35:40 health Health back to full (100).
#4345 03:35:41 combat The training dummy takes 3 damage.
#4346 03:35:42 room Entered The Badlands [badland1.roo, RID 45/3009].
#4347 03:35:43 combat The training dummy takes 3 damage.
#4348 03:36:22 quest Priestess Tenuv'vyal has: [85] An Offering to Faren (offered, step 1)
#4349 03:36:25 self You said: attune frost
#4350 03:36:25 server Priestess Tenuv'vyal tells you, ""
```

## Coordinator check (2026-10-24, after the report)

Not reproduced with a scripted client (GameSession, the same packages/world the playtester uses): a character who has done the Disciple of Faren quest (quest 81 marked done) and knows Faren spells gets, in the Badlands (RID 45) next to Priestess Tenuv'vyal:

- "attune": "Faren's gifts run three ways. Flame burns hottest. Frost chills, slowing all it touches. Storm jolts, breaking a foe's spells. ..."
- "attune flame": "So be it. Faren's flame is yours, and you are its."
- "attune frost" afterwards: "You are bound to flame already. Faren does not unmake his gifts."
- a non-disciple: "You have not walked Faren's path as my disciple. Come back when you have."

So the game sends these lines; the blank `tells you, ""` is most likely how the playtester's MCP journal shows them (its headless body), not a game bug. Treat as a tool problem unless it shows up in the browser body.
