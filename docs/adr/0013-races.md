# ADR 0013: Races

- **Status:** proposed, 2026-10-15. Not built. Its body skins need [ADR 0012](0012-cosmetics.md) §1.3 (`ANIMATE_DYE`); its creator work feeds [ADR 0010](0010-followers.md)'s `AppearanceEditor`.

## Context

We want playable races. To keep it simple, every race has the same body; only heads, faces and skins differ.

| Race | Strengths and weaknesses | Looks |
|---|---|---|
| **Elves** | better at magic, worse at melee | pointy ears, sharper eyes, pointier chins and noses |
| **Orcs** | better at melee, worse at magic | orc hairstyles, tusks in the mouth |
| **Islanders** | human; better at archery and aim; 5 to 10% weaker to magic | human |
| **Desert Nomads** | human; 10 to 15% resistance to magic; less mana per mana node | human |

The new elf and orc parts need a pipeline for making faces, like our other art pipelines.

### What Server 104 already has

Paths below are under `kod/` in our `shards-server` fork. `object/active/holder/nomoveon/battler/` is shortened to `battler/`.

**Nothing about race.** The Kod has no race at all.

**Character creation:**
- **The creation message** (`blakserv/sprocket.c`'s `BP_NEW_CHARINFO`) carries:
  - name, description, gender;
  - a list of face parts (resources);
  - the hair and skin translations;
  - lists of stats, spells and skills.
  
  The lists carry their own length, so one more element needs no C change. Kod refuses any other length today (`Length(lFaceparts) <> 5`, `Length(lStats) <> 6`).
- **Checking it** (`util/system.kod ReceiveClient`, then `battler/player.kod PlayerNewCharInfo`):
  - each face part must be on its list in `GetAllowed{Head,Hair,Eye,Nose,Mouth}Icons` (`RestrictToResourceList`);
  - the skin must be one of the four (`PT_BLUE_TO_SKIN1-4`), or it becomes the third;
  - stats are 1 to 50 each, 220 in all.
- **One head per gender:** what the creator is sent (`SendCharInfo`, `AddFaceIconsToPacket`) holds only the first head on the list, so the creator has no choice of head.

**The face art:**

| Part | Male | Female | Bitmaps | Shrink |
|---|---|---|---|---|
| Head | `phax` | `phkx` | 6, one group | 7 |
| Eyes | 4 | 3 | 14, in 4 groups: the expressions, normal, happy, sad and wry | 14 |
| Noses | 3 | 3 | 5 | 14 |
| Mouths | 3 | 3 | 14 (male), 20 (female), in 4 groups | 14 |
| Hair | 7 | 10 | 6 | 10 to 14 |

- **Colours:** faces are all in the dark-blue ramp (`0x90`), which the skin translation colours (eyes have a little grey for the whites); hair is in the grey ramp (`0xd0`).
- **Hotspots:** the head carries eyes 11, mouth 12, hair 13 and nose 14 (its back view only 13).
- **Views:** face parts have 5 views, with no back; heads and hair have 6.
- **Ears are drawn into the head**, with no hotspot of their own, and hair is drawn over the head.

**Skins:**
- **Offered:** only `PT_BLUE_TO_SKIN1-4`.
- **Defined but unused:** `PT_BLUE_TO_GREEN` (5, a sage green), `PT_BLUE_TO_GRAY` (7) and `PT_BLUE_TO_ASHEN` (9, no good: it turns greys red).
- **The body's skin** (the hands, about a sixth of the arm art) comes from the clothes' two-colour translations, `0x87 + 11 × cloth + skin`, over 11 ramps that don't include the sage green.
  - `Player.ConvertskincolortoXLAT` maps the green skin to the first human skin, so a green orc would have pink hands. Grey works.

**Where race bonuses can go,** beside the faction bonuses (`util/parlia.kod`), which are called from each formula:
- `GetFactionSpellPowerBonus`, in `object/passive/spell.kod GetSpellPower`;
- `GetFactionHitrollBonus`, in `Player.GetOffense`;
- `GetFactionDamageBonus`, in `Player.GetDamage`;
- `GetFactionDefenseBonus`.

**The other formulas:**
- **Archery:** bows are `RangedWeapon`s, and archery's stat is Aim.
- **Mana:** each mana node gives `((5 + Mysticism) / 10) + 3` (`GetManaAdjust`, in `object/passive/mananode.kod`, `mananode/feynode.kod`, doubled, and `object/active/portal/corpnode.kod`). `ComputeMaxMana` adds them up afresh each time, so a change applies itself.
- **Resistances:**
  - **How they're kept:** pairs of type and value, spells as negative types; `-ATCK_SPELL_ALL` is resistance to all magic.
  - **Players have no base resistances:** `battler.kod GetBaseResistances` returns none ("players do not").
  - **How they combine:** a check takes the best resistance plus the worst weakness, and values of the same type add up.
  - **The Stats tab** shows magic resistance from the current list, so a base value would show by itself.
- **Pitfalls:**
  - `RecalibratePlayer` clears stat modifiers (`pi*Mod`) and `plResistances` on every update, so racial effects must be computed, never stored there.
  - Some Kod puts the human head back by name: taking off the shrunken-head mask (`object/item/passitem/defmod/helmet/mask/shrnkmsk.kod`), and also `statue.kod`, `logghost.kod`, `ladyphen.kod`, `dm.kod` and `PlayerNewCharInfo`'s fallback for a bad message.
- **Saves:** a new property with a default (`piRace = RACE_HUMAN`) is filled in for every existing character when the save loads.

### What our client has

- **The creator** (`CharacterCreator.tsx`) reads the parts (`packages/protocol/src/messages.ts readCharInfo`, one head per gender) and sends the five parts, the hair translation and the skin (a byte, `buildNewCharInfo`). Its skin slider is labelled Light to Dark.
- **The portrait** (`icons.ts portrait`) draws a player's overlays on hotspots 1 to 20.
- **The ambient townsfolk** (`townsfolk.ts`) list the human skins and parts.
- **The creator is reused** by `AppearanceEditor` (ADR 0010 §9.3) and the barber (ADR 0012 §4).

### What we have for making faces

- **The remaster's tools** (`meridian-unreal/tools/sprites/`):
  - `new_hair.py`: draw the head and face on flat green, ask for the front, then every other view with the approved front as a reference; matte around the face parts; even out the greys.
  - `face_sheet.py`: sheets of creator faces.
- **iconforge** (`shards-server/tools/iconforge/`): `bgf.py`, the providers, caching and the review page.
- **`garmentforge`** (planned, ADR 0012 §5): parts kept in place, colours mapped by shade to the allowed ramps.

## Decisions

The user decided these on 2026-10-15:
- **humans stay** as the default race, with no bonuses; existing characters stay human, and only new characters choose a race;
- **each race has its own skin colours**, and the whole body follows;
- **race never changes** once the character is made;
- **bonuses are percentages**, applied where faction bonuses are; creation stats don't change;
- and, as for every ADR now, **only our client and our server** have to work.

### 1. Race on the character

1. **`piRace` on `Player`:** `RACE_HUMAN` (0, the default), `RACE_ELF`, `RACE_ORC`, `RACE_ISLANDER` or `RACE_NOMAD`.
   - Existing characters load as human, and stay so.
   - Race is set at creation (and when a character is restarted, through `RecycleUser`), and never afterwards, except by an admin.
2. **A race table** (`util/races.kod`, `SYS@GetRaces`). For each race:
   - a name and a description;
   - the heads, eyes, noses, mouths and hair for each gender;
   - the skins it may have;
   - its bonuses (3).
3. **Islanders and nomads use the human parts,** with their own skins. Elves and orcs get new parts (5), and may share some human hair and noses, decided part by part.

### 2. Making a character

1. **What the creator is sent changes** (`BP_CHARINFO`). After the colours, it lists the races, and for each race and gender:
   - its heads, hair, eyes, noses and mouths;
   - its skins;
   - its name and description.
   
   `readCharInfo` changes with it.
2. **The race comes back as a 7th number** at the end of the stats list (`BP_NEW_CHARINFO`). The list carries its own length, so `sprocket.c` doesn't change.
   - `PlayerNewCharInfo` takes 6 or 7 numbers, and checks every part and the skin against that race's lists (`GetAllowed*Icons(gender, race)`).
   - The 220-point rule is unchanged.
3. **The creator's Appearance tab gets a choice of race:**
   - five portraits, each with a line about its strengths and weaknesses;
   - choosing one changes the parts and skins on offer;
   - the skins are named, not a slider from light to dark.
4. **Stats at creation don't change.**

### 3. Racial bonuses

1. **Computed every time,** by one helper, `Player.GetRaceBonus`, called beside each faction bonus; never stored in the stat modifiers. Starting values, to be tuned in play:

| Race | Bonus | Where |
|---|---|---|
| Elf | spellpower +10% | `GetSpellPower`, before it's held to 1-99 |
| Elf | melee damage -10% (not bows) | `GetDamage` |
| Orc | melee damage +10% | `GetDamage` |
| Orc | spellpower -10% | `GetSpellPower` |
| Islander | bow hit roll +10% | `GetOffense`, with a `RangedWeapon` |
| Islander | bow damage +10% | `GetDamage` |
| Islander | magic resistance -8 | `GetBaseResistances` |
| Nomad | magic resistance +12 | `GetBaseResistances` |
| Nomad | mana per node ×0.75 | a helper used by all three `GetManaAdjust`s |
| Human | none | |

2. **Resistances:**
   - `Player.GetBaseResistances` returns the race's magic resistance (`-ATCK_SPELL_ALL`).
   - A nomad's adds to the Resist Magic spell's, up to 100.
   - An islander's weakness always counts, as the worst.
   - The Stats tab shows it with no change to our client.
3. **Mana:** max mana is recomputed for every player at logon once this lands, so nomads' mana is right at once.
4. **The race shows:** the Stats tab gets a Race line, and looking at a player says their race.

### 4. Skins

1. **Each race's skins** (the exact tones settled in the art pass):

   | Race | Skins |
   |---|---|
   | Humans | the four they have now |
   | Islanders | warm browns |
   | Nomads | sun-darkened tans and browns |
   | Elves | pale tones, and a grey "moon" tone (`PT_BLUE_TO_GRAY`) |
   | Orcs | sage green (`PT_BLUE_TO_GREEN`) and a grey-green |

2. **The whole body follows.** The face takes the skin translation. The body's translations use ADR 0012's dye code (`ANIMATE_DYE`), whose skin can be any ramp, the sage green included, so the hands, and the skin around clothes, match. `ConvertskincolortoXLAT` stops turning green into human pink. **This needs ADR 0012 §1.3 built first.**
3. **The skin is still sent as one byte** at creation. Only the list of allowed skins changes.

### 5. New elf and orc faces, and the pipeline

1. **What's needed, for each gender:**
   - **Elves:** a head (narrower, with a pointed chin) with separate ears, 3 sharper eyes (in the 4 expressions) and 2 or 3 narrow noses.
   - **Orcs:** a head (heavy brow and jaw), 3 tusked mouths (in the 4 expressions), 2 broad noses, and 3 or 4 orc hairstyles (a topknot, a crest, braids).
2. **Ears as an overlay of their own:**
   - a new hotspot, `HS_EARS` (15: at most 20, so the portrait shows it), on every view of the head;
   - `SendOverlays` sends the ears after the hair, so long hair doesn't hide them;
   - a helmet that removes the hair (`poHair_remove`) removes the ears too;
   - orc heads may use it as well;
   - our client draws it with no change; it's one more overlay.
3. **`faceforge`,** a mode of ADR 0012's `garmentforge` (`shards-server/tools/`), sharing its code:
   - iconforge's `bgf.py`, providers, caching and review page;
   - `new_hair.py`'s way: the base head and face drawn on flat green, the front first, then every other view with the approved front as a reference, and a matte around the face parts;
   - **every part kept in place:** its base's canvas, offsets and hotspots;
   - **colours mapped by shade to one ramp:** the skin ramp for heads, eyes, noses and mouths; the grey ramp for hair;
   - **tusks** in a ramp no skin translation touches. *To check*, entry by entry; `0xb0` is the likely one;
   - **expressions:** the normal one first, then happy, sad and wry with the normal one as the reference;
   - **new heads:** the tool places hotspots 11 to 15 again, starting from the base's positions, and the review sheet lets them be nudged;
   - **review sheets:** `face_sheet.py`'s creator faces in every race's skins, and all 8 angles.
4. **Installing:** into `resource/graphics/shards/`, with their resources in `system.kod`, then `npm run assets` and a server deploy. They can be tried on the ambient townsfolk first, which load art by file name (`localRes`).
5. **Human heads put back by name are fixed:** the shrunken-head mask and the rest restore the character's own head (a stored `prBaseHead`, or the race's default), never `phax` or `phkx`.

