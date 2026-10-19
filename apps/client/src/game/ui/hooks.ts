import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { WorldEvent, WorldState } from "@shards/world";

/** Re-render when the world sends one of these events; returns a counter that changes. */
export function useWorld(world: WorldState, types: WorldEvent["type"][]): number {
  const [version, setVersion] = useState(0);
  const key = types.join(",");
  useEffect(() => {
    const wanted = new Set(key.split(","));
    return world.on((e) => {
      if (wanted.has(e.type)) setVersion((v) => v + 1);
    });
  }, [world, key]);
  return version;
}

/**
 * A picture that loads asynchronously (IconRenderer). `key` identifies it; `load` is
 * only called when the key changes.
 */
export function useAsyncImage(key: string, load: () => Promise<string | null> | null): string | null {
  const [state, setState] = useState<{ key: string; url: string | null }>({ key: "", url: null });
  useEffect(() => {
    let live = true;
    const p = load();
    if (p) void p.then((url) => live && setState({ key, url }));
    return () => {
      live = false;
    };
    // `load` is a new closure every render; the key says when it matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.url : null;
}

/** A figure's eight views (drawbmp.c angles, 4096 a turn), and how far a drag goes for one, of its width */
const VIEW_STEP = 4096 / 8;
const DRAG_PER_VIEW = 0.175;

/**
 * Ours: a figure turned by dragging across it, through its eight views (the character window's,
 * and a player's description). Returns its angle, the pointer-down handler, and a reset (the
 * front again).
 */
export function useTurnDrag(): [number, (e: ReactPointerEvent<HTMLElement>) => void, () => void] {
  const [angle, setAngle] = useState(0);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const width = el.getBoundingClientRect().width;
    const startX = e.clientX,
      startAngle = angle;
    const move = (ev: PointerEvent) => {
      const views = Math.round((ev.clientX - startX) / (width * DRAG_PER_VIEW));
      setAngle((((startAngle - views * VIEW_STEP) % 4096) + 4096) % 4096);
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
  return [angle, onPointerDown, () => setAngle(0)];
}
