// annotate.c MapAnnotationDialogProc (client.rc IDD_ANNOTATE): an annotation's text, with
// OK, Delete and Cancel.

import { useState } from "react";
import { MAX_ANNOTATION_LEN } from "../annotations.ts";
import { Button, Text, TextField, Window } from "./kit.tsx";

export function AnnotateDialog({
  text: initial, onDone, onClose,
}: {
  text: string;
  /** OK with the text, or Delete with "" (an empty annotation is none) */
  onDone: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="mk-modal">
      <Window title="Map annotation" dlu={[161, 67]} onClose={onClose}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onDone(text);
          }}
        >
          <Text at={[7, 8, 118, 8]}>Type the text of your map annotation:</Text>
          <TextField at={[7, 20, 145, 16]} value={text} onChange={setText} maxLength={MAX_ANNOTATION_LEN - 1} autoFocus />
          <Button at={[14, 46, 35, 14]} type="submit" isDefault>
            OK
          </Button>
          <Button at={[63, 46, 35, 14]} onClick={() => onDone("")}>
            Delete
          </Button>
          <Button at={[112, 46, 35, 14]} onClick={onClose}>
            Cancel
          </Button>
        </form>
      </Window>
    </div>
  );
}
