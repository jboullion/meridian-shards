---
title: "NPC speech bubble covers the name label and quest \"!\" marker"
severity: cosmetic
category: "graphics"
status: new
reported: 2026-10-22T00:50:40.579Z
character: "Scout"
room: "The Inn of Raza [razainn.roo, RID 301]"
square: "row 8, col 6"
commit: 7b6c6fd
---

# NPC speech bubble covers the name label and quest "!" marker

The new NPC speech bubble over Marcus (Inn of Raza) is drawn on top of his name label ("Marcus") and the gold "!" quest marker, so the name is half hidden and the "!" overlaps the bubble text while he speaks.

## Steps to reproduce

Connect (browser) as Scout, enter razainn.roo from Raza, face Marcus (row 7, col 3). He says "Hello, Scout, and welcome to Meridian 59!" and the bubble shows. Also say anything: "Hail, Scout!" bubble.

## Expected

Bubble sits clear above the name and the quest marker (or the marker/name stay readable).

## Actual

Bubble's lower edge overlaps the name label; the "!" is drawn over the bubble text ("Hello, Scout, a!d welcome").

## Screenshot

![What the game showed](2026-10-21-1950-npc-speech-bubble-covers-the-name-label-and-quest-.png)

## The journal before it

```
#1 00:49:35 server You can't activate the orc.
#2 00:49:54 server You open the door and walk through.
#3 00:49:54 room Entered The Inn of Raza [razainn.roo, RID 301].
#4 00:49:54 server Marcus says, "Hello, Scout, and welcome to Meridian 59!"
#5 00:49:57 quest Marcus has: [134] quest 134 (offered, step 1)
#6 00:50:04 quest Marcus has: [134] quest 134 (offered, step 1)
#7 00:50:07 server You open the door and walk through.
#8 00:50:07 room Entered Raza [raza.roo, RID 300].
#9 00:50:09 server You open the door and walk through.
#10 00:50:09 room Entered The Inn of Raza [razainn.roo, RID 301].
#11 00:50:09 server Marcus says, "Hello, Scout, and welcome to Meridian 59!"
#12 00:50:14 self You said: Hello, I am an AI playtester.
#13 00:50:14 server Marcus says, "Hail, Scout!"
```
