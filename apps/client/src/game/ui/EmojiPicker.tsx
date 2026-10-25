// Ours (ADR 0024): the emoji button at the end of the chat line, and its palette (emoji.ts). A
// pick goes in at the caret; the palette stays open for more until a click elsewhere or Escape.
// Its buttons never take the focus, so the chat line keeps its caret.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { CHAT_EMOJI } from "../emoji.ts";

const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <span className="emoji-picker" ref={ref}>
      <button
        type="button"
        className="emoji-toggle"
        title="Emoji"
        aria-label="Emoji"
        aria-expanded={open}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        🙂
      </button>
      {open && (
        <div className="emoji-grid">
          {CHAT_EMOJI.map((e) => (
            <button type="button" key={e} title={e} onMouseDown={keepFocus} onClick={() => onPick(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
