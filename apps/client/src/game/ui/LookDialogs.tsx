// Looking at things: the description dialog (clientd3d/dialog.c DescDialogProc, client.rc
// IDD_DESC and IDD_DESCPLAYER) and the pick list for choosing among several objects
// (lookdlg.c DisplayLookList, IDD_ITEMLISTSINGLE and IDD_ITEMLISTMULTIPLE).
//
// The description dialog's buttons depend on where the look came from, as the original sets
// them before asking (SetDescParams): a room object close by can be picked up, used or
// activated (gameuser.c SetDescParamsByRoomObject), an inventory item dropped, used or
// unused (inventry.c A_LOOKINVENTORY), and anything else just has OK.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ANIMATE, DF, type ObjectInfo } from "@shards/protocol";
import { DRAWFX } from "@shards/render";
import { isNumberItem, type LookResult } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import { Button, Window } from "./kit.tsx";
import { ObjIcon } from "./Sidebar.tsx";

/** dialog.h DESC_*: which buttons the description dialog shows */
export const DESC = {
  NONE: 0, GET: 0x01, DROP: 0x02, USE: 0x04, UNUSE: 0x08, INSIDE: 0x10, ACTIVATE: 0x20, APPLY: 0x40,
} as const;

/** dialog.c PAGE_BREAK_CHAR: splits a long description into pages */
const PAGE_BREAK = "\xb6";
/** object.h MAX_DESCRIPTION, dialog.h MAX_URL */
const MAX_DESCRIPTION = 1000;
const MAX_URL = 200;

/** The description dialog's buttons besides OK (IDC_GET, IDC_DROP, IDC_USE, IDC_UNUSE, IDC_ACTIVATE, IDC_APPLY). */
export type DescAction = "get" | "drop" | "use" | "unuse" | "inside" | "activate" | "apply";

/** dialog.c AnimateDescription: a cycling object keeps cycling in the picture. */
function useAnimatedGroup(o: ObjectInfo): number | undefined {
  const a = o.animation;
  const cycling = a.type === ANIMATE.CYCLE && a.groupLow !== undefined && a.groupHigh !== undefined && a.groupHigh > a.groupLow;
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!cycling) return;
    const t = setInterval(() => setStep((s) => s + 1), Math.max(50, a.period ?? 100));
    return () => clearInterval(t);
  }, [cycling, a.period]);
  if (!cycling) return undefined;
  const lo = a.groupLow! - 1;
  return lo + (step % (a.groupHigh! - a.groupLow! + 1));
}

/** dialog.c SetFontToFitText: the name shrinks until it fits on one line. */
function FittedName({ text, color }: { text: string; color?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let s = 1;
    el.style.setProperty("--fit", "1");
    while (s > 0.3 && el.scrollWidth > el.clientWidth) {
      s -= 0.05;
      el.style.setProperty("--fit", String(s));
    }
    setScale(s);
  }, [text]);
  return (
    <div ref={ref} className={`desc-name${color ? " player" : ""}`} style={{ "--fit": scale, color } as CSSProperties}>
      {text}
    </div>
  );
}

/**
 * The description dialog: the object's picture on the left, its name in the title face, the
 * description, the inscription or a player's own words below it (editable when DF_EDITABLE),
 * a player's web page, and the buttons for what we can do with it.
 */
