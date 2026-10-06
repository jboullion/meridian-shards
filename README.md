# Meridian Shards

A faithful browser port of the classic Meridian 59 client: the original 2.5D look, sprites and textures, rendered with WebGL at modern resolutions, with modern controls. It connects to our own server running the original Server 104 server code. Every server is a "shard" of one original universe.

**Status:** milestone 0 (the de-risk spike) works. The server builds and runs locally, and a headless client logs in through the WebSocket gateway, creates a character, enters the Inn of Raza and walks out into Raza. See [docs/roadmap.md](docs/roadmap.md).

## Quick start (Windows, local)

Requirements: Node 24+ and Visual Studio 2026 with the C++ x86 toolset.

```bash
server\build.cmd                     # build blakserv, the Kod and rsc0000.rsb from server\src
server\setup-run.cmd                 # prepare server\src\run\server and install our config
server\src\run\server\blakserv.exe   # start the server (run from that folder)
npm run gateway                      # WebSocket gateway on ws://localhost:8059
npm run headless -- --user shardbot --pass shardbot --stay 10
```

`server\src` is a git-ignored copy of the Server 104 source. Copy it from `meridian-unreal\Server-104` (for example with `robocopy <that folder> server\src /E /XD run .vs`).

## Docs

- [AGENTS.md](AGENTS.md): rules, layout and conventions
- [docs/adr/0001-direction.md](docs/adr/0001-direction.md): decisions and architecture
- [docs/roadmap.md](docs/roadmap.md): milestones, the slice checklist and progress
- [docs/research/protocol.md](docs/research/protocol.md): the client/server protocol, with source references

## Licence

GPLv2 (see [LICENSE](LICENSE)), like the Meridian 59 source it ports. The game's art, music and rooms are not part of this repository.

Meridian is a registered trademark of its owners; this is a non-commercial fan project.
