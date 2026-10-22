---
title: "Smith Repair window shows plain names for revealed magic items; chain armor has no ring"
severity: major
category: "items"
status: fixed
reported: 2026-10-21T23:54:33.606Z
character: "Scout"
room: "The Blacksmith of Raza [razasmith.roo, RID 303]"
square: "row 6, col 6"
commit: 7b6c6fd
---

# Smith Repair window shows plain names for revealed magic items; chain armor has no ring

Phase 2 says revealed magic items get a full name from the server (UC_MAGIC_NAME) shown in the smith window. In Tomas's Repair window (Raza smith, RID 303) the revealed items still read "chain armor (worn)", "short sword (worn)" and "hammer". Waited 4 s, reconnected and reopened three times: the name never changes. The chain armor row also has no ring on its icon, although its description dialog shows "enormous chain armor of warding" with a thick silver ring.

## Steps to reproduce

1. connect (browser) as Scout, who wears a revealed enormous chain armor of warding, wields a revealed short sword (red ring) and carries the Adventuring hammer (amber ring).
2. Go to razasmith (RID 303), talk to Tomas [2639].
3. Screenshot after 4 s.

## Expected

Rows read e.g. "enormous chain armor of warding (worn) 556/559", with the item's ring on the icon (silver for warding). ItemServiceDialog.tsx calls session.itemName(o), and phase 2 says the smith window shows full names.

## Actual

Rows: "chain armor (worn) 556/559 10 shillings", "short sword (worn) 193/218 14 shillings", "hammer 292/293 10 shillings". Chain armor icon has no ring; sword icon has a red ring; hammer an amber ring. Names stay plain. The description dialog (examine) shows the full name line correctly, so the server data exists. Possible causes: the UC_MAGIC_NAME reply isn't arriving or isn't stored (SendMagicName CanSee / HasRevealedMagicName, or the client's world.magicNames), or the inventory object's flags for the armor lack the reveal bits. Not checked: the inventory tooltip (the tools can't open it).

## Screenshot

![What the game showed](2026-10-21-1854-smith-repair-window-shows-plain-names-for-revealed.png)

## The journal before it

```
#1 23:54:02 quest Tomas has no quests for you.
```

## Triage (2026-10-21)

- **Names: not a game bug.** The screenshot shows the full names in the browser client ("enormous chain armor of warding (worn)", "potent short sword of vampirism (worn)", "adventuring hammer"). The playtester read the window through its own text tools, which show items' plain names.
- **Chain armor's ring: fixed.** Its flags were right (enormous, silver), but a silver ring on the light grey chain-mail icon didn't show. Every ring now has a dark line just inside it (styles.css `.obj-icon.magic::after`), so pale rings show on pale art.
