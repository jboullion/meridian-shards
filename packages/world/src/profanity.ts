// The profanity filter (clientd3d/profane.c). Each term becomes a pattern that takes every
// letter as a run of look-alikes ("[Ss$]+") with colour codes, spaces and punctuation
// allowed between them, so "h e-c~rk" still matches "heck". A match counts only if it
// looks deliberate (VerifyProfaneUsage). Incoming text either loses the message
// (IDS_PROFANITYREMOVED) or has each curse replaced by symbols (CleanseProfaneString), and
// outgoing speech with one is blocked (say.c FilterSayMessage). The terms come from
// profane.dat, each line XORed with 5 (LoadProfaneTerms).
//
// The patterns are profane.c's, from GNU-style syntax ("\(...\)*") to JavaScript's; both
// engines search leftmost-first with greedy repeats.

/** profane.h MAXPROFANETERM: letters in a term */
export const MAX_PROFANE_TERM = 20;

/** _szPrefix, _szPostfix: colour codes around the term (left off with the extra search) */
const AFFIX = "(?:[`~][rgbBIUn])*";
/** _szGrout: colour codes or anything but letters, digits and '"' between the letters */
const GROUT = '(?:[`~][rgbBIUn]|[^a-zA-Z0-9"])*';
/** _szAlpha: each letter and the characters that pass for it in the text window's font */
const ALPHA = [
  "[Aa@^]+", "[Bb]+", "[Cc]+", "[Dd]+", "[Ee]+", "[Ff]+", "[Gg]+", "[Hh]+", "[Ii1|!]+", "[Jj]+", "[Kk]+", "[Ll1|!]+", "[Mm]+",
  "[Nn]+", "[Oo0@]+", "[Pp]+", "[Qq]+", "[Rr]+", "[Ss$]+", "[Tt]+", "[UuVv]+", "[VvUu]+", "[Ww]+", "[Xx]+", "[Yy]+", "[Zz2]+",
];
/** _szWith: the symbols a curse turns into, a different string for each term in turn */
const WITH = ["!#@*%", "@+$&!", "*!%#@", "&@!+$", "%#!@*", "!+@$&", "@*%!#", "$&!@+"];

/** client.rc IDS_PROFANITYREMOVED: what an ignored message shows instead */
export const PROFANITY_REMOVED = "~r< ~Iprofane message blocked~I >";
/** client.rc IDS_PROFANITYWARNING: why outgoing speech wasn't sent */
export const PROFANITY_WARNING =
  "The message was blocked.\n\nIt used language listed as profanity.  Review your profanity filter options and/or reconsider your message.";

const isAlpha = (ch: string | undefined) => ch !== undefined && /^[A-Za-z]$/.test(ch);

/** AddProfaneTerm / RemoveProfaneTerm: a term is its letters, lower case */
export function normalizeTerm(term: string): string {
  let out = "";
  for (const ch of term) if (isAlpha(ch)) out += ch.toLowerCase();
  return out.slice(0, MAX_PROFANE_TERM);
}

/** CompileProfaneExpression: the term's pattern */
export function termPattern(term: string, extra: boolean): string {
  let p = extra ? "" : AFFIX;
  for (let i = 0; i < term.length; i++) {
    const n = term.charCodeAt(i) - 97;
    if (n >= 0 && n < 26) p += ALPHA[n];
    if (i + 1 < term.length) p += GROUT;
  }
  return extra ? p : p + AFFIX;
}

/**
 * VerifyProfaneUsage: is the match from..to (exclusive) in `s` a deliberate curse? Always
 * with the extra search; otherwise when it stands as a word (start and end at the string's
 * edges, colour codes or non-letters), isn't broken up by spaces or punctuation, or uses
 * characters above 127.
 */
