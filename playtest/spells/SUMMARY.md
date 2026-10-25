# Spell system playtest: summary (2026-10-24 and 25)

Six schools played one after another with the character Scout, plus scripted players for what one character can't do (PvP, group effects, exact numbers). Individual reports are in `playtest/reports/` (30 bug reports from the spell tests, dated 2026-10-24 and 25), the raw numbers and observations in `playtest/notes/2026-10-24.md` and `2026-10-25.md`, and the descriptions as the game shows them in `playtest/spells/descriptions-<school>.md` (with `tier-changes.md`).

## How it was run, and what to keep in mind

- **Build under test.** Shal'ille, Qor and Kraanan were played on the Kod compiled at 19:12 on 2026-10-24 (spell revamp phases 1-7). The "level grids" and "Themala teaches every Jala song" commits came in while those stages ran. The server was rebuilt and reloaded at 22:40 (24 spells moved tier), and Faren, Riija and Jala were played on that build. Mechanics don't depend on tiers, but teacher lists and "which level" answers do: those were re-checked after the reload (the Raza elder, the teacher scan).
- **The character is a fixture.** Scout had Intellect 90 and a very high Mysticism (+40% on attack-spell damage, see `DamageFactors`), base health 100 (set through the game's own call, with XP matched: base health follows XP, so a bare `set` snaps back at the next level-up), all spells at 99%, a one-off mana stock of 900 (the natural maximum is 89; stock above it never regenerates and is lost on death), and a lot of reagents. Damage numbers in the reports are for that character. A stat-35 character does about 25-30% less (the descriptions say so too: they use the viewer's own stats).
- **Descriptions.** The game offers no way to read a spell's description in the playtester's tools, so a scripted client dumped all 158 as the game sends them (`BP_LOOK` on each spell) at 60% and at 99% ability.
- **Tool artifacts, not game bugs.** The playtester's MCP journal drops some multi-line resource messages. Two reports it filed as major are NOT game bugs (a scripted client gets the messages): the Faren priestess's blank "attune" replies, and Foresight printing nothing. Both reports carry a coordinator note saying so.

## Checks that came out clean (by script, over all 158 spells)

