// The zoomed pixel canvas: draws a frame (with an onion skin, a grid and its hotspots) and runs
// the drawing tools. A stroke works on its own copy and hands the finished frame up once.

import { useEffect, useRef, useState } from "react";
import { TRANSPARENT_INDEX } from "@shards/formats";
import { cloneFrame, cut, floodFill, inside, linePoints, paste, plot, rectPoints, type Frame } from "./model.ts";

export type Tool = "pencil" | "eraser" | "fill" | "picker" | "line" | "rect" | "select";

export interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CHECK = [
  [58, 61, 70],
  [74, 78, 88],
];

/** A frame as RGBA at one pixel per pixel; transparent pixels show a checkerboard (or nothing) */
export function frameRgba(f: Frame, palette: Uint8Array, opts: { checker?: boolean; onion?: Frame | null } = {}): ImageData {
  const img = new ImageData(Math.max(1, f.w), Math.max(1, f.h));
  const d = img.data;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const o = (y * f.w + x) * 4;
      const v = f.px[y * f.w + x]!;
      if (v !== TRANSPARENT_INDEX) {
        d.set([palette[v * 3]!, palette[v * 3 + 1]!, palette[v * 3 + 2]!, 255], o);
        continue;
      }
      const under = opts.onion && inside(opts.onion, x, y) ? opts.onion.px[y * opts.onion.w + x]! : TRANSPARENT_INDEX;
      const c = opts.checker ? CHECK[(x + y) & 1]! : null;
      if (under !== TRANSPARENT_INDEX) {
        const k = 0.35;
        const base = c ?? [0, 0, 0];
        d.set([base[0]! * (1 - k) + palette[under * 3]! * k, base[1]! * (1 - k) + palette[under * 3 + 1]! * k, base[2]! * (1 - k) + palette[under * 3 + 2]! * k, 255], o);
      } else if (c) d.set([c[0]!, c[1]!, c[2]!, 255], o);
    }
  return img;
}

interface Props {
  frame: Frame;
  palette: Uint8Array;
  zoom: number;
  tool: Tool;
  /** Colours for the left and right buttons */
  primary: number;
  secondary: number;
  grid: boolean;
  onion: Frame | null;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  onCommit: (f: Frame) => void;
  onPick: (colour: number, button: number) => void;
  onHover: (p: { x: number; y: number; colour: number } | null) => void;
}

type Drag =
  | { kind: "paint"; base: Frame; work: Frame; colour: number; last: [number, number] }
  | { kind: "shape"; base: Frame; work: Frame; colour: number; from: [number, number] }
  | { kind: "select"; from: [number, number] }
  | { kind: "move"; lifted: Frame; hole: Frame; work: Frame; from: [number, number]; sel: Selection };

