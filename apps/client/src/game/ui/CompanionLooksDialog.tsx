// Ours (docs/adr/0010-followers.md 9.3): our companion's looks. The character creator's
// Appearance page (AppearanceEditor) started from its look, and its shirt and legs in the colours
// its kind may wear. OK sends `companion look ...` (util/companionbook.kod Look checks every
// place against the server's lists and answers with a new status).

import { useState } from "react";
import type { CharInfo } from "@shards/protocol";
import { buildLookCommand, type CompanionStatus } from "@shards/world";
import type { IconRenderer } from "../icons.ts";
import { AppearanceEditor, facePicks, type Face } from "./AppearanceEditor.tsx";
import { Button, Text, Window, at } from "./kit.tsx";

/** blakston.khd XLAT_TO_*, the clothes colours a companion's palette names */
const CLOTHES: Record<number, string> = {
  0x00: "Red", 0x04: "Orange", 0x05: "Green", 0x06: "Blue", 0x07: "Purple", 0x08: "Yellow", 0x09: "Gray", 0x0a: "Sky", 0x0b: "Dark green", 0x0c: "Black",
};

export function CompanionLooksDialog({
  status, info, icons, onCommand, onClose,
}: {
  status: CompanionStatus;
  /** The creator's lists (BP_CHARINFO), null until they arrive */
  info: CharInfo | null;
  icons: IconRenderer;
  onCommand: (line: string) => void;
  onClose: () => void;
}) {
  const l = status.look;
  const [face, setFace] = useState<Face>({
    gender: l.gender, hair: l.hair, eyes: l.eyes, nose: l.nose, mouth: l.mouth, beard: l.beard, hairT: l.hairColour, faceT: l.skin,
  });
  const [colours, setColours] = useState<[number, number]>([l.colour1, l.colour2]);

  const ok = () => {
    if (!info) return;
    const p = facePicks(info, face);
    onCommand(
      buildLookCommand({
        gender: face.gender, hair: p.at.hair, eyes: p.at.eyes, nose: p.at.nose, mouth: p.at.mouth, beard: p.at.beard,
        hairColour: p.at.hairT, skin: p.at.faceT, colour1: colours[0], colour2: colours[1],
      }),
    );
    onClose();
  };

  const row = (y: number, label: string, which: 0 | 1) => (
    <>
      <Text at={[14, y + 2, 40, 8]} className="right">
        {label}
      </Text>
      <div className="pet-colours companion-colours" style={at([60, y, 250, 14])}>
        {status.palette.map((x, i) => (
          <button
            key={i}
            type="button"
            className={i === colours[which] ? "selected" : ""}
            onClick={() => setColours(which === 0 ? [i, colours[1]] : [colours[0], i])}
          >
            {CLOTHES[x] ?? `Colour ${i + 1}`}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="mk-modal">
      <Window title={`${status.name}'s appearance`} dlu={[320, 226]} wide onClose={onClose}>
        {info ? (
          <>
            <AppearanceEditor info={info} face={face} onChange={setFace} icons={icons} at={[2, 2, 316, 160]} intro={`Choose how ${status.name} looks.`} />
            {row(166, "Shirt:", 0)}
            {row(184, "Legs:", 1)}
          </>
        ) : (
          <Text at={[14, 80, 290, 10]}>Asking for the faces to choose from…</Text>
        )}
        <div style={at([214, 208, 104, 14], "y")}>
          <Button at={[0, 0, 50, 14]} isDefault disabled={!info} onClick={ok}>
            OK
          </Button>
          <Button at={[54, 0, 50, 14]} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Window>
    </div>
  );
}
