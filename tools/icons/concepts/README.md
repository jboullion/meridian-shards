# Icon concepts

Candidates for a new Meridian Shards icon: red roses and green leaves, as the original client's
icon has, with a yellow crystal shard (`#fedf01`, the interface's highlight) where its sword was.
`ai-close-noguard.png` is our official logo, used everywhere (2026-10-11): `../cutout-emblem.py` cut
it out of its background as `../emblem.png`, which `../make-icons.ts` makes every app icon and
favicon from, and the website will use too.

| File | What it is |
|---|---|
| `ai-close-noguard.png` | **The logo** (2026-10-11): five roses, the shard standing on its own among them |
| `ai-close-hilt.png` | Kept for reference: the same roses, the shard as the blade of a whole gold hilt (cut out with `../cutout-emblem.py concepts/ai-close-hilt.png <out.png>`) |
| `ai-close.png`, `ai-lush.png` | The first two AI images (a leftover crossguard; a dense round bed of roses with a broader shard) |
| `a-hexagon.svg` | Hand-drawn SVG: five roses on a hexagon, the shard through it |
| `a-wreath.svg`, `b-bouquet.svg`, `c-medallion.svg` | Earlier SVG drafts |
| `favicon-test.svg` | A simplified emblem for favicons: bold roses and sword that stay readable at 16-32 px. Not used yet |
| `favicon-test-noguard.svg` | The simplified favicon without the hilt: the shard alone, its point resting on the bottom rose |
| `preview.html`, `preview-hexagon.html` | The SVGs side by side, large and at 64 and 32 px |
| `preview-favicon.html` | Both paintings and both SVGs as browser-tab favicons at 16 and 32 px |

## How the AI images were made

- **Reference:** the original client's 256-colour icon (48 x 48, in the installed client's
  `meridian.exe`, icon group 101; `icon1.ico` in the asset build only has a 16-colour dither),
  upscaled 16x with `4xNomos8kDAT` (two 4x passes) through `meridian-unreal`'s
  `tools/aigen/sprite.py upscale_rgba`. The reference is original art, so it isn't kept here.
- **Generator:** OpenAI image edits through `meridian-unreal`'s `tools/aigen/restyle.py openai()`
  (its default model, its `.env` key), 1024 x 1024, high quality.
- `ai-close.png`, `ai-lush.png`: the upscaled original and our app icon (for the shard) as
  references, with the prompt asking for the original's composition and palette, the sword replaced
  by a tall faceted yellow crystal shard (`#fedf01` lit faces, amber shadows, a soft glow), in a
  hand-painted 1990s fantasy RPG icon style on a plain very dark background. Close: "five large roses
  arranged like the original, small green leaves between them". Lush: "a dense, lush bed of many deep
  red blooms ... filling a circle around the shard".
- `ai-close-noguard.png`: `ai-close.png` and `ai-lush.png` as references, "recreate the first image
  exactly ... remove the golden crossguard, the hilt and every other sword part ... put the shard from
  the second image there". The roses came back unchanged; the shard stayed the first image's.
- `ai-close-hilt.png`: `ai-close.png` and the upscaled original as references, "make the shard the
  blade of a sword: a complete, intact golden sword hilt ... a polished gold crossguard curving upward
  at both ends, then a short wrapped grip and a round gold pommel, all in one straight vertical line".
