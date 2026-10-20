# Playtest reports

What the AI playtester ([ADR 0020](../docs/adr/0020-ai-playtester.md)) finds while it plays on the local server.

- `reports/`: one bug per file, `<date>-<time>-<slug>.md`, written by the agent's `report_bug` tool, with a `.png` of the same name beside it when the agent plays in the real client (`--body browser`). The screenshots show the game's art, so they're git-ignored: they stay on the machine that took them. The front matter has the severity (blocker, major, minor, cosmetic), the category, the status, where it happened (character, room, square) and the commit. The body has what happened, steps to reproduce, and the journal's last 30 lines before the report.
- `notes/`: a file a day of observations that aren't bugs: balance, confusing text, ideas.

## Triage

Read the new ones (`status: new`), then change the status in the file:

- `confirmed`: real, and worth fixing. Add it to the roadmap or fix it, then `fixed` with the commit.
- `wontfix`: real, but as intended (or the original does the same).
- `invalid`: the agent misread the game (say why in a line, so the brief can be improved).
- `duplicate`: name the other report.

The agent reads `list_reports` before filing, so a report's title and status are what keep it from filing the same thing twice.

## Running it

1. `npm run dev` (the local stack).
2. In Claude Code in this repo, the `meridian` MCP server (`.mcp.json`) gives the tools. Ask the `playtester` agent (`.claude/agents/playtester.md`) to play, or use the tools yourself: `connect`, `look_around`, `wait_events`...
3. The character is `shardscout` / `shardscout`, character Scout, a plain player.
4. `connect` plays headless (quick, text only) by default. `connect` with body `browser` plays in the real client in a hidden Edge window, so the agent can take screenshots. To watch it play, start the server with `--headed` (in `.mcp.json`).