- Every "Spellpower N" equals the sum of its breakdown lines, at 60% and at 99% ability.
- Every spell's spellpower rises with ability, and every "At your spellpower" line changes with it.
- Damage against a dummy matched the description's range for 18 attack spells (Fireball 8-14 observed vs 8-13 described, Lightning Bolt 13-16 vs 11-16, Ice Nova 10-15 vs 10-18, Fire Storm 15-27 vs 14-27, Earthquake 17-22 vs 15-23, Blast of Fire, Explosive Frost, Shocking Fury, Vampiric Drain...). One Fireball roll was a point over the stated maximum.
- No typo in any description that I could find by reading every word that appears only once. (Typos are in messages: "matyrdom" in Martyr's Grace, "pile of bones's remains", "is already effected by magic" which is upstream.)
- The Raza elder answers "level 1" and "level 2" with spell lists, "I teach no abilities at that level." for levels 3-6 (he used to stay silent).

## Bugs and surprises, most serious first

Severity as the playtester judged it, after my checks. File names are in `playtest/reports/`.

1. **Jala foe songs have no range.** Sacred Resonance, Profane Resonance and Disharmony hit dummies 6, 8, 9, 15 and 30 squares away on every pulse, though the description says "within hearing" (about 8 squares by the Kod). With a pack, 6 foes take 4.8 damage per second for 0.6 mana per second. Likely cause: `radiusench.kod` measures the distance from the caster to the caster.
2. **Conciliation pacifies for good.** A monster that "loses interest" never attacks again, even after the song ends, until you hit it (60+ seconds seen). The description says "for a few moments".
3. **Profane Resonance overheals.** Health reached 173 of 100 (the cap is 200%), then decayed over a minute.
4. **Crystalize Mana fires free and often.** For anyone who knows it, any cast or song upkeep that can't be paid triggers a surge: about 129 mana, every ~59 seconds, no reagents, no health cost. That's 2.2 mana per second on top of a natural 1 per second. It also lowers max mana (29 of 89) for the minute. This is why songs "never run dry".
5. **Forces of Light adds no spellpower** (the cast passes a spell number where a spell object is compared: `spell.kod:2539` vs `room.kod:3860`). It also only reaches players, so companions get nothing. Even fixed, it's capped like the light bonus.
6. **Qor's "hour of the day" term is a sawtooth**: `2 + hour` (0-23), so Qor spellpower climbs all day, peaks at 23:00, and falls back to its minimum at midnight. At noon in a field a Qor mage (68) is about as strong as at midnight in a dark crypt (64). Darkness itself only adds about +2. This contradicts "spellpower grows with darkness".
7. **Eavesdrop lasts about 2 seconds** (500 + (spellpower/10)*100 ms), too short to hear anything.
8. **Temples with unreachable insides.** The walker cannot reach the Riija monk (RID 2151: the nav grid has no route; the temple also throws non-immortals out of the inner area, so a teleport doesn't help), the inner Kraanan temple around Priestess Qerti'nya, and Berg's temple of Jala (Themala) from the main gate. These may be nav-grid gaps, but the Riija monk is the only Riija teacher.
9. **Silence.** The caster can't speak under his own silence ("Your words catch in your throat"), casting any spell lifts the curtain without the spell firing, and any hit ends it within 1-2 seconds, so against a monster in melee range it doesn't hold. The description says nobody but the caster can cast or speak, and "monsters and players alike". It does mute a player (scripted PvP) and drains about 6-7 mana per second. Not shown against a monster caster (none would stay at range).
10. **Poison is a Qor level-1 spell that does nothing** (no teacher, no effect, no message) and **Poison Gas only poisons players**. **Shadow Rift** and **Blood Inheritance** need a prism and other casters and just waste reagents solo. **Summon Cow** has no teacher.
11. Smaller: Fade prints "visible again" twice and swallows the cast that breaks it; Flash reaches every creature in the room at any distance (13 identical "Duration of hold is 2 seconds." lines in one cast); Feign Death drains 5 mana per 5 s (not in the description) and lets monsters heal fully; Final Rites gives no damage or kill feedback; Holy Symbol shows no visible effect; Holy Weapon adds flat damage to every hit; Martyr's Grace ignores companions; Martyr's Battleground's ally on/off messages never appear; Dispel Illusion with nothing to dispel takes its reagents silently; Hunt on an offline player takes its cost and says nothing; Mark of Dishonor still says "gaining N health" for Vampiric Drain while it blocks the heal (it does block it); six foe songs all say "You begin playing a discordant tune."; song descriptions leave out the per-pulse mana upkeep.

## Confirmed working as described (numbers)

- **Shal'ille.** Spellpower grows with light: Holy Blaze 86 in a noon field, 77 at midnight, 54 in the Raza crypt ("Shal'ille's favour in this place" +25 in a field, +0 underground; "The light here" +9 noon, 0 midnight, +2 crypt). Effect: about 15% less damage in a crypt. Holy Blaze on neutrals 12-18, on orcs 21-23, on zombies 22-23, on skeletons 20-27, on a Qor player 19-27 (described 11-16). It heals a companion and never hurts it ("restoring 12 hitpoints", capped by the wound). Detect Evil, Mark of Dishonor (PvP: marked player takes about +10% and no heal at all: Vampiric Drain healed 35 health over 3 casts unmarked, 0 marked), Final Rites (kills zombies in 2-3 casts, hits all undead in the room), Restore Companion (half health back), Truce, Rescue, Cure Poison, Dazzle, Reveal, Resist Acid all worked.
- **Qor.** Vampiric Drain heals about 12 per cast (overheals); Splash of Acid 22-26 per cast; Acid Touch 10-15 per bare-hand hit for 3 mana and 640 seconds; Invisibility works as described (monsters ignore you unless you struck them; 148-164 s); Fade works (120 + 5 x spellpower s; breaks on cast and attack, not on walking); Defile gives a flat ~17 mana whatever the monster; Death Link, Blind, Hold (only 3-4 s), Swap, Animate worked.
- **Kraanan.** Martyr's Battleground at spellpower 99: +149 to hit, +4 damage per blow, heals 6 per death and 12 at an ally's, 228 s, monsters not healed by their own deaths. Companion fights with it: 3 skeletons cleared in 13 s against 30 s without, and the companion healed 42 to 65. Mana Shield: exactly 1.5 mana per point of damage, 13 minutes. Anti-magic Aura drops every spell in the room (yours too) from 99 to 25.
- **Faren.** Fire Storm radius about 10-11 squares (not room-wide). Area spells against 5 targets: Fire Storm 123 per cast (21 mana, ~3.3 s), Ice Nova 93 (14 mana), Earthquake 126 (11 mana, 6.3 s, and 17-20 damage to you). Heat/Freezing 4 damage to every monster in the room each 10 s for 300 s. Attunement: +9 to +11 spellpower and about +13-18% damage on that element; flame burns 3 ticks of about 1/12 each (nearly invisible), frost chills (attack interval x1.45-1.5 for ~5 s), storm silences 3 s after a Lightning Bolt or Shocking Fury hit. The chill and the 3-second silence also work unattuned.
- **Riija.** Disguise bonus = (spellpower + 9) / 10, max 10 (about +11% spellpower), only the strongest counts; Anonymity best (14 mana, 6 minutes, keeps gear). Bewildered: +8.6% Fireball damage after Vertigo on a player (18.6 over 24 casts vs 17.1 over 18), +8-9% on a dummy after Vertigo or Illusionary Wounds; Vertigo ~20 s on every monster tried. Feign Death: monsters give up, no gear loss. Transmogrify: the cow keeps the wounds and drops nothing.
- **Jala.** Songs cost mana every 5 s after the cast (Warp Time 5, Spellbane 8, Mana Convergence 9, Jig 10, foe songs 3); Lute and Necklace of Jala add +20 spellpower each. Warp Time slows an orc's attacks by 38%; Civility weakens its hits by about 13% (the Kod says 23%).
- **PvP (two soldiers of rival lieges, scripted).** Rival-school bonus is large: Holy Blaze on a Qor player 1.7x the described range, Vampiric Drain on a Shal'ille player about 1.5x; Fireball (no school bonus) matches its description. Silence mutes a player. Mark of Dishonor and Bewildered work.

## Overpowered and weak, overall

**Three most overpowered**
1. **Crystalize Mana** (Jala): about 129 free mana a minute, automatically.
2. **Mana Focus** (Faren, 1 mana): Fireball 14.2 to 20-22 (+47%) and about 3x mana regeneration for 40 seconds; spamming bolts is roughly mana-neutral.
3. **The 3-mana touch spells**: Icy Fingers 18-21 per punch, Acid Touch 10-15, Touch of Flame ~14, Zap 17-20, each about once a second for 10 to 25 minutes, bare hands only. About twice the damage per second of Fireball for 3 mana in total.

Close behind: Martyr's Battleground (+40% damage for the whole side for 8-10 mana), Conciliation (permanent de-aggro), Profane Resonance (overheal), Illusionary Fire Wall (~7 dps for 144 s, 14 mana), the room-wide foe songs, and (by the Kod, still to be confirmed with a big wound) Holy Blaze as a heal at about 1.5x Major Heal for a third of the mana.

**Three weakest**
1. **Forces of Light** (Shal'ille): does nothing today.
2. **Eavesdrop** (Riija): about 2 seconds.
3. **Poison** (Qor): can't be cast at all (nothing happens, nothing teaches it).

Next weakest: Rejuvenate (no measurable gain), Mirth (no visible effect), Mana Convergence (+15% for 1.8 mana/s), Hold (3-4 s), Silence (breaks on a hit), Evil Twin and Apparition, Holy Symbol, Heat/Freezing (0.4 dps), Bless, Spiritual Hammer and Sword (the spellpower they add is their value).

## Teachers

- Every spell a player can learn has a teacher in the Kod, except: Poison (monsters only), Summon Cow, and the internal effects (Chill, Burn, Bewildered); Squelch is a DM spell that shows in a player's Jala list. Quest-gated teachers: Heat and Fade (Barloque apothecary), Dement (Jasper elder), Truth, Mirth and Melancholy (Pupil of Truth), Invigorate (needs another Jala song first). The Faren priestess now sells Shatter, the Qor priestess Silence, the Kraanan priestess and the Heretic Martyr's Battleground, Priestess Themala every Jala song (17).
- The shops show nothing for a character that already knows everything, so prices were not read in game ("doesn't sell anything" reads oddly: "nothing more to teach you" would be clearer).
- Reaching them: see bug 8.

## Not tested, and why

Cure Disease (nothing in reach gives disease), Portal of Life and Bond (reagent costs), Truth (no invisible foe), Spellbane and Disharmony's spell-block (no monster stayed at range casting), Melancholy, Relay and Mystic Touch (need a second player), Detect Evil's flash (a light flicker, inconclusive in screenshots), Brittle's and Spore Burst's effect on a real monster, Mana Shield running dry, Martyr's Battleground with faction soldiers or a real second player, Silence against a monster caster, and the faction-war PvP of Shatter and the walls. Unarmed touch spells weren't compared against armed melee.
