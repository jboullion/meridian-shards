# ADR 0023: The spell revamp

- Status: built (2026-10-24), playtest next. Phases 0 to 7 are committed in shards-server: phase 0, bugs and curses (cd3ec410); phase 1, true effects in descriptions (ab910721); phase 2, player spells on monsters (71871527); phase 3, Faren (bd295159); phase 4, Jala (1d2fdff7); phase 5, Shal'ille and Qor (6c485611); phase 6, Kraanan and Riija (d60728e1); phase 7, descriptions, balance and teachers (43e4dd7b).
- Builds on: [ADR 0021](0021-factions-and-the-faction-war.md), whose no-random-PvP rule decides who a spell may harm; [ADR 0022](0022-guilds.md), whose guildmates count as allies; the magic item revamp, whose repair state a shattered weapon enters.
- Design page, with decisions D1-D40, numbered as here, the level grids and the playtest checklist: https://claude.ai/artifact/DN85cZxQmimZC6jo1vdNRr

## Context

Version 1 is close, and the spell system was the last one left from the 1990s. An audit on 2026-10-24 found:

- **The game hid what spells do.** A description was flavour text and a reagent list. Spellpower came from up to eight sources (half the spell's skill, a school bonus capped at 30, a second school bonus capped at 10, faction, shrines, items, Kraanan's hidden +20, enchantments), and none of them was shown.
- **Karma was dead but still in use.** Player karma has been 0 since commit 61c2a0cd. Shal'ille's and Qor's second spellpower source was karma, so it was always 0. Detect Evil and Detect Good needed the caster's own karma and did nothing. Holy Blaze, Final Rites, Séance and Martyr's Grace scaled with it.
- **Many spells only worked on players.** Shatter was disabled. Swap, Purge, Foresight, Brittle and Mark of Dishonor did nothing useful, or nothing at all, against monsters. With random PvP gone (ADR 0021), most fights are against monsters.
- **Some spells were dead weight:**
  - Jala's eight school-hindering songs hindered schools few players would ever fight.
  - Martyr's Battleground called revenants, which are gone.
  - Silence was disabled.
  - Fade and Invisibility meant nothing to monsters, since monster targeting never checked them.
  - Illusionary Wounds healed back, Illusionary Fire Wall did nothing under spellpower 35, and the Riija summons died in a hit.
  - Feign Death fooled no monster and threw away your gear.
- **Real bugs:**
  - Agility Boon shared spell ID 190 with Spiritual Sword.
  - Unholy Touch did almost no damage to the undead.
  - A misspelt property left five spells at exertion 1.
  - Distill's check never ran.
  - The newbie heal bonus was printed but not given.
  - Curse leftovers remained in Maleval's quest text and in the item code.

## Decisions

### Descriptions and spellpower

- **D1. A spell's description shows its buffs and where they come from.** Under the flavour text come three blocks:
   - **At your spellpower:** what the spell does in numbers.
   - **Costs:** mana, vigor, each reagent, cast time and recovery.
   - **Spellpower:** the total and every part of it.
- **D2. One source of truth.** `Spell.GetSpellPower(who, bParts)` returns the total, or with `bParts` the total and a list of named parts. The cast and the description call the same code, so they can't disagree.
- **D3. Each spell states its effect in plain numbers** (`HasEffectSummary` and `SendEffectSummary`; the design page called it `GetEffectSummary`).
- **D4. Server text first.** Descriptions already reach the web client as text, so no client change is needed. A styled panel can come later.
- **D5. Hidden bonuses are named.** Kraanan's flat +20 stays and shows as "Kraanan's favour". Every school's second source has its own line, and so does the school bonus's 30 cap, or its floor at 0, when it applies.

The breakdown has 18 fixed lines (`SPELL_PP_SLOTS`), because the client stops formatting past 8 nested `%r`.

### Player-targeted spells work on monsters (phase 2)

