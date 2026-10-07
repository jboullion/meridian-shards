import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ByteReader, ByteWriter } from "@shards/protocol";
import { parseRoo } from "@shards/formats";
import { PlayerMover } from "../src/movement.ts";
import { formatServerMessage, parseMarkup } from "../src/text.ts";

const ASSETS = join(import.meta.dirname, "../../../dist/assets");
const have = existsSync(join(ASSETS, "raza.roo"));
const sq = (v: number) => (v - 1) * 1024; // 1-based square (with fraction) to client fine

describe.skipIf(!have)("movement (move.c) in Raza", () => {
  function mover() {
    const sent: { move: [number, number, number][]; turn: number[] } = { move: [], turn: [] };
    const m = new PlayerMover({ move: (x, y, s) => sent.move.push([x, y, s]), turn: (a) => sent.turn.push(a) });
    m.room = parseRoo(new Uint8Array(readFileSync(join(ASSETS, "raza.roo"))));
    return { m, sent };
  }
  const walk = (m: PlayerMover, ms: number, angle: number, t0 = 1000) => {
    m.angle = angle;
    let t = t0;
    for (let i = 0; i < ms / 16; i++) {
      t += 16;
      m.update({ forward: 1, strafe: 0, run: false }, 16, t, [], 0);
    }
    return t;
  };

  test("walls stop you: the ledge north of the town square", () => {
    const { m } = mover();
    m.place(sq(41.5), sq(4.5), 0);
    walk(m, 3000, 3072); // north
    expect(m.y / 1024 + 1).toBeGreaterThan(3.2); // stopped by the ledge at row 3.13
    expect(m.y / 1024 + 1).toBeLessThan(3.6);
  });

  test("walking speed is MOVEUNITS per 85 ms (~2.9 squares/s) and the server hears every 250 ms", () => {
    const { m, sent } = mover();
    m.place(sq(41.5), sq(23.5), 0);
    walk(m, 1000, 1024); // south, open square
    const moved = Math.hypot(m.x - sq(41.5), m.y - sq(23.5)) / 1024;
    expect(moved).toBeGreaterThan(2.5);
    expect(moved).toBeLessThan(3.2);
    expect(sent.move.length).toBeGreaterThanOrEqual(3);
    expect(sent.move.length).toBeLessThanOrEqual(5);
    expect(sent.turn).toEqual([1024]);
  });

  test("leaving the map asks the server (edge exit) without moving", () => {
    const { m, sent } = mover();
    m.place(sq(38.9), sq(1.3), 0);
    walk(m, 1500, 3072);
    expect(m.y).toBeGreaterThan(0);
    expect(sent.move.some(([, y]) => y <= 0)).toBe(true);
  });
});

describe("server text (srvrstr.c)", () => {
  const rsc = new Map<number, string>([
    [1, "%s says, \"%q\""],
    [2, "~BMarcus~n"],
    [3, "You have %i shillings and %r."],
    [4, "a %s"],
    [5, "mace"],
    [6, "100%% sure"],
  ]);
  const lookup = (id: number) => rsc.get(id);
  test("%s expands resources, %q inserts literal strings", () => {
    const r = new ByteReader(new ByteWriter().u32(2).string("Hail, %s!").finish());
    expect(formatServerMessage(1, r, lookup)).toBe('~BMarcus~n says, "Hail, %s!"');
  });
  test("%i and nested %r messages; %%", () => {
    const r = new ByteReader(new ByteWriter().i32(42).u32(4).u32(5).finish());
    expect(formatServerMessage(3, r, lookup)).toBe("You have 42 shillings and a mace.");
    expect(formatServerMessage(6, new ByteReader(new Uint8Array()), lookup)).toBe("100% sure");
  });
  test("~ codes become spans", () => {
    const spans = parseMarkup("~BMarcus~n says ~rhi", "white");
    expect(spans).toEqual([
      { text: "Marcus", color: "white", bold: true, italic: false, underline: false },
      { text: " says ", color: "white", bold: false, italic: false, underline: false },
      { text: "hi", color: "rgb(128,0,0)", bold: false, italic: false, underline: false },
    ]);
  });
});
