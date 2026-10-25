---
title: "Berg: arrival square in Outskirts of Berg (from Main Gate) has no way out; Themala unreachable"
severity: minor
category: "movement"
status: new
reported: 2026-10-25T05:52:00.708Z
character: "Scout"
room: "Outskirts of Raza [razaforest.roo, RID 330]"
square: "row 24, col 37"
commit: dcdec20
---

# Berg: arrival square in Outskirts of Berg (from Main Gate) has no way out; Themala unreachable

travel_to / take_exit from bergmg.roo to berg4.roo puts the character at row 8, col 7, and from there every walk_to (even one square away) and take_exit (E edge to the Temple of Jala, N edge back to the Main Gate) answers "No way to ...". The Temple of Jala (Priestess Themala, who teaches every song) is therefore not reachable on foot from Berg by this route. d6e6.roo (Deep in the Forest of Farol, arrived from c6.roo's east edge, at row 5 col 3) did the same.

## Steps to reproduce

admin_teleport berg (RID 2800), rest off, travel_to 2814. It walks bergcity -> bergmg -> berg4 and stops: "Stopped in berg4.roo on the way (bergmg.roo -> berg4.roo): No way to the E edge." Repeated twice (after rest off too). walk_to 8,8 / 9,7 / 7,7: "No way ... (walls, or it's not walkable)". Contrast: admin_teleport 2813 puts me at (22,10) and take_exit berg_jala.roo works at once ("Now in berg_jala.roo, at row 8, col 2"). Second case: admin_teleport 300, travel_to 2814 stops in d6e6.roo at (5,3): "No way to the N edge.".

## Expected

The arrival square beside an exit is on the room's walkable floor and joins the rest of the room.

## Actual

Isolated arrival square (8,7) in berg4.roo. May be the playtester's nav grid rather than the room; I did not check with the browser body. If the room really drops a player there, it is a trap: even the way back N is refused.

## The journal before it

```
#14077 05:51:03 combat Your attack is parried by the orc.
#14078 05:51:04 combat Your punch pummels the orc for 6 damage.
#14079 05:51:04 combat You hit orc for 6.
#14080 05:51:04 combat The orc is clearly injured.
#14081 05:51:05 combat The orc's attack slashes you for 6 damage.
#14082 05:51:05 combat Your attack is parried by the orc.
#14083 05:51:06 combat Your attack is dodged by the orc.
#14084 05:51:07 combat Your punch pummels the orc for 8 damage.
#14085 05:51:07 combat You hit orc for 8.
#14086 05:51:07 combat The orc's attack misses you.
#14087 05:51:08 combat Your punch slaps the orc for 3 damage.
#14088 05:51:08 combat You hit orc for 3.
#14089 05:51:09 combat Your punch pummels the orc for 7 damage.
#14090 05:51:09 combat You hit orc for 7.
#14091 05:51:09 combat The orc is seriously wounded.
#14092 05:51:10 combat The orc's attack cuts you for 3 damage.
#14093 05:51:10 combat Your attack misses the orc.
#14094 05:51:11 combat Your punch pummels the orc for 5 damage.
#14095 05:51:11 combat You hit orc for 5.
#14096 05:51:12 combat The orc's attack misses you.
#14097 05:51:12 combat Your punch pummels the orc for 7 damage.
#14098 05:51:12 combat You hit orc for 7.
#14099 05:51:12 combat The orc is weak, and near death.
#14100 05:51:14 combat Your punch pummels the orc for 8 damage.
#14101 05:51:14 combat You hit orc for 8.
#14102 05:51:15 combat Your punch thrashes the orc.
#14103 05:51:15 server The orc crumples to the ground, never to rise again.
#14104 05:51:15 combat You can't carry any more, so you loot nothing from your fallen enemy, but you do find 28 shillings.
#14105 05:51:15 combat Your target is gone (dead, or it left).
#14106 05:51:16 health Health back to full (100).
```
