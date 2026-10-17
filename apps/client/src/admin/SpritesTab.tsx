// The Sprites tab: a pixel editor for the game's .bgf sprites. Open any sprite (hair and facial
// hair are previewed on a head in every hair colour), paint, fix frames, offsets and hotspots,
// import pictures, and save. Saved sprites go to shards-server's resource/graphics/shards, which
// the asset build reads first, so they replace the classic copies (tools/dev/spriteApi.ts).
// New hairstyles and facial hair can be listed for the character creator from here too.
//
// Keys: B pencil, E eraser, G fill, I picker, L line, R rectangle (Shift: filled), M select
// (drag inside a selection to move it), X swaps the colours, [ and ] change frame, the arrows
// nudge the frame's offset (Shift: 5), Delete clears the selection, Ctrl+C and Ctrl+V copy and
// paste it, Ctrl+Z and Ctrl+Y undo and redo, Ctrl+S saves.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeBgf, HAIR_RAMP, PaletteMatcher, parseBgf, TRANSPARENT_INDEX } from "@shards/formats";
import { XlatTable } from "@shards/render";
import { AssetStore } from "../assets.ts";
import { loadSprites, loadSpriteStyles, registerStyle, revertSprite, saveSprite, spriteBytes, type SpriteEntry, type SpriteStyles } from "./api.ts";
import { ImportDialog, NewSpriteDialog, type ImportTarget } from "./sprites/Dialogs.tsx";
import { HeadPreview } from "./sprites/HeadPreview.tsx";
import { FrameThumb, PixelCanvas, type Selection, type Tool } from "./sprites/PixelCanvas.tsx";
import {
  blankFrame, cloneSprite, coloursUsed, cut, deleteFrame, flipX, fromBgf, HAIR_COLOURS, kindOf, paste, plot, rectPoints, resize, strayColours, swapFrames, toBgf, viewsOf,
  parseGroup, type Frame, type Sprite,
} from "./sprites/model.ts";

type Say = (text: string, error?: boolean) => void;
type Lock = "hair" | "used" | "none";
const FILTERS = ["All", "Ours", "Hair", "Beards", "Faces"] as const;
type Filter = (typeof FILTERS)[number];
const TOOLS: { tool: Tool; key: string; label: string }[] = [
  { tool: "pencil", key: "b", label: "Pencil" },
  { tool: "eraser", key: "e", label: "Eraser" },
  { tool: "fill", key: "g", label: "Fill" },
  { tool: "picker", key: "i", label: "Picker" },
  { tool: "line", key: "l", label: "Line" },
  { tool: "rect", key: "r", label: "Rect" },
  { tool: "select", key: "m", label: "Select" },
];

const assets = new AssetStore();
const ready = assets.init().then(async () => {
  const palette = (await assets.palette()).rgb;
  return { palette, xl: new XlatTable(palette, await assets.lightPalettes()) };
});

const matches = (f: Filter, e: SpriteEntry) =>
  f === "All" ||
  (f === "Ours" && e.override) ||
  (f === "Hair" && /^pt[a-z]{2}\.bgf$/.test(e.name)) ||
  (f === "Beards" && e.name.startsWith("pbd")) ||
  (f === "Faces" && /^p[henm][a-z]x\.bgf$/.test(e.name));

const fitZoom = (f: Frame | undefined) => (f ? Math.max(2, Math.min(24, Math.floor(480 / Math.max(f.w, f.h, 1)))) : 8);

function swatch(palette: Uint8Array, i: number): string {
  return i === TRANSPARENT_INDEX ? "repeating-conic-gradient(#555 0 25%, #888 0 50%) 0 0 / 8px 8px" : `rgb(${palette[i * 3]},${palette[i * 3 + 1]},${palette[i * 3 + 2]})`;
}
const hex = (i: number) => i.toString(16).toUpperCase().padStart(2, "0");

