// Ours (docs/adr/0006-pets.md section 4): the Pets window, from the ☰ menu's Actions and the Pets
// key. The kinds as pictures, the locked ones dimmed with the health they need; the chosen one
// turning slowly; its colours; a name; No pet, OK and Cancel. Laid out in dialog units with the kit.

import { useEffect, useState, type ReactNode } from "react";
import { ANIMATE } from "@shards/protocol";
import { PET_KINDS, PET_NAME_MAX, cleanPetName, localRes, petUnlocked, type PetChoice, type PetKind } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import { Button, Text, TextField, Window } from "./kit.tsx";

const KINDS = Object.entries(PET_KINDS) as [string, PetKind][];
/** The preview turns a view (an eighth) this often (ms) */
const TURN_MS = 400;

function Modal({ children }: { children: ReactNode }) {
  return <div className="mk-modal options-modal">{children}</div>;
}

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

export function PetsWindow({
  icons, current, maxHealth, onChoose, onClose,
}: {
  icons: IconRenderer;
  /** Our pet now, or null */
  current: PetChoice | null;
  /** Our maximum health (STAT_HP's max), what unlocks kinds and colours (2.1); null before the server says */
  maxHealth: number | null;
  onChoose: (pet: PetChoice | null) => void;
  onClose: () => void;
}) {
  const health = maxHealth ?? 0;
  // 2.3: a pet we have stays ours even below its tier
  const open = (kind: string, colour: number) => petUnlocked(kind, colour, health) || (current?.kind === kind && current.colour === colour);
  const [kind, setKind] = useState<string | null>(current?.kind ?? null);
  const [colour, setColour] = useState(current?.colour ?? 0);
  const [name, setName] = useState(current?.name ?? "");
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTurn((a) => (a + 1) % 8), TURN_MS);
    return () => clearInterval(t);
  }, []);
  const chosen = kind ? (PET_KINDS as Record<string, PetKind>)[kind] : undefined;
  const ok = !chosen || open(kind!, colour);

  return (
    <Modal>
      <Window title="Pets" dlu={[300, 214]} wide onClose={onClose} className="options-dialog pets-window">
        <Text at={[6, 5, 288, 16]} wrap>
          Your pet follows you about, seen by everyone playing Meridian Shards. More open up as your maximum health grows
          {maxHealth !== null ? ` (yours is ${maxHealth})` : ""}.
        </Text>
        <div className="pet-grid" style={{ position: "absolute", left: "calc(var(--dx) * 6)", top: "calc(var(--dy) * 24)", width: "calc(var(--dx) * 186)" }}>
          {KINDS.map(([key, k]) => {
            const locked = !open(key, 0);
            return (
              <button
                key={key}
                type="button"
                className={`pet-tile${kind === key ? " selected" : ""}${locked ? " locked" : ""}`}
                title={locked ? `${k.label}: needs ${k.health} maximum health` : k.label}
                onClick={() => {
                  setKind(key);
                  setColour(0);
                }}
              >
                <PetPicture icons={icons} kind={k} />
                <span>{locked ? `${k.health} health` : k.label}</span>
              </button>
            );
          })}
        </div>
        <div className="pet-preview" style={{ position: "absolute", left: "calc(var(--dx) * 198)", top: "calc(var(--dy) * 24)", width: "calc(var(--dx) * 96)", height: "calc(var(--dy) * 96)" }}>
          {chosen ? <PetPicture icons={icons} kind={chosen} angle={turn * 512} xlat={chosen.colours[colour]?.xlat ?? 0} /> : <span>No pet</span>}
        </div>
        {chosen && chosen.colours.length > 1 && (
          <div className="pet-colours" style={{ position: "absolute", left: "calc(var(--dx) * 198)", top: "calc(var(--dy) * 124)", width: "calc(var(--dx) * 96)" }}>
            {chosen.colours.map((c, i) => (
              <button
                key={c.label}
                type="button"
                className={`${i === colour ? "selected" : ""}${open(kind!, i) ? "" : " locked"}`}
                title={open(kind!, i) ? c.label : `${c.label}: needs ${c.health} maximum health`}
                onClick={() => setColour(i)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <Text at={[6, 172, 40, 8]}>Its name:</Text>
        <TextField at={[46, 170, 110, 12]} value={name} onChange={setName} maxLength={PET_NAME_MAX} />
        <Text at={[160, 172, 134, 8]} className="pets-note">
          {chosen && !ok ? `${chosen.label} needs ${Math.max(chosen.health, chosen.colours[colour]?.health ?? 0)} maximum health.` : chosen ? chosen.label : ""}
        </Text>
        <Button at={[6, 194, 60, 14]} onClick={() => setKind(null)}>
          No pet
        </Button>
        <Button
          at={[182, 194, 54, 14]}
          isDefault
          disabled={!ok}
          onClick={() => {
            onChoose(chosen && kind ? { kind, colour, name: cleanPetName(name) } : null);
            onClose();
          }}
        >
          OK
        </Button>
        <Button at={[240, 194, 54, 14]} onClick={onClose}>
          Cancel
        </Button>
      </Window>
    </Modal>
  );
}
