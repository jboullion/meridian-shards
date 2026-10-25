# Spell system playtest (2026-10-24)

How the spell rework is being played, and how to report. Read this first, then your school's description file.

## The character

You are **Scout** (the server calls the character Shardscout) on the local test server, through the `meridian` tools. The developer has set Scout up:

- 120 health, 400 mana (it refills when the developer says so; `rest` also recovers a little), stats 35 each.
- Every spell of the school you're testing (and Kraanan, Faren, Riija, Jala when they're not in the way) at **99% ability**. Shal'ille and Qor spells exclude each other: a player who knows any Qor spell gets "You are not worthy to cast..." on every Shal'ille spell, and a Qor spell says "not vile enough" if the player knows a Shal'ille one. That is the original's rule; the developer swaps which of the two you know between stages.
- Plenty of reagents (about 99 of each common one), so a refusal "You don't have the reagents to cast X!" is worth reporting: say which reagent the description names.
- A weapon: a mace. 1000 shillings.

## What the game tells you

- Every cast prints "Spellpower for <spell> is N." in the events. The spellpower changes with the room's light, the hour, your vigor, company and your faction, so that line is how you compare places and times.
- Damage lines read like "Your fireball chars the training dummy for 10 damage." or "Your fire storm scorches the giant rat for 26 damage.". Count them: numbers are what we need.
- `examine` cannot show a spell's description (spells aren't room or inventory objects), so the descriptions are written out for you, as the game shows them, in `playtest/spells/descriptions-<school>.md`. They were taken in the Inn of Raza at 99% ability; each shows the spellpower breakdown and, beneath it, the numbers at 60%. The effect line ("At your spellpower: ...") moves with the spellpower, so compare against it using the spellpower the cast reports.
- The developer has already checked, by script, that every spellpower total equals its breakdown and that every number rises with ability. Don't spend time on that; do tell us when a description says something the spell doesn't do.

## Test helpers (local server only; say in a report when you used one)

`admin_teleport` (a room by number), `admin_spawn` (monsters by Kod class on the square east of you; e.g. GiantRat, Centipede, Mummy, Orc, Skeleton, Zombie, FungusBeast, Slime, Troll...), `admin_give`, `admin_hour` (the server's hour, 0-23, for everyone: 12 is noon, 0 is midnight).

Where to fight: the Outskirts (RID 330) is a daylight field; the Raza crypt (RID 306) is a dark dungeon; the Tos arena foyer, caves and crypts are indoors. Monsters spawn beside you.

## How to report

File each real problem with `report_bug` (check `list_reports` first), and put the other observations in `note`. For each issue give:

- the spell
- what you did (target, solo or group, the spellpower the cast printed)
- what you expected (quote the description line or the brief)
- what happened (numbers: how many casts, min/max/average damage, seconds)
- when the description text is wrong, quote the exact text

Finish with a short summary table: spell, worked as described? (yes/no/partly), verdict (too strong / about right / too weak, with the number behind it).
