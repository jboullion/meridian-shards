# ADR 0012: Cosmetics

- **Status:** proposed, 2026-10-15. Not built. It uses [ADR 0009](0009-quests.md)'s channel: hidden spoken `#` commands from our client, `BP_USERCOMMAND` `UC_*` packets back. Its windows build on [ADR 0010](0010-followers.md)'s `AppearanceEditor`.

## Context

We want players to do more with how they look:
- **Recolour items.**
- **Decals** on clothes.
- **A barber** in a couple of towns, for a new haircut or hair colour.
- **A skill or a vendor** for making cosmetics.
- **New clothes,** such as fine dresses and shirts, with an art pipeline that draws each one from every angle the sprites need.

### What Server 104 already has

Paths below are under `kod/` in our `shards-server` fork. `object/active/holder/nomoveon/battler/monster/towns/` is shortened to `towns/`, and `object/item/passitem/` to `passitem/`.

**Colour is one byte per part:**
- An item's colour is its palette translation, `piItem_flags & ITEM_PALETTE_MASK`. `object/item.kod` sends it as `ANIMATE_TRANSLATION` and a byte (`SendAnimation`, `SendLookAnimation`, `SendInventoryAnimation`).
- **Worn items:** they hand it on through `DoPlayerArt` to the player's `SetPlayerIcon`, `SetPlayerArms` and `SetPlayerLegs`, which pack it into `piBody_translations` and `piBody_translations2`.
- **Clothes use two-colour translations:** `util.kod EncodeTwoColorXLAT(c1, c2)` is `0x87 + 11 × c1 + c2`. The art's red ramp becomes `c1`, the cloth, and its dark-blue ramp becomes `c2`, the wearer's skin, across the palette's 11 colour ramps.
- **So a garment has one dyeable colour.** Blue is taken by the skin.

**A dye system already exists:**
- **The items:** `passitem/dyebottle.kod` (`DyeBottle`), `dyeremover.kod`, and `numbitem/pigmentdust.kod`.
- **Pigment dust:** about 26 colours, which mix into new ones (`CanMix`, `GetNewColor`). Dust comes from venom on a coloured heartstone.
- **Where to buy them:**
  - Lady Aftyn, the Marion healer (`towns/marntwn/mrhealer.kod`), sells bottles and removers.
  - Rosaline Marinus's Rainbow Forge (`towns/jixatwn/jixadyem.kod`) sells robes, skirts and tank tops in rare colours.
- **On the item:** `SetItemColor`, `RemoveDye`, `piOriginalColor`, `pbColored`, and `ResetSkinColor`, which keeps the wearer's skin in a two-colour translation.
- **Its bugs:**
  - Bottles store a raw palette index, not a two-colour translation, so dyed clothes lose their skin.
  - `SetItemColor` overwrites the item's other flag bits (`ITEM_FLOAT_INVENTORY`).
  - Dyeing a worn item doesn't redraw the wearer (no `DoPlayerArt`).
  - Shirts can't be dyed.
  - Once armour is dyed, `Armor.SetPaletteTranslation` ignores every later change.

**Tailors:**
- Tepal ix'Zonak (`towns/kocatwn/kctailor.kod`), Hester Gilk (`towns/crnthtwn/cntailor.kod`) and Madelia (`towns/barlqtwn/bqtailor.kod`), all `MOB_ROLE_TAILOR`.
- Tepal changes a player's default shirt colour when asked ("Tepal new look").
- **Templates for a paid service by speech:** `towns/decoratr.kod` (topics, prices, a credit balance) and Barloque's clerk (`bqclerk.kod`, "change name", with a warning about the cost).

**Clothes:**

| Kind | Art |
|---|---|
| `ShirtBase`, `Shirt`, `RoyalShirt` | `bta` / `btb` |
| `Tanktop` | `bta` / `btb`, or `btae` / `btbe` |
| Pants | `bfa` to `bff` |
| Skirts | `bfc` / `bfd` and `bfg` / `bfh` |
| Robes (`RobeBase`) | `btc` / `btd`, with skirt legs |

- There are no dresses, gowns or cloaks.
- **A per-item look:** `Tanktop` redeclares its art as properties, so one item can change its art. That's the precedent for per-item looks.

