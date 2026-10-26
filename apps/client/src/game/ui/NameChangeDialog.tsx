// Ours (docs/adr/0026-the-office-of-the-justicar.md): Caramo's window in the Office of the Justicar.
// Our name now, a field for the new one and the fee; Change sends `rename <new name>` and the
// server answers in chat: Caramo refuses a name that's taken or unfit (and charges nothing), or
// records it in the Book of Jala and renames us (UC_ITEM_SERVICE kind 3, shards-server
// util/itemservicebook.kod and towns/barlqtwn/bqclerk.kod).

import { useState } from "react";
import { CHAR_NAME_MAX, CHAR_NAME_MIN, renameCommand } from "@shards/world";
import { Button, TextField, Window } from "./kit.tsx";

export function NameChangeDialog({
  name, current, fee, onCommand, onClose,
}: {
  /** The clerk's name */
  name: string;
  /** Our name now */
  current: string;
  fee: number;
  onCommand: (line: string) => void;
  onClose: () => void;
}) {
  const [wanted, setWanted] = useState("");
  const trimmed = wanted.trim().replace(/\s+/g, " ");
  const same = trimmed.toLowerCase() === current.toLowerCase();
  const ok = trimmed.length >= CHAR_NAME_MIN && trimmed.length <= CHAR_NAME_MAX && !same;

  return (
    <Window title={`${name}, clerk`} onClose={onClose} className="game-dialog name-change-dialog">
      <p className="panel-note">
        You are <strong>{current}</strong>. {name} can record a new name for you before the Office, for{" "}
        {fee.toLocaleString()} shillings, from your purse or from your bank account.
      </p>
      <TextField value={wanted} onChange={setWanted} maxLength={CHAR_NAME_MAX} placeholder="Your new name" autoFocus />
      <p className="panel-note">
        {same
          ? "That is already your name."
          : `Every change is written in the Book of Jala, for all to read. A name that's taken or unfit costs nothing.`}
      </p>
      <div className="mk-buttons">
        <Button
          isDefault
          disabled={!ok}
          onClick={() => {
            onCommand(renameCommand(trimmed));
            onClose();
          }}
        >
          Change name
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Window>
  );
}
