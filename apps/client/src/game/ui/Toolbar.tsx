// The toolbar's buttons (clientd3d/toolbar.c): merintr's (mermain.c default_buttons: Help, Drop,
// Get, Rest/Stand) and mailnews's mailbox (mailnews.c mail_buttons). Each bitmap holds the button
// out (left half) and in (right half), drawn transparently over the window background. Rest/Stand
// is a toggle: it stays in while resting (command.c CommandRest / CommandStand ToolbarSetButtonState).
//   - ClassicToolbar: the Classic interface's row over the view, as the original lays it out: the
//     buttons from TOOLBAR_X, the latency meter after them (lagbox.c), and the room's enchantments
//     right-aligned to the view's edge (enchant.c EnchantmentsResize room_enchant_x)
//   - the Modern interface's UnitFrame shows Rest/Stand and the mailbox beside our face

import { useState, type ReactNode } from "react";
import type { AssetStore } from "../../assets.ts";
import { useKeyedHalves } from "./keyed.ts";
import { LatencyMeter } from "../TitleBar.tsx";

/** One button: the bitmap, its tooltip (merintr.rc IDS_TB*, mailnews.rc IDS_READMAIL), and what it does */
export interface ToolbarButton {
  bitmap: string;
  name: string;
  onClick: () => void;
  /** A toggle's state (b->pressed); undefined for a plain button */
  pressed?: boolean;
}

export function ToolbarButtonView({ assets, button, tooltips }: { assets: AssetStore; button: ToolbarButton; tooltips: boolean }) {
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

/** The Classic interface's toolbar row over the view (graphics.c: the view starts MIN_TOP_TOOLBAR below it). */
export function ClassicToolbar({
  assets, buttons, tooltips, latency, children,
}: {
  assets: AssetStore;
  /** None with Show toolbar off (config.toolbar) */
  buttons?: ToolbarButton[];
  tooltips: boolean;
  /** The latency meter's round trip (null while measuring); undefined with Show latency meter off */
  latency?: number | null;
  /** The room's enchantments, right-aligned */
  children?: ReactNode;
}) {
  return (
    <div className="classic-toolbar">
      {buttons && (
        <div className="toolbar-buttons" role="toolbar" aria-label="Toolbar">
          {buttons.map((b) => (
            <ToolbarButtonView key={b.bitmap} assets={assets} button={b} tooltips={tooltips} />
          ))}
        </div>
      )}
      {latency !== undefined && <LatencyMeter ms={latency} tooltip={tooltips} />}
      <div className="classic-room-enchantments">{children}</div>
    </div>
  );
}
