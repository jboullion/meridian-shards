import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BP, ByteReader, Connection, FrameDecoder, RandomStreams, ServerToken, buildReqMove, crc32, encodeFrame, md5,
  passwordDigest, readMove,
} from "../src/index.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("md5 matches RFC 1321 vectors", () => {
  assert.equal(hex(md5(new Uint8Array())), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(hex(md5(new TextEncoder().encode("abc"))), "900150983cd24fb0d6963f7d28e17f72");
  const long = new TextEncoder().encode("12345678901234567890123456789012345678901234567890123456789012345678901234567890");
  assert.equal(hex(md5(long)), "57edf4a22be3c955ac49da2e2107b67a");
});

test("password digest replaces 0x00 bytes with 0x01", () => {
  for (const pw of ["shardbot", "a", "password123", "x".repeat(40)]) {
    const d = passwordDigest(pw);
    assert.equal(d.length, 16);
    assert.ok(!d.includes(0));
  }
});

test("LCG streams match a BigInt reference of the C code", () => {
  const seeds = [3583632400, 123456789, 4000000000, 2147483647, 1];
  const rs = new RandomStreams();
  rs.init(seeds);
  const ref = seeds.map(BigInt);
  for (let n = 0; n < 1000; n++) {
    for (let i = 0; i < 5; i++) ref[i] = ((ref[i] * 9301n + 49297n) & 0xffffffffn) % 233280n;
    const expect = Number(ref[Number(ref[4] % 4n)]);
    assert.equal(rs.step(), expect);
  }
});

test("security word sign-extends type bytes >= 0x80", () => {
  const a = new RandomStreams();
  const b = new RandomStreams();
  a.init([1, 2, 3, 4, 5]);
  b.init([1, 2, 3, 4, 5]);
  const body = Uint8Array.of(155, 1, 2);
  const w = a.securityFor(body);
  // Recompute by hand: (WORD)(signed char)155 = 0xff9b
  const r = b.step() & 0xffff;
  const expect = (r ^ 3 ^ ((0xff9b << 4) & 0xffff) ^ (crc32(body) & 0xffff)) & 0xffff;
  assert.equal(w, expect);
});

test("redbook token: echo resets, then slides through the string", () => {
  const t = new ServerToken();
  t.lookup = (id) => (id === 7 ? "Ab" : undefined);
  // before any echo the token is 0
  const p0 = Uint8Array.of(BP.ECHO_PING);
  t.desecure(p0);
  assert.equal(p0[0], BP.ECHO_PING);
  t.onEchoPing(10 ^ 0xed, 7); // token 10, redbook "Ab"
  const seq = [BP.PLAYER, BP.MOVE, BP.SAID, BP.CREATE];
  const tokens = [10, 10 + 65, 10 + 65 + 98, 10 + 65 + 98 + 65];
  for (let i = 0; i < seq.length; i++) {
    const pkt = Uint8Array.of(seq[i] ^ (tokens[i] & 0xff));
    t.desecure(pkt);
    assert.equal(pkt[0], seq[i]);
  }
});

test("frames round-trip through the decoder in arbitrary chunks", () => {
  const bodies = [Uint8Array.of(1), buildReqMove(600, 480, 25, 2569), new Uint8Array(3000).fill(7)];
  const wire = Buffer.concat(bodies.map((b, i) => encodeFrame(b, 0x1234, i)));
  const dec = new FrameDecoder();
  const got: Uint8Array[] = [];
  for (let i = 0; i < wire.length; i += 5) {
    dec.push(wire.subarray(i, i + 5));
    for (let f = dec.next(); f; f = dec.next()) got.push(f.body);
  }
  assert.deepEqual(got.map(hex), bodies.map(hex));
});

test("move message layout: row first, Kod fine units", () => {
  const b = buildReqMove(600, 480, 25, 2569);
  const r = new ByteReader(b);
  assert.equal(r.u8(), BP.REQ_MOVE);
  assert.equal(r.u16(), 600);
  assert.equal(r.u16(), 480);
  assert.equal(r.u8(), 25);
  assert.equal(r.u32(), 2569);
});

test("BP_MOVE parse splits the turn-to-face bit", () => {
  const body = Uint8Array.of(1, 2, 0, 0, 100, 0, 200, 0, 0x80 | 25);
  const m = readMove(new ByteReader(body));
  assert.deepEqual(m, { id: 513, kodRow: 100, kodCol: 200, speed: 25, turnToFace: true });
});

test("connection: login messages are framed with crc 0 and epoch 0; game ones carry the epoch", () => {
  const sent: Uint8Array[] = [];
  const conn = new Connection((b) => sent.push(b));
  conn.start();
  conn.sendLogin(Uint8Array.of(1));
  assert.equal(hex(sent[0]), "01000000010000" + "01");
  // AP_GETCHOICE then AP_GAME, server epoch 9
  const seeds = new Uint8Array(21);
  seeds[0] = 22;
  conn.receive(encodeFrame(seeds, 0, 9));
  conn.receive(encodeFrame(Uint8Array.of(25), 0, 9));
  assert.equal(conn.state, "game");
  conn.sendGame(Uint8Array.of(BP.PING));
  assert.equal(sent[1][6], 9);
  conn.close();
});
