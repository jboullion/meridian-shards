# Comparison screenshots

Every client takes the same pictures from the same squares and facing. That gives the website comparisons it can switch between: the original client, Classic, Modern, the phone layout and Unreal. [`shots.json`](shots.json) lists the shots. To add one, add an entry and run the clients again.

| Client | Taken by | Output |
|---|---|---|
| Classic, Modern, Mobile | `npm run shots` (this folder's [`capture.ts`](capture.ts)) | `ReferenceImages/comparisons/<id>/{classic,modern,mobile}.png` |
| Unreal | meridian-unreal `npm run shots` (`tools/ue/run_comparison_shots.ps1`, reading this `shots.json`) | `ReferenceImages/comparisons/<id>/unreal.png` |
| Original | by hand (below) | `ReferenceImages/comparisons/<id>/original.png` |

`ReferenceImages/` is git-ignored. The website copies what it needs from there with its own `npm run images`.

## Taking them (browser)

```bash
npm run dev                                   # the local stack, in another terminal
npm run shots                                 # every shot for classic, modern and mobile
npm run shots -- --only raza-pond,inn-room    # some shots
npm run shots -- --client mobile              # one client
npm run shots -- --headed                     # watch
```

It uses the installed Edge (`--channel chromium` for Playwright's own browser, after `npx playwright install chromium`).

### What the script does

1. It sets the client's settings before the page loads:
   - the interface (Classic or Modern) or Touch Controls on
   - weather off
   - no FPS counter
2. It logs in as the screenshot character and gives it a mace and a metal shield if it hasn't got them, then wields and wears them.
3. It fixes the time of day for everyone on the server (`dm afternoon`).
4. For each shot:
   1. It moves the character to the shot's square: `TeleportTo`, then System's `UtilGoNearSquare` through the maintenance port, using the square's centre.
   2. It waits for the scene to settle and the Modern chat to fade.
   3. It waits for a moment when none of our townsfolk is right in front of the camera. If one is still there after 20 s, it says so and takes the shot anyway.
   4. It runs the shot's steps and saves the shot.

Desktop shots are 1600×900. The phone's are a landscape Pixel 7 (915×412 CSS pixels at 2.625×).

### The screenshot character

It is `Shardshots` on the local admin account `shardshots` (password = name). If your server doesn't have it yet:

1. Create the account and its admin character:
   ```bash
   node tools/maint/maint.ts "create account admin shardshots shardshots none"
   node tools/maint/maint.ts "create admin <the account number it printed>"
   ```
2. Log in once in the browser, pick `<New character>` and name it `Shardshots`.
3. Choose its spells: the phone's quick slots are filled from them (zap, illuminate, minor heal and glow are used now).

The mace and shield are given on every run, if they're missing.

## Login screen backgrounds

The login screen fades between pictures of the game's places. Modern uses the desktop pictures and the phone uses the mobile ones. [`backgrounds.json`](backgrounds.json) lists them: the arena, the cities, Castle Victoria, the six schools' teachers and the three faction leaders. It uses the same format as `shots.json`, with a few more fields, and `capture.ts` takes it:

```bash
npm run dev                                             # the local stack, in another terminal
npm run shots:backgrounds                               # every background, modern and mobile
npm run shots:backgrounds -- --only tos-fountain        # some
npm run shots:backgrounds -- --client modern --headed   # one client, watching
```

They land in `ReferenceImages/login-backgrounds/<id>/{modern,mobile}.png`, each with a WebP copy beside it for the game (`modern.webp` scaled to 2560×1440, `mobile.webp` as taken, about 350 KB each). `index.json` beside them lists every shot taken so far: id, title, tags, time, files and the web copies.

To put them on the login screen, run `npm run assets`. It copies the WebP copies into the game files as `login/<id>.<layout>.webp`, with `login/backgrounds.json` listing them (`tools/assets/build-assets.ts`). The login screen fades between them (`apps/client/src/game/Intro.tsx`). Deploy the server so the hosted client gets them; new releases of the apps carry them too. `npm run shots:backgrounds -- --web-only` makes the copies again from the pictures already taken, without the local stack (for a new size or quality in `web`). Modern pictures are 3840×2160 (1920×1080 at 2×). Mobile pictures are a landscape Pixel 7's 2401×1081. The windows (`viewports`) are 32 pixels taller than that, because the browser's title bar sits above the view.

### What's different from the comparison shots

| Manifest field | What it does |
|---|---|
| `"hud": false` | Saves the 3D view alone (`gameScene.captureView`), so nothing over it appears in either layout: no interface, touch controls, title bar, names, speech bubbles or first-person hands |
| `"out"` | Where the shots go, from the repository's root (`--out` overrides it) |
| `"viewports"` | Each client's window: `{ "width", "height", "deviceScaleFactor" }` |
| no `"equipment"` | The character isn't given anything (the hands aren't in the picture anyway) |
| `"web"` | `{ "quality", "width": { "<client>": <max width> } }`: a WebP copy of each picture for the game, made after the shots in the same browser (no image library) |
| `"settings"` | Client settings over the run's own (`settings.ts`), e.g. `{ "enhanced": false }` to take the same shots in the original's lighting |

| Shot field | What it does |
|---|---|
| `pitch` | The first-person look in degrees: negative looks down, positive up |
| `time` | `morning`, `afternoon`, `evening` or `night` (the DM commands: 6, 13, 18 and 23 o'clock), instead of the manifest's `time`. The run takes one time of day after another. Townsfolk carry torches from 19 to 6, and the arena is shut from 22 to 6, so an arena shot at `night` would be empty. |
| `tags` | `arena`, `city`, `castle`, `teacher`, `leader`, `evening`, `night`, for the login screen to choose by |

### Finding a spot

1. In development, log in as `Shardshots` in the browser. Go to the room with the admin console's Travel tab, then walk and look to the view you want (PgUp/PgDn tilts the look).
2. Run `await shards.pose()` in the console. It gives the room's number, the square, the facing and the pitch, ready to copy into a shot.
3. Take that shot alone with `--only <id> --headed` and look at it.

`UtilGoNearSquare` puts the character at the square's centre, as near as it can. On some squares that's a rooftop, which can make a good overview (`raza-overview`). An NPC stands at its Kod square, which is in the room's or faction's Kod file (`backgrounds.json` notes which). Aim at it from a few squares away.

### Unreal (meridian-unreal, still to do)

`run_comparison_shots.ps1` already takes `-Manifest` and `-Out`. To take these, it also needs to:

- Leave out `-MRLookDevUI` and the wielded mace when the manifest says `"hud": false`.
- Use the shot's `pitch` as the camera's (`rotation[0]`, degrees, negative down).
- Use the shot's `time` as `-GameHour`: morning 6, afternoon 13, evening 18, night 23 (the server's hours; the comparison shots use 17 for the afternoon mood).
- Skip shots whose room isn't in `data/zone_layout.json` yet, rather than failing the run.
- Write `unreal.png` beside the others (it does already). `index.json` lists it on the next browser run.

## Steps

| Step | What it does |
|---|---|
| `inventory` | Opens the inventory: the Inventory key on the desktop (Modern's character window; Classic already shows it in the sidebar), the Items drawer on the phone. |
| `hideHud` | Hide Interface (Modern) |
| `view:<first\|chase\|behind\|front>` | The Modern camera view |
| `chase:<heading>:<pitch>:<arm>` | The chase camera at a heading (0-4095, like `angle`), a pitch in radians (negative looks down) and an arm length in squares |
| `wheel` | Holds the phone's Cast button down until its wheel of quick slots opens |
| `arenaFight[:<s>]` | Waits up to 4 minutes for a bout in the arena (ADR 0007), then `s` seconds more (4 by default) for it to get going |
| `login` | Unreal only: its login screen |
| `eval:<script>` | Runs a script in the page with `shards` in scope, then waits a moment: to try an effect, e.g. `eval:shards.gameScene.seasonPin = 2` (fall) or `eval:shards.gameScene.snowCover = 1` |

## The original client (by hand)

For each shot whose `clients` include `original`, stand where it says and take a screenshot of the whole window. Save it as `ReferenceImages/comparisons/<id>/original.png`.

| Shot | Room | Square (row, col) | Facing | Then |
|---|---|---|---|---|
| `raza-pond` | Raza | 17, 19 | east-south-east, a little south of east (190): the shops across the pond on the left, the temple's clock tower on the right | |
| `inn-room` | The Inn of Raza | 3, 8 (where a new character arrives) | west-south-west (1792): the Welcome sign and Marcus | |
| `inn-inventory` | The Inn of Raza | 3, 8 | west-south-west | the Inventory tab |
| `tos-arena` | The Arena of Kraanan (from Tos's East Ende, through the Arena foyer) | 22, 11 (in the south stands) | north-east (3300): the spectators and the Watcher's box | |

- **Getting there:** an admin character gets there quickly with the admin console. Use `send object <you> TeleportTo rid int 300` (Raza), `301` (the Inn) or `60` (the Arena), then `send object 0 UtilGoNearSquare what object <you> where object <the room> new_row int <row> new_col int <col> new_angle int <angle>`. `dm get coords` shows where you are.
- **The character:** wield a mace and wear a shield, as the other clients do.
- **The time:** use `dm afternoon` when you can.
- **The window size:** use a size close to 16:9, so the pictures line up with the others.
