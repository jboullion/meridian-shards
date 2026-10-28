# ADR 0028: The Abilities tab, and how far the next school level is

- Status: built (2026-10-28). Tried on the local server: the trainer's answer (`PlayerCanLearn`) and the tab's numbers (`LearnNeed`) agree for weaponcraft 3 on a weaponcraft 2 character (41 of 185, 144 short both ways); the tab drew every state with an admin character (mastered schools, an admin-only spell under Other) and with sample numbers in the browser (short, ready, out of reach, the counting three). Not yet played by a character climbing a school.
- Builds on: training and abilities ([ADR 0016](0016-abilities.md)), the spell revamp's level grids ([ADR 0023](0023-spells.md)).

## Context

A school's levels are gated by a sum players never saw. To learn the first spell (or weapon skill) of level N, the three best percents you have at level N−1 of that school must add up to a **need**:

- your **learn points** (each school's highest level by the table 1, 2, 4, 6, 8, 10 for levels 1–6, weaponcraft counting as one school, plus the level you're reaching for) × 7,
- plus 297 − 16 × 7 (`Settings.piMaxLearnPoints`),
- less Intellect × 2/5 × 7,
- at least 75, and a third (two thirds) of that when the level below has only one (two) abilities.

So every new level in *any* school raises every other school's need, by 7 or 14. The only way to find out where you stood was to ask a trainer. The Spells and Skills tabs were two flat lists that said nothing about schools.

## Decision

1. **One Abilities tab** replaces Spells and Skills, in the Modern character window and the Classic sidebar (the Spells tab's button art). Spells and skills are grouped by school: Weaponcraft, then Shal'ille, Qor, Kraanan, Faren, Riija and Jala; anything else (brawling, thievery, admin spells) goes under **Other skills**, with no progress.
2. **Each school folds.** Folded, it's a summary: its level ("Faren 3"), how far its next level is ("Faren 4: 168 of 213", "Kraanan 5 ready", "Mastered", "Out of reach"), a bar and one plain line ("45 more in your three best Faren 3 spells"); the tooltip explains the rule in a sentence. Open, it lists the school's abilities lowest level first under "Level N" labels, and a dot marks the three that count. Schools start folded; which are open is remembered per character (`localStorage` `shards.abilities.<server>.<character>`). A search opens every school with a match. Rows behave as the old lists did (cast, look, drag to the quick slots, the range ring, Cast, Study).
3. **The server reckons it.** The client knew spells' schools but no levels, and nothing about skills; and the rule has shortcuts and scaling that are easy to copy wrong. So the server sends the numbers, from the same code the trainers use:
   - `player.kod` `LearnNeed` (school, level) is the (school, level) half of `PlayerCanLearn`, which now calls it after its own checks (accessible, enabled, free, known, karma, the "you know one at this level" shortcuts), so trainers behave exactly as before. `LearnStanding` (each school's highest level), `LearnTopThree` and `LearnIntellectHelp` are its parts. Weaponcraft is still the highest level of *any* skill, as `PlayerCanLearn` always counted it.
   - `UC_SCHOOLS` (126), from `util/shardsabilities.kod` `SendSchools`: learn points, Intellect's help, each school known (level, next, have, need, `SCHOOL_*` state), and every spell and skill known with its school, level and whether it counts.
   - `Player.QueueSchools` posts one send after any change (`ChangeSpellAbility`, `ChangeSkillAbility`, `AddSpell`, `AddSkill`, `RemoveSpell`, `RemoveSkill`, `RemoveAll*`, a stat reset's Intellect) and at logon, so a stat reset's dozens of changes send once. The client asks with `schools` over `UC_SHARDS` if it has none.
4. **Trainers are unchanged.** No warning when buying a level; the tab is where players learn this.

## Consequences

- Players can see what to practise or train, and that spreading over schools costs them, before they find a trainer.
- The client no longer has separate Spells and Skills tabs; `Sidebar.tsx StatList` is gone (quests have their own panel).
- The reckoning lives in one place; a change to it changes the tab and the trainers together.

## Where

- shards-server: `player.kod` (`PlayerCanLearn`, `LearnStanding`, `LearnSchoolLevel`, `LearnTopThree`, `LearnNeed`, `LearnIntellectHelp`, `QueueSchools`, `SendSchoolsNow`, the hooks), `util/shardsabilities.kod` (`SendSchools`, `SCHOOL_*`), `user.kod` (logon, the `schools` verb, `UserChangedStats`), `include/protocol.khd` (`UC_SCHOOLS`).
- meridian-browser: `packages/world/src/schools.ts` (`readSchools`, with a test), `state.ts` (`world.schools`, the `schools` event), `session.ts`; `apps/client/src/game/ui/AbilitiesList.tsx`, `Sidebar.tsx` (`Tab`, `TABS`, `requestTabStats`), `CharacterWindow.tsx`, `styles.css` (`.ability-*`), `tables/help.json`.
