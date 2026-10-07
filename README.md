# Meridian Shards

A faithful browser port of the classic Meridian 59 client: the original 2.5D look, sprites and textures, rendered with WebGL at modern resolutions, with modern controls. It connects to our own server running the original Server 104 server code. Every server is a "shard" of one original universe.

**Status:**
- **Milestone 0 (the de-risk spike) is done.** The server builds and runs locally. A headless client logs in through the WebSocket gateway, creates a character, enters the Inn of Raza and walks out into Raza, and the original Windows client sees it there.
- **The browser client logs in and enters the world.** You can pick or create a character, then stand in the Inn of Raza or Raza with every object (NPCs, players, signs, trees, torches) drawn, lit and labelled like the original D3D client. Walking uses the original collision code, and you can open doors, cross into neighbouring zones, chat, look at things, and pick up and drop items.
- **The original's interface works:** the health, mana and vigor bars, your face and enchantments, the minimap, and the inventory, stats, spells, skills and quests tabs. You can buy from shopkeepers, sell to them, use the bank and vault, and hear the original music and sounds. Settings (O or F10) cover sound and key bindings, with a modern (WASD) preset and the original's keys.
- **Combat and character creation work:** target and fight the forest creatures with your weapon in hand, cast spells at a target, die and walk out of the Underworld, and make new characters with the original's full creator (face, stats, spells and skills).
- **The room viewer (`/?viewer`) renders every Raza slice room** from the original files.

See [docs/roadmap.md](docs/roadmap.md).

## Quick start (Windows, local)

Requirements: Node 24+ and Visual Studio 2026 with the C++ x86 toolset.

```bash
npm install
server\build.cmd          # build blakserv, the Kod and rsc0000.rsb from server\src
server\setup-run.cmd      # prepare server\src\run\server and install our config
npm run assets            # copy the original game files into dist/assets (never committed)
npm run dev               # blakserv + gateway + Vite; open http://localhost:5173 and log in
npm run headless -- --user shardbot --pass shardbot --stay 10
```

`npm run assets` reads the art and sounds from an installed Server 104 client (`%LOCALAPPDATA%\Meridian-104`).

`server\src` is a git-ignored copy of the Server 104 source. Copy it from `meridian-unreal\Server-104` (for example with `robocopy <that folder> server\src /E /XD run .vs`).

## Docs

- [AGENTS.md](AGENTS.md): rules, layout and conventions
- [docs/adr/0001-direction.md](docs/adr/0001-direction.md): decisions and architecture
- [docs/roadmap.md](docs/roadmap.md): milestones, the slice checklist and progress
- [docs/research/protocol.md](docs/research/protocol.md): the client/server protocol, with source references

## Licence

GPLv2 (see [LICENSE](LICENSE)), like the Meridian 59 source it ports. The game's art, music and rooms are not part of this repository.

Meridian is a registered trademark of its owners; this is a non-commercial fan project.