**Decals:**
- **On robes:** a disciple's robe (`passitem/defmod/armor/robebase/robedisc.kod`) wears an emblem (`emblm-*.bgf`) as an overlay on hotspot `HS_EMBLEM` (51), following the body's frames.
- **On shields:** the guild shield wears its insignia as a second overlay with its own translation.
- **What the art has:**
  - Torso art is 24 bitmaps: 4 poses × 6 views, the back view shared, in 22 groups.
  - The robe torsos (`btc`, `btd`) have hotspot 51 on every bitmap; the shirt torsos (`bta`, `btb`) have none. Checked with `tools/iconforge/bgf.py`.
  - Legs are 42 bitmaps, left arms 48 and right arms 96.

**Hair:**
- **Stored as:** `prToupee`, plus the hair translation in `piBody_translations2`, set with `SetHairTranslation`.
- **Allowed choices:** `util/system.kod GetAllowedHairIcons`, and `PlayerNewCharInfo`'s list of hair translations.
- **No changing it in game:** only at creation, or by an admin.

**Skills:**
- **How they work:** `Skill is PassiveObject` (`object/passive/skill.kod`): a number (`viSkill_num`, 400 and up), a school (`viSchool`: fencing, brawling, thievery), and `ImproveAbility` with `viChance_to_Increase`.
- **Teaching:** NPCs with `MOB_TEACHER` teach the skills listed in their `plFor_sale`.
- **No crafting:** the crafting school was removed (`SS_CRAFTING`, reserved).

### What our client has

- **Translations** (`packages/render/src/xlat.ts`):
  - `XlatTable` is a full port of the original's.
  - About 27 ids are free (`0x1f`, `0x34-35`, `0x3e-40`, `0x4b-4c`, `0x50`, `0x54`, `0x5d-5f`, `0x62-6d`, `0x85-86`). An unknown id draws the art undyed.
  - It already builds lighter and darker ramps (`halfRamp`).
