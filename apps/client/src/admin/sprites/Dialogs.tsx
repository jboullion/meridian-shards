// The sprite editor's dialogs: importing a picture as a frame, and starting a new sprite.

import { useEffect, useMemo, useRef, useState } from "react";
import { parseBgf } from "@shards/formats";
import { spriteBytes } from "../api.ts";
import { FrameThumb } from "./PixelCanvas.tsx";
import { readImage, toIndices, type ImportOptions, type Rgba } from "./importImage.ts";
import { blankFrame, fromBgf, newSprite, type Frame, type Kind, type Preset, type Sprite } from "./model.ts";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box">
        <div className="buttons">
          <h2>{title}</h2>
          <button style={{ marginLeft: "auto" }} onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- import a picture

export type ImportTarget = "replace" | "add" | "new";

export function ImportDialog(p: {
  palette: Uint8Array;
  frame: Frame | null;
  kind: Kind;
  allowed: Set<number> | null;
  onClose: () => void;
  onApply: (px: Uint8Array, w: number, h: number, target: ImportTarget) => void;
}) {
  const [img, setImg] = useState<Rgba | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opts, setOpts] = useState<ImportOptions>(() => ({
    removeBackground: true,
    key: null,
    tolerance: 60,
    crop: true,
    w: p.frame?.w ?? 32,
    h: p.frame?.h ?? 32,
    scaling: "box",
    colours: p.kind === "other" ? "palette" : "ramp",
  }));
  const set = (o: Partial<ImportOptions>) => setOpts((x) => ({ ...x, ...o }));
  const source = useRef<HTMLCanvasElement>(null);

  const open = (f: File | undefined) => {
    if (!f) return;
    readImage(f).then(
      (i) => {
        setImg(i);
        setProblem(null);
        if (!p.frame) set({ w: Math.min(i.w, 128), h: Math.min(i.h, 128) });
      },
      (e: unknown) => setProblem(`Couldn't read that picture: ${(e as Error).message}`),
    );
  };

  useEffect(() => {
    const c = source.current;
    if (!c || !img) return;
    c.width = img.w;
    c.height = img.h;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  }, [img]);

  const result = useMemo(() => {
    if (!img || opts.w < 1 || opts.h < 1) return null;
    try {
      const f = blankFrame(opts.w, opts.h);
      f.px = toIndices(img, p.palette, opts, opts.colours === "palette" ? p.allowed : null);
      return f;
    } catch (e) {
      return (e as Error).message;
    }
  }, [img, opts, p.palette, p.allowed]);

  const pickKey = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!img) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * img.w),
      y = Math.floor(((e.clientY - r.top) / r.height) * img.h);
    const i = (y * img.w + x) * 4;
    set({ key: [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!], removeBackground: true });
  };

  const sameSize = !!p.frame && p.frame.w === opts.w && p.frame.h === opts.h;
  const ok = result && typeof result !== "string";
  return (
    <Modal title="Import a picture" onClose={p.onClose}>
      <div
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          open(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" accept="image/*" onChange={(e) => open(e.target.files?.[0])} />
        <span className="dim">or drop a PNG here</span>
      </div>
      {problem && <div className="error">{problem}</div>}
      <div className="import">
        <div>
          <h2>Picture {img && <span className="dim">{img.w}x{img.h}: click it to pick the background</span>}</h2>
          <canvas ref={source} className="source" onPointerDown={pickKey} />
        </div>
        <div>
          <label className="check">
            <input type="checkbox" checked={opts.removeBackground} onChange={(e) => set({ removeBackground: e.target.checked })} /> Remove the background
          </label>
          <div className="buttons">
            Background:
            {opts.key ? <span className="swatch" style={{ background: `rgb(${opts.key.join(",")})` }} /> : <span className="dim">the corners' colour</span>}
            {opts.key && <button onClick={() => set({ key: null })}>Corners</button>}
          </div>
          <label>
            Tolerance {opts.tolerance}
            <input type="range" min={5} max={200} value={opts.tolerance} onChange={(e) => set({ tolerance: Number(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.crop} onChange={(e) => set({ crop: e.target.checked })} /> Crop to what's solid
          </label>
          <div className="buttons">
            Size
            <input className="num" type="number" min={1} max={512} value={opts.w} onChange={(e) => set({ w: Number(e.target.value) })} />x
            <input className="num" type="number" min={1} max={512} value={opts.h} onChange={(e) => set({ h: Number(e.target.value) })} />
            {p.frame && !sameSize && <button onClick={() => set({ w: p.frame!.w, h: p.frame!.h })}>This frame's</button>}
          </div>
          <label>
            Scaling
            <select value={opts.scaling} onChange={(e) => set({ scaling: e.target.value as ImportOptions["scaling"] })}>
              <option value="box">Box (average): big pictures</option>
              <option value="nearest">Nearest: pixel art</option>
            </select>
          </label>
          <label>
            Colours
            <select value={opts.colours} onChange={(e) => set({ colours: e.target.value as ImportOptions["colours"] })}>
              <option value="ramp">Hair ramp by brightness (recolourable hair)</option>
              <option value="palette">Nearest palette colour{p.allowed ? " (in the lock)" : ""}</option>
            </select>
          </label>
        </div>
        <div>
          <h2>As a frame</h2>
          {typeof result === "string" && <div className="error">{result}</div>}
          {ok && <FrameThumb frame={result} palette={p.palette} scale={4} max={256} />}
        </div>
      </div>
      <div className="buttons">
        <button disabled={!ok || !p.frame} onClick={() => ok && p.onApply(result.px, opts.w, opts.h, "replace")}>
          Replace this frame{p.frame && !sameSize ? " (and its size)" : ""}
        </button>
        <button disabled={!ok || !p.frame} onClick={() => ok && p.onApply(result.px, opts.w, opts.h, "add")}>
          Add as a new frame
        </button>
        <button disabled={!ok} onClick={() => ok && p.onApply(result.px, opts.w, opts.h, "new")}>
          Start a new sprite with it
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- a new sprite

const REFERENCE: Record<"hair" | "beard", string> = { hair: "ptsa.bgf", beard: "pbda.bgf" };

export function NewSpriteDialog(p: { taken: Set<string>; first?: { px: Uint8Array; w: number; h: number } | null; onClose: () => void; onCreate: (s: Sprite) => void }) {
  const [file, setFile] = useState("");
  const [preset, setPreset] = useState<Preset>(p.first ? "generic" : "hair");
  const [reference, setReference] = useState("");
  const [keepPixels, setKeepPixels] = useState(false);
  const [size, setSize] = useState({ w: p.first?.w ?? 32, h: p.first?.h ?? 32, shrink: 4 });
  const [problem, setProblem] = useState<string | null>(null);

  const name = file.trim().toLowerCase().replace(/\.bgf$/, "") + ".bgf";
  const nameProblem = !/^[a-z0-9_-]{1,20}\.bgf$/.test(name)
    ? "A file name: letters, digits, - and _ (the classic names are 8 letters or fewer)"
    : p.taken.has(name)
      ? `${name} already exists: open it instead`
      : preset === "hair" && !name.startsWith("pt")
        ? "Hairstyles' files start with pt (e.g. ptsm.bgf) so the editor knows them"
        : preset === "beard" && !name.startsWith("pbd")
          ? "Facial hair files start with pbd (e.g. pbdg.bgf)"
          : null;

  const create = async () => {
    try {
      let ref: Sprite | null = null;
      if (preset !== "generic") {
        const from = reference.trim().toLowerCase() || REFERENCE[preset];
        ref = fromBgf(from, await parseBgf(await spriteBytes(from.endsWith(".bgf") ? from : `${from}.bgf`)));
      }
      const s = newSprite(name, preset, { reference: ref, keepPixels, w: size.w, h: size.h, shrink: size.shrink });
      if (p.first && s.frames[0]) {
        const f0 = s.frames[0];
        if (f0.w === p.first.w && f0.h === p.first.h) f0.px = p.first.px.slice();
        else s.frames[0] = { ...blankFrame(p.first.w, p.first.h, f0.xoff, f0.yoff), hotspots: f0.hotspots, px: p.first.px.slice() };
      }
      p.onCreate(s);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };

  return (
    <Modal title="New sprite" onClose={p.onClose}>
      <label>
        File name
        <input autoFocus value={file} placeholder={preset === "hair" ? "ptsm" : preset === "beard" ? "pbdg" : "myicon"} onChange={(e) => setFile(e.target.value)} />
      </label>
      {file && nameProblem && <div className="dim">{nameProblem}</div>}
      <label>
        Kind
        <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          <option value="hair">Hairstyle: 6 views on the head's toupee hotspot</option>
          <option value="beard">Facial hair: 5 views on the mouth</option>
          <option value="generic">Anything else: one frame</option>
        </select>
      </label>
      {preset !== "generic" ? (
        <>
          <label>
            Frames, sizes and offsets from
            <input value={reference} placeholder={REFERENCE[preset]} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={keepPixels} onChange={(e) => setKeepPixels(e.target.checked)} /> Copy its pixels too
          </label>
          {p.first && <div className="dim">The imported picture becomes its first view.</div>}
        </>
      ) : (
        <div className="buttons">
          Size
          <input className="num" type="number" min={1} max={512} value={size.w} disabled={!!p.first} onChange={(e) => setSize({ ...size, w: Number(e.target.value) })} />x
          <input className="num" type="number" min={1} max={512} value={size.h} disabled={!!p.first} onChange={(e) => setSize({ ...size, h: Number(e.target.value) })} />
          Shrink
          <input className="num" type="number" min={1} max={255} value={size.shrink} onChange={(e) => setSize({ ...size, shrink: Number(e.target.value) })} />
        </div>
      )}
      {problem && <div className="error">{problem}</div>}
      <div className="buttons">
        <button disabled={!!nameProblem} onClick={() => void create()}>
          Create {nameProblem ? "" : name}
        </button>
        <span className="dim">It's saved when you press Save.</span>
      </div>
    </Modal>
  );
}
