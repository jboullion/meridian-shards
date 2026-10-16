// The admin module's window (module/admin admindlg.c, admin.rc IDD_ADMIN), for admin
// characters, whom the server gives the module on logon (admin.kod UserLogonHook). A command
// line with its history and the server's answers (BP_ADMIN, the command echoed first), as the
// original's. Shift+4 or the ☰ menu opens it; Esc or the X hides it, "quit" closes it. While
// it's showing, looking at something (a right click in the view, or on an inventory item)
// shows that object here instead.
//
// Ours, after the remaster's console (meridian-unreal UI/SMRAdminConsole.cpp), in four tabs
// under the answers:
//   Travel   the cities, and every room (rooms.json from the asset build) to search and go to
//   Players  the original's Users box (Show, Go to, Rescue), plus Bring here and Tell
//   Self     the DM say commands about yourself (dm.kod UserSay: immortal, get spells...)
//   World    the time of day, monsters, scenery, messages to everyone, the server's commands
// A line starting "dm " goes as a DM command (SAY_DM, module/dm's "dm"), like the buttons on
// Self and World; the game's messages that answer one land here too (GameView).
//
// Left out, as planned: the object box that lists a shown object's properties to edit,
// and its Move and Send dialogs (docs/missing-features.md).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameSession } from "@shards/world";
import { Button, GroupBox, ListBox, Tabs, Text, TextField, Window, type Rect } from "./kit.tsx";

/** clientd3d/statterm.h MAX_HISTORY: characters the text window keeps */
const MAX_HISTORY = 30000;

/** Keeps the end of the admin text, MAX_HISTORY characters at most (BK_GOTTEXT) */
export function appendAdminText(text: string, more: string): string {
  const next = text + more.replace(/\r/g, "");
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/** A room to go to (rooms.json): its number, name and file */
export interface AdminRoom {
  rid: number;
  name: string;
  roo: string;
}

/** The Travel tab's city buttons: each town's main street (blakston.khd RID_*) */
export const ADMIN_CITIES: readonly { name: string; rid: number }[] = [
  { name: "Tos", rid: 50 },
  { name: "Barloque", rid: 102 },
  { name: "Marion", rid: 200 },
  { name: "Cor Noth", rid: 150 },
  { name: "Raza", rid: 300 },
  { name: "Jasper", rid: 350 },
  { name: "Ko'catan", rid: 2000 },
  { name: "Castle Victoria", rid: 38 },
  { name: "Brax", rid: 828 },
  { name: "Underworld", rid: 1 },
];

/** Rooms matching what was typed: a name, a room file or the start of a number */
export function filterRooms(rooms: readonly AdminRoom[], typed: string): AdminRoom[] {
  const t = typed.trim().toLowerCase();
  if (!t) return [...rooms];
  return rooms.filter((r) => r.name.toLowerCase().includes(t) || r.roo.includes(t) || String(r.rid).startsWith(t));
}

const TABS = ["Travel", "Players", "Self", "World"] as const;
type Tab = (typeof TABS)[number];

/** Where the tabs' pages start, and how the button rows are laid out, in dialog units */
const PAGE_Y = 133;
const ROW_X = 46;
const ROW_W = 56;
const ROW_GAP = 3;
const ROW_H = 11;
const PER_LINE = 5;

/** A button on a row of Self or World; `field` is a text field two buttons wide */
type RowItem = { label: string; onClick: () => void; disabled?: boolean; title?: string } | { field: string; value: string; onChange: (v: string) => void; onSubmit: () => void };

/** Rows of buttons with their labels on the left, five to a line, wrapping (the remaster's SWrapBox rows) */
function ButtonRows({ rows }: { rows: { label: string; items: RowItem[] }[] }) {
  const out: ReactNode[] = [];
  let y = PAGE_Y;
  for (const row of rows) {
    out.push(
      <Text key={`l-${row.label}`} at={[3, y + 2, ROW_X - 6, 8]}>
        {row.label}
      </Text>,
    );
    let slot = 0;
    for (const item of row.items) {
      const span = "field" in item ? 2 : 1;
      if (slot + span > PER_LINE) {
        slot = 0;
        y += ROW_H + ROW_GAP;
      }
      const r: Rect = [ROW_X + slot * (ROW_W + ROW_GAP), y, span * ROW_W + (span - 1) * ROW_GAP, ROW_H];
      out.push(
        "field" in item ? (
          <span
            key={`f-${row.label}-${item.field}`}
            style={{ display: "contents" }}
            title={item.field}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              item.onSubmit();
            }}
          >
            <TextField at={[r[0], r[1] - 1, r[2], 13]} value={item.value} onChange={item.onChange} maxLength={200} />
          </span>
        ) : (
          <Button key={`b-${row.label}-${item.label}`} at={r} onClick={item.onClick} disabled={item.disabled} title={item.title}>
            {item.label}
          </Button>
        ),
      );
      slot += span;
    }
    y += ROW_H + ROW_GAP + 2;
  }
  return <>{out}</>;
}