### 6. Our client

1. **The creation messages:** `readCharInfo` reads the new layout, and `buildNewCharInfo` adds the race.
2. **Choosing a race** in the creator (2.3).
   - `AppearanceEditor` (ADR 0010 §9.3) takes the race, so a barber (ADR 0012 §4) offers only that race's hair, and a follower's kind can have a race.
3. **Showing it:** the character window shows the race. The portrait and the turning figure need no change (the ears are on hotspot 15).
4. **A suggestion:** elf and orc townsfolk later, from the races' parts (`townsfolk.ts`).

### 7. NPCs and the world

- **NPCs don't react to race:** no prices, no refusals. If that's ever wanted, the Barloque merchant's change of mood for murderers (`bqmerch.kod`) shows how.
- **Lore:** where each race comes from (islanders from the waters around Ko'catan, nomads from the desert). The wiki writes it once it's built.

### 8. The order to build it

1. `piRace`, the race table, the bonuses and resistances, with races set by an admin, checked against damage and spellpower.
2. The creation messages and the creator's choice of race. Islanders and nomads are complete at this step, since they use human parts.
3. Orc and elf skins on the body, once ADR 0012's dye code exists.
4. `faceforge`, then the orc parts, then the elf heads and ears.
5. The fixes for human heads put back by name, the Stats tab's Race line, and the look text.
6. The website's pages about races.

### 9. Left to settle when it's built

- The exact percentages (3.1).
- Each race's skin tones (4.1).
- Which human parts elves and orcs may share (1.3).
- The tusks' ramp (5.3).
- Whether orc heads use the ear overlay (5.2).
- The races' descriptions in the creator (2.3).

## Consequences

- **Creation changes its protocol** (`BP_CHARINFO`, and the 7th stat). Our client and our Kod change together.
- **New art,** a server deploy, and paid image calls: for each part, its views times its expressions.
- **Skins on the body wait for ADR 0012** §1.3.
- **Balance:** racial bonuses stack with faction bonuses. Accepted, and tuned in play.
- **Saves change** (`piRace`, human by default), so it's tried on a copy first ([ADR 0008](0008-player-homes.md) 3.3).
- **Docs to update** as each part lands:
  - `AGENTS.md` and `docs/missing-features.md`
  - `docs/research/protocol.md` (`BP_CHARINFO`, `BP_NEW_CHARINFO`)
  - the website's wiki
