// Ours (docs/adr/0006-pets.md section 4): the Pets tab of the character window and the interface
// column, from the ☰ menu's Actions and the Pets key too. The kinds as pictures, the locked ones
// dimmed with the health they need; a click picks one (or No pet); the chosen one turning slowly,
// its colours, its name. It flows to fit, from the Classic column's narrow page to the Modern window's.
// The chosen one turns when dragged, as the paper doll's figure does.

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ANIMATE } from "@shards/protocol";
import { PET_KINDS, PET_NAME_MAX, cleanPetName, localRes, petForKarma, petUnlocked, type PetChoice, type PetKind } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import { Button } from "./kit.tsx";
import { PanelSection } from "./FriendsPanel.tsx";

/** The kinds as the window shows them: a group (the fey) once, as its karma's kind */
const KINDS = (Object.entries(PET_KINDS) as [string, PetKind][]).filter(([, k]) => !k.group || k.group.karma === "good");
/** Dragging the preview: a view (an eighth of a turn) per this much of its width, as the paper doll */
const VIEW_STEP = 4096 / 8;
const DRAG_PER_VIEW = 0.175;

/** A kind's picture, standing, from a view angle (0 = the front), in a colour */
function PetPicture({ icons, kind, angle = 0, xlat = 0 }: { icons: IconRenderer; kind: PetKind; angle?: number; xlat?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    icons
      .object({ iconRes: localRes(kind.icon), animation: { type: ANIMATE.NONE, group: 1 }, overlays: [], translation: xlat }, { angle })
      .then((u) => live && setUrl(u))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [icons, kind, angle, xlat]);
  return url ? <img src={url} alt="" draggable={false} /> : null;
}

export function PetsPanel({
  icons, current, maxHealth, karma, onChoose,
}: {
  /** Our karma (-100 to 100), which picks the fey's kind; null before the server says */
  karma: number | null;
  icons: IconRenderer;
  /** Our pet now, or null */
  current: PetChoice | null;
  /** Our maximum health (piMax_health), what unlocks kinds and colours (2.1); null before the server says */
  maxHealth: number | null;
  onChoose: (pet: PetChoice | null) => void;
}) {
  const health = maxHealth ?? 0;
  // 2.3: a pet we have stays ours even below its tier
  const open = (kind: string, colour: number) => petUnlocked(kind, colour, health) || (current?.kind === kind && current.colour === colour);
  const [name, setName] = useState(current?.name ?? "");
  const [angle, setAngle] = useState(0);
  // Dragged to turn, as CharacterWindow.tsx Figure
  const turn = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const width = el.getBoundingClientRect().width;
    const startX = e.clientX,
      start = angle;
    const move = (ev: PointerEvent) => {
      const views = Math.round((ev.clientX - startX) / (width * DRAG_PER_VIEW));
      setAngle((((start - views * VIEW_STEP) % 4096) + 4096) % 4096);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const chosen = current ? (PET_KINDS as Record<string, PetKind>)[current.kind] : undefined;
  /** A group's kind (the fey) as our karma has it */
  const resolve = (key: string) => {
    const g = (PET_KINDS as Record<string, PetKind>)[key]?.group;
    return g ? (petForKarma(g.name, karma) ?? key) : key;
  };
  const pick = (kind: string, colour = 0) => onChoose({ kind: resolve(kind), colour, name: cleanPetName(name) });

  return (
    <div className="pets-panel">
      <PanelSection title="Your pet">
        <div className="pet-current">
          <div className="pet-preview" title={chosen ? "Drag to turn" : undefined} onPointerDown={turn} onDoubleClick={() => setAngle(0)}>
            {chosen ? <PetPicture icons={icons} kind={chosen} angle={angle} xlat={chosen.colours[current!.colour]?.xlat ?? 0} /> : <span>No pet</span>}
          </div>
          <div className="pet-current-side">
            <b>{chosen ? chosen.label : "None"}</b>
            {chosen && (
              <label className="pet-name-field">
                <span>Name</span>
                <span className="mk-edit">
                  <input
                    value={name}
                    maxLength={PET_NAME_MAX}
                    spellCheck={false}
                    placeholder="(none)"
                    onChange={(e) => setName(e.target.value)}
                    // Kept as it's typed, tidied when done
                    onBlur={() => current && onChoose({ ...current, name: cleanPetName(name) })}
                    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                  />
                </span>
              </label>
            )}
            {chosen && chosen.colours.length > 1 && (
              <div className="pet-colours">
                {chosen.colours.map((c, i) => (
                  <button
                    key={c.label}
                    type="button"
                    className={`${i === current!.colour ? "selected" : ""}${open(current!.kind, i) ? "" : " locked"}`}
                    title={open(current!.kind, i) ? c.label : `${c.label}: needs ${c.health} maximum health`}
                    disabled={!open(current!.kind, i)}
                    onClick={() => pick(current!.kind, i)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {chosen && <Button onClick={() => onChoose(null)}>No pet</Button>}
          </div>
        </div>
      </PanelSection>
      <PanelSection title="Choose">
        <div className="pet-grid">
          {KINDS.map(([key, k]) => {
            // A group (the fey) shows the kind our karma calls for, under the group's name
            const shown = resolve(key);
            const sk = (PET_KINDS as Record<string, PetKind>)[shown] ?? k;
            const label = k.group?.label ?? k.label;
            const locked = !open(shown, 0);
            const mine = current?.kind === shown || (!!k.group && chosen?.group?.name === k.group.name);
            return (
              <button
                key={key}
                type="button"
                className={`pet-tile${mine ? " selected" : ""}${locked ? " locked" : ""}`}
                title={locked ? `${label}: needs ${k.health} maximum health` : k.group ? `${label}: good or dark as your karma is` : label}
                disabled={locked}
                onClick={() => pick(key)}
              >
                <PetPicture icons={icons} kind={sk} />
                <span>{locked ? `${k.health} health` : label}</span>
              </button>
            );
          })}
        </div>
      </PanelSection>
      <p className="panel-note">
        Your pet follows you about, seen by everyone playing Meridian Shards. More open up as your maximum health grows
        {maxHealth !== null ? ` (yours is ${maxHealth})` : ""}.
      </p>
    </div>
  );
}