export function SpritesTab({ say: sayNow }: { say: Say }) {
  // the dashboard makes a new one at every render
  const sayRef = useRef(sayNow);
  useEffect(() => {
    sayRef.current = sayNow;
  });
  const say = useCallback<Say>((text, error) => sayRef.current(text, error), []);
  const [gfx, setGfx] = useState<{ palette: Uint8Array; xl: XlatTable } | null>(null);
  const [list, setList] = useState<SpriteEntry[] | null>(null);
  const [styles, setStyles] = useState<SpriteStyles | null>(null);
  const [find, setFind] = useState("");
  const [filter, setFilter] = useState<Filter>("All");

  const [sprite, setSprite] = useState<Sprite | null>(null);
  const [saved, setSaved] = useState<Sprite | null>(null);
  const [past, setPast] = useState<Sprite[]>([]);
  const [future, setFuture] = useState<Sprite[]>([]);
  const [fi, setFi] = useState(0);
  const [tool, setTool] = useState<Tool>("pencil");
  const [primary, setPrimary] = useState(0xd4);
  const [secondary, setSecondary] = useState(TRANSPARENT_INDEX);
  const [zoom, setZoom] = useState(8);
  const [grid, setGrid] = useState(true);
  const [onion, setOnion] = useState<number | null>(null);
  const [lock, setLock] = useState<Lock>("none");
  const [usedAtOpen, setUsedAtOpen] = useState<Set<number>>(new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [clip, setClip] = useState<Frame | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; colour: number } | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "import" } | { kind: "new"; first?: { px: Uint8Array; w: number; h: number } }>(null);
  // the size being typed, for the frame it was typed for
  const [resizeDraft, setResizeDraft] = useState<{ key: string; w: number; h: number } | null>(null);
  const [anchor, setAnchor] = useState({ ax: 0.5, ay: 1 });
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const dirty = !!sprite && sprite !== saved;
  const frame = sprite?.frames[fi];
  const kind = sprite ? kindOf(sprite.file) : "other";
  const allowed = lock === "hair" ? HAIR_COLOURS : lock === "used" ? usedAtOpen : null;
  const entry = list?.find((e) => e.name === sprite?.file);

  const refreshList = useCallback(() => {
    loadSprites().then(setList, (e: unknown) => say(`The sprite list: ${(e as Error).message}`, true));
    loadSpriteStyles().then(setStyles, (e: unknown) => say(`system.kod's styles: ${(e as Error).message}`, true));
  }, [say]);

  useEffect(() => {
    ready.then(setGfx, (e: unknown) => say(`The palette: ${(e as Error).message}`, true));
    refreshList();
  }, [refreshList, say]);

  const frameKey = frame ? `${sprite!.file}:${fi}:${frame.w}x${frame.h}` : "";
  const resizeTo = resizeDraft?.key === frameKey ? { ...resizeDraft, ...anchor } : { w: frame?.w ?? 0, h: frame?.h ?? 0, ...anchor };
  const setResizeTo = (r: { w: number; h: number; ax: number; ay: number }) => {
    setResizeDraft({ key: frameKey, w: r.w, h: r.h });
    setAnchor({ ax: r.ax, ay: r.ay });
  };

  // ------------------------------------------------------------ editing and history

  const commit = (next: Sprite) => {
    if (!sprite) return;
    setPast((p) => [...p, sprite].slice(-200));
    setFuture([]);
    setSprite(next);
  };
  const update = (fn: (s: Sprite) => void) => {
    if (!sprite) return;
    const n = cloneSprite(sprite);
    fn(n);
    commit(n);
  };
  const setFrame = (f: Frame) => sprite && commit({ ...sprite, frames: sprite.frames.map((x, i) => (i === fi ? f : x)) });
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev || !sprite) return;
    setPast(past.slice(0, -1));
    setFuture([sprite, ...future]);
    setSprite(prev);
    setFi((i) => Math.min(i, prev.frames.length - 1));
  };
  const redo = () => {
    const next = future[0];
    if (!next || !sprite) return;
    setFuture(future.slice(1));
    setPast([...past, sprite]);
    setSprite(next);
    setFi((i) => Math.min(i, next.frames.length - 1));
  };

  const start = (s: Sprite, isSaved: boolean) => {
    setSprite(s);
    setSaved(isSaved ? s : null);
    setPast([]);
    setFuture([]);
    setFi(0);
    setSelection(null);
    setOnion(null);
    setZoom(fitZoom(s.frames[0]));
    setUsedAtOpen(coloursUsed(s));
    const k = kindOf(s.file);
    setLock(k === "other" ? "none" : "hair");
    if (k !== "other") setPrimary(0xd4);
    setLabel("");
  };

  const open = async (name: string) => {
    if (dirty && !confirm(`${sprite!.file} has changes that aren't saved. Drop them?`)) return;
    try {
      start(fromBgf(name, await parseBgf(await spriteBytes(name))), true);
    } catch (e) {
      say(`${name}: ${(e as Error).message}`, true);
    }
  };

  const pickColour = (i: number, button = 0) => {
    if (allowed && !allowed.has(i)) {
      say(`Colour ${hex(i)} is outside the lock (${lock === "hair" ? "the hair ramp" : "this sprite's colours"}): unlock it to use it`, true);
      return;
    }
    if (button === 2) setSecondary(i);
    else setPrimary(i);
  };

  const changeLock = (l: Lock) => {
    setLock(l);
    const next = l === "hair" ? HAIR_COLOURS : l === "used" ? usedAtOpen : null;
    if (next && !next.has(primary)) setPrimary([...next].find((i) => i !== TRANSPARENT_INDEX) ?? TRANSPARENT_INDEX);
    if (next && !next.has(secondary)) setSecondary(TRANSPARENT_INDEX);
  };

  // ------------------------------------------------------------ files

  const save = async () => {
    if (!sprite || busy) return;
    const stray = allowed ? strayColours(sprite, allowed) : new Map();
    if (stray.size && !confirm(`${[...stray.values()].reduce((a, b) => a + b, 0)} pixels use colours outside the lock. Save anyway?`)) return;
    setBusy(true);
    try {
      const data = await encodeBgf(toBgf(sprite));
      const r = await saveSprite(sprite.file, data);
      setSaved(sprite);
      say(`Saved ${sprite.file} to ${r.path}${r.backup ? ` (the last copy is in ${r.backup})` : ""}; game tabs load it again`);
      refreshList();
    } catch (e) {
      say(`Saving ${sprite.file}: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    if (!sprite || !confirm(`Delete our copy of ${sprite.file} and go back to the classic one? (Ours is kept in build/spriteforge/backups.)`)) return;
    try {
      const r = await revertSprite(sprite.file);
      say(`${sprite.file} is the classic one again (ours is in ${r.backup})`);
      refreshList();
      start(fromBgf(sprite.file, await parseBgf(await spriteBytes(sprite.file))), true);
    } catch (e) {
      say(`Reverting ${sprite.file}: ${(e as Error).message}`, true);
    }
  };

  const register = async () => {
    if (!sprite || (kind !== "hair" && kind !== "beard")) return;
    setBusy(true);
    say(`Listing ${sprite.file} for the character creator and building the Kod...`);
    try {
      const r = await registerStyle(kind, sprite.file, label);
      for (const s of r.steps) say(s, !r.ok);
      if (!r.ok) say(r.tail, true);
      else say(`${sprite.file} is ${r.resource}: reload the game tabs, then make a character to see it`);
      refreshList();
    } catch (e) {
      say(`Listing ${sprite.file}: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };

  const applyImport = (px: Uint8Array, w: number, h: number, target: ImportTarget) => {
    if (target === "new") {
      setDialog({ kind: "new", first: { px, w, h } });
      return;
    }
    if (!sprite || !frame) return;
    if (target === "replace") {
      const f = frame.w === w && frame.h === h ? { ...frame, px } : { ...resize(frame, w, h, 0.5, 1), px };
      setFrame(f);
    } else {
      update((s) => s.frames.push({ ...blankFrame(w, h, frame.xoff, frame.yoff), hotspots: frame.hotspots.map((x) => ({ ...x })), px }));
      setFi(sprite.frames.length);
    }
    setDialog(null);
  };

  // ------------------------------------------------------------ keys

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (dialog || t.closest("input, select, textarea")) return;
      if (!sprite || !frame) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === "z" && !e.shiftKey) undo();
        else if (k === "y" || (k === "z" && e.shiftKey)) redo();
        else if (k === "s") void save();
        else if (k === "c" && selection) setClip(cut(frame, selection.x, selection.y, selection.w, selection.h));
        else if (k === "v" && clip) {
          const at = selection ?? { x: 0, y: 0 };
          const f = { ...frame, px: frame.px.slice() };
          paste(f, clip, at.x, at.y);
          setFrame(f);
          setSelection({ x: at.x, y: at.y, w: clip.w, h: clip.h });
          setTool("select");
        } else return;
        e.preventDefault();
        return;
      }
      const t2 = TOOLS.find((x) => x.key === k);
      if (t2) setTool(t2.tool);
      else if (k === "x") {
        setPrimary(secondary);
        setSecondary(primary);
      } else if (k === "[") setFi((i) => Math.max(0, i - 1));
      else if (k === "]") setFi((i) => Math.min(sprite.frames.length - 1, i + 1));
      else if (k === "escape") setSelection(null);
      else if ((k === "delete" || k === "backspace") && selection) {
        const f = { ...frame, px: frame.px.slice() };
        plot(f, rectPoints(selection.x, selection.y, selection.x + selection.w - 1, selection.y + selection.h - 1, true), TRANSPARENT_INDEX);
        setFrame(f);
      } else if (k.startsWith("arrow")) {
        const n = e.shiftKey ? 5 : 1;
        const dx = k === "arrowleft" ? -n : k === "arrowright" ? n : 0,
          dy = k === "arrowup" ? -n : k === "arrowdown" ? n : 0;
        setFrame({ ...frame, xoff: frame.xoff + dx, yoff: frame.yoff + dy });
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ------------------------------------------------------------ the page

  const shown = useMemo(() => {
    const f = find.trim().toLowerCase();
    return (list ?? []).filter((e) => matches(filter, e) && (!f || e.name.includes(f))).slice(0, 400);
  }, [list, find, filter]);
  const stray = useMemo(() => (sprite && allowed ? strayColours(sprite, allowed) : new Map<number, number>()), [sprite, allowed]);
  const listed = sprite && styles ? (kind === "hair" ? styles.hair : styles.beard).includes(sprite.file) : true;

  const snapStray = () => {
    if (!gfx || !allowed) return;
    const m = new PaletteMatcher(gfx.palette, lock === "hair" ? HAIR_RAMP : [...allowed]);
    const to = new Map<number, number>();
    for (const c of stray.keys()) to.set(c, m.nearest(gfx.palette[c * 3]!, gfx.palette[c * 3 + 1]!, gfx.palette[c * 3 + 2]!));
    update((s) => {
      for (const f of s.frames) for (let i = 0; i < f.px.length; i++) f.px[i] = to.get(f.px[i]!) ?? f.px[i]!;
    });
    say(`${to.size} stray colours snapped to the nearest allowed ones`);
  };

  return (
    <div className="sprites">
      <aside className="spritelist">
        <input placeholder="Find a sprite (e.g. ptsa)" value={find} onChange={(e) => setFind(e.target.value)} />
        <div className="buttons">
          {FILTERS.map((f) => (
            <button key={f} className={f === filter ? "on" : ""} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <div className="rows">
          {!list && <div className="dim">Reading dist/assets...</div>}
          {shown.map((e) => (
            <div key={e.name} className={`row ${e.name === sprite?.file ? "on" : ""}`} onClick={() => void open(e.name)}>
              <span>{e.name}</span>
              {e.override && <span className="tag">{e.original ? "edited" : "ours"}</span>}
            </div>
          ))}
        </div>
        <button onClick={() => setDialog({ kind: "new" })}>New sprite...</button>
      </aside>

      {!sprite || !frame || !gfx ? (
        <section className="editor">
          <p className="dim">
            Pick a sprite on the left, or start a new one. Saved sprites go to shards-server's resource/graphics/shards and replace the classic copies; commit them there.
          </p>
          <button onClick={() => setDialog({ kind: "import" })} disabled={!gfx}>
            Import a picture...
          </button>
        </section>
      ) : (
        <section className="editor">
          <div className="buttons sticky">
            <b>
              {sprite.file}
              {dirty ? " *" : ""}
            </b>
            {!entry && <span className="tag">new</span>}
            <button onClick={() => void save()} disabled={busy || (!dirty && !!entry)}>
              Save
            </button>
            {entry?.override && entry.original && <button onClick={() => void revert()}>Revert to classic</button>}
            <button onClick={undo} disabled={!past.length} title="Ctrl+Z">
              Undo
            </button>
            <button onClick={redo} disabled={!future.length} title="Ctrl+Y">
              Redo
            </button>
            <button onClick={() => setDialog({ kind: "import" })}>Import...</button>
            <span className="sep" />
            {TOOLS.map((t) => (
              <button key={t.tool} className={tool === t.tool ? "on" : ""} onClick={() => setTool(t.tool)} title={`${t.key.toUpperCase()}`}>
                {t.label}
              </button>
            ))}
            <span className="sep" />
            <button onClick={() => setZoom((z) => Math.max(1, z - 1))}>-</button>
            <span>{zoom}x</span>
            <button onClick={() => setZoom((z) => Math.min(48, z + 1))}>+</button>
            <label className="check">
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grid
            </label>
            <select value={onion ?? ""} onChange={(e) => setOnion(e.target.value === "" ? null : Number(e.target.value))} title="Another frame, faintly under this one">
              <option value="">No onion skin</option>
              {sprite.frames.map((_, i) => (i === fi ? null : <option key={i} value={i}>Under: frame {i}</option>))}
            </select>
          </div>

          <div className="work">
            <div className="canvaswrap">
              <PixelCanvas
                frame={frame}
                palette={gfx.palette}
                zoom={zoom}
                tool={tool}
                primary={primary}
                secondary={secondary}
                grid={grid}
                onion={onion !== null ? (sprite.frames[onion] ?? null) : null}
                selection={selection}
                setSelection={setSelection}
                onCommit={setFrame}
                onPick={pickColour}
                onHover={setHover}
              />
              <div className="dim status">
                {frame.w}x{frame.h} · offset {frame.xoff}, {frame.yoff} · shrink {sprite.shrink}
                {hover && ` · ${hover.x}, ${hover.y}: ${hover.colour === TRANSPARENT_INDEX ? "transparent" : hex(hover.colour)}`}
                {selection && ` · selection ${selection.w}x${selection.h}`}
              </div>
            </div>

            <div className="panel">
              <h2>Colours</h2>
              <div className="buttons">
                <span className="swatch big" style={{ background: swatch(gfx.palette, primary) }} title="Left button" /> {hex(primary)}
                <span className="swatch big" style={{ background: swatch(gfx.palette, secondary) }} title="Right button" /> {hex(secondary)}
                <select value={lock} onChange={(e) => changeLock(e.target.value as Lock)}>
                  <option value="hair">Lock: hair ramp</option>
                  <option value="used">Lock: this sprite's colours</option>
                  <option value="none">No lock</option>
                </select>
              </div>
              <div className="palette">
                {Array.from({ length: 256 }, (_, i) => (
                  <span
                    key={i}
                    className={`swatch ${allowed && !allowed.has(i) ? "off" : ""} ${i === primary ? "on" : ""}`}
                    style={{ background: swatch(gfx.palette, i) }}
                    title={`${hex(i)}${i === TRANSPARENT_INDEX ? " transparent" : ""}`}
                    onPointerDown={(e) => pickColour(i, e.button)}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                ))}
              </div>
              {stray.size > 0 && (
                <div className="buttons warn">
                  {[...stray.values()].reduce((a, b) => a + b, 0)} pixels in {stray.size} colours outside the lock
                  <button onClick={snapStray}>Snap them in</button>
                </div>
              )}

              <h2>Frame {fi}</h2>
              <div className="dim">{viewsOf(sprite, fi)}</div>
              <div className="buttons">
                Offset
                <input className="num" type="number" value={frame.xoff} onChange={(e) => setFrame({ ...frame, xoff: Number(e.target.value) })} />
                <input className="num" type="number" value={frame.yoff} onChange={(e) => setFrame({ ...frame, yoff: Number(e.target.value) })} />
                <span className="dim">(arrow keys)</span>
              </div>
              <div className="buttons">
                Size
                <input className="num" type="number" min={1} value={resizeTo.w} onChange={(e) => setResizeTo({ ...resizeTo, w: Number(e.target.value) })} />x
                <input className="num" type="number" min={1} value={resizeTo.h} onChange={(e) => setResizeTo({ ...resizeTo, h: Number(e.target.value) })} />
                <select value={`${resizeTo.ax},${resizeTo.ay}`} onChange={(e) => {
                  const [ax, ay] = e.target.value.split(",").map(Number);
                  setResizeTo({ ...resizeTo, ax: ax!, ay: ay! });
                }}>
                  <option value="0.5,1">keep bottom centre</option>
                  <option value="0.5,0.5">keep centre</option>
                  <option value="0,0">keep top left</option>
                  <option value="0.5,0">keep top centre</option>
                  <option value="0,1">keep bottom left</option>
                  <option value="1,1">keep bottom right</option>
                </select>
                <button disabled={resizeTo.w < 1 || resizeTo.h < 1 || (resizeTo.w === frame.w && resizeTo.h === frame.h)} onClick={() => setFrame(resize(frame, resizeTo.w, resizeTo.h, resizeTo.ax, resizeTo.ay))}>
                  Resize
                </button>
              </div>
              <div className="buttons">
                <button onClick={() => update((s) => flipX(s.frames[fi]!))}>Flip</button>
                <button onClick={() => update((s) => s.frames.splice(fi + 1, 0, { ...s.frames[fi]!, px: s.frames[fi]!.px.slice(), hotspots: s.frames[fi]!.hotspots.map((h) => ({ ...h })) }))}>
                  Duplicate
                </button>
                <button onClick={() => update((s) => s.frames.splice(fi + 1, 0, { ...blankFrame(frame.w, frame.h, frame.xoff, frame.yoff), hotspots: frame.hotspots.map((h) => ({ ...h })) }))}>
                  Add blank
                </button>
                <button disabled={sprite.frames.length < 2} onClick={() => {
                  update((s) => deleteFrame(s, fi));
                  setFi(Math.max(0, fi - 1));
                }}>
                  Delete
                </button>
                <button disabled={fi === 0} onClick={() => {
                  update((s) => swapFrames(s, fi, fi - 1));
                  setFi(fi - 1);
                }}>
                  ←
                </button>
                <button disabled={fi >= sprite.frames.length - 1} onClick={() => {
                  update((s) => swapFrames(s, fi, fi + 1));
                  setFi(fi + 1);
                }}>
                  →
                </button>
              </div>

              <h2>Hotspots</h2>
              {frame.hotspots.map((h, i) => (
                <div key={i} className="buttons">
                  #<input className="num" type="number" value={h.number} title="Hotspot number; negative draws the overlay under" onChange={(e) => update((s) => (s.frames[fi]!.hotspots[i]!.number = Number(e.target.value)))} />
                  x <input className="num" type="number" value={h.x} onChange={(e) => update((s) => (s.frames[fi]!.hotspots[i]!.x = Number(e.target.value)))} />
                  y <input className="num" type="number" value={h.y} onChange={(e) => update((s) => (s.frames[fi]!.hotspots[i]!.y = Number(e.target.value)))} />
                  <button onClick={() => update((s) => s.frames[fi]!.hotspots.splice(i, 1))}>×</button>
                </div>
              ))}
              <button onClick={() => update((s) => s.frames[fi]!.hotspots.push({ number: 1, x: Math.floor(frame.w / 2), y: Math.floor(frame.h / 2) }))}>Add a hotspot</button>

              <h2>Sprite</h2>
              <div className="buttons">
                Shrink
                <input className="num" type="number" min={1} max={255} value={sprite.shrink} onChange={(e) => update((s) => (s.shrink = Math.max(1, Number(e.target.value) || 1)))} />
              </div>
              {sprite.groups.map((g, gi) => (
                <GroupRow key={`${sprite.file}-${gi}-${g.join(",")}`} index={gi} group={g} frames={sprite.frames.length} onSet={(next) => update((s) => (s.groups[gi] = next))} onDelete={() => update((s) => s.groups.splice(gi, 1))} say={say} />
              ))}
              <button onClick={() => update((s) => s.groups.push([fi]))}>Add a group</button>

              {(kind === "hair" || kind === "beard") && !listed && entry?.override && (
                <>
                  <h2>Character creator</h2>
                  <div className="dim">Not offered yet. This adds it to system.kod, builds the Kod and reloads the server.</div>
                  <input placeholder={kind === "hair" ? "What it is, e.g. Side braid" : "What it is, e.g. Mutton chops"} value={label} onChange={(e) => setLabel(e.target.value)} />
                  <button disabled={busy || dirty} onClick={() => void register()}>
                    Offer this {kind === "hair" ? "hairstyle" : "facial hair"}
                  </button>
                </>
              )}
            </div>
          </div>

          <h2>Frames</h2>
          <div className="frames">
            {sprite.frames.map((f, i) => (
              <div key={i} className={`frame ${i === fi ? "on" : ""}`} onClick={() => {
                setFi(i);
                setSelection(null);
              }}>
                <FrameThumb frame={f} palette={gfx.palette} />
                <span className="dim">
                  {i}: {viewsOf(sprite, i)}
                </span>
              </div>
            ))}
          </div>

          {(kind === "hair" || kind === "beard") && styles && (
            <>
              <h2>On a head</h2>
              <HeadPreview sprite={sprite} kind={kind} palette={gfx.palette} xl={gfx.xl} colours={styles.hairColours} />
            </>
          )}
        </section>
      )}

      {dialog?.kind === "import" && gfx && (
        <ImportDialog palette={gfx.palette} frame={frame ?? null} kind={kind} allowed={allowed} onClose={() => setDialog(null)} onApply={applyImport} />
      )}
      {dialog?.kind === "new" && (
        <NewSpriteDialog
          taken={new Set((list ?? []).map((e) => e.name))}
          first={dialog.first ?? null}
          onClose={() => setDialog(null)}
          onCreate={(s) => {
            if (dirty && !confirm(`${sprite!.file} has changes that aren't saved. Drop them?`)) return;
            start(s, false);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function GroupRow({ index, group, frames, onSet, onDelete, say }: { index: number; group: number[]; frames: number; onSet: (g: number[]) => void; onDelete: () => void; say: Say }) {
  const [text, setText] = useState(group.join(" "));
  const apply = () => {
    if (text === group.join(" ")) return;
    try {
      onSet(parseGroup(text, frames));
    } catch (e) {
      say(`Group ${index}: ${(e as Error).message}`, true);
      setText(group.join(" "));
    }
  };
  return (
    <div className="buttons">
      Group {index}
      <input className="grp" value={text} title="A frame number for each view, -1 for none" onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} />
      <button onClick={onDelete}>×</button>
    </div>
  );
}
