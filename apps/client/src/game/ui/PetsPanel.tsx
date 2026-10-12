// Ours (docs/adr/0006-pets.md section 4): the Pets tab of the character window and the interface
// column, from the ☰ menu's Actions and the Pets key too. The kinds as pictures, the locked ones
// dimmed with the health they need; a click picks one (or No pet); the chosen one turning slowly,
// its colours, its name. It flows to fit, from the Classic column's narrow page to the Modern window's.

import { useEffect, useState } from "react";
import { ANIMATE } from "@shards/protocol";
import { PET_KINDS, PET_NAME_MAX, cleanPetName, localRes, petUnlocked, type PetChoice, type PetKind } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import { Button } from "./kit.tsx";
import { PanelSection } from "./FriendsPanel.tsx";

const KINDS = Object.entries(PET_KINDS) as [string, PetKind][];
/** The preview turns a view (an eighth) this often (ms) */
const TURN_MS = 400;

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
  icons, current, maxHealth, onChoose,
}: {
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
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTurn((a) => (a + 1) % 8), TURN_MS);
    return () => clearInterval(t);
  }, []);
  const chosen = current ? (PET_KINDS as Record<string, PetKind>)[current.kind] : undefined;
  const pick = (kind: string, colour = 0) => onChoose({ kind, colour, name: cleanPetName(name) });

  return (
    <div className="pets-panel">
      <PanelSection title="Your pet">
        <div className="pet-current">
          <div className="pet-preview">
            {chosen ? <PetPicture icons={icons} kind={chosen} angle={turn * 512} xlat={chosen.colours[current!.colour]?.xlat ?? 0} /> : <span>No pet</span>}
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
            const locked = !open(key, 0);
            return (
              <button
                key={key}
                type="button"
                className={`pet-tile${current?.kind === key ? " selected" : ""}${locked ? " locked" : ""}`}
                title={locked ? `${k.label}: needs ${k.health} maximum health` : k.label}
                disabled={locked}
                onClick={() => pick(key)}
              >
                <PetPicture icons={icons} kind={k} />
                <span>{locked ? `${k.health} health` : k.label}</span>
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
