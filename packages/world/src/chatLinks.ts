// Ours (ADR 0024): item links in player chat. A link travels inside the said text as a plain
// ASCII token, {i:<file>:<translation>:<magic bits>|<name>}, which the server passes through like
// any other text, and our clients draw as the item's inventory icon and "[name]". The original
// client shows the token as typed. A link is only a picture and a name: anyone can type one.

import { MAGIC_FLAGS_MASK } from "./magic.ts";
import type { ChatItemLink, TextSpan } from "./text.ts";

const LINK = /\{i:([A-Za-z0-9_-]{1,32}):(\d{1,3}):([0-9a-f]{1,2})\|([^{}|]{1,80})\}/g;

/** The magic flag bits start here; the token carries them shifted down, in hex */
const MAGIC_SHIFT = 20;

/** Characters a linked name can't carry: the token's own, and the ~/` style codes */
const NAME_UNSAFE = /[{}|~`]/g;

/** An item's link token, or null when its picture isn't a .bgf file */
export function chatLinkToken(icon: string, translation: number, flags: number, name: string): string | null {
  const m = /^([A-Za-z0-9_-]{1,32})\.bgf$/i.exec(icon);
  if (!m) return null;
  const clean = name.replace(NAME_UNSAFE, "").trim().slice(0, 80);
  if (!clean) return null;
  const magic = ((flags & MAGIC_FLAGS_MASK) >>> MAGIC_SHIFT).toString(16);
  return `{i:${m[1].toLowerCase()}:${translation & 0xff}:${magic}|${clean}}`;
}

/** What a link shows as text, in the chat input and anywhere icons aren't drawn */
export const chatLinkLabel = (name: string): string => `[${name.replace(NAME_UNSAFE, "").trim().slice(0, 80)}]`;

/** Split item link tokens out of styled spans: each becomes its own span with `item` set. */
export function splitChatLinks(spans: TextSpan[]): TextSpan[] {
  if (!spans.some((s) => s.text.includes("{i:"))) return spans;
  const out: TextSpan[] = [];
  for (const span of spans) {
    if (!span.text.includes("{i:")) {
      out.push(span);
      continue;
    }
    let at = 0;
    for (const m of span.text.matchAll(LINK)) {
      const start = m.index;
      if (start > at) out.push({ ...span, text: span.text.slice(at, start) });
      const item: ChatItemLink = {
        file: m[1].toLowerCase(),
        translation: Number(m[2]) & 0xff,
        flags: (parseInt(m[3], 16) << MAGIC_SHIFT) & MAGIC_FLAGS_MASK,
        name: m[4].trim(),
      };
      out.push({ ...span, text: `[${item.name}]`, item });
      at = start + m[0].length;
    }
    if (at < span.text.length) out.push({ ...span, text: span.text.slice(at) });
  }
  return out;
}
