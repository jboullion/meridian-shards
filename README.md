# Meridian Shards

A faithful browser port of the classic Meridian 59 client: the original 2.5D look, sprites and textures, rendered with WebGL at modern resolutions, with modern controls. It connects to our own server running the original Server 104 server code. Every server is a "shard" of one original universe.

**Status:**
- **Milestone 0 (the de-risk spike) is done.** The server builds and runs locally. A headless client logs in through the WebSocket gateway, creates a character, enters the Inn of Raza and walks out into Raza, and the original Windows client sees it there.
- **The room viewer renders every Raza slice room** from the original files, with the original client's lighting.

See [docs/roadmap.md](docs/roadmap.md).

## Quick start (Windows, local)

Requirements: Node 24+ and Visual Studio 2026 with the C++ x86 toolset.

```bash
npm install
server\build.cmd          # build blakserv, the Kod and rsc0000.rsb from server\src
server\setup-run.cmd      # prepare server\src\run\server and install our config
npm run assets            # copy the original game files into dist/assets (never committed)
npm run dev               # blakserv + gateway + Vite; open http://localhost:5173/?rid=301
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