export function DescriptionDialog({
  look, buttons, icons, onAction, onSave, onClose,
}: {
  look: LookResult;
  /** DESC_* flags */
  buttons: number;
  icons: IconRenderer;
  onAction: (a: DescAction) => void;
  /** OK with a changed description or web page (null: unchanged) */
  onSave: (description: string | null, url: string | null) => void;
  onClose: () => void;
}) {
  const o = look.object;
  const group = useAnimatedGroup(o);
  const editable = (look.flags & DF.EDITABLE) !== 0;
  // DisplayDescription: the box only appears for inscribed or editable objects, and players
  const box = look.player || (look.flags & (DF.EDITABLE | DF.INSCRIBED)) !== 0 ? (look.inscription ?? "") : null;
  const pages = box === null || editable ? [box ?? ""] : box.split(PAGE_BREAK);
  const [page, setPage] = useState(0);
  const [text, setText] = useState(box ?? "");
  const [url, setUrl] = useState(look.url ?? "");
  const okRef = useRef<HTMLDivElement>(null);
  useEffect(() => okRef.current?.querySelector("button")?.focus(), []);

  const ok = () => {
    const desc = editable && text !== (box ?? "") ? text : null;
    const newUrl = look.player && editable && url !== (look.url ?? "") ? url : null;
    if (desc !== null || newUrl !== null) onSave(desc, newUrl);
    onClose();
  };
  const run = (a: DescAction) => () => {
    onAction(a);
    onClose();
  };
  // GetPlayerNameColor: players' names in their name colour (black when drawn black)
  const nameColor = look.player
    ? o.drawingType === DRAWFX.BLACK
      ? "#000"
      : `rgb(${(o.nameColor >> 16) & 255}, ${(o.nameColor >> 8) & 255}, ${o.nameColor & 255})`
    : undefined;
  const webUrl = /^https?:\/\//i.test(url.trim()) ? url.trim() : null;

  return (
    <div className="mk-modal look-modal desc-modal">
      <Window title={look.player ? "Player Description" : "Object Description"} onClose={onClose} className="desc-dialog">
        <div className="desc-layout">
          <div className="desc-picture">
            <ObjIcon icons={icons} object={o} opts={group !== undefined ? { group } : undefined} />
          </div>
          <div className="desc-main">
            <FittedName text={look.name} color={nameColor} />
            {look.description && <div className="desc-fixed">{look.description}</div>}
            {box !== null && (
              <div className="desc-box-row">
                <span className={`mk-edit area desc-box${editable ? "" : " readonly"}`}>
                  <textarea
                    value={editable ? text : pages[page]}
                    readOnly={!editable}
                    maxLength={MAX_DESCRIPTION}
                    onChange={(e) => setText(e.target.value)}
                    spellCheck={false}
                    aria-label={look.player ? "Description" : "Inscription"}
                  />
                </span>
                {pages.length > 1 && (
                  <div className="desc-pager">
                    <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)} title="Previous page">
                      &lt;
                    </Button>
                    <Button disabled={page === pages.length - 1} onClick={() => setPage((p) => p + 1)} title="Next page">
                      &gt;
                    </Button>
                  </div>
                )}
              </div>
            )}
            {look.player && (
              <div className="desc-url">
                <span>Web page:</span>
                <span className={`mk-edit${editable ? "" : " readonly"}`}>
                  <input value={url} readOnly={!editable} maxLength={MAX_URL} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
                </span>
                <Button disabled={!webUrl} onClick={() => webUrl && window.open(webUrl, "_blank", "noopener")}>
                  Go
                </Button>
              </div>
            )}
          </div>
        </div>
        {/* IDD_DESC: OK at 148, Get/Drop at 206, Inside/Use/Unuse at 262 (dialog units) */}
        <div className="desc-buttons" ref={okRef}>
          <Button isDefault onClick={ok}>
            OK
          </Button>
          {buttons & DESC.GET ? <Button className="slot-b" onClick={run("get")}>Get</Button> : null}
          {buttons & DESC.DROP ? <Button className="slot-b" onClick={run("drop")}>Drop</Button> : null}
          {buttons & DESC.INSIDE ? <Button className="slot-c" onClick={run("inside")}>Inside</Button> : null}
          {buttons & DESC.ACTIVATE ? <Button className="slot-c" onClick={run("activate")}>Use</Button> : null}
          {buttons & DESC.APPLY ? <Button className="slot-c" onClick={run("apply")}>Use</Button> : null}
          {buttons & DESC.UNUSE ? <Button className="slot-c" onClick={run("unuse")}>Unuse</Button> : null}
          {buttons & DESC.USE ? <Button className="slot-c" onClick={run("use")}>Use</Button> : null}
        </div>
      </Window>
    </div>
  );
}

export interface LookListItem {
  object: ObjectInfo;
  name: string;
}

/** A pick from the list: the object, and for number items with LD_AMOUNTS how many. */
export interface LookListChoice {
  id: number;
  amount?: number;
}

