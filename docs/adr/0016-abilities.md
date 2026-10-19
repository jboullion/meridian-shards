# ADR 0016: Training and item abilities instead of utility spells

- **Status:** accepted and built, 2026-10-17 (shards-server: `util/shardsabilities.kod`; client: the Train window and the item buttons). Changed 2026-10-18: Send to vault and Send to guild hidden, Appraise for valuable things only, and market listings last 30 days (decisions 2, 7 and 8).

## Context

Play-testing the Stats and Spells tabs showed what the original left there:
- **Seven utility spells that were really actions:** Meditate, Appraise, Conveyance, Transference, Set, Loadout and Vault Loadout. Every new character got them at level 1 and 0 mana, and they filled the Spells tab.
- **Meditate's spoken trance:** you said an ability's name, then a number. It was the only way to spend training points.
- **Stats that meant nothing:** Karma has been hard-wired to 0 since the server dropped it, and Unbound Energy was a second economy (free casts paid for by kills) we didn't want. Weight and Bulk Carried already show in the inventory.

## Decision

1. **Train.** The Stats tab's Training Points row has a Train button (and `train` is a typed command). It opens a window listing the spells and skills you know, with a search, each with its percent and what 1% costs: the ability's own `GetMeditateRatio` (10 × its level), as Meditate charged. You choose how many percent (to 99, as far as your points go). Only abilities you know can be trained; new ones still come from trainers.
2. **Item abilities**, in the description of an item you carry (a right click, in every layout):
   - **Appraise** (a small scales button) sets the price it sells for in the citizen's market, or clears it (the Appraise spell's rules). Since 2026-10-18 only on valuable things: magical (a gem, an enchantment or indestructible scroll, or an item with a magical property), or worth 5,000 shillings or more (its base value). The server says which (`UC_APPRAISAL`), and Veydran won't list anything else.
   - **Send to vault** sends a stack (or a bag's stacks) to your vault for a shilling a unit of bulk (Conveyance), and **Send to guild** to your guild hall's chest (Transference). Since 2026-10-18 they have no buttons, and nothing in the game mentions them: fast travel makes them less needed. They still work on the server (`vault`, `guild`).
3. **Retired:** Meditate, Appraise, Conveyance, Transference, Set, Loadout and Vault Loadout, and the set, loadout and vault loadout scrolls. Meditate's side effect, a silent trance restoring mana, goes with it.
4. **Unbound energy is gone:** no gain from kills, no free casts, no stat. Unbound energy scrolls crumble when used and are taken at logon; Fortuna no longer sells them.
5. **The Stats list:** Training Points first, with Train; Might to Aim; a divider; the rest. Karma, Unbound Energy, Weight and Bulk Carried aren't listed.
6. **Two user commands** (protocol.md, "Ours"): `UC_SHARDS_OBJECT` (111) carries an object with a command line, since `UC_SHARDS`'s line can't name an object; `UC_TRAINING` (112) lists what can be trained and its price.
7. **The guide quest** that asked you to cast Conveyance asked you to send a stack to your vault (a new step kind, `convey`: QuestBook `QK_CONVEY` 15). With the button hidden, the step is a talk with Rolan De'nair instead, keeping the steps' numbers for players partway through; the `convey` kind stays for later.
8. **Market listings last 30 days** (2026-10-18). Unsold, an item goes back to its appraiser's vault with its price cleared, to be appraised and offered again; its appraiser is told then, or at their next logon.

## As built

- **Server** (shards-server):
  - `util/shardsabilities.kod` (`ShardsAbilities`, `SYS@GetShardsAbilities`): `ObjectCommand` (train, appraise, appraise ask, vault, guild), `SendTraining`, `IsAppraisable` (`APPRAISE_MIN_VALUE`, `IsMagical`) and `SendAppraisal` (`UC_APPRAISAL` 113). The logic is the spells', cited.
  - **The market** (`util/playermarket.kod`): `Item.SetMarketListed` stamps a listing as it arrives; `ExpireListings`, each game hour (`SYS NewGameHour`), sends listings 30 days old back to the appraiser's vault (`ReturnToSeller`; a full vault or a missing appraiser leaves it on sale, tried again later) and `TellReturns` tells those who were away at logon. A listing from before the clock starts its 30 days at the first check. `Veydran.GetForSale` reads the market afresh, so the Buy window and purchases never offer an item that has gone. `Monster` (the market's offer check) refuses what isn't appraisable. The market's signs say all this. On a server whose market was never set up (`SYS.GetPlayerMarket` is `# ADR 0016: Training and item abilities instead of utility spells

- **Status:** accepted and built, 2026-10-17 (shards-server: `util/shardsabilities.kod`; client: the Train window and the item buttons). Changed 2026-10-18: Send to vault and Send to guild hidden, Appraise for valuable things only, and market listings last 30 days (decisions 2, 7 and 8).

## Context

Play-testing the Stats and Spells tabs showed what the original left there:
- **Seven utility spells that were really actions:** Meditate, Appraise, Conveyance, Transference, Set, Loadout and Vault Loadout. Every new character got them at level 1 and 0 mana, and they filled the Spells tab.
- **Meditate's spoken trance:** you said an ability's name, then a number. It was the only way to spend training points.
- **Stats that meant nothing:** Karma has been hard-wired to 0 since the server dropped it, and Unbound Energy was a second economy (free casts paid for by kills) we didn't want. Weight and Bulk Carried already show in the inventory.

## Decision

1. **Train.** The Stats tab's Training Points row has a Train button (and `train` is a typed command). It opens a window listing the spells and skills you know, with a search, each with its percent and what 1% costs: the ability's own `GetMeditateRatio` (10 × its level), as Meditate charged. You choose how many percent (to 99, as far as your points go). Only abilities you know can be trained; new ones still come from trainers.
2. **Item abilities**, in the description of an item you carry (a right click, in every layout):
   - **Appraise** (a small scales button) sets the price it sells for in the citizen's market, or clears it (the Appraise spell's rules). Since 2026-10-18 only on valuable things: magical (a gem, an enchantment or indestructible scroll, or an item with a magical property), or worth 5,000 shillings or more (its base value). The server says which (`UC_APPRAISAL`), and Veydran won't list anything else.
   - **Send to vault** sends a stack (or a bag's stacks) to your vault for a shilling a unit of bulk (Conveyance), and **Send to guild** to your guild hall's chest (Transference). Since 2026-10-18 they have no buttons, and nothing in the game mentions them: fast travel makes them less needed. They still work on the server (`vault`, `guild`).
3. **Retired:** Meditate, Appraise, Conveyance, Transference, Set, Loadout and Vault Loadout, and the set, loadout and vault loadout scrolls. Meditate's side effect, a silent trance restoring mana, goes with it.
4. **Unbound energy is gone:** no gain from kills, no free casts, no stat. Unbound energy scrolls crumble when used and are taken at logon; Fortuna no longer sells them.
5. **The Stats list:** Training Points first, with Train; Might to Aim; a divider; the rest. Karma, Unbound Energy, Weight and Bulk Carried aren't listed.
6. **Two user commands** (protocol.md, "Ours"): `UC_SHARDS_OBJECT` (111) carries an object with a command line, since `UC_SHARDS`'s line can't name an object; `UC_TRAINING` (112) lists what can be trained and its price.
7. **The guide quest** that asked you to cast Conveyance asked you to send a stack to your vault (a new step kind, `convey`: QuestBook `QK_CONVEY` 15). With the button hidden, the step is a talk with Rolan De'nair instead, keeping the steps' numbers for players partway through; the `convey` kind stays for later.
8. **Market listings last 30 days** (2026-10-18). Unsold, an item goes back to its appraiser's vault with its price cleared, to be appraised and offered again; its appraiser is told then, or at their next logon.

## As built

- **Server** (shards-server):
 until `RecreateAll`), `send object 0 SetupPlayerMarket` makes it.
  - `user.kod`: `UC_SHARDS_OBJECT` goes to `ShardsObjectCommand`; `train list` is a `UC_SHARDS` verb. `blakserv/sprocket.c` parses the new command.
  - **Retiring the spells:** SYS no longer creates them (`CreateAllSpellsIfNew`), `AddDefaultSpells` gives Blink and Phase only, and `SYS.RetireUtilitySpells` (run by `RecreateAll`, that is `reload system`, or by hand on the maintenance port: `send object 0 RetireUtilitySpells`) takes them from every player and deletes them.
  - **The classes stay** (the seven spells, the scrolls, `UBScroll`): blakserv won't load a save holding an object whose class is gone (`loadgame.c LoadGameObject`), and copies of the scrolls may wait in vaults and shops. A scroll whose spell is gone says it's disabled (`SpellItem.ReqNewApply`). `Player.DropRetiredItems` takes the scrolls from inventories at logon. The spell class files can be deleted once a save holds none of their objects.
  - **Unbound energy:** removed from `player.kod`, `user.kod`, `spell.kod` (the free-cast paths), `settings.kod` and the teleport spells; `UnboundEnergyTimer` stays as a stub for timers in old saves.
  - **The Stats group** (`ToCliStats` group 2) sends 25 stats, without Karma (7) and Unbound Energy (27); `DrawKarma` does nothing.
  - The texts that named the spells (vault signs, the market's sign, the temple, the vault contract, reaching the training point cap) were reworded, and their German and Portuguese copies dropped, so they show in English until translated again.
- **Client:**
  - `game/statRows.ts` (tested): the Stats tab's rows, used by `Sidebar.tsx NumericStats` for Modern, Classic and the phone.
  - `ui/OptionsDialogs.tsx TrainDialog`, opened by `GameView openTrain` (sends `train list`; `UC_TRAINING` through `Game.tsx`'s `training` relay).
  - `ui/LookDialogs.tsx DescriptionDialog abilities` (`DescButton.icon`) and `ui/Dialogs.tsx AppraiseDialog`, `AppraiseIcon`, from `GameView itemAbilities`: looking at an item we carry asks `appraise ask`, and the scales show when `UC_APPRAISAL` says it can be appraised (its price, if any, in the tooltip and the prompt). The server checks every rule and answers in the chat.
  - `packages/world/src/training.ts` (`readTraining`, `trainableAmount`, `trainCommand`, `readAppraisal`); `GameSession.shardsObject`.
  - The fey pets read a missing Karma as 0 (the good fey), as the server's karma always is.

## Consequences

- Training is a window, not a spoken trance, and costs the same.
- New characters start with Blink and Phase only.
- The six quests gated on karma (`questbook.kod`) still can't be offered, as before: karma is always 0. That's for another change.

## Skill practice (2026-10-18)

Weapon skills improved too slowly in the play test, and the reason was the original's gate: a stroke or weapon skill could only improve on a hit after 75 swings (`piWeaponcraftImprovementMinimumSwings`) since the last gain or weapon change, and each hit tried only one of the two (60% the weapon). Doubling the tries (`viImprove_percent`) barely mattered while the gate set the pace. The improvement code also read the skill's ability as a *spell's* (`GetSpellAbility` with the skill's number), so skill % never slowed it down and the soft cap never applied.

**Decision:** practice, for every skill (`skill.kod ImproveAbility`): weapons, strokes, brawling, parry, block, dodge, disarm, Second Wind. Spells keep their own formula (`spell.kod`, `piAdvancementRate`).

- **Every use is one roll** at the skill's starting chance plus 1/20 of it for each use since the skill last improved (`PRACTICE_RAMP`): after 20 uses without a gain the chance has doubled, after 60 it has quadrupled, up to 50% (`PRACTICE_MAX_CHANCE`). A gain sets the count back to 0, but the starting chance is never 0, so two gains in a row can happen.
- **Each skill keeps its own count:** `Player.plSkillPractice`, `[ skill number, half uses ]`, through `GetSkillPractice` and `SetSkillPractice` (kept to 20,000 half uses).
- **A swing practises both** the stroke and the weapon's skill (`Stroke.ImproveStroke`; brawling when unarmed, `Unarmed.ImproveStroke`), hit or miss: a miss (`Player.AssessMiss`, ours) rolls at half the chance and counts as half a use. Parry, block and dodge still get their chance on a kill in which we dodged; other skills on use.
- **The starting chance** (`GetPracticeChance`, in hundredths of a percent): `GetInitialChance` (the skill's `viChance_to_Increase` with Intellect and the faction bonus, as before) × 800/30, times (1 − ability/110)², halved above twice the requisite stat (the soft cap, which now works), times the foe (its level against 10 + ability/2, 0.25 to 1.5; 60 when not a monster), times the learn points' penalty (2.5% each, down to a quarter), times `Settings.piSkillPracticeRate` (percent, 100). Rooms' `ModifyChanceToImprove` still apply, and Second Wind's "no tokens" rule still gives 0.
- **What it plays out to** (an average weapon of 30, stat 50, Intellect 30, monsters about our level): about 8 uses for 1% at 5%, 20 at 50%, 80 at 90%; about 600 uses from 1% to 50% and 2,500 more to 99% (the gate made it at least 7,500). Tried on our server: a mace at 50% against a giant rat starts at 1.67% a swing (Startling's Might of 25 puts its soft cap at 49%) and gained 5% in 250 hits, 8 to 61 hits apart; 30 unarmed swings took punch from 12% to 15% and brawling from 10% to 11%.
- **Gone:** `ImproveOnce`, `GetSecondaryChance`, `viImprove_percent` and the 75-swing gate (`piWeaponcraftImprovementMinimumSwings` and the swing count stay, unused). The unused swing `bonus` is still passed but ignored.
