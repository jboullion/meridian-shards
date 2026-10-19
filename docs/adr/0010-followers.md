# ADR 0010: Companions (proposed as Followers)

- **Status:** accepted 2026-10-17 and built the same day for the fighting kinds (the Duke's, the Princess's, the rebels' and Kraanan's) and, in a second round, the casters of Shal'ille, Qor and Faren; Riija's and Jala's are left for later. Built under the name **Companion**, since "follow" already means following a friend (ADR 0005). See "As built" at the end, which overrides the sections above where they differ. Proposed 2026-10-15. A big Kod change, like [ADR 0008](0008-player-homes.md) and [ADR 0009](0009-quests.md), using 0009's channel: hidden spoken `#` commands from our client, `BP_USERCOMMAND` `UC_*` packets back.
  - Changed 2026-10-15 ([ADR 0015](0015-social-on-our-server.md)): our client sends its `#` commands as `UC_SHARDS` lines, the same words without the `#`, instead of speaking them. Nothing is spoken, so there are no lines to hide.

## Context

We want companions, much as in Skyrim:
- **Getting one:** from 50 health (Meridian's "level"), a character can get one from their faction's leader or their school's head, and it suits the leader who gave it.
- **Looks:** the player chooses its face with the character creator's tools. Its stats come from its kind and can't be edited.
- **Strength:** about the owner's level, but weaker, and it grows with them.
- **Death:** it can die, and be revived.
- **Dismissal:** for a while, or for good.
- **Gear:** its own, which the player can't change except for cosmetics and colours.
- **Pack mule:** it carries as much as the player does.

### What Server 104 already has

Paths below are under `kod/` in our `shards-server` fork. `object/active/holder/nomoveon/battler/` is shortened to `battler/`.

**Minions:**
- **The link to a master:** `Monster.SetMaster` / `GetMaster` / `IsMinion` (`battler/monster.kod`), and the master's `plControlledMinions` with `MinionControlCheck` (`battler.kod`).
- **What makes minions:** Animate, Seduce, Reflection, the evil twin and the DragonFly Queen.
- **Fighting:**
  - `Player.CommandMinionAttack` sends minions at the master's target, and at whatever hurts the master.
  - `Brain.GetHatred` never targets the master.
  - `Monster.AllowBattlerAttack` asks the master, so PvP rules and murderer flags fall on the master.
  - `KilledSomething` credits the master.
- **Limits:** 4 per player (`util/settings.kod piPlayerMinionLimit`). Our client draws your minions as a green minimap dot (`MM_MINION_SELF`).

**Following from room to room:**
- `Monster.SomethingLeft` posts `GotoMaster`, which moves the minion with `NewHold`, so a room can't refuse it.
- **A bug:** its distance test has no `abs()`, so any minion north or west of its master counts as close.
- The evil twin uses `UtilGoNearSquare` (`util.kod`) instead, which rooms can refuse.

**Logging off:**
- `Player.UserLogoffHook` calls `RemoveAllMinions`, which frees or deletes them.
- **The evil twin survives it:** it goes to limbo (`EnterStateLimbo`, `NewOwner $`), and logging on places it again (`monster/eviltwin.kod PlaceEvilTwin`).

**Monsters that look like players:**
- `battler/monster/human.kod` (`Human is Monster`) has a player's face parts and colour translations, its own `SendOverlays`, and the hooks that worn items call (`DoPlayerArt`, `AddEquipmentObject`).
- Faction troops (`human/troop.kod`) are made from it, in their faction's colours.
- `object/active/logghost.kod SetLogoffGhost` copies a player's look into fields of its own.
- **Our client** draws these exactly like players, portrait and all (`icons.ts MIN_PLAYER_OVERLAYS`).

**Holding items:**
- **Monsters can carry anything.** Every monster is a `Holder`, with no limit unless `GetBulkMax` / `GetWeightMax` say otherwise. A player's limit is 1700 plus 20 per point of Might (`player.kod`).
- **Death drops it:** `Monster.CreateTreasure` drops everything a monster held.
- **The vault messages** let any monster answer our Withdraw and Deposit windows: `MobIsVaultman`, `GetForSale`, `VaultDeposit`, `VaultWithdraw` (`monster.kod`), `UserWithdrawal` and `UserDeposit` (`user.kod`).
- **Containers refuse monsters** (`UserObjectContents`).

**Death and healing:**
- **Nothing revives anything.** Portal of Life only eases a dead player's penalty.
- **Healing:** `spell/heal.kod` heals players only.
- **Corpses:** a monster's (`DeadBody`) lasts 2 minutes.

**Stats per monster:**
- Settable per instance: `SetMaxHitPoints`, `piOffense`, `piDefense`, `piMinDamage`, `piMaxDamage`, `piArmor`, and `viLevel` / `viDifficulty`, which troops redeclare as properties.
- **Level is health:** `Player.GetLevel` returns `GetBaseMaxHealth`, and `GainBaseMaxHealth` already calls `GameQuestMaintenance.EvaluatePlayer` on each gain.

**Cleaning up:**
- `Monster.DestroyDisposable` keeps anything with a master or with `pbDontDispose`.
- **Spawn caps:** monster rooms count every monster, minions too, against their caps (`room/monsroom.kod piMonster_count`).

**The leaders:**
- **Factions** (`battler/monster/factions/`):
  - `DukeLiege`, Duke Akardius (RID 952);
  - `PrincessLiege`, Princess Kateriina (RID 852);
  - `RebelLiege`, Jonas D'Accor (the Jasper bar, RID 371).
  
  Membership is `piFaction` (`Player.JoinFaction`). The hp50 guide chain already sends players to all three.
- **School heads** (`battler/monster/temples/`):
  - `ShalillePriestess` Xiana
  - `QorPriestess` Zuxana
  - `KraananPriestess` Qerti'nya
  - `FarenPriestess` Tenuv'vyal
  - `RiijaMonk`
  - `JalaPriestess` Themala
  
  Weaponcraft has no head.

**Faces:**
- A player's face is stored as `prHead`, `prEyes`, `prMouth`, `prNose`, `prToupee`, `piBody_translations` and `piBody_translations2`.
- At creation, `Player.PlayerNewCharInfo` checks each part against `system.kod SendCharInfo`'s lists (`RestrictToResourceList`).
- Nothing changes a face later.

### What our client has

- **The character creator** (`CharacterCreator.tsx`):
  - Its Appearance page is state inside the component, and `done()` sends `BP_NEW_CHARINFO`.
  - The parts come from `BP_SEND_CHARINFO`; whether the server answers that in game is still to check.
  - The preview is a face only.
- **Ambient figures:** `townsfolk.ts` builds whole figures from an `Appearance` (`lookFor`, `twoColorXlat`).
- **Windows to reuse:** `TradeDialog` (Withdraw) and `GiveDialog` (Deposit) in `ui/Dialogs.tsx`.
- **Friends' health bars over heads:** `gameScene.ts drawLabels`.
- **Targeting** (`[`, `]`, click to attack) takes anything attackable, with no "not mine" rule.
- **A word in use:** "follow" and "followers" already mean following a friend (ADR 0005, "Refuse followers").

## Decisions

The user decided these on 2026-10-15:
- **only our client and our server have to work**; original clients aren't supported, so nothing here offers them a way in or is checked against them;
- **stronger together**: a follower scales with its owner's health, and a bond grows the longer they travel together;
- **it fights in PvP too**, and can be killed wherever its owner could be attacked;
- **it leaves with its owner** at logoff, pack and all, and comes back with them;
- **revival**: by a new Shal'ille spell on its corpse, or else by its leader, at their hall, after a wait or for a fee;
- **its pack is never lost**: nothing it carries drops when it dies;
- **dismissed for a while**, it goes home to its leader's hall and waits; dismissed for good, the slot is free;
- **one at a time**: a faction leader gives one only to that faction's members, and a school head only to players with real standing in the school.

### 1. What a follower is

1. **A new Kod class, `Follower is Human`,** one per character, kept on `User` as `poFollower`.
   - It is active, waiting (at its leader's hall), or fallen.
   - It is never disposed (`pbDontDispose`) and isn't counted in `piMonster_count`.
   - It doesn't count against the minion limit.
2. **Its kind comes from its leader:** a table in Kod (`util/followerkinds.kod`), one entry per leader. An entry gives:
   - the art and gear for each bond tier (3.2);
   - how it fights;
   - the colours it may be given (8);
   - a list of names.
3. **The kinds proposed:**

   | Leader | Kind |
   |---|---|
   | Duke Akardius | a Duke soldier, sword and shield |
   | Princess Kateriina | a Princess knight |
   | Jonas D'Accor | a rebel fencer or archer |
   | Xiana (Shal'ille) | a healer, who heals the owner |
   | Zuxana (Qor) | a dark caster |
   | Qerti'nya (Kraanan) | a warrior-priest |
   | Tenuv'vyal (Faren) | an elemental mage |
   | Monk of Riija | an illusionist |
   | Themala (Jala) | a bard |

   **Fighters come first.** The casters need monsters that cast spells. *To check*: what Kod's monster spellcasting can do.
4. **Its name** is picked from its kind's list. Looking at it says whose it is.

### 2. Getting one

1. **Where:** at 50 base health or more, say "follower" (or `#follower ask`) near:
   - **a faction leader**, as a member of that faction (`piFaction`);
   - **a school head**, with real standing in that school, for example knowing its level-3 spells. The exact rule is settled when it's built.
2. **One at a time.** A player who has one is told to dismiss it for good first (6.3).
3. **Pointing the way:** `GameQuestMaintenance` gains a hint at 50 health, which becomes a guide quest under ADR 0009.

### 3. How strong it is, and the bond

1. **It scales with its owner:**
   - its health is about 70% of the owner's base maximum health;
   - its `viLevel` follows the owner's health, and its damage and defence come from `viLevel` and its kind.
   
   It's worked out again whenever the owner gains health, and whenever the follower is placed.
2. **The bond** grows with time together (logged-on time while it's active) and with kills shared.
   - It has 5 tiers. Each adds a little health and damage (up to about +15% in all) and unlocks the next tier of gear, which shows.
   - It's kept on `User`, so a revived follower keeps it. Dismissing for good loses it.
3. **No editing stats.** They come only from the kind, the bond tier and the owner's health.

### 4. Following and fighting

1. **From room to room:**
   - `Follower.SomethingLeft` always follows its owner, whatever the distance. The `abs()` bug is fixed in `Monster` too.
   - It goes through `UtilGoNearSquare`, so a room can refuse it. A refused follower waits by the door and rejoins its owner when they come back.
   - *To check*: which rooms refuse it: survival rooms, homes (ADR 0008).
2. **Fighting reuses the minions':** `SetMaster`, `CommandMinionAttack`, `GetHatred`, and `AllowBattlerAttack` through the master.
   - It fights players wherever PvP is allowed. Players can attack it wherever they could attack its owner.
   - Murderer and outlaw flags fall on the owner, as for minions now.
   - Its kills credit its owner (`KilledSomething`).
3. **Stances:**
   - `#follower follow`;
   - `#follower stay`;
   - `#follower defend`: it fights only what attacks its owner or itself;
   - `#follower passive`.
4. **Healing:**
   - `heal.kod` and the other healing spells take the caster's own follower, and their group's.
   - Out of a fight, it gets health back like any monster (`GainHealthNormal`).

### 5. Death and revival

1. **When it dies:**
   - it leaves a `FollowerCorpse`, a `DeadBody` that lasts 10 minutes;
   - the follower goes to limbo (`EnterStateLimbo`, `NewOwner $`) with its pack and gear;
   - its `CreateTreasure` drops nothing, in PvP too;
   - its owner is told.
2. **A new Shal'ille spell**, "Restore Companion" or similar, cast on the corpse, brings it back there with half its health.
   - Anyone may cast it on anyone's fallen follower.
   - It needs a spell number, an icon (a `.bgf`, a rebuilt `rsc0000.rsb`, a server deploy) and a place in Shal'ille's list.
3. **Otherwise, its leader:** once the corpse has gone, the follower is "recovering" at its leader's hall. Its owner collects it there after about an hour of real time, or at once for a fee that grows with health. The numbers are settled when it's built.

### 6. Logging off, and dismissing it

1. **Logging off:** an active follower goes to limbo with its owner (the evil twin's way), and is placed beside them when they log on. `RemoveAllMinions` leaves it alone.
2. **Dismissed for a while** (`#follower dismiss`):
   - it goes to its leader's room and waits there, keeping its pack;
   - nobody can attack it while it waits;
   - its owner fetches it with `#follower come` near it or near the leader.
3. **Dismissed for good** (`#follower dismiss forever`, said again within 30 s to confirm):
   - only with its pack empty, so nothing is ever lost;
   - its bond is lost, and the slot is free.
4. **A deleted character's** follower goes with them.

### 7. The pack mule

1. **It carries what its owner can:** its `GetBulkMax` and `GetWeightMax` return the owner's.
2. **The pack is apart from its gear.**
   - Its own equipment (`plUsing`) is never offered or taken.
   - It never uses what's in the pack.
3. **Giving and taking use the vault windows**, with no new messages:
   - `MobIsVaultman` and `GetForSale` answer its owner only, with no fee;
   - Deposit puts items in the pack, and Withdraw lists the pack;
   - the Follower tab opens them (Give and Take), and so does double-clicking the follower.
   
   *To check*: that the per-viewer object flags can offer this to the owner only. If the vault messages prove awkward, the fallback is a `UC_FOLLOWER_PACK` list with `#follower give` and `#follower take`.
4. **The pack survives everything:** death, logging off, and waiting at the hall.

### 8. Its looks

1. **Kept on the follower:**
   - gender, head, hair, eyes, nose and mouth;
   - the hair and skin colours;
   - two cosmetic colours (shirt and trousers, or its armour's dye), from its kind's palette.
2. **Set with `#follower look <gender> <head> <hair> <eyes> <nose> <mouth> <hair colour> <skin colour> <colour 1> <colour 2>`,** at any time. Kod checks each part against the lists `PlayerNewCharInfo` uses (`RestrictToResourceList`, `SendCharInfo`'s parts), and the colours against the kind's palette.
3. **Its first look** is random for its kind (`Human`'s `SetFace` and `SetHair`).

### 9. Our client

1. **`UC_FOLLOWER_STATUS`**, sent at logon and on every change:
   - its state;
   - its health and maximum;
   - its bond and tier;
   - where it is (the room);
   - its stance.
2. **A Follower tab** beside Friends and Pets (`Sidebar.tsx TABS`, `CharacterWindow`):
   - its portrait, name, kind, health bar, bond bar and state;
   - the stances, Give, Take, Appearance…, Dismiss and Dismiss forever;
   - where it waits or recovers.
3. **Appearance… reuses the character creator.**
   - Its Appearance page becomes its own `AppearanceEditor` component, with the parts in and the choices out.
   - It gains the colour rows and a whole-figure preview (`townsfolk.ts lookFor`).
   - It sends `#follower look`.
   - The parts come from `BP_SEND_CHARINFO` in game. *To check*; if the server won't answer, from a parts list the asset build makes.
4. **In the world:**
   - its health bar over its head, as friends' are drawn (`drawLabels`);
   - its green minimap dot, which it already gets as a minion;
   - target cycling and click-to-attack skip our own follower;
   - typed `deposit` and `withdraw` prefer a banker to it.
5. ~~**Hidden lines:** the `#follower` commands and their answers are hidden through `lineFilter` (the chain from ADR 0009).~~ Not needed with `UC_SHARDS` (ADR 0015).

### 10. The order to build it

1. `Follower` with one fighting kind (the Duke's soldier): getting it from the Duke, following, fighting, logging off and on. All with typed commands.
2. Scaling, the bond and its gear tiers.
3. Death, the corpse and the leader's fallback; then the new spell and its art.
4. The pack (the vault messages), and both kinds of dismissal.
5. Looks, and `#follower look`.
6. Our client: `UC_FOLLOWER_STATUS`, the Follower tab, `AppearanceEditor`, and the touches in the world.
7. The other factions' kinds, then the schools' (the casters once monster spellcasting is checked).
8. The website's wiki page, once it's built.

### 11. Left to settle when it's built

- Each kind's way of fighting, gear tiers and palette (1.2).
- The rule for standing in a school (2.1).
- The bond's numbers (3.2).
- The leader's wait and fee (5.3).
- Whether players may name followers freely (1.4).
- Which rooms refuse followers (4.1).
- The word: "follower" against ADR 0005's friend-follow ("Refuse followers"), and whether that wording changes.

## Consequences

- **One more monster per player online:** more server work, and bigger saves (the packs).
- **More power in PvP**, accepted. The 70% scaling is what keeps it in hand.
- **The first new spell:** new art in `rsc0000.rsb`, and a server deploy.
- **Saves change** (new `User` properties), so `reload system` and a restart are tried on a copy first (0008 3.3).
- **The commands are a protocol:** `#follower` and `UC_FOLLOWER_STATUS` change in our client and our Kod together.
- **Docs to update** as each part lands:
  - `AGENTS.md` and `docs/missing-features.md`
  - `docs/admin-console.md` (granting, reviving and removing a follower)
  - `docs/research/protocol.md` (`UC_FOLLOWER_*`)
  - the website's wiki

## As built (2026-10-17)

**Decided with the user on 2026-10-17:**
- **Scope:** everything above, with the fighting kinds only: the Duke's soldier, the Princess's knight, the rebels' fencer and Kraanan's warrior-priest. The casters (Shal'ille, Qor, Faren, Riija, Jala) come later: monsters can't heal or buff allies today.
- **The name:** Companion everywhere (Kod, commands, packets, the tab). The file keeps its name, as code comments point at it.
- **A school's standing (2.1):** the disciple quest done: QuestBook 82 for Kraanan, or the old `QST_ID_KRAANAN_DISCIPLE` (`HasDoneReplacing`).
- **A refused room (4.1):** the companion steps out to limbo, its owner is told it was left behind, and it rejoins them in the next room that will have it (not "waits by the door").
- **Aggro:** aggressive monsters attack companions as they attack players (`Brain.GetHatred`).
- **Leaving a faction:** the companion keeps serving; the faction only matters when asking.

**Kod** (shards-server):
- `util/companionkinds.kod` (`CompanionKinds`): per kind its leader, hall, faction, names, damage, five gear tiers, faction shield and palette; the bond tiers and their bonuses. `util/companionbook.kod` (`CompanionBook is CompanionKinds`, `SYS@GetCompanionBook`): the commands, asking, placing, scaling, the bond, death, dismissal, looks, the client packets and the admin messages. It keeps no state of its own.
- `battler/monster/human/companion.kod` (`Companion is Human`): its owner (`poSworn`), kind, state, stance, ready time, name, colours, gear tier. `GetObjectFlags` per viewer: never attackable by its owner, who gets `OF_BUYABLE | OF_OFFERABLE` (the vault windows). It answers `GetFaction` with its kind's faction, so it can wear that faction's soldier shield. `Killed` is a full override (no treasure, no quest credit); `CanPlayerAdvanceOnMe` is FALSE (no XP from killing one).
- `object/passive/body/compcorp.kod` (`CompanionCorpse`, 10 minutes) and `spell/restcomp.kod` (`RestoreCompanion`, SID 203, Shal'ille level 4, 2 emeralds and 2 elderberries, sold by Shal'ille's priestess; the Raise Dead icon for now).
- **States:** active (with its owner, or in limbo while they're away or it was left behind), waiting (dismissed, at its hall), fallen (in limbo while its corpse lasts), recovering (at its hall). **Stances:** follow, defend (only `CommandMinionAttack(#defend=TRUE)`, from `Player.AssessDamage`), stay, passive.
- **Numbers** (blakston.khd `COMPANION_*`): health 70% of its owner's base health, fighting 85%, each raised by the bond tier's 0/3/7/11/15%; bond 1 a minute together and 3 a shared kill of a monster at least 2/3 its owner's level (at most 120 kill points an hour), tiers at 0/300/1000/2500/5000; the corpse 10 minutes, then an hour at its hall or 25 shillings per point of its owner's health; 50 health to ask.
- **Hooks:** `User` (properties, logon, logoff, `NewOwner`, `KilledSomething`, `Delete`, the `companion` verb), `Player` (`GainBaseMaxHealth`, `CommandMinionAttack`), `Battler` (minion count and `RemoveAllMinions` skip companions), `Monster` (`SomethingLeft`'s `abs()`, defaults), `Human` (`prBeard`), monster rooms' counts, `Room.AllowsCompanion` (not arenas, the Underworld or survival rooms), `Brain.GetHatred`, heal (the caster's or their group's companion), animate (refuses its corpse).
- **Guide quests:** a `companion` step kind (`QK_COMPANION` 14, done while the player has one) and four quests, ids 240-243 (`companion-duke`, `-princess`, `-rebel`, `-kraanan`), band 50, from each leader to their faction's members and from Kraanan's priestess to her disciples.

**The commands and the packet:** `companion status | ask | follow | defend | stay | passive | dismiss | dismiss forever [confirm] | come | pay | look <10 positions>` over `UC_SHARDS`; `UC_COMPANION` (109) back, a status or a health update ([protocol.md](../research/protocol.md), "Ours"). Looks travel as places in `BP_CHARINFO`'s lists, not resource ids: Kod can't turn a number into a resource.

**Our client:**
- `packages/world/src/companion.ts` (tested): `readCompanion`, `buildLookCommand`. `game/companion.ts` (`CompanionStore`): the status from logon, and the creator's lists once asked for in game.
- `ui/CompanionPanel.tsx`: the Companion tab beside Pets (key C, settings version 14 unless C was taken): portrait, name, kind, health and bond bars, where it is, stances, Give and Take (the Deposit and Withdraw windows), Appearance…, Dismiss, Fetch or Call back, Pay, Dismiss forever with a confirm; Ask when there's none.
- `ui/AppearanceEditor.tsx`: the character creator's Appearance page as a component, used by the creator and by `ui/CompanionLooksDialog.tsx`, which adds the shirt and legs colours from its kind's palette. The preview is the face, not the whole figure.
- In the world: its health bar under its name; our own companion is never targeted (the server's per-viewer flags); typed `deposit` and `withdraw` prefer a banker or trader to it.

**The admin dashboard's Companions tab** (`apps/client/src/admin/CompanionsTab.tsx`, `tools/dev/companionApi.ts`): give yourself one of any kind, set the bond or jump to a tier, bring it here, kill, revive, recover now, remove. **Test script:** `tools/headless/companion.ts`.

**Tried on our server:** getting one (by Ask's checks and by the dashboard), following through exits and teleports, logoff and logon, death, the corpse and Restore Companion, recovering at the hall, both dismissals, every kind's gear at every tier (shields included), the pack's Give and Take, the looks by command and from the dialog, the tab, the C key, the guide quest's step. **Not yet tried:** its health bar over its head in the browser, PvP with a second player, Ask's faction and disciple refusals with a 50-health character.

**Still to do:** Riija's and Jala's companions, the website's wiki page, Restore Companion's own icon, a whole-figure preview in the looks dialog.

### The casters (2026-10-17, second round)

**Decided with the user:** Shal'ille's healer, Qor's dark caster and Faren's mage; no Riija or Jala companions for now. Damage spells only (no Hold, Blind or spells that hit an area), so companions can't lock players down in PvP. The healer heals its owner first, then itself, then the owner's groupmates in the room. Each school's head asks for its disciple quest (79 Shal'ille, 80 Qor, 81 Faren, 82 Kraanan) or the old one it replaced; karma was suggested as a further rule, but Server 104 removed karma in 2023 (`Player.GetKarma` is always 0).

**Kod:**
- `companionkinds.kod`: kinds 5-7 (`COMPANION_SHALILLE`, `_QOR`, `_FAREN`) with their priestesses, halls (Shal'ille's temple, Qor's temple, the badlands where Faren's priestess stands), names and palettes; `GetSchool`, `IsCaster`, `GetDiscipleQuest` / `GetOldDisciple` (so `Ask`'s school rule is general); `GetSpellBook` per tier (Qor: Poison, Vampiric Drain, Splash of Acid; Faren: Shocking Fury, Fireball, Ice Shard, Lightning Bolt, Blast of Fire; Shal'ille: Holy Blaze from tier 3), `GetHeals` (Minor Heal, and Major Heal from tier 3), `GetCasterNumbers` (chance to cast, spell power 40 + 12 a tier, mana 40 + half its owner's health). Gear: a robe in its first colour and an apprentice's wand, then the school's disciple robe, a circlet, a master's wand, and the Qormas helm for Qor at tier 5.
- `companion.kod`: `ApplyCaster` (from `Rescale`), `CastAt` (Monster.MonsterCastSpell's checks: mana, the spell's `CanPayMonsterCosts`, the room's `ReqSpellCast`), at most one cast every 2 seconds. `MonsterCastSpell` casts in reach as well as from afar; `TryAttack` tries a spell before the wand. `SupportTimer` every 2.5 s: heal the owner below 70%, itself below 50%, or the neediest groupmate below 70% (`Room.AreGroupedHere`), the big heal below half. `GainMaxHealth` does nothing (a circlet's trade of health for mana would undo `Rescale`); `GainHealthNormal` returns what it gained and `GainHealth` is its alias, for `heal.kod` and Vampiric Drain.
- `heal.kod`: a companion may heal itself.
- Guide quests 244-246 (`companion-shalille`, `-qor`, `-faren`), from each priestess to her disciples.

**Tried on our server:** every caster's gear, spell book and numbers at every tier; Faren, Qor and Shal'ille attack spells landing on a monster, one every 2 seconds; the healer healing itself and its owner with both heals. **Not yet tried:** healing a groupmate; the Ivy Circlet was dropped from Faren's gear because it asks its wearer for Shal'ille spells.

### The revamp: faction leaders only (2026-10-19)

**Decided with the user, after play testing:** seven kinds were too many, and the faction ones were plain fighters. Only the three faction leaders give companions now, and each fights with a weapon and a school's spells; the schools' four kinds and the disciple-quest rule are gone. Spells come as the owner's base health grows (the first at 50, the second at 70, the third at 90), and spell power and damage grow with it. The bond keeps its 0-15% bonus and now betters the kit within its weapon's family.

| Leader | Kind | Kit (tier 1 → 5) | Spells |
|---|---|---|---|
| The Duke | battle-mage | axe → berserker axe → + thorn circlet → nerudite axe → + Qormas helm; Qor's disciple robe | Acid Touch, Splash of Acid, Blind |
| The Princess | spellsword | hammer → + circlet → maul → + gauntlets → wizard's hat; Faren's disciple robe | Touch of Flame or Icy Fingers, Fireball or Ice Shard, Lightning Bolt |
| Jonas D'Accor | war-priest | scimitar → + simple helm → helm → + gauntlets → daemon helm; Kraanan's disciple robe | Bless, Magic Shield, Armor of Gort, on its owner |

Each wears a herald shield (`GuildShield`) in its faction's colours with its faction's insignia, in place of the soldier shields.

- **Fire or ice:** the Princess's spellsword turns a fire spell into its cold twin when its target resists cold less (`Battler.ResistanceCheck`).
- **Touch spells:** a player's touch spell is an enchantment that works only unarmed, so a companion's is one blow of the spell's kind in reach, 150% of its melee damage, which resistances temper (`Companion.TouchStrike`). Out of reach it picks a ranged spell or uses its weapon.
- **Blind is back** for the Duke's (third spell, a fifth of its casts), which the second round had ruled out for PvP.
- **The war-priest's buffs:** every 30 minutes, with its owner beside it in sight (and not in a safe room unless buffing others is allowed there), it puts on them each buff they lack, lasting 30 minutes, so they stay up. One purged stays gone until the next round. They're the real enchantments (`StartEnchantment` with its spell power), so they show and purge as any other.
- **Old companions:** a school's companion is released when its owner logs on, its pack returned; a faction one puts on the new kit.
- **Numbers** (`blakston.khd`): `COMPANION_KINDS` 3, `COMPANION_SPELL2_HEALTH` 70, `COMPANION_SPELL3_HEALTH` 90, `COMPANION_BUFF_SECONDS` 1800, `COMPANION_BUFF_CHECK_MS` 5000, `COMPANION_TOUCH_PCT` 150. Chance to cast 30% + 2 a tier; spell power two thirds of the owner's base health + 3 a tier (10-99); mana 40 + half its owner's health. Damage 4.5-10% of the owner's health for the casters, 5-11% for the war-priest.
- **Removed:** kinds 4-7 and their names, halls and palettes; `IsCaster`, `GetHeals`, `GetDiscipleQuest`, the healer's `SupportTimer`; guide quests 243-246. Quests 240-242 remain, their offers rewritten.

**Not yet tried:** all of it, in game.

### Round 2: support for all three (2026-10-19)

**Decided with the user:** the Duke's and Princess's companions support their owner too, Jonas's adds Jala's songs (only while calm), and the touch strikes go: in reach they use their weapon. Artifice (Riija's) turned out to be a trading illusion with no combat effect, so the Duke's casts Qor's Unholy Weapon instead.

| Owner health | Duke | Princess | Jonas |
|---|---|---|---|
| 50 | Splash of Acid · Shadow Form | Fireball/Ice Shard · Minor Heal | Bless · Invigorate |
| 70 | Blind · Unholy Weapon | Lightning Bolt · Holy Weapon | Magic Shield · Restorate |
| 90 | Reflection | Umbrella | Armor of Gort · Rejuvenate |

- **One support timer** (`Companion.SupportTimer`, every 2 s, `CompanionKinds.GetSupport`'s `[spell, mana, COMP_SUP_*]`). It gives back 3% of its mana each time (monsters regained none, so round 1's casters ran dry), then, with its owner in its room:
  - **Enchantments** (Bless, Magic Shield, Gort, Shadow Form): every 30 minutes, those they lack, lasting 30 minutes (`BuffOwner`).
  - **Holy or Unholy Weapon:** in that round and whenever they wield a weapon it hasn't looked at (`EnchantWeapon`). It does what `holywp.kod`/`unholywp.kod` do itself, since those want their caster to hold the weapon, and never overwrites another attack spell or Enchant Weapon. Lasts the spell's hours.
  - **Minor Heal:** below 75% health, at most every 10 s, by `CastAt`.
  - **Umbrella** while fighting, **Reflection** (one every 20 s up to the player limit) while fighting; both gone once calm (`SYS.DeletePlayerReflections`).
  - **Songs** while calm (no blow for 10 s and no target), stopped the moment it fights or is fought (`MarkFight`, from `TryAttack`, `AssessDamage` and its owner's attack or defend command), since they soothe everyone in range, foes too.
  - Nothing in a safe room but the heal, unless buffing others is allowed there.
- **Radius spells** (Umbrella, the songs) are the real ones, cast by `CastSpell(#who=companion)`; a monster can hold them (`nomoveon.kod`). `radiusench.kod CanEnchantUser` gained one rule: a companion's reach its owner, and others as if its owner had cast them (Umbrella's guild rule only knew players). They end when it leaves a room, falls, waits, turns passive or is deleted (`StopSupport`).
- **Reflection** is `summrefl.kod`'s own cast, the companion the original; `reflectn.kod` already copies a monster's look and drains it nothing. `Companion.HasSpell` answers FALSE for `Reflection.Constructor`.
- **Mana:** 60 + two thirds of the owner's base health.

**Not yet tried:** all of it, in game. Watch the songs and dome (a companion as a radius source is new) and how reflections of a companion pick their targets.
