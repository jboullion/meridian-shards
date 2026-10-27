// Ours: builds our music (tools/music/pieces/*.ts, each a Piece: score.ts) into dist/music: the
// MIDI as written, and the OGG rendered with gm.dls (render.ts), where `npm run assets` picks the
// OGGs up for the client. Like the game's own music, the renders never go in git.
//
//   node tools/music/build.ts [<piece> ...] [--bank gm|generaluser|<file>]
//   node tools/music/build.ts --list      every piece's title, bars and length, as JSON
//
// <piece> is a file name in pieces/ without .ts (princess); none: all of them. Rooms play a piece
// by naming its file in their Kod (shards-server: `castle2a_music = princess.ogg`).

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Piece } from "./score.ts";
import { renderOgg } from "./render.ts";

const ROOT = resolve(import.meta.dirname, "../..");
export const PIECES = join(ROOT, "tools", "music", "pieces");
export const OUT = join(ROOT, "dist", "music");

export function pieceNames(): string[] {
  return readdirSync(PIECES)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => basename(f, ".ts"))
    .sort();
}

export async function loadPiece(name: string): Promise<Piece> {
  // A fresh copy each time, so an edited piece is read anew in a long-running process
  const mod = (await import(`${pathToFileURL(join(PIECES, `${name}.ts`)).href}?t=${Date.now()}`)) as { piece?: Piece };
  if (!mod.piece) throw new Error(`pieces/${name}.ts exports no piece`);
  return mod.piece;
}

export async function buildPiece(name: string, bank = "gm") {
  const piece = await loadPiece(name);
  const score = piece.build();
  const midi = score.toMidi();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.mid`), midi);
  const r = await renderOgg(midi, { bank });
  writeFileSync(join(OUT, piece.file), r.ogg);
  return { name, file: piece.file, title: piece.title, bars: score.bars, seconds: r.seconds, bytes: r.ogg.length };
}

/** What each piece is, without rendering it (for the admin dashboard) */
export async function listPieces() {
  const out = [];
  for (const name of pieceNames()) {
    try {
      const p = await loadPiece(name);
      const s = p.build();
      out.push({ name, file: p.file, title: p.title, about: p.about, bars: s.bars, seconds: s.seconds, parts: s.parts.map((x) => x.name) });
    } catch (e) {
      out.push({ name, file: "", title: name, about: "", bars: 0, seconds: 0, parts: [], error: (e as Error).message });
    }
  }
  return out;
}

if (process.argv[1]?.endsWith("build.ts") && process.argv.includes("--list")) {
  console.log(JSON.stringify(await listPieces()));
} else if (process.argv[1]?.endsWith("build.ts")) {
  const args = process.argv.slice(2);
  const b = args.indexOf("--bank");
  const bank = b >= 0 ? args[b + 1]! : "gm";
  const asked = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--bank");
  for (const name of asked.length ? asked : pieceNames()) {
    const t0 = Date.now();
    const r = await buildPiece(name, bank);
    console.log(`${r.file}: ${r.title}, ${r.bars} bars, ${r.seconds.toFixed(1)}s, ${(r.bytes / 1024).toFixed(0)} KB (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  console.log("Run `npm run assets` to put them in dist/assets.");
}
