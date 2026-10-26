// packages/protocol/fixtures/readers.json read back as another client's port of our readers
// would (meridian-godot's reader_test): each case from its bytes, arguments and resources alone.
// It fails when a reader no longer gives a case's result (run npm run fixtures), and when one of
// our server's user commands has no case at all.

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import * as protocol from "@shards/protocol";
import * as world from "../src/index.ts";
import { FIXTURES_FILE, toPlain, type ReaderCase } from "../../protocol/test/fixture.ts";

// npm run fixtures runs the tests to write the file: not to read it
const generating = !!process.env.SHARDS_FIXTURES_OUT;
const file = generating
  ? { cases: [] }
  : (JSON.parse(fs.readFileSync(new URL(`../../../${FIXTURES_FILE}`, import.meta.url), "utf8")) as { commit: string; generated: string; cases: ReaderCase[] });
const readers: Record<string, unknown> = { ...protocol, ...world };

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

describe.skipIf(generating)(FIXTURES_FILE, () => {
  it.each(file.cases.map((c) => [c.name, c] as const))("%s", (_name, c: ReaderCase) => {
    const reader = readers[c.reader];
    expect(typeof reader, `${c.reader} isn't exported by @shards/protocol or @shards/world`).toBe("function");
    expect(fs.existsSync(new URL(`../../../${c.source}`, import.meta.url)), c.source).toBe(true);
    const lookup = c.resources ? [(id: number) => c.resources![id]] : [];
    const result = (reader as (...a: unknown[]) => unknown)(...c.args, new protocol.ByteReader(bytes(c.hex)), ...lookup);
    expect(toPlain(result)).toEqual(c.result);
  });

  it("has a case for every user command our server sends", () => {
    // UC_SHARDS and UC_SHARDS_OBJECT only go to the server
    const ours = Object.values(protocol.UC).filter((uc) => uc > protocol.UC.SHARDS && uc !== protocol.UC.SHARDS_OBJECT);
    const covered = new Set(file.cases.filter((c) => c.message === "BP_USERCOMMAND").map((c) => c.code));
    expect(ours.filter((uc) => !covered.has(uc))).toEqual([]);
  });
});