- **D6.** Spells aimed at players also work on monsters and NPCs. Players stay gated by `MayAttackPlayer` (war, guild war, arenas).
- **D7. Shatter is enabled again.** A shattered monster deals about 20% less damage for 1-3 minutes. On a player it breaks their wielded weapon into the magic revamp's repair state. The Faren priestess teaches it (D29).
- **D8. Debuffs map to what monsters have:**

   | Spell | Against a monster or NPC |
   |---|---|
   | Shatter | Weapon breaks: about 20% less damage for 1-3 minutes |
   | Brittle | Hide cracks: defense down for 30-90 seconds |
   | Enfeeble | Damage down |
   | Dement | Spellpower and casting chance down |
   | Vertigo | Offense and defense down (made a percentage in D37) |
   | Forget | Can't cast for 30-60 seconds, and forgets its target for a moment |
   | Foresight | Shows level, health, resistances and weaknesses, and its spells |
   | Swap | Swap places with a monster or companion, except bosses and no-move monsters |
   | Purge | Strips its enchantments and unbinds animated or illusory minions |
   | Mark of Dishonor | Can't be healed and takes 10% more damage |
   | Purify, Breath of Life, Cure Disease | Also work on companions |

   Monsters ask each enchantment to adjust them through new `Spell` hooks that change nothing by default:
   - `ModifyMonsterOffense`, `ModifyMonsterDefense`, `ModifyMonsterDamage`, `ModifyMonsterDamageTaken`
   - `MonsterCanCast`, `ModifyMonsterSpellPower`, `MonsterCanHeal`
   - `ModifyMonsterMoveSpeed`, `ModifyMonsterAttackTime`

   The monster reads them from both `plEnchantments` and `plRadiusEnchantments`. A monster's damage is in hundredths, so a flat damage bonus is multiplied by 100.

### Faren: the elements (phase 3)

- **D9, D10. Attunement, a one-time choice of Flame, Frost or Storm.** Priestess Tenuv'vyal offers it after Disciple of Faren, once you can learn level 4 Faren: say "attune", then "attune flame", "attune frost" or "attune storm". She warns that it's permanent. The chosen element's spells get +10 spellpower (its own line) and 15% more damage. Other elements get no penalty. Stored in `Player.piFarenAttunement`.
- **D11. Each element has a niche:**
    - **Flame:** for a flame-attuned mage, Fireball, Blast of Fire, Fire Storm and Touch of Flame set their target burning, instead of hitting 15% harder. The burn deals a quarter of the hit again over 6 seconds, in three ticks (`Burn`, `SID_BURN`; decided 2026-10-24). Heat and the fire walls keep the 15%.
    - **Frost:** Ice Shard, Explosive Frost, Ice Nova, the ice wall and Freezing chill their target for 4-6 seconds (`Chill`, `SID_CHILL`). A chilled monster moves and attacks half again as slowly. A chilled player recovers half again as slowly from attacks and spells. Chills don't stack.
    - **Storm:** a monster hit by Lightning Bolt or Shocking Fury can't cast for 3 seconds, and the lightning wall holds whoever crosses it for one second.
- **D12. A clear ladder for each element:** touches at 1-2, bolts at 3 (Fireball, Ice Shard, Lightning Bolt), blasts and room spells at 4 (Blast of Fire, Explosive Frost, Shocking Fury, Heat, Freezing, Winds), walls at 5 (Fire Wall, Ice Wall, with Brittle), storms at 6 (Ice Nova, Ring of Flames, with Fire Storm). Built with the level grids (below).
- **D13, D14. Room spells reach monsters, and never hurt their caster or the caster's allies:**
    - **Heat** burns by armour weight and saps vigor; monsters take 2-5.
    - **Freezing** hurts light armour most, and chills.
    - **Winds** gusts every 10 seconds.
    - **Winds and Sandstorm** buffet for a little damage, which never kills, and cut a monster's to-hit by spellpower/3 percent.

    Stopping regeneration was dropped, because monsters don't regenerate. `Spell.AffectsMonsters` lets `Room.EnchantAllOccupants` include monsters.
