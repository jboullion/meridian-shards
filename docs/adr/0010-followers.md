# ADR 0010: Followers

- **Status:** proposed, 2026-10-15. Not built. A big Kod change, like [ADR 0008](0008-player-homes.md) and [ADR 0009](0009-quests.md), using 0009's channel: hidden spoken `#` commands from our client, `BP_USERCOMMAND` `UC_*` packets back.

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
5. **Hidden lines:** the `#follower` commands and their answers are hidden through `lineFilter` (the chain from ADR 0009).

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
