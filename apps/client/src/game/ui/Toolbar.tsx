// The button bar over the view (clientd3d/toolbar.c), with the buttons merintr adds
// (mermain.c default_buttons: Help, Drop, Get, Rest/Stand) and mailnews's mailbox
// (mailnews.c mail_buttons). merintr's separator takes no room: ToolbarAddButton leaves
// num_separators out of the position. Each bitmap holds the button out (left half) and in
// (right half), drawn transparently over the window background. Rest/Stand is a toggle:
// it stays in while resting (command.c CommandRest / CommandStand ToolbarSetButtonState).

import { useState } from "react";
import type { AssetStore } from "../../assets.ts";
import { useKeyedHalves } from "./keyed.ts";

/** One button: the bitmap, its tooltip (merintr.rc IDS_TB*, mailnews.rc IDS_READMAIL), and what it does */
export interface ToolbarButton {
  bitmap: string;
  name: string;
  onClick: () => void;
  /** A toggle's state (b->pressed); undefined for a plain button */
  pressed?: boolean;
}

function Button({ assets, button, tooltips }: { assets: AssetStore; button: ToolbarButton; tooltips: boolean }) {
  const halves = useKeyedHalves(assets.url(`ui/${button.bitmap}`));
  // ToolbarDrawButton: the right half while held down (ODS_SELECTED) or toggled in
  const [down, setDown] = useState(false);
  const pressed = down || !!button.pressed;
  return (
    <button
      type="button"
      className="toolbar-button"
      title={tooltips ? button.name : undefined}
      aria-label={button.name}
      aria-pressed={button.pressed}
      style={halves ? { backgroundImage: `url(${halves[pressed ? 1 : 0]})` } : undefined}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onClick={(e) => {
        // ToolbarCommand: don't leave the keyboard focus on the button
        e.currentTarget.blur();
        button.onClick();
      }}
    >
      {!halves && button.name}
    </button>
  );
}

export function Toolbar({ assets, buttons, tooltips }: { assets: AssetStore; buttons: ToolbarButton[]; tooltips: boolean }) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Toolbar">
      {buttons.map((b) => (
        <Button key={b.bitmap} assets={assets} button={b} tooltips={tooltips} />
      ))}
    </div>
  );
}
