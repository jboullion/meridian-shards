// Select character (module/char/charpick.c PickCharDialogProc, char.rc IDD_CHARPICK 215 x 254
// DLU): the account's characters, then a "<New character>" row for every free slot; OK plays
// the selected one or opens the creator for a free slot; Log off asks first. The two ad
// panels under the message of the day are left out, so the dialog is shorter.

import { useState } from "react";
import type { CharacterSlot } from "@shards/protocol";
import type { GameSession } from "@shards/world";
import { Backdrop, Button, ListBox, MessageBox, Text, TextArea, Window } from "./ui/kit.tsx";

/** BP_CHARACTERS flag 1: the slot has no character yet */
const NEW_CHARACTER = 1;

/**
 * charpick.c WM_INITDIALOG: characters by name, case-insensitively (strcmpi), with the
 * free slots always last in the server's order.
 */
export function sortCharacters(chars: readonly CharacterSlot[]): CharacterSlot[] {
  const named = chars.filter((c) => c.flags !== NEW_CHARACTER);
  const free = chars.filter((c) => c.flags === NEW_CHARACTER);
  named.sort((a, b) => {
    const x = a.name.toLowerCase(),
      y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return [...named, ...free];
}

export function CharacterSelect({
  characters, motd, error, session, onLogout, onCreate, onClearError,
}: {
  characters: CharacterSlot[];
  motd: string;
  error: string | null;
  session: GameSession;
  onLogout: () => void;
  onCreate: (slotId: number) => void;
  onClearError: () => void;
}) {
  const rows = sortCharacters(characters);
  // charpick.c: the first row starts selected
  const [picked, setPicked] = useState<number | null>(null);
  const selected = rows.some((c) => c.id === picked) ? picked : (rows[0]?.id ?? null);
  const [confirmLogoff, setConfirmLogoff] = useState(false);

  const ok = (id = selected) => {
    const c = rows.find((r) => r.id === id);
    if (!c) return;
    if (c.flags === NEW_CHARACTER) onCreate(c.id);
    else session.useCharacter(c.id);
  };

  return (
    <Backdrop>
      <Window title="Select character" dlu={[215, 182]} onClose={() => setConfirmLogoff(true)}>
        <ListBox
          at={[9, 9, 118, 51]}
          label="Characters"
          autoFocus
          items={rows.map((c) => ({
            key: c.id,
            label: c.flags === NEW_CHARACTER ? "<New character>" : c.name,
          }))}
          selected={selected}
          onSelect={setPicked}
          onActivate={ok}
        />
        <Button at={[159, 9, 47, 14]} isDefault onClick={() => ok()} disabled={selected === null}>
          OK
        </Button>
        <Button at={[159, 27, 47, 14]} onClick={() => setConfirmLogoff(true)}>
          Log off
        </Button>
        <Text at={[9, 64, 100, 8]}>Message of the day</Text>
        <TextArea at={[10, 74, 195, 101]} value={motd && motd !== "<Default>" ? motd : ""} readOnly />
      </Window>
      {confirmLogoff && (
        // charpick.c IDCANCEL: AreYouSure(..., NO_BUTTON, IDS_LOGOFF)
        <MessageBox
          text="Are you sure you want to disconnect?"
          kind="yesno"
          defaultNo
          onResult={(yes) => {
            setConfirmLogoff(false);
            if (yes) onLogout();
          }}
        />
      )}
      {error && !confirmLogoff && <MessageBox text={error} onResult={onClearError} />}
    </Backdrop>
  );
}
