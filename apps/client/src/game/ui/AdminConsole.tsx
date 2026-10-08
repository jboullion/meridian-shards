// The admin module's window (module/admin admindlg.c, admin.rc IDD_ADMIN), for admin
// characters, whom the server gives the module on logon (admin.kod UserLogonHook). A command
// line with its history, the server's answers (BP_ADMIN, the command echoed first), Go to
// room and Reset data, and the users logged on with Show, Go to and Rescue. Shift+4 opens
// it; Esc or the X hides it, "quit" closes it. While it's showing, looking at something
// (a right click in the view, or on an inventory item) shows that object here instead.
//
// Left out, as planned: the object box that lists a shown object's properties to edit,
// and its Move and Send dialogs (docs/missing-features.md).

import { useEffect, useRef, useState } from "react";
import type { GameSession } from "@shards/world";
import { Button, GroupBox, ListBox, Text, TextField, Window } from "./kit.tsx";

/** clientd3d/statterm.h MAX_HISTORY: characters the text window keeps */
const MAX_HISTORY = 30000;

/** Keeps the end of the admin text, MAX_HISTORY characters at most (BK_GOTTEXT) */
export function appendAdminText(text: string, more: string): string {
  const next = text + more.replace(/\r/g, "");
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

export function AdminConsole({
  session, text, command, onCommandChange, history, onCommand, onHide, onQuit,
}: {
  session: GameSession;
  text: string;
  /** The command line (BK_SENDCMD puts each command sent there, from wherever it came) */
  command: string;
  onCommandChange: (command: string) => void;
  /** Commands sent, newest first (the combo box's list) */
  history: string[];
  /** BK_SENDCMD: send it and remember it */
  onCommand: (command: string) => void;
  onHide: () => void;
  onQuit: () => void;
}) {
  const setCommand = onCommandChange;
  const [historyAt, setHistoryAt] = useState(-1);
  const [user, setUser] = useState<number | null>(null);
  const [askRoom, setAskRoom] = useState(false);
  const outRef = useRef<HTMLTextAreaElement | null>(null);
  const players = [...session.world.players.values()].sort((a, b) => a.name.localeCompare(b.name));
  const me = session.world.player?.id ?? 0;

  // EditBoxScroll: the newest text in view
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const send = (c: string) => {
    setHistoryAt(-1);
    onCommand(c);
  };
  /** IDC_SHOW, IDC_GOTO, IDC_RESCUE for the chosen user */
  const forUser = (make: (id: number) => string) => user !== null && send(make(user));

  return (
    <>
      <Window title="Administration" dlu={[342, 270]} onClose={onHide} className="game-dialog dlu admin-window">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // IDOK: "quit" closes the window
            if (command.trim().toLowerCase() === "quit") return onQuit();
            if (command.trim()) send(command.trim());
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
          <textarea ref={outRef} className="admin-text" readOnly value={text} style={{ position: "absolute", left: "calc(var(--dx) * 1)", top: "calc(var(--dy) * 24)", width: "calc(var(--dx) * 337)", height: "calc(var(--dy) * 133)" }} />
          <Button at={[1, 158, 43, 11]} onClick={() => setAskRoom(true)}>
            Go to room
          </Button>
          <Button at={[48, 158, 43, 11]} onClick={() => send(`send object ${me} invalidatedata`)}>
            Reset data
          </Button>
          <GroupBox at={[1, 170, 146, 98]} label="Users" />
          <ListBox at={[5, 180, 78, 84]} label="Users" items={players.map((p) => ({ key: p.id, label: p.name }))} selected={user} onSelect={setUser} />
          <Text at={[87, 183, 25, 8]}>Object:</Text>
          <Text at={[114, 183, 27, 9]}>{user ?? ""}</Text>
          <Button at={[97, 211, 36, 11]} onClick={() => forUser((id) => `show object ${id}`)}>
            Show
          </Button>
          <Button at={[97, 225, 36, 11]} onClick={() => forUser((id) => `send object ${me} admingotoobject what object ${id}`)}>
            Go to
          </Button>
          <Button at={[97, 239, 36, 11]} onClick={() => forUser((id) => `send object ${id} admingotosafety`)}>
            Rescue
          </Button>
        </form>
      </Window>
      {askRoom && (
        <RoomDialog
          onDone={(rid) => {
            setAskRoom(false);
            // IDC_TELEPORT: a room id or a RID_ constant
            if (rid) send(`send object ${me} teleportto rid int ${rid}`);
          }}
        />
      )}
    </>
  );
}

/** admindlg.c AdminGetString (IDD_ADMINSTRING): the room to go to */
function RoomDialog({ onDone }: { onDone: (rid: string | null) => void }) {
  const [rid, setRid] = useState("");
  return (
    <div className="mk-modal">
      <Window title="String" dlu={[133, 53]} onClose={() => onDone(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onDone(rid.trim());
          }}
        >
          <TextField at={[17, 9, 99, 18]} value={rid} onChange={setRid} autoFocus />
          <Button at={[9, 35, 50, 14]} type="submit" isDefault>
            OK
          </Button>
          <Button at={[71, 35, 50, 14]} onClick={() => onDone(null)}>
            Cancel
          </Button>
        </form>
      </Window>
    </div>
  );
}
