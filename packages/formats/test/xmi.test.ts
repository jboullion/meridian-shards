// XMI to MIDI (xmi.ts): a small XMI made here, and the game's own tracks when the server's
// resource tree is linked (server/src, never in git).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { xmiToMidi } from "../src/index.ts";

const XMI = join(import.meta.dirname, "../../../server/src/resource/audio/xmi");

/** An IFF chunk: id, big-endian size, data (padded to even) */
function chunk(id: string, data: number[]): number[] {
  const n = data.length;
  return [...id].map((c) => c.charCodeAt(0)).concat([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff], data, n & 1 ? [0] : []);
}

/** The track's events after its tempo: [delta, ...bytes] */
function events(midi: Uint8Array): number[] {
  const track = [...midi.subarray(14 + 8)];
  return track.slice(7); // 00 FF 51 03 tt tt tt
}

describe("xmiToMidi", () => {
  test("a note-on's duration becomes a note-off, and delta bytes add up", () => {
    // program 46 at 0; 120+60 ticks later, a note-on lasting 120 ticks (VLQ 00 78); end
    const evnt = [0xc0, 46, 120, 60, 0x90, 64, 100, 0x78, 0xff, 0x2f, 0x00];
    const xmi = new Uint8Array(chunk("FORM", [...[..."XMID"].map((c) => c.charCodeAt(0)), ...chunk("EVNT", evnt)]));
    const { midi, seconds } = xmiToMidi(xmi);
    expect(String.fromCharCode(...midi.subarray(0, 4))).toBe("MThd");
    // 180 ticks is the VLQ 81 34; the note-off follows 120 (78) ticks later, and the song runs to it
    expect(events(midi)).toEqual([0, 0xc0, 46, 0x81, 0x34, 0x90, 64, 100, 0x78, 0x80, 64, 0, 0, 0xff, 0x2f, 0]);
    expect(seconds).toBeCloseTo(2.5);
  });

  test("tempo events are dropped (AIL plays at 120 ticks a second)", () => {
    const evnt = [0xff, 0x51, 3, 0x0f, 0x42, 0x40, 0x90, 60, 90, 60, 0xff, 0x2f, 0];
    const { midi } = xmiToMidi(new Uint8Array(chunk("EVNT", evnt)));
    expect(events(midi)).toEqual([0, 0x90, 60, 90, 60, 0x80, 60, 0, 0, 0xff, 0x2f, 0]);
  });

  test("not an XMI", () => {
    expect(() => xmiToMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/EVNT/);
  });

  describe.skipIf(!existsSync(XMI))("the game's tracks", () => {
    test("every one converts, with the length of its recording", () => {
      const files = readdirSync(XMI).filter((f) => f.toLowerCase().endsWith(".xmi"));
      expect(files.length).toBeGreaterThan(60);
      for (const f of files) expect(xmiToMidi(new Uint8Array(readFileSync(join(XMI, f)))).seconds).toBeGreaterThan(5);
      // castle.ogg runs 201 s, its reverb's tail included
      expect(xmiToMidi(new Uint8Array(readFileSync(join(XMI, "Castle.xmi")))).seconds).toBeCloseTo(197.9, 0);
    });
  });
});
