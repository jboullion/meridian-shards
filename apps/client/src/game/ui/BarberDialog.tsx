// Ours (docs/adr/0012-cosmetics.md 4): the barber's chair. The character creator's Appearance page
// (AppearanceEditor) showing only hair, facial hair and hair colour, starting from our look as
// the barber's menu sends it (UC_COSMETICS, util/cosmeticsbook.kod SendBarberMenu). OK sends
// `barber <hair> <beard> <hair colour>`, which the server checks and charges for.

import { useState } from "react";
import type { CharInfo } from "@shards/protocol";
import { barberCommand, type BarberLook } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import { AppearanceEditor, facePicks, type Face } from "./AppearanceEditor.tsx";
import { Button, Text, Window, at } from "./kit.tsx";

export function BarberDialog({
  name, price, look, info, icons, onCommand, onClose,
}: {
  /** The barber's name */
  name: string;
  price: number;
  look: BarberLook;
  /** The creator's lists (BP_CHARINFO), null until they arrive */
  info: CharInfo | null;
  icons: IconRenderer;
  onCommand: (line: string) => void;
  onClose: () => void;
}) {
  const [face, setFace] = useState<Face>({
    gender: look.gender, hair: look.hair, eyes: look.eyes, nose: look.nose, mouth: look.mouth, beard: look.beard, hairT: look.hairColour, faceT: look.skin,
  });
  const p = info ? facePicks(info, face) : null;
  const changed = !!p && (p.at.hair !== look.hair || p.at.beard !== look.beard || p.at.hairT !== look.hairColour);

  return (
    <div className="mk-modal">
      <Window title={name} dlu={[320, 196]} wide onClose={onClose}>
        {info ? (
          <AppearanceEditor
            info={info}
            face={face}
            onChange={(f) => setFace({ ...f, gender: look.gender, faceT: look.skin })}
            icons={icons}
            at={[2, 2, 316, 160]}
            intro={`A new cut or colour: ${price} shillings.`}
            rows={["hair", "beard", "hairT"]}
          />
        ) : (
          <Text at={[14, 80, 290, 10]}>Asking for the styles to choose from…</Text>
        )}
        <div style={at([160, 176, 158, 14], "y")}>
          <Button at={[0, 0, 74, 14]} isDefault disabled={!changed} onClick={() => p && (onCommand(barberCommand(p.at.hair, p.at.beard, p.at.hairT)), onClose())}>
            Cut ({price})
          </Button>
          <Button at={[84, 0, 74, 14]} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Window>
    </div>
  );
}