- **D15. Mana Shield moves to Kraanan level 5.** It costs a blue dragon scale and a kriipa claw (it used to cost 15 rare items), and the Kraanan priestess teaches it. It still converts damage taken into mana lost, 1.5 mana per health point.

### Jala: songs against foes (phase 4)

- **D16. The eight school songs become damage and debuff songs:**

    | Song | Level | Becomes |
    |---|---|---|
    | Sacred Resonance | 3 | Holy damage each pulse, double against undead |
    | Profane Resonance | 3 | Unholy damage each pulse; the singer regains a little health |
    | Disharmony | 4 | Earth damage each pulse, and enemies can't cast |
    | Civility | 2 | Enemies deal 10-29% less damage |
    | Conciliation | 2 | Calms: each pulse a monster may stop attacking |
    | Warp Time | 2 | Enemies attack and cast more slowly |
    | Truth | 4 | Reveals hidden enemies, dispels illusions, lowers defense |
    | Spellbane | 6 (was 5) | Enemy casters lose spellpower; monsters cast half as often |

- **D17. A song touches only the singer's foes:** monsters, and enemy players the singer may attack. Never the singer, guildmates or bystanders. The range stays 40 squares × (1 + spellpower/99). Warp Time no longer slows its own singer.
- **D18. Damage songs pulse every 5 seconds,** for 1-3 plus up to 4 with spellpower (`Hinder.GetPulseDamage`), against every foe in range.
- **D19. The hinder fizzle chance is gone** from casting.
- **D20. Songs play their music.** Listeners in range hear each song's `prMusic`, and the room's music returns when the song stops.

### Shal'ille and Qor: light and dark (phase 5)

- **D31. Light and dark replace karma** as these schools' second spellpower source. Shal'ille gets `Spell.GetLightBonus`: 0 at room light 84 or less, up to 10 at 220 or more. Qor gets 10 less that. Darkness no longer adds a separate bonus; it just darkens the room.
- **D32. Friend or foe, not karma, decides for players.**
    - Holy Blaze heals anyone, player or companion, its caster couldn't attack, and burns foes.
    - Forces of Light helps only the caster's allies (`Spell.IsCasterAlly`, shared with D25).
    - Against monsters, good and evil still count: monsters keep their karma.
