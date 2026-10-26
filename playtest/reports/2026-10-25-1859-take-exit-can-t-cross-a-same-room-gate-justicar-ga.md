---
title: "take_exit can't cross a same-room gate: Justicar gallery gate bounces back (walker)"
severity: major
category: "movement"
status: new
reported: 2026-10-25T23:59:06.962Z
character: "Scout"
room: "Office of the Justicar [barcourt.roo, RID 115]"
square: "row 6, col 12"
commit: dcdec20
---

# take_exit can't cross a same-room gate: Justicar gallery gate bounces back (walker)

In the Office of the Justicar (RID 115) the only way from the gallery (rows 1-6, where you arrive from the street and by teleport) to Caramo and the sign in the well (rows 7+) is a same-room gate: exit squares (6,11) -> (8,11) and (7,11) -> (5,11) (barcourt.kod CreateStandardExits). The playtester's take_exit / walk_to can't use it, so Caramo, the rename window and her bounties are unreachable. This is the playtest walker's limit (tools/agent/walker.ts takeExit/useDoor), not the game, but it blocks parts A and B of the ADR 0026 test.

## Steps to reproduce

1. admin_teleport 115 (lands row 6, col 12, gallery). 2. take_exit barcourt.roo. 3. Journal: 'You open the door and walk through.' (the server puts you at 8,11), then 'You are unable to go anywhere.' x4 (useDoor keeps pressing go because roomFile never changes), then the walker takes the second nearest door (7,11) -> back to (5,11). Result text: 'The door at row 7, col 11 didn't let you through (locked, or not a door you can use).' walk_to(11,11) stops at 6,11 (no path across the wall); talk to Caramo says 'You must stand closer to speak with them.'

## Expected

take_exit to the court side should stop after the first teleport inside the same room (position changed by the exit's arrival square) and leave me at (8,11) in the well.

## Actual

The walker waits ~6 s for a room change, then walks to the other gate and returns to the gallery. Blink, rest, parallel calls didn't help (Blink goes to viTeleport 6,12).

## Screenshot

![What the game showed](2026-10-25-1859-take-exit-can-t-cross-a-same-room-gate-justicar-ga.png)

## The journal before it

```
#142 23:55:40 server Sister Imelda says, "Nothing so simple as a grave-digger.  The ground there is old and sour with dark magic.  The dead have risen near Tos since long before Master Mold was born."
#143 23:55:51 server Advocate Tobias Wren says, "Could a man with a shovel do such a thing?"
#144 23:55:56 server Sister Imelda says, "Necromancy takes years of study, rare reagents and a great deal of wickedness.  Master Mold has none of these."
#145 23:56:02 server Pell the cooper tells you, "The spectator whispers.  Shh!  This is the best part."
#146 23:56:02 quest Pell the cooper has no quests for you.
#147 23:56:06 server Ambrose Mold says, "...I've got a very good shovel."
#148 23:56:08 self You told Shardshots: Scout (AI playtester): stuck in the gallery of the Justicar office; my walker can't use the same-room gate. Dev: please teleport Scout to row 11, col 8 (the well) if you can.
#149 23:56:11 server Young Corin says, "Ha!"
#150 23:56:17 server Justice Halvard Crane says, "Mistress Fenn, I am sorry for your loss, and for your fright.  But this court cannot hang a man for the nature of the soil."
#151 23:56:28 server Justice Halvard Crane says, "Ambrose Mold, you are found innocent."
#152 23:56:33 server Justice Halvard Crane says, "The court orders the graveyard at Tos sealed after dark.  Any brave soul who would put the risen dead back in their graves may ask the clerk: the Office pays for such work."
#153 23:56:44 server Ambrose Mold says, "Thank you, your honour.  I'll dig them deeper from now on."
#154 23:56:51 server The court stands in recess.  The next case will be heard shortly.
#155 23:56:51 server Dunstan says, "My money's on the Crown in the next one."
#156 23:57:30 server You can't fight here.
#157 23:57:51 server Caramo says, "All rise!  The matter of Brindle against Thorne, farmers of Marion, concerning a cow."
#158 23:57:59 server Justice Halvard Crane says, "A cow."
#159 23:58:03 server Caramo says, "Yes, your honour.  Her name is Buttercup."
#160 23:58:09 server Mirabel says, "Ha!  Buttercup!"
#161 23:58:13 server Justice Halvard Crane says, "Proceed."
#162 23:58:18 server Joss Brindle says, "Your honour, Buttercup was born on my land, of my cow, and she's mine."
#163 23:58:25 server Wenna Thorne says, "She's eaten my grass for three years!  Every drop of milk in her came out of my field!"
#164 23:58:33 server Joss Brindle says, "The fence is on your side of the brook!"
#165 23:58:38 server Wenna Thorne says, "The brook moved!"
#166 23:58:40 self You said: Scout status: C mostly done (4 trials heard). A and B BLOCKED: my walker can't cross the gallery gate to Caramo (take_exit bounces me back). Need teleport to the well, row 11 col 8.
#167 23:58:40 self The server moved you back (a blocked step).
#168 23:58:43 server Justice Halvard Crane says, "Order.  Advocate Wren, you speak for Mistress Thorne?"
#169 23:58:49 server Advocate Tobias Wren says, "I do, your honour, and I would like to call Buttercup herself as a witness."
#170 23:58:57 server There is a long silence in the court.
#171 23:59:02 server Justice Halvard Crane says, "...The cow is outside?"
```
