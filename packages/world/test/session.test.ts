import { afterEach, describe, expect, test, vi } from "vitest";
import { GameSession } from "../src/index.ts";

/** A socket that opens (or not) and says only what the test makes it say */
class FakeSocket {
  binaryType = "arraybuffer";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  send(): void {}
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
}

const make = () => {
  const ws = new FakeSocket();
  const errors: string[] = [];
  const s = new GameSession(
    { url: "ws://x", username: "a", password: "b", lookupResource: () => undefined, createSocket: () => ws as unknown as WebSocket },
    { error: (e) => errors.push(e) },
  );
  return { s, ws, errors };
};

describe("logging in doesn't wait forever", () => {
  afterEach(() => vi.useRealTimers());

  test("a socket that never opens gives up and says so", () => {
    vi.useFakeTimers();
    const { s, ws, errors } = make();
    vi.advanceTimersByTime(15_001);
    expect(errors[0]).toMatch(/Can't reach the server/);
    expect(s.phase).toBe("closed");
    expect(ws.closed).toBe(true);
  });

  test("a server that accepts and then says nothing (hung) gives up and lets go", () => {
    vi.useFakeTimers();
    const { s, ws, errors } = make();
    vi.advanceTimersByTime(1000);
    ws.open();
    vi.advanceTimersByTime(14_000);
    expect(errors).toEqual([]);
    vi.advanceTimersByTime(1_001);
    expect(errors).toEqual(["The server isn't answering. It may be starting up or busy: try again in a few minutes."]);
    expect(s.phase).toBe("closed");
    expect(ws.closed).toBe(true);
  });

  test("a server that answers but never gets us to the character list gives up too; closing ourselves stops the timers", () => {
    vi.useFakeTimers();
    const { ws, errors } = make();
    ws.open();
    // Any word from the server: not hung (the bytes needn't make sense here)
    ws.onmessage?.({ data: new Uint8Array([0]).buffer });
    vi.advanceTimersByTime(44_000);
    expect(errors.filter((e) => /taking too long/.test(e))).toEqual([]);
    vi.advanceTimersByTime(1_001);
    expect(errors.some((e) => /taking too long/.test(e))).toBe(true);

    const other = make();
    other.ws.open();
    other.s.close();
    vi.advanceTimersByTime(60_000);
    expect(other.errors).toEqual([]);
  });
});
