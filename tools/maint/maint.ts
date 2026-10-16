// Run admin commands on the local blakserv through its maintenance port
// (localhost only). Commands end with CR, not LF (blakserv/maintenance.c).
//
//   node tools/maint/maint.ts "show object 7001" ["another command" ...]
//
// Never use it for "save game" against a server you care about without meaning to.

import { maint } from "./maintClient.ts";

const cmds = process.argv.slice(2);
if (!cmds.length) {
  console.error('usage: node tools/maint/maint.ts "<command>" ...');
  process.exit(2);
}

try {
  const outs = await maint(...cmds);
  cmds.forEach((c, i) => process.stdout.write(`> ${c}\n${outs[i]}\n`));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
