// The client's tables (apps/client/tables) put in use for tests, which have no asset build to load
// them from. A test that types commands or shows the tables imports this first.

import achievements from "../../tables/achievements.json";
import commands from "../../tables/commands.json";
import emoji from "../../tables/emoji.json";
import help from "../../tables/help.json";
import { applyClientTables, type ClientTables } from "./clientTables.ts";

export const SOURCE_TABLES = { achievements, emoji, commands, help } as unknown as ClientTables;

applyClientTables(SOURCE_TABLES);