- **D33. The rival school takes extra damage.** Holy Touch and Holy Blaze hurt a player who knows Qor spells more. Unholy Touch and Vampiric Drain (+25%) hurt a player who knows Shal'ille spells more. One check covers all four: `Spell.IsRivalSchoolPlayer`, built on `Player.KnowsSpellSchool`.
- **D34. Detect Evil and Detect Good** make evil (or good) monsters flash, and players who know Qor (or Shal'ille) spells, hidden and invisible ones included (`User.ToCliObject`).
- **D35. No signature mechanic for these two schools yet.** The overflow ward (Shal'ille) and dark harvest (Qor) ideas are parked.
- **D21, D22. Fade and Invisibility work against monsters** (`Monster.LosesSightOf`, `SomethingChanged`, `Brain.AttemptTargetSwitch`).
    - Monsters never see a faded player.
    - They don't see an invisible player either, unless that player struck them, or the monster sees invisible (`vbSeesInvisible`, off for every monster so far).
    - They don't pick such a target, and they drop one that fades or turns invisible.
    - Attacking doesn't break Invisibility. Players still need Detect Invisible.
- **D23. Silence is enabled again at Qor level 6.** Nobody but the caster can cast or speak in the room, monster, NPC or player. Its dead tie to the Jala room enchantments is gone. The Qor priestess and the Heretic teach it.
- **D24. Smaller fixes:**
    - Mark of Dishonor on a player now matches the monster version: no healing at all, regeneration included, and a tenth more damage.
    - Final Rites does 12-20 plus up to 16 to each undead.
    - Holy Blaze's heal scales with spellpower.
    - Defile takes any corpse; a creature's gives half the mana of a player's.
- **D41. Qor's Blade replaces Blood Inheritance** (decided 2026-10-26), as Qor's answer to Spiritual Sword. Blood Inheritance needed a prism on the ground and several casters, which a mostly single-player game can't gather. Spell 146 keeps its class, `BloodInheritance`, for saved worlds.
    - Cast alone and at once, for 15 mana, 20 shaman blood and 30 orc teeth, it summons Qor's blade (`QorsBlade`): the Spiritual Sword's stats and art, its blade turned blood red (`PT_GRAY_TO_RED`), with a crimson ring.
    - The blade deals unholy damage. One blow in seven drinks 6-12 blood and heals the wielder by as much, though not from the undead. It adds 15 to Qor spells.
    - Only someone who knows a Qor spell of level 6 and no Shal'ille spell can wield it.
    - Both blades are bound to their summoner: they can't be dropped, given, sold or stored, and stay through death. Casting again replaces the old one.

### Kraanan and Riija (phase 6)

- **D25. Martyr's Battleground blesses the caster's side of a fight.**
    - **Who counts:** the caster's allies in the room, through `Spell.IsCasterAlly`. That means the caster, anyone they may not attack, their companions and minions (and their allies' companions and minions), and soldiers of the caster's faction.
    - **Players:** +50 plus spellpower to hit, and 1-4 damage a blow.
    - **Monster allies:** 10-29% more offense and the same damage bonus.
    - **On a death:** every death in the room heals allies 2-6, and twice that when the dead was an ally. It lasts 32-228 seconds.
    - **Foes** get nothing. Killing Fields stays the everyone-hits-harder version.
    - **The Marion crypt** casts it itself, and there every player counts.
    - **New room hooks:** `Room.SomethingKilled` tells enchantments of a death (`Spell.RoomSomethingKilled`); an arriving monster gets `Spell.StartEnchantmentNewMonster`; `UnenchantAllOccupants` takes `#monsters`.
    - **Level:** Kraanan level 6 (it was 3), with the level grids.
- **D36. Bewildered, Riija's group role.** Vertigo, Dement, Forget, Illusionary Wounds and Flash leave their target bewildered for 15 seconds: it takes 10% more damage from everyone, monster or player. It's an internal effect nobody learns (`Bewildered`, `SID_BEWILDERED` 207), and it doesn't stack.
- **D37. Illusions that bite:**
    - Monsters believe Illusionary Wounds and Illusionary Fire Wall, so their wounds don't heal back. The wounds still never kill on their own. Players still heal theirs back.
    - Fire Wall works at any spellpower.
    - Flash spares the caster and their allies, and holds monsters 1-3 seconds.
    - Vertigo lasts 10-30 seconds and cuts 15-24% of a monster's offense and defense, so it also works on monsters whose offense is set outright, such as garrison monsters.
- **D38. Summons that last:**
    - Reflection gets 25-75% of its caster's health (it had 15-40).
    - Evil Twin gets 25-50% of the original's health (it had about 20).
    - Apparition's monster gets a quarter of its health instead of a tenth.
- **D39. Feign Death and Transmogrify:**
    - Monsters lose sight of a feigning player, as with Fade, and Feign Death no longer throws gear on the ground.
    - Transmogrify's new monster keeps the old one's share of wounds and drops no loot (`Monster.TransmogrifiedFrom`, `pbTransmogrified`), so it can't farm stronger loot from weak monsters.
- **D40. Riija's second spellpower source is staying in disguise** (decided 2026-10-24; it was how full your pack is). While a Riija disguise is on the caster (Anonymity, Illusionary Form, Morph or Shadow Form), Riija spells gain a tenth of that disguise's spellpower, up to 10. The strongest disguise counts (`Spell.IsRiijaGuise`, `Player.GetRiijaGuisePower`). The breakdown line reads "Your Riija disguise".
- **D26. Riija leads with scouting:** Foresight is level 1, so new players can read a monster before fighting it; Shadow Form and Feign Death move to level 2. Built with the level grids (below).

### Descriptions, balance and teachers (phase 7)

- **D27. Every description was checked against the code.** 44 files were corrected, text only.
    - **Stale references removed:** karma and guardian-angel rewards on the heals, Shal'ille "punishing" in Anonymity, Morph's "attacked freely even in towns", and Phase's item loss.
    - **Rewritten to say what the spell does:** Bond, Truce, Umbrella, Nodeburst, Death Rift, Death Link, Mana Bomb, Holy Symbol, Create Weapon, Morph and Phase.
    - **Also fixed:** wrong intro levels, typos and reagent wording.
- **D28. A damage table.** Damage and mana were read from the running server for every attack spell. Within each delivery type (touch blasts, bolts, area spells), damage rises with level. The one outlier was Fire Storm: it dealt less per cast than Earthquake for nearly three times the mana. It is now 16-30 for 22 mana (it was 12-28 for 30). Damage songs and room spells are support and area damage, and weren't held to the bolt band.
- **D29. Teachers:**
    - The Faren priestess teaches Shatter (nobody did), the Qor priestess Silence, and the Kraanan priestess Martyr's Battleground. The Heretic still teaches the last two.
    - Nobody teaches a disabled, internal or curse spell.
    - **Priestess Themala teaches every Jala song** (decided 2026-10-24; she taught nothing). She keeps the other teachers' gates: Truth, Mirth and Melancholy need the Pupil of Truth quest, and Invigorate needs another Jala song first.
    - **Fixed:**
      - The Raza elder's "level N" reply, which never answered.
      - Stale spell numbers in a teacher's list that could break any teacher's level reply or learn advice.
      - Chill, Burn and Bewildered becoming learnable on a no-murder server.
- **D30. A playtest checklist** for each school, plus a faction-war run, is on the design page.

### The level grids (decided 2026-10-24)

A player's first spell at a level needs their three best abilities one level below, in that school, to add up past `PlayerCanLearn`'s threshold: about 7 × learn points + 185 − 2.8 × intellect, where learn points are 1, 2, 4, 6, 8 or 10 for the highest level reached in each school and in weapons. A one-school character can climb on two spells; a character in two or three schools can't. So **every level from 1 to 5 keeps at least three learnable spells.** The drafts were taken as drawn, except Jala: its draft moved Spellbane to 6 and left level 5 with two spells, so Crystalize Mana comes down to 5 instead.

| School | Moves | Learnable spells per level |
|---|---|---|
| Faren | Fireball 4→3, Ice Shard 4→3, Lightning Bolt 5→3, Shocking Fury 3→4, Heat 3→4, Freezing 3→4, Winds 3→4, Fire Wall 4→5, Ice Wall 4→5, Brittle 4→5, Ice Nova 5→6, Ring of Flames 5→6 | 5 · 5 · 6 · 6 · 6 · 5 |
| Shal'ille | Restore Companion 4→3, Truce 4→5, Mark of Dishonor 4→5 | 4 · 5 · 6 · 5 · 6 · 4 |
| Qor | Blood Inheritance 5→6 (Silence 3→6 in phase 5) | 4 · 4 · 5 · 5 · 5 · 4 |
| Kraanan | Deflect 4→5, Mana Bomb 4→6, Martyr's Battleground 3→6 (Mana Shield from Faren 5 in phase 3) | 4 · 5 · 4 · 4 · 6 · 3 |
| Riija | Foresight 2→1, Shadow Form 1→2, Feign Death 1→2 | 3 · 5 · 4 · 3 · 4 · 2 |
| Jala | Crystalize Mana 6→5, Spellbane 5→6 | 3 · 3 · 4 · 3 · 3 · 1 |

- A spell's level also sets its training-point cost, its improve chance (10 points harder per level), a scroll's value and the Riija sword's charges. The two intros that named a level were changed (Winds, Deflect).
- Faren attunement's "may learn level 4 Faren" test now asks about Blast of Fire, since Fireball is level 3.
- The other NPC gates that read levels still hold: Swap wants a Riija spell above 3, Spiritual Hammer a Kraanan spell above 2, Alzahakar's Shadow Form any spell of level 5 or more.
- Riija's and Jala's level 6 stay thin (Seduce and Elusion; Spellbane alone). Nothing sits above them, so they block no one.

### Phase 0: bugs and curses

- **Agility Boon** is spell 204, so it exists. Its quest rewards had been giving Spiritual Sword.
- **The guide quest** asks you to spend training points instead of using Meditate.
- **Unholy Touch** against undead does half damage. It was roughly zero, from `2/iDamage`.
- **Exertion** applies to Enfeeble, Gaze of the Basilisk, Spellbane, Warp Time and poison. A misspelt property had left them at 1.
- **Distill:** its check runs, its comparison goes the right way, and its expiry no longer overflows.
- **Winds'** duration scales with spellpower.
- **Fire Storm and Ice Nova** refuse during Jig instead of wasting the cast.
- **Illusionary Form and Morph** stop showing the attack pose for every animation.
- **The newbie heal bonus** was later removed altogether (decided 2026-10-24).
- **Curses:** Curse Weapon is gone from Maleval's quest text, and the dead cursed-item code is gone (`IsCursed`, `ItemIsCursed`, `RemoveCurseAllItems`, `IA_CURSED`, the forced re-equip).

## Consequences

- **Spells read the same way everywhere.** Every school has a second spellpower source a player can act on: light, darkness, company and health, vigor, an instrument, a disguise. The description names it.
- **Every school matters against monsters.** Most fights are PvE since ADR 0021, and the spells aimed at players, the room spells, the songs and the illusions all work on monsters now.
- **Each school has a group role:**
  - Faren attunement, for damage.
  - Jala's foe songs, for area damage and debuffs.
  - Riija's Bewildered, for a damage boost on one target.
  - Martyr's Battleground and Forces of Light, for buffing allies.
  - Holy Blaze, for healing while fighting.
- **PvP has school rivalry:** Shal'ille against Qor.
- **Karma is gone from player spells,** except Séance's and Martyr's Grace's small karma terms, which now always add 0. Good players lost their old bonus there.
- **Saved worlds keep old values.** Spell properties (damage ranges, `pbEnabled`, `pbAccessible`) and teachers' `plFor_sale` are saved, and `reload system` doesn't rebuild them. A fresh world picks everything up. A running world needs, once:
  - `send object 0 CreateAllSpellsIfNew` (Chill, Burn, Bewildered).
  - `EnableSpell` on Silence and Shatter.
  - `SetDamageRange iMin int 16 iMax int 30` on Fire Storm.
  - `SetForSale` on the Faren, Qor and Kraanan priestesses.
- **The grids assume a fresh world,** which version 1 launches on. On a running world a character keeps a spell that moved up, and knowing a spell one level up lets them buy anything below it in that school.

## Left to settle

- **The Silence drain:** keep 5-10 mana a second?
- The Duke and the Princess each teach a Jala song, outside their factions' schools (ADR 0021).
- **Not yet tried in play:**
  - Group fights for Martyr's Battleground and Forces of Light.
  - Holy Blaze healing a companion.
  - Reflection, Evil Twin and Apparition in a real fight.
  - Transmogrify cast for real.
  - Shatter on a player.
  - The wall chills and jolts.
  - The songs and room spells against enemy players.
  - The Raza elder's reply seen in the client.
- **Spell visuals** come after this revamp: impact bursts, projectile trails, school hand glows, buff pulses, room moods, parity fixes and about 40 missing sounds (listed on the design page).
