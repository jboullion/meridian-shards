// Mail and the news globes (module/mailnews, mailnews.rc): Read Mail (IDD_MAILREAD), Send
// Mail (IDD_MAILSEND), the newsgroup reader (IDD_NEWSREAD) and Post Article (IDD_NEWSPOST).
// Like the original's, they're modeless: the game goes on behind them.

import { useEffect, useState } from "react";
import { NEWS, type NewsArticle } from "@shards/protocol";
import type { GameSession } from "@shards/world";
import { mailText, replySubject, serverDate, type MailMessage } from "../mailbox.ts";
import { Button, ListBox, TextArea, TextField, Window } from "./kit.tsx";

/** mail.h MAX_SUBJECT, MAX_RECIPIENTS, MAXMAIL; news.h MAXARTICLE */
const MAX_SUBJECT = 50;
const MAX_RECIPIENTS = 20;
const MAXMAIL = 4096;

/** The original's edit boxes give \r\n line ends; other players' clients expect them. */
const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

/** A row of columns in a list (the original's list views) */
function Columns({ cells, widths }: { cells: string[]; widths: string }) {
  return (
    <span className="mail-columns" style={{ gridTemplateColumns: widths }}>
      {cells.map((c, i) => (
        <span key={i}>{c}</span>
      ))}
    </span>
  );
}

/** What a reply starts with (mailread.c UserMailReply, newsread.c UserReplyNewsMail) */
export interface MailDraft {
  to: string[];
  subject: string;
}

/**
 * mailread.c ReadMailDialogProc: the kept messages, newest first (#, From, Subject, Date),
 * and the one chosen below. Write, Reply, Reply All, Rescan (ask for new mail), Delete.
 */
export function ReadMailDialog({
  mailbox, info, onWrite, onReply, onRescan, onDelete, onClose,
}: {
  mailbox: MailMessage[];
  /** IDC_MAILINFO: "Looking for new messages...", "You have no new mail." */
  info: string;
  onWrite: () => void;
  onReply: (m: MailMessage, all: boolean) => void;
  onRescan: () => void;
  onDelete: (m: MailMessage) => void;
  onClose: () => void;
}) {
  const newest = [...mailbox].sort((a, b) => b.num - a.num);
  const [selected, setSelected] = useState<number | null>(newest[0]?.num ?? null);
  const current = mailbox.find((m) => m.num === selected) ?? null;
  const widths = "2.5em 7em 1fr 11em";
  return (
    <Window title="Read Mail" onClose={onClose} className="game-dialog mail-dialog">
      <div className="mail-header">
        <Columns cells={["#", "From", "Subject", "Date"]} widths={widths} />
      </div>
      <ListBox
        className="mail-list"
        label="Mail"
        items={newest.map((m) => ({ key: m.num, label: <Columns cells={[String(m.num), m.sender, m.subject, serverDate(m.time)]} widths={widths} /> }))}
        selected={current?.num ?? null}
        onSelect={setSelected}
      />
      <div className="mk-buttons mail-buttons">
        <Button onClick={onWrite}>Write</Button>
        <Button onClick={() => current && onReply(current, false)} disabled={!current}>
          Reply
        </Button>
        <Button onClick={() => current && onReply(current, true)} disabled={!current}>
          Reply All
        </Button>
        <Button onClick={onRescan}>Rescan</Button>
        <Button
          onClick={() => {
            if (!current) return;
            const i = newest.findIndex((m) => m.num === current.num);
            onDelete(current);
            setSelected(newest[i + 1]?.num ?? newest[i - 1]?.num ?? null);
          }}
          disabled={!current}
        >
          Delete
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
      <p className="mail-info">{info}</p>
      <TextArea value={current ? mailText(current) : ""} readOnly />
    </Window>
  );
}

/**
 * mailsend.c SendMailDialogProc: recipients separated by commas, a subject and the text.
 * Send asks the server to look the names up (BP_REQ_LOOKUP_NAMES); `lookup` gets the
 * answer, and the mail goes when every name is a player.
 */
