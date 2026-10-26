# ADR 0027: Offerings and shrines

- Status: built (2026-10-26). Tried on the local server:
  - the market shrine took an offering, and everyone heard it;
  - a dedication past its time faded, both through `CheckExpiry` and through `System.NewGameHour`, and everyone heard that;
  - Shal'ille's daily gave its bottle and completed when the bottle was offered at a shrine, and wasn't offered again that day;
  - every temple offered its daily;
  - the Death Realm quest came from the elder, hid Zuxana's copy, and counted the laboratory and the Death Realm temple (reached by teleport).

  The ritual itself (the six bottles on the pedestals) is the existing code and hasn't been played.
- Builds on: the quest book ([ADR 0009](0009-quests.md)), the spell revamp's spell power ([ADR 0023](0023-spells.md)), and the Death Realm (the Marion crypt ritual, `shards-server` `monsroom/marcryp4.kod`).

## Context

There are six offerings, one bottle per school. They live in `kod/object/item/passitem/offering/`:

| School | Bottle |
|---|---|
| Shal'ille | tears of a newborn |
| Qor | blood of the innocent |
| Kraanan | sweat of the warrior king |
| Faren | burning water |
| Riija | bottle of lies |
| Jala | mystic perfume |

They do nothing on their own. They have two uses.

**Shrines** (`object/passive/shrine.kod`):
- Dropping a bottle beside a shrine dedicates the shrine to its god (`System.ShrineCheckItem`). Every player then has +6 spell power in that school (`System.GetShrineBonus`, added in `Spell.GetSpellPower`), and everyone online hears it.
- There are six shrines:
  - the Forest Shrine;
  - the Badlands;
  - the orc cave;
  - the Brax arena;
  - the island cavern, hidden until its item puzzle is solved;
  - the Barloque market.

**The Death Realm.** In the Mad Brothers' laboratory (Marion crypt, level 4), all six bottles go on the pedestals, Qor's in the centre. Speaking "Hear me Qor, accept my offer. Open your realm and lend me your strength." then opens a portal to the Death Realm temple.

**Where the bottles come from:**
- boss drops: the Orc Pit, the Sewer King;
- the Golem dungeon and Marion crypt treasure;
- the Death Realm's merchants, for souls;
- the Stunted Dwarf quest;
- a daily quest each from the Faren, Kraanan and Riija temples (quests 85-87), which only hand the bottle over.

**What was wrong (found 2026-10-25):**
- A dedication lasted forever, so one player could hold every shrine for their school.
- The market shrine had no drop check, so it could never be dedicated.
- Nothing told players what a bottle is for: each description was the same "ominous purpose you can only guess at".
- Shal'ille, Qor and Jala had no daily.
- No NPC mentioned the Death Realm ritual.

## Decisions

These are the user's, made on 2026-10-25.

1. **A dedication lasts one real day.**
   - `Shrine.piExpires` is set to `GetTime()` plus a day when an offering is made. Another offering, of any school, starts a fresh day.
   - `System.NewGameHour` asks every shrine to `CheckExpiry`. One past its time falls back to no god, the totals are recomputed, and everyone hears that the god's favour fades.
   - Fading depends only on the clock, so it survives restarts and room recreates.
   - A shrine's description says how many hours its god has left.
2. **The effect stays server-wide, and so do the messages.** +6 spell power a shrine, for everyone, while it lasts.
3. **The market shrine takes offerings**, like the others: `barlmarket.kod` checks dropped items, within 2 squares.
4. **Each bottle's description says what it's for:** its god, and that a shrine would turn to that god for a day. Qor's also hints that six together open stranger doors.
5. **A new quest step, `shrine`.** It's done when the player makes an offering at any shrine, of the step's `school` (or of any school).
   - The bottle remembers who last held it (`Offering.poLastHolder`), and the shrine tells the quest book (`QuestBook.ShrineOffered`, `QK_SHRINE` 25).
   - In the quest files a step reads `{ "kind": "shrine", "school": "faren" }`. Its `rooms`, the open shrines, are its map area.
6. **Every school has a daily shrine quest** from its temple, band 50+, every 24 hours:

   | School | Giver |
   |---|---|
   | Shal'ille | Priestess Xiana |
   | Qor | Priestess Zuxana |
   | Kraanan | Priestess Qerti'nya |
   | Faren | Priestess Tenuv'vyal |
   | Riija | the Monk of Riija |
   | Jala | Priestess Themala |

   The giver's incantation (a `talk` step) gives the bottle, and the quest completes when it's offered at a shrine.
   - Quests 85-87 (Faren, Kraanan, Riija) are reshaped this way, keeping their ids.
   - Shal'ille, Qor and Jala get new ones.
7. **The Death Realm quest, at 100 health**, is given by both Ran er'Hoth, the Marion elder, and Priestess Zuxana of Qor. Taking one hides the other.
   - The text explains the ritual.
   - Steps: find the laboratory, enter the Death Realm, then go back to the giver.

## Consequences

- A bottle the player can't carry lands at their feet, and it only counts as theirs once they pick it up (`Offering.NewOwner`).

- A dedication made before this change has no `piExpires`, so it fades at the first check. The next deploy brings a fresh world anyway.
- The meridian-browser quest tool and the client know the new step kind (`schema.ts`, `validate.ts`, `packages/world/src/quests.ts`, the admin Quests tab).
- A shrine still accepts any item dropped beside it and grumbles at anything that isn't an offering, as before.
