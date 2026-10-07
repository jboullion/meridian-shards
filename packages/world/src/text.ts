// Server text: printf-style resources filled from message parameters
// (clientd3d/srvrstr.c CheckServerMessage, CheckMessageOrder) and the ~/` colour
// and style codes (DisplayMessage).
//
// Format characters:
//   %d %i  an integer parameter
//   %s     an integer naming a string resource; that string may contain more format
//          characters, whose parameters come *after* all of this pass's parameters
//          (the C code formats in passes)
//   %q     a literal string parameter (inserted as-is, never re-scanned)
//   %r     a nested message: a resource id followed by its own parameters
//   %%     a percent sign
//   %X$N   numbered parameter (reordering); $0 hides the field

import type { ByteReader } from "@shards/protocol";

type Seg = { raw: boolean; s: string };

/** Fill a resource with parameters read from `r`. Returns null if the resource is unknown. */
export function formatServerMessage(
  fmtId: number,
  r: ByteReader,
  lookup: (id: number) => string | undefined,
  depth = 0,
): string | null {
  const fmt = lookup(fmtId);
  if (fmt === undefined) return null;
  if (!fmt.includes("%") || depth > 8) return fmt;
  if (/%[a-z]\$\d/.test(fmt)) reorderParams(fmt, r);

  let segs: Seg[] = [{ raw: true, s: fmt }];
  for (let pass = 0; pass < 16 && segs.some((x) => x.raw); pass++) {
    const next: Seg[] = [];
    for (const seg of segs) {
      if (!seg.raw) {
        next.push(seg);
        continue;
      }
      const s = seg.s;
      let i = 0;
      let lit = "";
      while (i < s.length) {
        const p = s.indexOf("%", i);
        if (p < 0 || p === s.length - 1) {
          lit += s.slice(i);
          break;
        }
        lit += s.slice(i, p);
        const c = s[p + 1];
        i = p + 2;
        // "$N" suffix: $0 hides the field (its parameter is still consumed)
        let hide = false;
        if (s[i] === "$") {
          hide = s[i + 1] === "0";
          i += 2;
          if (s[i] >= "0" && s[i] <= "9") i++;
        }
        switch (c) {
          case "%":
            lit += "%";
            break;
          case "d":
          case "i": {
            const v = r.remaining >= 4 ? r.i32() : 0;
            if (!hide) lit += String(v);
            break;
          }
          case "s": {
            const id = r.remaining >= 4 ? r.u32() : 0;
            if (!hide) {
              next.push({ raw: false, s: lit });
              lit = "";
              next.push({ raw: true, s: lookup(id) ?? "" });
            }
            break;
          }
          case "q": {
            const v = r.remaining >= 2 ? r.string() : "";
            if (!hide) lit += v;
            break;
          }
          case "r": {
            const id = r.remaining >= 4 ? r.u32() : 0;
            const v = formatServerMessage(id, r, lookup, depth + 1) ?? "";
            if (!hide) lit += v;
            break;
          }
          default:
            // " %", "%." and friends stay as text
            lit += "%" + c;
        }
      }
      next.push({ raw: false, s: lit });
    }
    segs = next;
  }
  return segs.map((x) => x.s).join("");
}

/**
 * CheckMessageOrder: when a resource numbers its fields (%s$2 %i$1), the server
 * sends parameters in field-number order; put them back in format order. Only
 * fixed-size fields (%d %i %s) and %q strings are supported here, as in practice.
 */
function reorderParams(fmt: string, r: ByteReader): void {
  const fields: { pos: number; type: string }[] = [];
  const re = /%([dsiqr])(?:\$(\d+))?/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(fmt))) {
    if (m[1] === "r") return; // nested messages: leave as sent
    const num = m[2] === undefined ? n : Math.max(0, Number(m[2]) - 1) || n;
    fields.push({ pos: num, type: m[1] });
    n++;
  }
  // Read the parameters as sent (in field-number order) and rewrite them in format order.
  const start = r.pos;
  const byNumber = [...fields].sort((a, b) => a.pos - b.pos);
  const chunks = new Map<number, Uint8Array>();
  for (const f of byNumber) {
    const p = r.pos;
    if (f.type === "q") r.string();
    else r.u32();
    chunks.set(f.pos, r.buf.slice(p, r.pos));
  }
  let w = start;
  for (const f of fields) {
    const c = chunks.get(f.pos)!;
    r.buf.set(c, w);
    w += c.length;
  }
  r.pos = start;
}

export interface TextSpan {
  text: string;
  /** CSS colour, or undefined for the line's default */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** ~/` codes (srvrstr.c code_table). */
const COLORS: Record<string, string> = {
  r: "rgb(128,0,0)", f: "rgb(200,0,0)", g: "rgb(0,100,0)", l: "rgb(0,255,0)", b: "rgb(0,0,255)",
  k: "rgb(0,0,0)", w: "rgb(255,255,255)", y: "rgb(230,230,25)", p: "rgb(255,105,210)", o: "rgb(255,150,0)",
  a: "rgb(127,255,212)", c: "rgb(46,234,250)", q: "rgb(143,38,170)", t: "rgb(11,59,112)", s: "rgb(60,60,60)",
  v: "rgb(128,0,128)", m: "rgb(205,0,205)",
};

/** Split a message into styled spans (srvrstr.c DisplayMessage). */
export function parseMarkup(message: string, startColor?: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let color = startColor,
    bold = false,
    italic = false,
    underline = false;
  let text = "";
  const flush = () => {
    if (text) spans.push({ text, color, bold, italic, underline });
    text = "";
  };
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    const code = message[i + 1];
    if ((ch === "~" || ch === "`") && code !== undefined) {
      if (code in COLORS) {
        flush();
        color = COLORS[code];
        i++;
        continue;
      }
      if (code === "B" || code === "I" || code === "U" || code === "n") {
        flush();
        if (code === "B") bold = !bold;
        else if (code === "I") italic = !italic;
        else if (code === "U") underline = !underline;
        else {
          bold = italic = underline = false;
          color = startColor;
        }
        i++;
        continue;
      }
    }
    text += ch;
  }
  flush();
  return spans;
}
