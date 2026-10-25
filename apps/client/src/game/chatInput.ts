// Ours (ADR 0024): the chat input's side of emoji and item links. Links show in the input as
// "[name]" and become their tokens ({i:...}, @shards/world chatLinks.ts) when the line is sent.
// Speech goes as UTF-8, and the server drops a line longer than user.kod MAX_CHAT_LEN bytes.

/** blakston.khd MAX_CHAT_LEN: user.kod drops (doesn't cut) a say longer than this, in bytes */
export const MAX_CHAT_BYTES = 550;

const encoder = new TextEncoder();

/** How many bytes the server will count */
export const utf8Length = (s: string): number => encoder.encode(s).length;

/** Each linked "[name]" still in the line, swapped for its token */
export function expandChatLinks(line: string, links: ReadonlyMap<string, string>): string {
  let out = line;
  for (const [label, token] of links) if (out.includes(label)) out = out.split(label).join(token);
  return out;
}

/**
 * `insert` put at the caret (or over the selection), or at the end with no caret; returns the
 * new text and where the caret goes. A link gets a space either side of it.
 */
export function insertAt(text: string, insert: string, start: number | null, end: number | null): { text: string; caret: number } {
  const a = Math.max(0, Math.min(text.length, start ?? text.length));
  const b = Math.max(a, Math.min(text.length, end ?? a));
  const link = insert.startsWith("[");
  const lead = link && a > 0 && !/\s$/.test(text.slice(0, a)) ? " " : "";
  const trail = link && !/^\s/.test(text.slice(b)) ? " " : "";
  const next = text.slice(0, a) + lead + insert + trail + text.slice(b);
  return { text: next, caret: a + lead.length + insert.length + trail.length };
}