export function verifyProfaneUsage(s: string, from: number, to: number, extra: boolean): boolean {
  if (!s) return false;
  if (extra) return true;
  let start = from === 0;
  let end = to >= s.length;
  if (s[from] === "~" || s[from] === "`") start = true;
  if (to >= 2 && (s[to - 2] === "~" || s[to - 2] === "`")) end = true;
  if (from >= 1 && !isAlpha(s[from - 1])) start = true;
  if (!isAlpha(s[to])) end = true;
  if (start && end) return true;
  let broken = false;
  for (let p = from; p < s.length && p < to; p++) {
    while ((s[p] === "~" || s[p] === "`") && p + 1 < s.length && p < to) p += 2;
    if (p >= s.length || p >= to) break;
    if (!isAlpha(s[p])) broken = true;
  }
  if (!broken) return true;
  for (let p = from; p < s.length && p < to; p++) if (s.charCodeAt(p) & 0x80) return true;
  return false;
}

export class ProfanityFilter {
  /** The terms in their slots; a removed term leaves a hole the next one fills (_apExpressions) */
  private readonly slots: (string | null)[] = [];
  private readonly compiled = new Map<string, RegExp>();
  /** _nWith: which symbols the next term gets, carried on between messages */
  private withIndex = 0;

  /** The terms, in order */
  get terms(): string[] {
    return this.slots.filter((t): t is string => t !== null);
  }

  /** LoadProfaneTerms: profane.dat's lines ("+term" adds, "-term" removes, ";" comments, the rest XORed with 5) */
  load(dat: string): void {
    for (const raw of dat.split(/\r?\n/)) {
      const line = raw.replace(/\r/g, "").replace(/^[ \t]+/, "");
      if (!line) continue;
      if (line[0] === "+") this.add(line.slice(1));
      else if (line[0] === "-") this.remove(line.slice(1));
      else if (line[0] !== ";") this.add([...line].map((c) => String.fromCharCode(c.charCodeAt(0) ^ 5)).join(""));
    }
  }

  /** AddProfaneTerm: false if it has no letters */
  add(term: string): boolean {
    const t = normalizeTerm(term);
    if (!t) return false;
    this.remove(t);
    const hole = this.slots.indexOf(null);
    if (hole >= 0) this.slots[hole] = t;
    else this.slots.push(t);
    return true;
  }

  /** RemoveProfaneTerm */
  remove(term: string): void {
    const t = normalizeTerm(term);
    if (!t) return;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i] === t) this.slots[i] = null;
  }

  private regex(term: string, extra: boolean): RegExp {
    const key = `${extra ? 1 : 0}${term}`;
    let re = this.compiled.get(key);
    if (!re) {
      re = new RegExp(termPattern(term, extra), "g");
      this.compiled.set(key, re);
    }
    return re;
  }

  /** ContainsProfaneTerms: the first term found decides (verified or not) */
  contains(text: string, extra: boolean): boolean {
    for (const t of this.terms) {
      const re = this.regex(t, extra);
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m) return verifyProfaneUsage(text, m.index, m.index + m[0].length, extra);
    }
    return false;
  }

  /** CleanseProfaneString: each term in turn, every deliberate match replaced by that term's symbols (re_replace_all) */
  cleanse(text: string, extra: boolean): string {
    let s = text;
    for (const t of this.terms) {
      this.withIndex = (this.withIndex + 1) % WITH.length;
      const sym = WITH[this.withIndex];
      const re = this.regex(t, extra);
      let out = "";
      let prev = 0;
      re.lastIndex = 0;
      for (let m = re.exec(s); m; m = re.exec(s)) {
        const end = m.index + m[0].length;
        out += s.slice(prev, m.index) + (verifyProfaneUsage(s, m.index, end, extra) ? sym : m[0]);
        prev = end;
        re.lastIndex = end;
      }
      s = out + s.slice(prev);
    }
    return s;
  }

  /** srvrstr.c: incoming text with the filter on, either gone (ignore) or with its curses obscured */
  filterIncoming(text: string, ignore: boolean, extra: boolean): string {
    if (ignore) return this.contains(text, extra) ? PROFANITY_REMOVED : text;
    return this.cleanse(text, extra);
  }
}
