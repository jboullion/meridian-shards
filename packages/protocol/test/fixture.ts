// Reader fixtures: packages/protocol/fixtures/readers.json holds, for every reader call a test
// makes through fixture(), the bytes the reader was given and what it returned. Other clients
// that port our readers check theirs against it (meridian-godot's reader_test), so a change to a
// reader here shows up there as a failing case.
//
// `npm run fixtures` (tools/fixtures/readers.ts) runs the tests with SHARDS_FIXTURES_OUT set, and
// each call writes its case there. Otherwise each call checks its case against the committed file:
// a reader or a test's bytes changed without `npm run fixtures` fails the test.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { threadId } from "node:worker_threads";
import { expect } from "vitest";
import { BP, type ByteReader } from "../src/index.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const FIXTURES_FILE = "packages/protocol/fixtures/readers.json";

/** The message a reader reads, and the file it's in (repo path) */
export interface ReaderSource {
  /** "BP_USERCOMMAND" or "BP_<NAME>" */
  message: string;
  /** The UC code for a user command, else the BP number */
  code: number;
  source: string;
}

/** One case in readers.json */
export interface ReaderCase {
  name: string;
  message: string;
  code: number;
  reader: string;
  source: string;
  /** Arguments that come before the ByteReader (readRoomChange's type, readSocial's UC code) */
  args: unknown[];
  /** The bytes the reader is given: after the UC byte for a user command, after the type byte otherwise */
  hex: string;
  /** For a reader that looks resources up: the ones it found (any other id is unknown) */
  resources?: Record<string, string>;
  /** The reader's return value as plain JSON */
  result: unknown;
}

/** A user command (BP_USERCOMMAND) read by `source`; code is its UC number */
export const userCommand = (code: number, source: string): ReaderSource => ({ message: "BP_USERCOMMAND", code, source });

/** A server message read by `source`, by its BP name or number */
export function serverMessage(bp: keyof typeof BP | number, source: string): ReaderSource {
  const name = typeof bp === "number" ? Object.keys(BP).find((k) => BP[k as keyof typeof BP] === bp) : bp;
  if (name === undefined) throw new Error(`no BP message ${bp}`);
  return { message: `BP_${name}`, code: BP[name as keyof typeof BP], source };
}

/** A value as plain JSON: undefined fields left out, null kept, Maps as objects, Sets and typed arrays as arrays */
export function toPlain(v: unknown): unknown {
  const walk = (x: unknown): unknown => {
    if (x instanceof Map) return Object.fromEntries([...x].map(([k, val]) => [String(k), walk(val)]));
    if (x instanceof Set) return [...x].map(walk);
    if (ArrayBuffer.isView(x)) return Array.from(x as unknown as ArrayLike<number>);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) if (val !== undefined) out[k] = walk(val);
      return out;
    }
    return x;
  };
  const plain = walk(v);
  return plain === undefined ? null : JSON.parse(JSON.stringify(plain));
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const isReader = (a: unknown): a is ByteReader =>
  !!a && typeof a === "object" && "buf" in a && "pos" in a && typeof (a as ByteReader).u8 === "function";

// Per test file (vitest gives each its own modules): calls so far, and each test's count
let seq = 0;
const perTest = new Map<string, number>();
let committed: Map<string, ReaderCase> | null = null;

function committedCase(name: string): ReaderCase | undefined {
  if (!committed) {
    const file = JSON.parse(fs.readFileSync(path.join(ROOT, FIXTURES_FILE), "utf8")) as { cases: ReaderCase[] };
    committed = new Map(file.cases.map((c) => [c.name, c]));
  }
  return committed.get(name);
}

/**
 * Runs reader(...args), as the test would, and returns its result. The ByteReader argument's
 * bytes from its position on are the case's; arguments before it go in the case, and a lookup
 * after it is watched for the resources the reader finds.
 */
export function fixture<A extends unknown[], T>(where: ReaderSource, reader: (...args: A) => T, ...args: A): T {
  const at = args.findIndex(isReader);
  if (at < 0) throw new Error(`fixture: ${reader.name} was given no ByteReader`);
  const r = args[at] as ByteReader;
  const hex = toHex(r.buf.subarray(r.pos));
  let resources: Record<string, string> | undefined;
  const call = args.map((a, i) => {
    if (i <= at) return a;
    // One lookup at most, and nothing else: the case's "resources" can't stand for more
    if (typeof a !== "function" || resources) throw new Error(`fixture: ${reader.name} takes more after the ByteReader than one lookup`);
    resources = {};
    const found = resources;
    return (id: number) => {
      const v = (a as (id: number) => unknown)(id);
      // What it found, "" included; an id it doesn't know (undefined or null) stays out
      if (typeof v === "string") found[id] = v;
      return v;
    };
  }) as A;
  const result = reader(...call);

  const state = expect.getState();
  const test = state.currentTestName ?? "";
  const n = (perTest.get(test) ?? 0) + 1;
  perTest.set(test, n);
  const c: ReaderCase = {
    name: n === 1 ? test : `${test} (${n})`,
    message: where.message,
    code: where.code,
    reader: reader.name,
    source: where.source,
    args: toPlain(args.slice(0, at)) as unknown[],
    hex,
    ...(resources ? { resources: Object.fromEntries(Object.entries(resources).sort(([a], [b]) => Number(a) - Number(b))) } : {}),
    result: toPlain(result),
  };

  const out = process.env.SHARDS_FIXTURES_OUT;
  if (out) {
    const file = path.relative(ROOT, state.testPath ?? "").replaceAll("\\", "/");
    fs.appendFileSync(path.join(out, `${process.pid}-${threadId}.jsonl`), JSON.stringify({ file, seq: seq++, case: c }) + "\n");
  } else {
    const was = committedCase(c.name);
    if (!was) throw new Error(`${FIXTURES_FILE} has no case "${c.name}": run npm run fixtures`);
    expect(c, `${FIXTURES_FILE} is out of date for "${c.name}": run npm run fixtures`).toEqual(was);
  }
  return result;
}
