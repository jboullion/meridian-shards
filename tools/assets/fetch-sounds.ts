// Downloads the ambient sounds that aren't the game's own (ours: town and inn chatter, the arena's
// crowd, distant thunder) into dist/sounds, where `npm run assets` picks them up. Like the game's
// own sounds they never go in git. Every one is CC0 (public domain), from BigSoundBank
// (Joseph Sardin, https://bigsoundbank.com); docs/ambient-sounds.md lists what plays where.
//
//   node tools/assets/fetch-sounds.ts [--force]

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "dist", "sounds");

/** Our file name, BigSoundBank's sound number, and what it is */
export const EXTRA_SOUNDS: { name: string; id: string; what: string }[] = [
  { name: "amb_town_talk.ogg", id: "3096", what: "Outside Talks #6: about fifty people chatting outdoors" },
  { name: "amb_inn_talk.ogg", id: "3542", what: "Small Restaurant Conversations: about fifteen people indoors" },
  { name: "amb_hall_talk.ogg", id: "3516", what: "Crowd of 50-60 People #2: a gathering indoors" },
  { name: "amb_cheer1.ogg", id: "0236", what: "Shouts and Applauses of Teens #1" },
  { name: "amb_cheer2.ogg", id: "0237", what: "Shouts and Applauses of Teens #2" },
  { name: "amb_applause.ogg", id: "0019", what: "Applause: 150 People" },
  { name: "amb_thunder1.ogg", id: "3113", what: "Thunder #2: a short thunderclap" },
  { name: "amb_thunder2.ogg", id: "3114", what: "Thunder #3: a thunderclap" },
  { name: "amb_thunder3.ogg", id: "3179", what: "Thunder #6: a thunderclap" },
  { name: "amb_thunder4.ogg", id: "3180", what: "Thunder #7: a thunderclap" },
];

if (process.argv[1]?.endsWith("fetch-sounds.ts")) {
  const force = process.argv.includes("--force");
  mkdirSync(OUT, { recursive: true });
  for (const s of EXTRA_SOUNDS) {
    const dest = join(OUT, s.name);
    if (existsSync(dest) && !force) {
      console.log(`have ${s.name}`);
      continue;
    }
    const url = `https://bigsoundbank.com/UPLOAD/ogg/${s.id}.ogg?v=d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Meridian Shards asset build)" } });
    if (!res.ok) {
      console.error(`!! ${s.name}: ${res.status} from ${url}`);
      process.exitCode = 1;
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(dest, bytes);
    console.log(`got ${s.name} (${(bytes.length / 1024).toFixed(0)} KB): ${s.what}`);
  }
}
