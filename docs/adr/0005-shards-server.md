# ADR 0005: Move to the Meridian: Shards server and the original protocol

- Status: Accepted
- Date: 2026-10-11
- Changes: [ADR 0001](0001-direction.md) decision 4 (blakserv stays an unmodified Server 104)

## Context

Meridian Shards was built against an unmodified Server 104 `blakserv`, the fan fork, and speaks its protocol. We now have our own server, [meridian-shards-server](https://github.com/jboullion/meridian-shards-server) (`J:\meridian-shard-server`). It is a fork of the original upstream game, [Meridian59/Meridian59](https://github.com/Meridian59/Meridian59), on the same `blakserv` + Kod stack, and is where new features will go.

That server's decisions shape this client:
- Its [ADR 0003](https://github.com/jboullion/meridian-shards-server/blob/master/docs/adr/0003-two-rulesets.md): two rulesets, `original` and `shards`, and no `server104`.
- Its [ADR 0002](https://github.com/jboullion/meridian-shards-server/blob/master/docs/adr/0002-protocol-version.md): the server announces its Shards protocol version at login (`AP_SHARDS_INFO = 60`).

Upstream and 104 differ on the wire in a known, bounded set of places, all listed in the server's [protocol-dialect.md](https://github.com/jboullion/meridian-shards-server/blob/master/docs/protocol-dialect.md):
- **Objects:** the object descriptor and flags, and the player-list entries.
- **Commands and login:** the user-command ids, login, and character creation.
- **Requests:** drop and inventory move.
- **File formats:** RSC v4 vs v5, and ROO v12/13 vs v15.

## Decision

1. **Meridian Shards plays on the Shards server only.** The client speaks the `original` protocol, plus the Shards additions gated by the version in `AP_SHARDS_INFO`. 104 support is removed, not kept behind a switch.
2. **The last 104 client is kept on the `server-104` branch** (`159936c`, the same code as `v0.6.1`). The migration happens on `shards-server` and merges to `main` when ready.
3. **The decoded model keeps its current shape.** `packages/protocol` turns upstream's packed object flags into the fields the renderer and UI already use (`drawingType`, `minimapFlags`, `nameColor`, `objectType`, `moveOnType`), following the original client's own rules:
   - name colours: `clientd3d/color.c` `GetPlayerNameColor`
   - minimap dots: `map.c` `MapDrawObjects`

   So most of the change stays inside the protocol package.
4. **104-only features are removed unless the Shards server grows them later,** the Shards way:
   - stat reallocation (`BP_REQ_STAT_CHANGE`)
   - the server-side preferences beyond safety
   - per-language strings
   - sector change, radius shots, stop-wave
   - the client-patch messages and the secret key
5. **Development runs the Shards server's Windows build** (`J:\meridian-shard-server\run\shards`, game 5960, maintenance 9999). The hosted stack moves to its Docker image later, as a coordinated cutover with a desktop release.
6. **Art comes from the original (Steam) client install.** It's permitted while the client and server are open source and the art is never committed.

## Consequences

- Fewer formats and messages to support. The renderer, minimap and dialogs barely change.
- Rarity (upstream's item grades) becomes available to the UI. Showing it is a later feature.
- **The hosted world moves to the Shards server in one step.** Desktop players auto-update to the highest release, so the first `shards-server` release must go out with the server switch, not before.
- Test accounts no longer appear on first login: the upstream server doesn't create accounts. Dev accounts are made on the server: its Windows admin window today, and its maintenance port once that is allowed.

## Alternatives

- **Keep 104 behind a ruleset switch:** rejected by the server's ADR 0003. It means two codecs and two readers per format, kept for a server we're leaving.
- **Change the decoded model to upstream's packed flags everywhere:** rejected. It touches the renderer, minimap, look dialog, movement and guild code for no behaviour gain.
