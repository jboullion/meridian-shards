// The server's nav grids for tests (ADR 0029): dist/assets/nav/*.nav as the asset build ships
// them from blakserv's export, found by the room's checksum.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Room } from "@shards/formats";
import { decodeNavGrid, type NavGrid } from "../src/navGrid.ts";

const NAV = join(import.meta.dirname, "../../../dist/assets/nav");
let bySecurity: Map<number, Uint8Array> | null = null;

/** The bytes of the shipped grid for a room, or null */
export function navBytesOf(room: Room): Uint8Array | null {
  if (!bySecurity) {
    bySecurity = new Map();
    if (existsSync(NAV))
      for (const f of readdirSync(NAV)) {
        const bytes = new Uint8Array(readFileSync(join(NAV, f)));
        if (bytes.length >= 16) bySecurity.set(new DataView(bytes.buffer).getUint32(8, true), bytes);
      }
  }
  return bySecurity.get(room.security >>> 0) ?? null;
}

/** A room's grid as the client reads it; throws when the asset build has none current for it */
export function navGridOf(room: Room, waterTextures?: ReadonlySet<number>): NavGrid {
  const bytes = navBytesOf(room);
  const g = bytes ? decodeNavGrid(bytes, room, waterTextures) : null;
  if (!g) throw new Error("no current nav grid for this room in dist/assets/nav: export the server's (save navgrids) and build the assets");
  return g;
}
