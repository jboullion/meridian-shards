// Hair or facial hair on a head, at all eight angles, in a hair colour: drawn by the game's own
// compositor (packages/render sprites.ts), as shards-server's tools/iconforge/headrender.ts does,
// so an offset nudged here sits exactly as it will in the game.

import { useEffect, useMemo, useRef, useState } from "react";
import { parseBgf, type Bgf } from "@shards/formats";
import { compositeSprite, paletteToRgba, XLAT, type XlatTable } from "@shards/render";
import { spriteBytes } from "../api.ts";
import { HANG, toBgf, type Sprite } from "./model.ts";

const HEADS = {
  male: { head: "phax.bgf", eyes: "peax.bgf", nose: "pnax.bgf", mouth: "pmax.bgf" },
  female: { head: "phkx.bgf", eyes: "pekx.bgf", nose: "pnkx.bgf", mouth: "pmkx.bgf" },
} as const;
type Gender = keyof typeof HEADS;
type Head = { head: Bgf; eyes: Bgf; nose: Bgf; mouth: Bgf };

const heads = new Map<Gender, Promise<Head>>();
function loadHead(g: Gender): Promise<Head> {
  let p = heads.get(g);
  if (!p) {
    const f = HEADS[g];
    const get = async (n: string) => parseBgf(await spriteBytes(n));
    p = Promise.all([get(f.head), get(f.eyes), get(f.nose), get(f.mouth)]).then(([head, eyes, nose, mouth]) => ({ head, eyes, nose, mouth }));
    heads.set(g, p);
  }
  return p;
}

/** The heads are drawn in a blue ramp that a skin translation colours (hair.py uses DBLUETOSKIN2) */
const SKINS = [XLAT.DBLUETOSKIN1, XLAT.DBLUETOSKIN2, XLAT.DBLUETOSKIN3, XLAT.DBLUETOSKIN4];

/** Image pixels per head pixel on screen */
const SCALE = 4;

function View({ head, part, hotspot, colour, skin, slot, palette, xl }: { head: Head; part: Bgf; hotspot: number; colour: number; skin: number; slot: number; palette: Uint8Array; xl: XlatTable }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const c = useMemo(
    () =>
      compositeSprite(
        {
          base: { bgf: head.head, group: 0, translation: skin, hotspot: 0 },
          overlays: [
            { bgf: head.mouth, group: 0, translation: skin, hotspot: 12 },
            { bgf: head.eyes, group: 0, translation: skin, hotspot: 11 },
            { bgf: head.nose, group: 0, translation: skin, hotspot: 14 },
            { bgf: part, group: 0, translation: colour, hotspot },
          ],
          viewAngle: slot * 512,
        },
        xl,
      ),
    [head, part, hotspot, colour, skin, slot, xl],
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || !c) return;
    el.width = c.width;
    el.height = c.height;
    const img = new ImageData(new Uint8ClampedArray(paletteToRgba(c.pixels, c.width, c.height, palette, 3)), c.width, c.height);
    el.getContext("2d")!.putImageData(img, 0, 0);
  }, [c, palette]);
  if (!c) return <div className="view dim">no view</div>;
  return (
    <div className="view">
      <canvas ref={ref} style={{ width: (c.width / c.resolution) * SCALE, height: (c.height / c.resolution) * SCALE }} />
      <span className="dim">{slot}</span>
    </div>
  );
}

export function HeadPreview({ sprite, kind, palette, xl, colours }: { sprite: Sprite; kind: "hair" | "beard"; palette: Uint8Array; xl: XlatTable; colours: { name: string; id: number }[] }) {
  const [gender, setGender] = useState<Gender>(() => (kind === "beard" ? "male" : "female"));
  const [colour, setColour] = useState(0);
  const [skin, setSkin] = useState<number>(XLAT.DBLUETOSKIN2);
  const [head, setHead] = useState<Head | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadHead(gender).then(
      (h) => live && setHead(h),
      (e: unknown) => live && setProblem((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [gender]);
  const part = useMemo(() => toBgf(sprite), [sprite]);
  return (
    <div className="heads">
      <div className="buttons">
        <select value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
          <option value="male">Male head</option>
          <option value="female">Female head</option>
        </select>
        <select value={colour} onChange={(e) => setColour(Number(e.target.value))}>
          {colours.map((c) => (
            <option key={`${c.name}-${c.id}`} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={skin} onChange={(e) => setSkin(Number(e.target.value))}>
          {SKINS.map((s, i) => (
            <option key={s} value={s}>
              Skin {i + 1}
            </option>
          ))}
        </select>
      </div>
      {problem && <div className="error">{problem}</div>}
      <div className="views">{head && [0, 1, 2, 3, 4, 5, 6, 7].map((slot) => <View key={slot} head={head} part={part} hotspot={HANG[kind]} colour={colour} skin={skin} slot={slot} palette={palette} xl={xl} />)}</div>
    </div>
  );
}
