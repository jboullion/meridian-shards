import { useEffect, useState } from "react";
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