export function SendMailDialog({
  session, draft, onLookup, onClose,
}: {
  session: GameSession;
  draft: MailDraft;
  /** Waits for the next BP_LOOKUP_NAMES (GameView routes it here) */
  onLookup: (fn: (ids: number[]) => void) => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState(draft.to.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const send = () => {
    // mailsend.c SendMailMessage: names split on commas, duplicates dropped
    const names: string[] = [];
    for (const raw of to.split(",")) {
      const n = raw.trim();
      if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
    if (!names.length) return setStatus("You must specify at least one recipient");
    if (names.length > MAX_RECIPIENTS) return setStatus(`This message has more than the allowed number of recipients (${MAX_RECIPIENTS}).`);
    setBusy(true);
    setStatus("Checking recipient names...");
    onLookup((ids) => {
      setBusy(false);
      const bad = ids.findIndex((id) => id === 0);
      if (ids.length !== names.length) return setStatus("");
      if (bad >= 0) return setStatus(`Bad recipient name ${names[bad]}. Check the spelling and try again.`);
      // MailRecipientsReceived: "Subject: " + subject + "\n" + the text
      session.sendMail(ids, crlf(`Subject: ${subject.slice(0, MAX_SUBJECT - 1)}\n${text}`));
      onClose();
    });
    session.lookupNames(names);
  };
  return (
    <Window title="Send Mail" onClose={onClose} className="game-dialog mail-dialog">
      <label className="form-row">
        To: <TextField value={to} onChange={setTo} autoFocus={!draft.to.length} />
      </label>
      <label className="form-row">
        Subject: <TextField value={subject} onChange={setSubject} maxLength={MAX_SUBJECT - 1} />
      </label>
      <p className="mail-info">{status}</p>
      <TextArea value={text} onChange={setText} maxLength={MAXMAIL} />
      <div className="mk-buttons">
        <Button isDefault onClick={send} disabled={busy}>
          Send
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Window>
  );
}

/** The newsgroup a globe opened (BP_LOOK_NEWSGROUP) */
export interface Newsgroup {
  newsgroup: number;
  permission: number;
  name: string;
  description: string;
}

/**
 * newsread.c ReadNewsDialogProc: the globe's description, its articles (Subject, Author,
 * Date) and the chosen one's text. Reply and Post need NEWS_POST; Mail author writes to
 * the poster. The index comes with BP_ARTICLES, the text with BP_ARTICLE.
 */
export function ReadNewsDialog({
  session, group, articles, article, ignored, onRequestArticle, onMailAuthor, onClose,
}: {
  session: GameSession;
  group: Newsgroup;
  articles: NewsArticle[] | null;
  /** The chosen article's text, once it came */
  article: { num: number; text: string } | null;
  /** Posters on the ignore list aren't listed (IsNameInIgnoreList) */
  ignored: (name: string) => boolean;
  /** BP_REQ_ARTICLE for this one (its text comes back without its number) */
  onRequestArticle: (num: number) => void;
  onMailAuthor: (a: NewsArticle) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [posting, setPosting] = useState<{ subject: string } | null>(null);
  const canRead = (group.permission & NEWS.READ) !== 0;
  const canPost = (group.permission & NEWS.POST) !== 0;
  const shown = (articles ?? []).filter((a) => !ignored(a.poster));
  // BK_ARTICLES: the first article is chosen to start with
  const current = shown.find((a) => a.num === selected) ?? shown[0] ?? null;
  useEffect(() => {
    // WM_INITDIALOG: ask for the index if we may read
    if (canRead) session.requestArticles(group.newsgroup);
  }, [session, group.newsgroup, canRead]);
  const currentNum = current?.num ?? null;
  useEffect(() => {
    // LVN_ITEMCHANGED and the timer: ask for the chosen article's text
    if (currentNum !== null && article?.num !== currentNum) onRequestArticle(currentNum);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onRequestArticle is a new closure every render
  }, [currentNum, article?.num]);
  const widths = "1fr 7em 11em";
  return (
    <>
      <Window title={`Newsgroup: ${group.name}`} onClose={onClose} className="game-dialog mail-dialog">
        <p className="news-desc">{group.description}</p>
        <div className="mail-header">
          <Columns cells={["Subject", "Author", "Date"]} widths={widths} />
        </div>
        <ListBox
          className="mail-list"
          label="Articles"
          items={shown.map((a) => ({ key: a.num, label: <Columns cells={[a.title, a.poster, serverDate(a.time)]} widths={widths} /> }))}
          selected={current?.num ?? null}
          onSelect={setSelected}
        />
        <div className="mk-buttons mail-buttons">
          <Button onClick={() => current && setPosting({ subject: replySubject(current.title) })} disabled={!canPost || !current || article?.num !== current.num}>
            Reply
          </Button>
          <Button onClick={() => current && onMailAuthor(current)} disabled={!current || article?.num !== current.num}>
            Mail author
          </Button>
          <Button onClick={() => setPosting({ subject: "" })} disabled={!canPost}>
            Post
          </Button>
          <Button onClick={() => session.requestArticles(group.newsgroup)} disabled={!canRead}>
            Rescan
          </Button>
          <Button
            onClick={() => {
              if (!current) return;
              session.deleteArticle(group.newsgroup, current.num);
              setSelected(null);
              session.requestArticles(group.newsgroup);
            }}
            disabled={!canPost || !current}
          >
            Delete
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
        <TextArea value={current && article?.num === current.num ? article.text : ""} readOnly />
      </Window>
      {posting && (
        <PostArticleDialog
          group={group.name}
          subject={posting.subject}
          onPost={(subject, text) => {
            session.postArticle(group.newsgroup, subject, crlf(text));
            setPosting(null);
            // newsread.c: rescan so the new article shows
            session.requestArticles(group.newsgroup);
          }}
          onClose={() => setPosting(null)}
        />
      )}
    </>
  );
}

/** newssend.c PostNewsDialogProc: a subject and the article; Post once there's text */
function PostArticleDialog({
  group, subject: initial, onPost, onClose,
}: {
  group: string;
  subject: string;
  onPost: (subject: string, text: string) => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(initial);
  const [text, setText] = useState("");
  return (
    <Window title="Post Article" onClose={onClose} className="game-dialog mail-dialog">
      <p>Article in newsgroup {group}</p>
      <label className="form-row">
        Subject: <TextField value={subject} onChange={setSubject} maxLength={MAX_SUBJECT - 1} autoFocus={!initial} />
      </label>
      <TextArea value={text} onChange={setText} maxLength={MAXMAIL} />
      <div className="mk-buttons">
        <Button isDefault onClick={() => onPost(subject, text)} disabled={!text}>
          Post
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Window>
  );
}
