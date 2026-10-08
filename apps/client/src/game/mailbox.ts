// The mailbox (module/mailnews mailfile.c). The server hands each new message over once
// (BP_MAIL) and forgets it when we say we have it (BP_DELETE_MAIL); the original keeps it as
// a file in its mail folder. We keep ours in the browser's storage, one mailbox per server
// and character, and tell the server only once it's saved.

/** A kept message (mailfile.c MailNewMessage's file, as fields). */
export interface MailMessage {
  /** Ours, one more than the highest kept (mailfile.c msgnum) */
  num: number;
  sender: string;
  recipients: string[];
  subject: string;
  /** When it was sent, in Kod's time (serverDate shows it) */
  time: number;
  body: string;
}

/** Where a mailbox is kept: localStorage-like (tests pass a Map). */
export interface MailStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storageKey = (server: string, character: string) => `shards.mail.${server}.${character.toLowerCase()}`;

export function loadMailbox(store: MailStore, server: string, character: string): MailMessage[] {
  try {
    const raw = store.getItem(storageKey(server, character));
    const list = raw ? (JSON.parse(raw) as MailMessage[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Saves the mailbox; false if it couldn't be (the server then keeps the message). */
export function saveMailbox(store: MailStore, server: string, character: string, list: MailMessage[]): boolean {
  try {
    store.setItem(storageKey(server, character), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const SUBJECT_ENGLISH = "Subject: ";
const SUBJECT_GERMAN = "Betreff: ";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number, w: number) => String(n).padStart(w, "0");

/**
 * Kod's time (blakserv ccode.c C_GetTime: Unix time less 1760000000, October 2025) as
 * mailnews.c DateFromSeconds shows it: "Wed Oct 08, 2026 14:05", local time. (The client
 * source still adds the older base, 211458440 + 1388534400, so the original shows
 * mail and news dates about five years early against this server.)
 */
export const KOD_TIME_BASE = 1760000000;

export function serverDate(time: number): string {
  const d = new Date((time + KOD_TIME_BASE) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${pad(d.getDate(), 2)}, ${pad(d.getFullYear(), 4)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
}

/**
 * mailfile.c MailNewMessage: the subject is the text's first line when it starts with
 * "Subject: " (or the German "Betreff: "); the rest is the body.
 */
export function newMailMessage(num: number, sender: string, recipients: string[], text: string, time: number): MailMessage {
  let subject = "";
  let body = text;
  for (const lead of [SUBJECT_ENGLISH, SUBJECT_GERMAN]) {
    if (!text.startsWith(lead)) continue;
    const rest = text.slice(lead.length);
    const nl = rest.indexOf("\n");
    subject = (nl < 0 ? rest : rest.slice(0, nl)).replace(/\r$/, "");
    body = nl < 0 ? "" : rest.slice(nl + 1);
    break;
  }
  return { num, sender, recipients, subject, time, body: body.replace(/\r\n/g, "\n") };
}

/** The message as the original's file shows it (From, To, Subject, Date, a line, the text). */
export function mailText(m: MailMessage): string {
  const date = serverDate(m.time);
  return `From: ${m.sender}\nTo: ${m.recipients.join(", ")}\nSubject: ${m.subject}\n${date ? `Date: ${date}` : ""}\n-------------\n${m.body}`;
}

/** The next message number (mailfile.c: one more than the highest). */
export const nextMailNumber = (list: readonly MailMessage[]): number => list.reduce((n, m) => Math.max(n, m.num), 0) + 1;

/** newssend.c MakeReplySubject: "Re: " in front, unless it's there already (or German "Aw: "), within MAX_SUBJECT */
export function replySubject(subject: string, max = 50): string {
  if (/^re: /i.test(subject) || /^aw: /i.test(subject)) return subject;
  return `Re: ${subject}`.slice(0, max - 1);
}

/** mailread.c UserMailReply: the sender, and with Reply All everyone else it went to but us */
export function replyRecipients(m: MailMessage, all: boolean, ownName: string): string[] {
  const names = all ? [m.sender, ...m.recipients] : [m.sender];
  const out: string[] = [];
  for (const n of names)
    if (n.toLowerCase() !== ownName.toLowerCase() && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  return out.length ? out : [m.sender];
}