export function AdminConsole({
  session, rooms, text, command, onCommandChange, history, onCommand, onDm, onTell, onHide, onQuit, onClear,
}: {
  session: GameSession;
  /** Every room (rooms.json), by number; empty before the asset build has one */
  rooms: readonly AdminRoom[];
  text: string;
  /** The command line (BK_SENDCMD puts each command sent there, from wherever it came) */
  command: string;
  onCommandChange: (command: string) => void;
  /** Commands sent, newest first (the combo box's list) */
  history: string[];
  /** BK_SENDCMD: send it and remember it */
  onCommand: (command: string) => void;
  /** A DM command (SAY_DM: "immortal", "get roo"), remembered as "dm ..." */
  onDm: (text: string) => void;
  /** Start a tell to this player on the chat line */
  onTell: (name: string) => void;
  onHide: () => void;
  onQuit: () => void;
  /** Empty the answers */
  onClear: () => void;
}) {
  const setCommand = onCommandChange;
  const [historyAt, setHistoryAt] = useState(-1);
  const [tab, setTab] = useState<Tab>("Travel");
  const [user, setUser] = useState<number | null>(null);
  const [find, setFind] = useState("");
  const [room, setRoom] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [item, setItem] = useState("");
  const [disguise, setDisguise] = useState("");
  const [monster, setMonster] = useState("");
  const [place, setPlace] = useState("");
  const [message, setMessage] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const outRef = useRef<HTMLTextAreaElement | null>(null);
  const players = [...session.world.players.values()].sort((a, b) => a.name.localeCompare(b.name));
  const me = session.world.player?.id ?? 0;
  const shownRooms = useMemo(() => filterRooms(rooms, find), [rooms, find]);

  // EditBoxScroll: the newest text in view
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const send = (c: string) => {
    setHistoryAt(-1);
    setStatus("");
    onCommand(c);
  };
  const dm = (t: string) => {
    setHistoryAt(-1);
    setStatus("");
    onDm(t);
  };
  /** The command line: "quit", "clear", "dm ..." or a server command */
  const runLine = (line: string) => {
    const l = line.trim();
    if (!l) return;
    // IDOK: "quit" closes the window
    if (l.toLowerCase() === "quit") return onQuit();
    if (l.toLowerCase() === "clear") {
      setCommand("");
      return onClear();
    }
    if (/^dm\s/i.test(l)) return dm(l.slice(3).trim());
    send(l);
  };
  /** IDC_TELEPORT (user.kod TeleportTo): a room by number */
  const goToRoom = (rid: number | null) => {
    if (!rid || rid <= 0) return setStatus("Pick a room, or type its number.");
    send(`send object ${me} teleportto rid int ${rid}`);
  };
  /** The picked room, else a number typed in the search (one the list doesn't know is fine) */
  const pickedRoom = () => room ?? (/^\d+$/.test(find.trim()) ? Number(find.trim()) : null);
  /** IDC_SHOW, IDC_GOTO, IDC_RESCUE for the chosen user */
  const forUser = (act: (id: number) => void) => (user !== null ? act(user) : setStatus("Pick a player first."));
  /** A DM command with what's typed after it, if anything is */
  const withText = (cmd: string, value: string, clear?: () => void) => () => {
    if (!value.trim()) return setStatus("Type something first.");
    dm(`${cmd} ${value.trim()}`);
    clear?.();
  };
  const say = (t: string) => ({ onClick: () => dm(t) });

  let page: ReactNode;
  if (tab === "Travel") {
    page = (
      <>
        <GroupBox at={[1, PAGE_Y, 337, 39]} label="Cities" />
        {ADMIN_CITIES.map((c, i) => (
          <Button key={c.rid} at={[6 + (i % 5) * 66, PAGE_Y + 10 + Math.floor(i / 5) * 14, 63, 11]} title={`Room ${c.rid}`} onClick={() => goToRoom(c.rid)}>
            {c.name}
          </Button>
        ))}
        <Text at={[3, PAGE_Y + 46, 20, 8]}>Find:</Text>
        <span
          style={{ display: "contents" }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            goToRoom(pickedRoom());
          }}
        >
          <TextField
            at={[24, PAGE_Y + 43, 140, 13]}
            value={find}
            maxLength={40}
            onChange={(v) => {
              setFind(v);
              setRoom(null);
            }}
          />
        </span>
        <Button at={[168, PAGE_Y + 44, 48, 11]} onClick={() => goToRoom(pickedRoom())}>
          Go there
        </Button>
        <Button at={[220, PAGE_Y + 44, 52, 11]} title="The room's name, file and number, and your square" onClick={() => {
          // dm.kod: the room's name, file and number; our square, fine position and floor height
          dm("get roo");
          dm("get coords");
        }}>
          Where am I?
        </Button>
        <Button at={[276, PAGE_Y + 44, 62, 11]} title="Ask the server for everything again, as after a save" onClick={() => send(`send object ${me} invalidatedata`)}>
          Reset data
        </Button>
        <ListBox
          at={[1, PAGE_Y + 59, 337, 112]}
          label="Rooms"
          className="admin-rooms"
          items={shownRooms.map((r) => ({ key: r.rid, label: `${r.rid}  ${r.name}  (${r.roo})` }))}
          selected={room}
          onSelect={setRoom}
          onActivate={goToRoom}
        />
        {!rooms.length && <Text at={[6, PAGE_Y + 64, 320, 8]}>No room list: run npm run assets. A number typed above still works.</Text>}
      </>
    );
  } else if (tab === "Players") {
    const tips: [string, string, () => void][] = [
      ["Show", "Every property of their character", () => forUser((id) => send(`show object ${id}`))],
      ["Go to", "Teleport to them", () => forUser((id) => send(`send object ${me} admingotoobject what object ${id}`))],
      ["Bring here", "Teleport them to you", () => forUser((id) => send(`send object ${id} admingotoobject what object ${me}`))],
      ["Rescue", "Send them somewhere safe", () => forUser((id) => send(`send object ${id} admingotosafety`))],
      [
        "Tell",
        "Write to them",
        () =>
          forUser((id) => {
            const p = session.world.players.get(id);
            if (p) onTell(p.name);
          }),
      ],
    ];
    page = (
      <>
        <GroupBox at={[1, PAGE_Y, 146, 170]} label="Users" />
        <ListBox at={[5, PAGE_Y + 10, 78, 156]} label="Users" items={players.map((p) => ({ key: p.id, label: p.id === me ? `${p.name} (you)` : p.name }))} selected={user} onSelect={setUser} />
        <Text at={[87, PAGE_Y + 13, 25, 8]}>Object:</Text>
        <Text at={[114, PAGE_Y + 13, 30, 9]}>{user ?? ""}</Text>
        {tips.map(([label, tip, act], i) => (
          <span key={label} style={{ display: "contents" }}>
            <Button at={[90, PAGE_Y + 30 + i * 15, 52, 11]} onClick={act}>
              {label}
            </Button>
            <Text at={[152, PAGE_Y + 32 + i * 15, 186, 8]}>{tip}</Text>
          </span>
        ))}
      </>
    );
  } else if (tab === "Self") {
    page = (
      <ButtonRows
        rows={[
          // the DM say commands (dm.kod UserSay, admin.kod UserSay); "dm help" lists them all
          { label: "Powers", items: [{ label: "Immortal", ...say("immortal") }, { label: "Mortal", ...say("mortal") }, { label: "Boost stats", ...say("boost stats") }, { label: "Get spells", ...say("get spells") }, { label: "Get skills", ...say("get skills") }, { label: "Clear abilities", ...say("clear abilities") }] },
          { label: "Seen", items: [{ label: "Hidden", ...say("hidden") }, { label: "Invisible", ...say("blank") }, { label: "Plain", ...say("plain") }, { label: "Stealth on", ...say("stealth on") }, { label: "Stealth off", ...say("stealth off") }, { label: "Anonymous", ...say("anonymous") }] },
          { label: "Karma", items: [{ label: "Good", ...say("good") }, { label: "Neutral", ...say("neutral") }, { label: "Evil", ...say("evil") }, { label: "Appeals on", ...say("appeal on") }, { label: "Appeals off", ...say("appeal off") }] },
          {
            label: "Items",
            items: [
              { field: 'An item ("long sword")', value: item, onChange: setItem, onSubmit: withText("item", item) },
              { label: "Get item", onClick: withText("item", item) },
              { label: "Money", ...say("get money") },
              { label: "Weapons", ...say("get weapons") },
              { label: "Armor", ...say("get armor") },
              { label: "Reagents", ...say("get reagents") },
              { label: "Potions", ...say("get potions") },
              { label: "Scrolls", ...say("get scrolls") },
              {
                // every deletable item: pressed twice
                label: confirmClear ? "Really clear?" : "Clear inventory",
                onClick: () => {
                  if (confirmClear) dm("clear inventory");
                  setConfirmClear(!confirmClear);
                },
              },
            ],
          },
          { label: "Look", items: [{ field: 'A monster ("orc")', value: disguise, onChange: setDisguise, onSubmit: withText("disguise", disguise) }, { label: "Disguise", onClick: withText("disguise", disguise) }] },
        ]}
      />
    );
  } else {
    page = (
      <ButtonRows
        rows={[
          // dm.kod: the time of day for everyone, until restored
          { label: "Time", items: [{ label: "Morning", ...say("morning") }, { label: "Afternoon", ...say("afternoon") }, { label: "Evening", ...say("evening") }, { label: "Night", ...say("night") }, { label: "Real time", ...say("restore time") }] },
          { label: "Monsters", items: [{ field: 'A monster ("giant rat")', value: monster, onChange: setMonster, onSubmit: withText("monster", monster) }, { label: "Make", onClick: withText("monster", monster) }, { label: "Call one", ...say("call monster") }, { label: "Rumble", ...say("rumble") }] },
          { label: "Place", items: [{ field: 'Scenery or a light ("brazier")', value: place, onChange: setPlace, onSubmit: withText("place", place) }, { label: "Place", onClick: withText("place", place) }, { label: "Lights?", ...say("help lights") }, { label: "Scenery?", ...say("help scenery") }, { label: "Event sign", ...say("event sign") }] },
          // dm.kod: "systemmessage" to everyone with the [###] prefix, "lemote" to this room
          { label: "Message", items: [{ field: "A message", value: message, onChange: setMessage, onSubmit: withText("systemmessage", message, () => setMessage("")) }, { label: "To everyone", onClick: withText("systemmessage", message, () => setMessage("")) }, { label: "To this room", onClick: withText("lemote", message, () => setMessage("")) }] },
          // the server itself: the maintenance port's commands
          { label: "Server", items: [{ label: "Who", onClick: () => send("who") }, { label: "Status", onClick: () => send("show status") }, { label: "Clock", onClick: () => send("show clock") }, { label: "Save game", title: "Saves now: object numbers change", onClick: () => send("save game") }, { label: "Server help", onClick: () => send("help") }, { label: "DM help", ...say("help") }] },
        ]}
      />
    );
  }

  return (
    <Window title="Administration" dlu={[342, 318]} onClose={onHide} className="game-dialog dlu admin-window">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runLine(command);
        }}
      >
        <Text at={[5, 7, 35, 8]}>Command:</Text>
        <span
          style={{ display: "contents" }}
          onKeyDown={(e) => {
            // The combo box's list, through the arrow keys
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const i = Math.max(-1, Math.min(history.length - 1, historyAt + (e.key === "ArrowUp" ? 1 : -1)));
            setHistoryAt(i);
            setCommand(i < 0 ? "" : history[i]);
          }}
        >
          <TextField at={[44, 4, 294, 13]} value={command} onChange={setCommand} autoFocus />
        </span>
        <textarea ref={outRef} className="admin-text" readOnly value={text} style={{ position: "absolute", left: "calc(var(--dx) * 1)", top: "calc(var(--dy) * 21)", width: "calc(var(--dx) * 337)", height: "calc(var(--dy) * 93)" }} />
        <Tabs
          at={[1, 117, 337, 13]}
          tabs={TABS}
          active={tab}
          onChange={(t) => {
            setTab(t);
            setStatus("");
            setConfirmClear(false);
          }}
        />
      </form>
      {/* The pages' own text fields submit by Enter themselves, not the command line's form */}
      {page}
      <Text at={[3, 307, 270, 8]} className="admin-status">
        {status || "Everything here changes the live world at once."}
      </Text>
      <Button at={[296, 305, 42, 11]} onClick={onClear}>
        Clear
      </Button>
    </Window>
  );
}
