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

## Steps

| Step | What it does |
|---|---|
| `inventory` | Opens the inventory: the Inventory key on the desktop (Modern's character window; Classic already shows it in the sidebar), the Items drawer on the phone. |
| `hideHud` | Hide Interface (Modern) |
| `view:<first\|chase\|behind\|front>` | The Modern camera view |
| `chase:<heading>:<pitch>:<arm>` | The chase camera at a heading (0-4095, like `angle`), a pitch in radians (negative looks down) and an arm length in squares |
| `wheel` | Holds the phone's Cast button down until its wheel of quick slots opens |
| `login` | Unreal only: its login screen |

## The original client (by hand)

For each shot whose `clients` include `original`, stand where it says and take a screenshot of the whole window. Save it as `ReferenceImages/comparisons/<id>/original.png`.

| Shot | Room | Square (row, col) | Facing | Then |
|---|---|---|---|---|
| `raza-pond` | Raza | 17, 19 | east-south-east, a little south of east (190): the shops across the pond on the left, the temple's clock tower on the right | |
| `raza-wide` | Raza | 22, 46 | north-west (2620): the pond, the Inn and the north gate | |
| `inn-room` | The Inn of Raza | 3, 8 (where a new character arrives) | west-south-west (1792): the Welcome sign and Marcus | |
| `inn-inventory` | The Inn of Raza | 3, 8 | west-south-west | the Inventory tab |

- **Getting there:** an admin character gets there quickly with the admin console. Use `send object <you> TeleportTo rid int 300` (Raza) or `301` (the Inn), then `send object 0 UtilGoNearSquare what object <you> where object <the room> new_row int <row> new_col int <col> new_angle int <angle>`. `dm get coords` shows where you are.
- **The character:** wield a mace and wear a shield, as the other clients do.
- **The time:** use `dm afternoon` when you can.
- **The window size:** use a size close to 16:9, so the pictures line up with the others.
