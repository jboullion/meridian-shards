// Run admin commands on the local blakserv through its maintenance port
// (localhost only, port 9999 on the Shards server; MAINT_PORT to change it).
//
//   node tools/maint/maint.ts "show object 7001" ["another command" ...]
//
// Never use it for "save game" against a server you care about without meaning to.

import { maintCommands } from "./client.ts";

const cmds = process.argv.slice(2);
if (!cmds.length) {
  console.error('usage: node tools/maint/maint.ts "<command>" ...');
  process.exit(2);
}

try {
  const replies = await maintCommands(cmds);
  cmds.forEach((c, i) => process.stdout.write(`> ${c}\n${replies[i]}\n`));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
