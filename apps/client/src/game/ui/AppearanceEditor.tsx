// The character creator's Appearance page (char.rc IDD_CHARAPPEARANCE, charface.c): gender,
// skin colour, hair, hair colour, eyes, nose, mouth and (ours) facial hair, with the face drawn
// from the server's parts (head plus overlays on hotspots 12, 11, 14, 13). Shared by the
// character creator and, ours, our companion's looks (docs/adr/0010-followers.md 9.3).

import { Fragment, useMemo, type ReactNode } from "react";
import { ANIMATE, type CharInfo } from "@shards/protocol";
import type { IconRenderer } from "../icons.ts";
import { useTurnDrag } from "./hooks.ts";
import { Button, Check, GroupBox, Text, Trackbar, at, type Rect } from "./kit.tsx";
import { ObjIcon } from "./Sidebar.tsx";

/** charface.c: hotspots for the mouth, eyes, nose and hair */
const HS = { mouth: 12, eyes: 11, nose: 14, hair: 13 };

/**
 * A face as places in BP_CHARINFO's lists: gender 0 male, 1 female; hair, eyes, nose, mouth and
 * hairT wrap around their lists (kept in range by facePicks); beard 0 none, else parts.beards[n - 1];
 * faceT a place in faceTranslations.
 */
export interface Face {
  gender: number;
  hair: number;
  eyes: number;
  nose: number;
  mouth: number;
  beard: number;
  hairT: number;
  faceT: number;
}

const rand = (n: number) => Math.floor(Math.random() * n);

/** charface.c CharFaceInit: random starting looks (facial hair starts as none) */
export function randomFace(info: CharInfo): Face {
  const gender = rand(2);
  const p = info.parts[gender];
  return {
    gender, hair: rand(p.hair.length), eyes: rand(p.eyes.length), nose: rand(p.noses.length), mouth: rand(p.mouths.length),
    hairT: rand(info.hairTranslations.length), faceT: rand(info.faceTranslations.length), beard: 0,
  };
}

/** CharRecomputeFace: keep a place in range when the gender changes */
const wrap = (i: number, n: number) => (n ? ((i % n) + n) % n : 0);

/** A face's places brought into range, and the parts and translations they pick */
export function facePicks(info: CharInfo, face: Face) {
  const parts = info.parts[face.gender];
  const at = {
    hair: wrap(face.hair, parts.hair.length),
    eyes: wrap(face.eyes, parts.eyes.length),
    nose: wrap(face.nose, parts.noses.length),
    mouth: wrap(face.mouth, parts.mouths.length),
    beard: wrap(face.beard, parts.beards.length + 1),
    hairT: wrap(face.hairT, info.hairTranslations.length),
    faceT: face.faceT,
  };
  return {
    parts,
    at,
    hair: parts.hair[at.hair],
    eyes: parts.eyes[at.eyes],
    nose: parts.noses[at.nose],
    mouth: parts.mouths[at.mouth],
    // Ours: none, or one of the server's facial hair choices
    beard: at.beard === 0 ? 0 : parts.beards[at.beard - 1],
    hairT: info.hairTranslations[at.hairT] ?? 0,
    faceT: info.faceTranslations[at.faceT] ?? 0,
  };
}

/** A right-aligned label (the .rc LTEXTs that end at their control). */
function Label({ at: r, children }: { at: Rect; children: ReactNode }) {
  return (
    <Text at={r} className="right">
      {children}
    </Text>
  );
}

type Step = "hair" | "eyes" | "nose" | "mouth" | "beard" | "hairT";

/** The editor's rows; a barber shows only hair, facial hair and hair colour */
export type AppearanceRow = "gender" | "skin" | Step;
const ALL_ROWS: readonly AppearanceRow[] = ["gender", "skin", "hair", "hairT", "eyes", "nose", "mouth", "beard"];
const STEP_LABELS: [Step, string][] = [
  ["hair", "Hair:"], ["hairT", "Hair color:"], ["eyes", "Eyes:"], ["nose", "Nose:"], ["mouth", "Mouth:"], ["beard", "Beard:"],
];