export function PixelCanvas(p: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  // the frame being drawn on (a stroke's copy), or null for the frame as it is
  const [work, setWork] = useState<Frame | null>(null);
  const [moving, setMoving] = useState<Selection | null>(null);

  const shown = work ?? p.frame;
  const sel = moving ?? p.selection;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const z = p.zoom;
    c.width = shown.w * z;
    c.height = shown.h * z;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const tmp = new OffscreenCanvas(Math.max(1, shown.w), Math.max(1, shown.h));
    tmp.getContext("2d")!.putImageData(frameRgba(shown, p.palette, { checker: true, onion: p.onion }), 0, 0);
    g.drawImage(tmp, 0, 0, shown.w * z, shown.h * z);
    if (p.grid && z >= 6) {
      g.strokeStyle = "rgba(0,0,0,0.25)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 1; x < shown.w; x++) {
        g.moveTo(x * z + 0.5, 0);
        g.lineTo(x * z + 0.5, shown.h * z);
      }
      for (let y = 1; y < shown.h; y++) {
        g.moveTo(0, y * z + 0.5);
        g.lineTo(shown.w * z, y * z + 0.5);
      }
      g.stroke();
    }
    for (const h of shown.hotspots) {
      const cx = (h.x + 0.5) * z,
        cy = (h.y + 0.5) * z,
        r = Math.max(4, z);
      g.strokeStyle = h.number < 0 ? "#4fc3f7" : "#ff5252";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - r, cy);
      g.lineTo(cx + r, cy);
      g.moveTo(cx, cy - r);
      g.lineTo(cx, cy + r);
      g.stroke();
      g.fillStyle = g.strokeStyle;
      g.font = "11px system-ui";
      g.fillText(String(h.number), cx + r + 2, cy - 2);
    }
    if (sel) {
      g.setLineDash([4, 3]);
      g.strokeStyle = "#ffd54f";
      g.lineWidth = 1;
      g.strokeRect(sel.x * z + 0.5, sel.y * z + 0.5, sel.w * z - 1, sel.h * z - 1);
      g.setLineDash([]);
    }
  }, [shown, p.palette, p.zoom, p.grid, p.onion, sel]);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * shown.w), Math.floor(((e.clientY - r.top) / r.height) * shown.h)];
  };
  const within = (s: Selection | null, [x, y]: [number, number]) => !!s && x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h;

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    const pt = at(e);
    const colour = p.tool === "eraser" ? TRANSPARENT_INDEX : e.button === 2 ? p.secondary : p.primary;
    const f = p.frame;
    if (p.tool === "picker") {
      if (inside(f, ...pt)) p.onPick(f.px[pt[1] * f.w + pt[0]]!, e.button);
      return;
    }
    if (p.tool === "fill") {
      const w = cloneFrame(f);
      floodFill(w, pt[0], pt[1], colour);
      p.onCommit(w);
      return;
    }
    if (p.tool === "select") {
      if (within(p.selection, pt)) {
        const s = p.selection!;
        const lifted = cut(f, s.x, s.y, s.w, s.h);
        const hole = cloneFrame(f);
        plot(hole, rectPoints(s.x, s.y, s.x + s.w - 1, s.y + s.h - 1, true), TRANSPARENT_INDEX);
        drag.current = { kind: "move", lifted, hole, work: f, from: pt, sel: s };
      } else {
        drag.current = { kind: "select", from: pt };
        p.setSelection(null);
      }
      return;
    }
    const work = cloneFrame(f);
    if (p.tool === "pencil" || p.tool === "eraser") {
      plot(work, [pt], colour);
      drag.current = { kind: "paint", base: f, work, colour, last: pt };
    } else {
      plot(work, [pt], colour);
      drag.current = { kind: "shape", base: f, work, colour, from: pt };
    }
    setWork(work);
  };

  const move = (e: React.PointerEvent) => {
    const pt = at(e);
    p.onHover(inside(shown, ...pt) ? { x: pt[0], y: pt[1], colour: shown.px[pt[1] * shown.w + pt[0]]! } : null);
    const d = drag.current;
    if (!d) return;
    if (d.kind === "paint") {
      plot(d.work, linePoints(d.last[0], d.last[1], pt[0], pt[1]), d.colour);
      d.last = pt;
      setWork(cloneFrame(d.work));
    } else if (d.kind === "shape") {
      const w = cloneFrame(d.base);
      plot(w, p.tool === "line" ? linePoints(d.from[0], d.from[1], pt[0], pt[1]) : rectPoints(d.from[0], d.from[1], pt[0], pt[1], e.shiftKey), d.colour);
      d.work = w;
      setWork(w);
    } else if (d.kind === "select") {
      const x = Math.max(0, Math.min(d.from[0], pt[0])),
        y = Math.max(0, Math.min(d.from[1], pt[1]));
      const x1 = Math.min(shown.w - 1, Math.max(d.from[0], pt[0])),
        y1 = Math.min(shown.h - 1, Math.max(d.from[1], pt[1]));
      p.setSelection(x1 >= x && y1 >= y ? { x, y, w: x1 - x + 1, h: y1 - y + 1 } : null);
    } else {
      const dx = pt[0] - d.from[0],
        dy = pt[1] - d.from[1];
      const w = cloneFrame(d.hole);
      paste(w, d.lifted, d.sel.x + dx, d.sel.y + dy);
      d.work = w;
      setWork(w);
      setMoving({ ...d.sel, x: d.sel.x + dx, y: d.sel.y + dy });
    }
  };

  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "paint" || d.kind === "shape") p.onCommit(d.work);
    else if (d.kind === "move") {
      if (d.work !== p.frame) p.onCommit(d.work);
      if (moving) p.setSelection(moving);
    }
    setWork(null);
    setMoving(null);
  };

  const cursor = p.tool === "picker" ? "copy" : p.tool === "select" ? "default" : "crosshair";
  return (
    <canvas
      ref={ref}
      className="pixels"
      style={{ cursor }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => p.onHover(null)}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/** A frame drawn small, for the frame strip and previews */
export function FrameThumb({ frame, palette, scale = 2, max = 64 }: { frame: Frame; palette: Uint8Array; scale?: number; max?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = Math.max(1, frame.w);
    c.height = Math.max(1, frame.h);
    c.getContext("2d")!.putImageData(frameRgba(frame, palette), 0, 0);
  }, [frame, palette]);
  const k = Math.min(scale, max / Math.max(frame.w, frame.h, 1));
  return <canvas ref={ref} className="thumb" style={{ width: frame.w * k, height: frame.h * k }} />;
}