/**
 * lookdlg.c DisplayLookList: choose one object (IDD_ITEMLISTSINGLE) or several
 * (IDD_ITEMLISTMULTIPLE, with All). With `amounts` (LD_AMOUNTS) a chosen number item gets a
 * quantity, all of it to start with. A double click looks at the object instead.
 */
export function LookListDialog({
  title, items, multiple, amounts, initial, icons, onDone, onLook, onClose,
}: {
  title: string;
  items: LookListItem[];
  multiple: boolean;
  amounts?: boolean;
  /** Chosen to start with in a single-choice list (else the first) */
  initial?: number;
  icons: IconRenderer;
  onDone: (chosen: LookListChoice[]) => void;
  onLook: (id: number) => void;
  onClose: () => void;
}) {
  const first = items.find((i) => i.object.id === initial) ?? items[0];
  const [chosen, setChosen] = useState<number[]>(multiple || !first ? [] : [first.object.id]);
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const listRef = useRef<HTMLUListElement>(null);
  /** IDC_ITEMFIND: the item the Find box went to (the caret, in a multiple-choice list) */
  const [caret, setCaret] = useState<number | null>(null);
  useEffect(() => listRef.current?.focus(), []);
  // lookdlg.c IDC_ITEMFIND EN_UPDATE: ListBox_FindString, the first name starting with the text
  const find = (text: string) => {
    if (!text) return;
    const hit = items.find((i) => i.name.toLowerCase().startsWith(text.toLowerCase()));
    if (!hit) return;
    setCaret(hit.object.id);
    if (!multiple) setChosen([hit.object.id]);
    listRef.current?.querySelector(`[data-id="${hit.object.id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const toggle = (id: number) =>
    setChosen((c) => (multiple ? (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]) : [id]));
  const counted = (i: LookListItem) => amounts && isNumberItem(i.object.id);
  const ok = () => {
    onDone(
      items
        .filter((i) => chosen.includes(i.object.id))
        .map((i) => (counted(i) ? { id: i.object.id, amount: Math.max(1, Math.min(i.object.amount, counts.get(i.object.id) ?? i.object.amount)) } : { id: i.object.id })),
    );
    onClose();
  };
  return (
    <div className="mk-modal look-modal">
      <Window title={title} onClose={onClose} className="look-list-dialog">
        <div className="look-list-layout">
          <div className="look-list-left">
            <div className="mk-text">{multiple ? "Select one or more items:" : "Select one item:"}</div>
            <span className="mk-edit list">
              <ul
                ref={listRef}
                className="mk-list look-list"
                tabIndex={0}
                role="listbox"
                aria-multiselectable={multiple}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    ok();
                  }
                }}
              >
                {items.map((i) => {
                  const on = chosen.includes(i.object.id);
                  return (
                    <li
                      key={i.object.id}
                      role="option"
                      aria-selected={on}
                      data-id={i.object.id}
                      className={`${on ? "selected" : ""}${caret === i.object.id ? " caret" : ""}`}
                      onMouseDown={() => toggle(i.object.id)}
                      onDoubleClick={() => onLook(i.object.id)}
                    >
                      <ObjIcon icons={icons} object={i.object} className="pick-icon" />
                      <span className="look-list-name">{i.name}</span>
                      {/* IDC_QUANLIST: how many of a chosen number item */}
                      {counted(i) && on && (
                        <span className="mk-edit look-list-amount" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            min={1}
                            max={i.object.amount}
                            value={counts.get(i.object.id) ?? i.object.amount}
                            onChange={(e) => setCounts(new Map(counts).set(i.object.id, Number(e.target.value) || 1))}
                            aria-label={`How many ${i.name}`}
                          />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </span>
            <label className="look-list-find">
              Find:
              <span className="mk-edit">
                <input type="text" maxLength={64} onChange={(e) => find(e.target.value)} onKeyDown={(e) => e.key === "Enter" && chosen.length && ok()} aria-label="Find" />
              </span>
            </label>
          </div>
          <div className="look-list-buttons">
            <Button isDefault onClick={ok} disabled={!chosen.length}>
              OK
            </Button>
            <Button onClick={onClose}>Cancel</Button>
            {multiple && <Button onClick={() => setChosen(items.map((i) => i.object.id))}>All</Button>}
          </div>
        </div>
      </Window>
    </div>
  );
}