/** The page: laid out in a 316 x 232 DLU rect (`at`), as the creator's sheet has it */
export function AppearanceEditor({
  info, face, onChange, icons, at: r, intro = "Choose your character's appearance.", rows = ALL_ROWS, children,
}: {
  info: CharInfo;
  face: Face;
  onChange: (face: Face) => void;
  icons: IconRenderer;
  at: Rect;
  intro?: string;
  /** Ours: the rows to show (all by default); the arrows close up under the ones kept */
  rows?: readonly AppearanceRow[];
  /** More controls on the page (the creator's Prev and Next) */
  children?: ReactNode;
}) {
  const p = facePicks(info, face);
  // Ours: the head turns through its views as it's dragged, like the character window's figure
  const [angle, turn, front] = useTurnDrag();
  const none = { type: ANIMATE.NONE, group: 1 };
  const faceObject = useMemo(
    () => ({
      iconRes: p.parts.head, animation: none, translation: p.faceT,
      overlays: [
        { iconRes: p.mouth, hotspot: HS.mouth, translation: p.faceT, effect: 0, animation: none },
        { iconRes: p.eyes, hotspot: HS.eyes, translation: p.faceT, effect: 0, animation: none },
        { iconRes: p.nose, hotspot: HS.nose, translation: p.faceT, effect: 0, animation: none },
        // Ours (player.kod SendOverlays): facial hair on the mouth's hotspot, in the hair colour
        ...(p.beard ? [{ iconRes: p.beard, hotspot: HS.mouth, translation: p.hairT, effect: 0, animation: none }] : []),
        { iconRes: p.hair, hotspot: HS.hair, translation: p.hairT, effect: 0, animation: none },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.parts.head, p.mouth, p.eyes, p.nose, p.hair, p.beard, p.faceT, p.hairT],
  );

  const step = (key: Step, d: number) => onChange({ ...face, [key]: face[key] + d });
  const arrows = (y: number, text: string, key: Step) => (
    <>
      <Label at={[140, y + 1, 55, 8]}>{text}</Label>
      <Button at={[213, y, 17, 11]} onClick={() => step(key, -1)} title={`Previous ${text.slice(0, -1).toLowerCase()}`}>
        &lt;
      </Button>
      <Button at={[230, y, 17, 11]} onClick={() => step(key, 1)} title={`Next ${text.slice(0, -1).toLowerCase()}`}>
        &gt;
      </Button>
    </>
  );

  return (
    <div style={at(r)}>
      <GroupBox at={[3, 0, 150, 158]} label="Face" />
      <div className="mk-face" style={at([14, 18, 127, 127])} title="Drag to turn" onPointerDown={turn} onDoubleClick={front}>
        <ObjIcon icons={icons} object={faceObject} opts={{ angle }} className="face" />
      </div>
      <Text at={[14, 147, 127, 8]} className="mk-face-hint">
        Drag to rotate head
      </Text>
      <Text at={[175, 3, 135, 18]} wrap>
        {intro}
      </Text>
      {rows.includes("gender") && (
        <>
          <Label at={[140, 22, 55, 8]}>Gender:</Label>
          <Check at={[213, 21, 45, 10]} radio name="gender" label="Male" checked={face.gender === 0} onChange={() => onChange({ ...face, gender: 0 })} />
          <Check at={[263, 21, 45, 10]} radio name="gender" label="Female" checked={face.gender === 1} onChange={() => onChange({ ...face, gender: 1 })} />
        </>
      )}
      {rows.includes("skin") && (
        <>
          <Label at={[140, 42, 55, 8]}>Skin color:</Label>
          <Trackbar
            at={[213, 35, 90, 15]}
            label="Skin color"
            min={0}
            max={Math.max(0, info.faceTranslations.length - 1)}
            value={face.faceT}
            onChange={(v) => onChange({ ...face, faceT: v })}
          />
          <Text at={[215, 55, 20, 8]}>Light</Text>
          <Text at={[287, 55, 20, 8]}>Dark</Text>
        </>
      )}
      {/* Ours: rows 13 apart (the original's 15) to fit Beard above Prev / Next; with gender and
          skin hidden they start higher */}
      {STEP_LABELS.filter(([k]) => rows.includes(k) && (k !== "beard" || p.parts.beards.length > 0)).map(([k, label], i) => (
        <Fragment key={k}>{arrows((rows.includes("gender") || rows.includes("skin") ? 66 : 30) + 13 * i, label, k)}</Fragment>
      ))}
      {children}
    </div>
  );
}
