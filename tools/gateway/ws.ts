// Minimal RFC 6455 WebSocket server side: handshake, binary frames, ping/pong,
// close, fragmentation. Enough for a byte-for-byte TCP bridge with no npm
// dependencies. (We can switch to the `ws` package later without changing callers.)

import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 1 << 20;

export interface WsConnection {
  sendBinary(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onMessage: (data: Uint8Array) => void;
  onClose: () => void;
}

/** Complete the upgrade handshake. Returns null (and rejects) if the request isn't a valid WS upgrade. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): WsConnection | null {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  const lines = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
  ];
  const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((s) => s.trim());
  if (protocols.includes("binary")) lines.push("Sec-WebSocket-Protocol: binary");
  socket.write(lines.join("\r\n") + "\r\n\r\n");

  let buf: Buffer = head.length ? Buffer.from(head) : Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let fragmentSize = 0;
  let closed = false;

  const conn: WsConnection = {
    onMessage: () => {},
    onClose: () => {},
    sendBinary(data) {
      if (!closed) socket.write(frame(0x2, data));
    },
    close(code = 1000, reason = "") {
      if (closed) return;
      closed = true;
      const r = Buffer.from(reason);
      const p = Buffer.alloc(2 + r.length);
      p.writeUInt16BE(code, 0);
      r.copy(p, 2);
      socket.end(frame(0x8, p));
      conn.onClose();
    },
  };

  const fail = (code: number) => conn.close(code);

  socket.on("data", (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return fail(1009);
        len = Number(big);
        off = 10;
      }
      if (!masked) return fail(1002); // clients must mask
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);

      if (opcode === 0x8) {
        if (!closed) {
          closed = true;
          socket.end(frame(0x8, payload.subarray(0, 2)));
          conn.onClose();
        }
        return;
      } else if (opcode === 0x9) {
        socket.write(frame(0xa, payload));
      } else if (opcode === 0xa) {
        // pong: ignore
      } else if (opcode === 0x1) {
        return fail(1003); // text not supported; the protocol is binary
      } else if (opcode === 0x2 || opcode === 0x0) {
        fragments.push(payload);
        fragmentSize += payload.length;
        if (fragmentSize > MAX_MESSAGE) return fail(1009);
        if (fin) {
          const msg = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments);
          fragments = [];
          fragmentSize = 0;
          conn.onMessage(msg);
        }
      } else {
        return fail(1002);
      }
    }
  });
  const onEnd = () => {
    if (!closed) {
      closed = true;
      conn.onClose();
    }
  };
  socket.on("close", onEnd);
  socket.on("error", onEnd);
  return conn;
}

function frame(opcode: number, payload: Uint8Array): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}
