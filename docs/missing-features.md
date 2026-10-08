# Missing features

What the original client has that Meridian Shards doesn't yet. Options for these are in the Preferences and Configuration windows already (shown in *italics* there), and saved with the other settings, so they'll work as soon as the feature does. Remove an entry when it lands, and add one whenever we skip something.

## Preferences (client.rc IDD_SETTINGS)

| Option | What it needs |
|---|---|
| Show weather effects | Rain, snow and sand (`BP_EFFECT` weather, `d3dparticle.c`). |
| Particle density % | The particle system itself (`D3DParticlesInit`), weather first. |
| Show toolbar | The original's button bar (`toolbar.c`): its actions are spread over our menu and keys. |
| Show tooltips | Tooltips on the interface column's buttons and stat bars (`tooltip.c`). |
| Map annotations | Notes on the map (`map.c` annotations, kept per room). |
| Filter text profanity, Profanity Options and Policy... | The word list and the dialog (`profane.c`, `IDD_PROFANITY`). |

## Configuration (the Bind Editor)

| Action | What it needs |
|---|---|
| Tab Forward / Tab Backward | Keyboard focus moving between the view, the inventory and the chat line (`MainTab`, `A_TABFWD`/`A_TABBACK`). The keys can be bound but do nothing yet. |

## Actions (merintr actions.c)

| Action | What it needs |
|---|---|
| Guild configuration | The guild messages (`UC_REQ_GUILDINFO`, `UC_GUILDINFO` and the rest) and the guild windows (`guild*.c`): create, invite, members and ranks, allies and enemies, guild halls, the shield. |
| Emotes and moods | Wave, Point, Dance and Happy, Sad, Neutral, Wry get their own menu (see `TODO.md`). Typed, they say they're not in yet instead of being said aloud. |
| Ignore list by name resource | The original keys ignores by name resource; we use the name, which survives across sessions. Not missing as such, just different. |

## Commands

| Command | What it needs |
|---|---|
| `help` | The original opens its web help pages. |
| `mail` | Mail (`module/mailnews`). |
| `addgroup` | Adds your target to a group; use Actions → Modify groups for now. |

## Elsewhere

From the roadmap, for completeness: sloped-texture rotation, blur and waver effects, `EFFECT_XLATOVERRIDE`, and fighting in the crypt.
