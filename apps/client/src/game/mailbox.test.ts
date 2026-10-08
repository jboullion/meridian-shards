import { describe, expect, test } from "vitest";
import { loadMailbox, mailText, newMailMessage, nextMailNumber, replyRecipients, replySubject, saveMailbox, type MailStore } from "./mailbox.ts";

const store = (): MailStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("the mailbox (mailfile.c)", () => {
  test("the subject is the first line after Subject: (or Betreff:)", () => {
    const m = newMailMessage(1, "Angel", ["Shardbot"], "Subject: Welcome!\r\nHello there.\r\nBye.", 0);
    expect(m.subject).toBe("Welcome!");
    expect(m.body).toBe("Hello there.\nBye.");
    expect(newMailMessage(2, "X", ["Y"], "Betreff: Hallo\nText", 0).subject).toBe("Hallo");
    expect(newMailMessage(3, "X", ["Y"], "No subject here", 0)).toMatchObject({ subject: "", body: "No subject here" });
    expect(mailText(m)).toMatch(/^From: Angel\nTo: Shardbot\nSubject: Welcome!\nDate: .+\n-------------\nHello there\.\nBye\.$/);
  });

  test("kept per server and character, numbered one past the highest", () => {
    const s = store();
    const m = newMailMessage(1, "A", ["B"], "hi", 0);
    expect(saveMailbox(s, "ws://x/ws", "Shardbot", [m])).toBe(true);
    expect(loadMailbox(s, "ws://x/ws", "shardbot")).toEqual([m]);
    expect(loadMailbox(s, "ws://x/ws", "Shardpal")).toEqual([]);
    expect(nextMailNumber([m, { ...m, num: 7 }])).toBe(8);
    const full: MailStore = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(saveMailbox(full, "s", "c", [m])).toBe(false);
  });

  test("replies", () => {
    expect(replySubject("Hello")).toBe("Re: Hello");
    expect(replySubject("re: Hello")).toBe("re: Hello");
    const m = newMailMessage(1, "Bob", ["Shardbot", "Ann", "bob"], "x", 0);
    expect(replyRecipients(m, false, "Shardbot")).toEqual(["Bob"]);
    expect(replyRecipients(m, true, "Shardbot")).toEqual(["Bob", "Ann"]);
  });
});