- **Compositing** (`packages/render/src/sprites.ts compositeSprite`):
  - It flattens every part into one palette-index image, which is what stands between us and true colour.
  - The RGBA path for Smooth textures (`colorTexture.ts`, the shader's `uColorMode`) is the way there later.
- **Overlays:** their count is a byte, and the compositor has no limit. An overlay whose hotspot the frame lacks is silently skipped.
- **Colour controls to reuse:**
  - the creator's hair arrows and skin slider (`CharacterCreator.tsx`);
  - the guild shield's colour steppers (`ui/GuildDialogs.tsx`);
  - the pets' colour row (`ui/PetsPanel.tsx`).

### Art tools we have

- **iconforge** (`shards-server/tools/iconforge/`):
  - It restyles item icons with an image model into palette-true BGFs, in batches you review: inventory, select, batch, review page, apply, install.
  - **Providers:** OpenAI, Gemini, fal, and Qwen-Image-Edit on a remote ComfyUI.
  - `pixelize.py` mattes, fits, downscales and maps to `blakston.pal`, and can be limited to some palette entries.
  - `bgf.py` reads and writes BGFs, keeping groups, offsets and hotspots.
  - `install` puts results in `resource/graphics/shards/`, which `npm run assets` takes first.
  - **Its limits for clothing:** it sends each frame to the model on its own, so nothing keeps views or poses consistent, and it fits each result to the frame's box, which would break where a garment meets the body's hotspots.
- **The remaster's sprite tools** (`meridian-unreal/tools/sprites/`):
  - `m59sprites.py` and `composite.py` draw any look from any angle;
  - `equipment_sheet.py` draws every outfit in four views;
  - `new_hair.py` made a new hairstyle in 6 consistent views from one prompt. It does the front first, then every other view with the approved front as a second reference, drawn in the grey ramp so the game can colour it.

## Decisions

The user decided these on 2026-10-15:
- **tailors and a Tailoring skill**: tailor NPCs dye, add decals and sell the new clothes, and players who learn Tailoring can do the same, so cosmetics become a trade;
- **looks only**: dyes and decals never change stats, and the new clothes have no armour;
- **palette dyes first**, true colour later;
- and, as for every ADR now, **only our client and our server** have to work.

### 1. Palette dyes

1. **A dye** is one of the palette's colour ramps (the 11, plus black, white and dark green) in a light, middle or dark shade: about 40 named dyes.
2. **Why the byte isn't enough:** 40 dyes, times a trim colour, times 4 skins, won't fit in the 27 free ids.
3. **A computed dye code instead.** A new animation code, `ANIMATE_DYE`, carries a 16-bit code in place of the translation byte. The code gives:
   - the main dye, for the art's red ramp;
   - the trim dye, for its grey ramp, on new garments (5);
   - the skin, for its dark-blue ramp.
   
   Our client builds the table when it first sees a code (`XlatTable.dye(code)`, from its `ramp` and `halfRamp`, cached), so there are no fixed slots. Kod gets `EncodeDye(main, trim, skin)` beside `EncodeTwoColorXLAT`. Undyed items keep sending their original byte.
4. **What each piece takes:**
   - Existing clothes keep their rules: shirts, pants and robes dye their red; grey-art pieces (baggy pants, hats) dye their grey.
   - New garments are drawn with the main cloth in red, the trim in grey and skin in dark blue, so they take both a main and a trim colour.
   - Skin always follows the wearer (`ResetSkinColor`).
5. **The existing dye system is fixed:**
   - bottles hold a dye, encoded for each item they're used on;
   - `SetItemColor` keeps the other flag bits;
   - dyeing a worn item redraws its wearer (`DoPlayerArt`, `SomethingChanged`);
   - shirts can be dyed;
   - dyed armour can be dyed again.
6. **On each item:** `piDyeMain`, `piDyeTrim` and `piDecalColour`.

### 2. Decals

1. **A decal is an overlay** on hotspot 51, over the torso, following its frames as the disciple's emblem does (`SendOverlayAnimation`), with its own colour.
2. **Hotspot 51 is added to the shirt torsos** (`bta`, `btb`, `btae`, `btbe`) and to every new torso.
   - A script copies each bitmap's emblem position from the robe torso in the same pose and view (the layouts match), with `bgf.py`.
   - A review sheet (`equipment_sheet.py`) checks it.
3. **Decal art:**
   - the existing emblems (`emblm-*`) and guild insignia (`gshri*`) first;
   - then new ones from the pipeline (5): small grey or two-colour BGFs at the emblem's size, in 6 views.
4. **Kept on the item:** `prDecal` and `piDecalColour`. One decal per garment.

### 3. Tailors, and the Tailoring skill

1. **The tailors** (Tepal, Hester, Madelia, and Rosaline's Rainbow Forge) offer, for shillings:
   - dyeing (main and trim);
   - adding or removing a decal;
   - the new clothes (5);
   - lessons in Tailoring (`MOB_TEACHER`).
2. **The tailor's window** in our client shows:
   - the item;
   - swatches of the dyes;
   - the decals;
   - a whole-figure preview;
   - the price.
   
   It sends `#tailor dye <item> <main> <trim>` or `#tailor decal <item> <decal> <colour>`. The tailor sends its dyes, decals and prices as `UC_TAILOR_*`. On the Kod side it works like `decoratr.kod`.
3. **Tailoring** is a new skill (`SKID_TAILORING`) in a new skill school, Crafts (`SKS_CRAFTS`), learned from tailors and improved by use.
   - **What it does:** apply a dye bottle or a decal patch to any garment, one's own or another player's, through the existing apply path. Success depends on ability, and a failure wastes the dye.
   - **What higher ability opens:** trim colours, light and dark shades, decals, then sewing.
   - **Sewing:** a bolt of cloth, a pattern and thread make a garment of that pattern in the cloth's colour. The patterns are the new clothes (5), sold by tailors or found.
   - **Materials:** cloth and thread from tailors. Dyes come from pigment dust, whose mixing stays the source of rare colours.
4. **Looks only:** nothing here adds stats or armour, and nothing sells to NPCs for more than it cost. Players make the market.

### 4. Barbers

1. **Barbers in two towns** to start, such as Tos and Barloque (settled when built), working like `decoratr.kod`.
2. **The barber's window** is the `AppearanceEditor` (ADR 0010 9.3) showing hair only: the styles and the 14 hair colours. It sends `#barber <hair> <colour>`.
   - Kod checks both against the creator's lists (`GetAllowedHairIcons`, the hair translations), sets `prToupee` and calls `SetHairTranslation`.
   - It costs shillings.
3. **New hairstyles** from the pipeline (5, as `new_hair.py`) join the list, at barbers only, not at creation, unless decided otherwise (9).
4. **Later, maybe:** the same window for face parts, as a "physician". Not decided here.

### 5. New clothes: the pipeline

1. **A new tool, `shards-server/tools/garmentforge/`,** built on iconforge (`bgf.py`, `pixelize.py`, the providers, the review page and the apply step) and on `new_hair.py`'s way of keeping views consistent.
2. **A garment is a set of BGFs, for each gender:**
   - a torso (24 bitmaps);
   - sleeves if it has them (left arm 48, right arm 96);
   - a skirt if it has one (legs, 42).
   
   Each keeps its base's groups, offsets and hotspots (51 too), so neither `SendOverlays` nor our client needs to change.
3. **The steps:**
   1. **A brief** (`garments/<name>.json`):
      - which parts;
      - a description;
      - which areas are the main cloth (red), the trim (grey) and skin (dark blue), and which details keep fixed colours in other ramps;
      - the base it's cloned from (the served `bta`, `btc`, `bfc` and so on). Not the `.bbg` files: their source bitmaps aren't in the repo, and they lack later hotspots such as 29.
   2. **The front first:** the base's front view, drawn with `composite.py` on flat green, restyled by the model ("a long evening gown…"), and reviewed.
   3. **Every other view and pose,** each with the approved front as a second reference and the base bitmap as the pose. Done in small batches, reviewed on the review page, with rejects sent back with notes.
   4. **Back into the palette, in place:**
      - The result is matted and kept at its frame's exact position: the base's canvas, offsets and hotspots, grown only where the garment goes past it (a hem), with `xoff` and `yoff` adjusted.
      - Then it's mapped by shade to the allowed ramps only.
   5. **Written and checked:** written with `bgf.py`, then a sheet of all 8 angles in the walk, attack and dance groups, plus a walk loop.
      - It can be seen in our client before any Kod exists, on the ambient townsfolk, which load art by file name (`localRes`).
   6. **Installed** to `resource/graphics/shards/`, then `npm run assets` and a server deploy.
4. **In Kod,** each garment is an item class like `ShirtBase`, or like `RobeBase` when it's full length, with its art, an inventory icon (from iconforge) and its layer. Tailors sell it, and Tailoring sews it from its pattern.
5. **The first set:** two dresses (a gown and a short dress) and two shirts (a doublet and a blouse), for both genders where it makes sense.
6. **Cost:** paid image calls, about one per unique bitmap plus retries, counted per batch as iconforge does.

### 6. Our client

1. **`ANIMATE_DYE`** read with the other translations (`readTranslation`), and `XlatTable.dye(code)` (1.3).
2. **The tailor's and the barber's windows,** on `AppearanceEditor` with the whole-figure preview. The paper doll (`CharacterWindow.tsx`) shows the result.
3. **`UC_TAILOR_*`**, with the `#tailor` and `#barber` lines hidden through `lineFilter` (0009's chain).
4. **Later, true colour** (its own decision, after the palette dyes):
   - each part recoloured in RGB while compositing, fed to the existing RGBA path, with picking still on the index image;
   - an `ANIMATE_TRANSLATION_RGB`;
   - a colour picker.

### 7. The website

- **Wiki pages** for the new clothes, the dyes, Tailoring and the barbers, from the imported Kod once they're built.
- **The new art** comes through the existing import.

### 8. The order to build it

1. The dye fixes, dyeable shirts, `ANIMATE_DYE` and the named dyes.
2. The tailors' service with typed commands, then the tailor's window.
3. Hotspot 51 on the shirt torsos, and decals from the existing emblems.
4. Barbers, with the existing hairstyles.
5. Tailoring: dyeing, then decals, then sewing.
6. `garmentforge`: one shirt from end to end, then the dresses.
7. New hairstyles and decals from the pipeline.
8. Later: true colour.

### 9. Left to settle when it's built

- The dye list and its shades; whether old armour art gets a trim ramp.
- Which towns get barbers.
- Prices.
- Whether decals go on armour and helmets.
- Tailoring's ability thresholds.
- Whether new hairstyles are offered at creation too.
- The first garments' designs.
- Which image provider each batch uses.

## Consequences

- **New art** in `resource/graphics/shards/`, a server deploy per batch, and bigger game files.
- **Paid image calls.**
- **Original art is edited:** the shirt torsos gain hotspot 51 and are installed under their own names, reviewed as iconforge's work is.
- **Saves change:** new item properties and a new skill, tried on a copy first ([ADR 0008](0008-player-homes.md) 3.3).
- **The commands are a protocol:** `#tailor`, `#barber`, `UC_TAILOR_*` and `ANIMATE_DYE` change in our client and our Kod together.
- **Docs to update** as each part lands:
  - `AGENTS.md` and `docs/missing-features.md`
  - `docs/research/protocol.md` (`ANIMATE_DYE`, `UC_TAILOR_*`)
  - iconforge's README (garmentforge)
  - the website's wiki
