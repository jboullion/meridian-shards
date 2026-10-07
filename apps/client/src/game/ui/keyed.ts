// Interface bitmaps drawn "transparently" by the original (OBB_TRANSPARENT: inuse.bmp,
// selftrgt.bmp, the view corners) use cyan, palette index 254, for the see-through
// parts. Browsers show that cyan, so key it out once on a canvas.

import { useEffect, useState } from "react";

const cache = new Map<string, Promise<string>>();
const halvesCache = new Map<string, Promise<[string, string] | null>>();

function loadKeyed(url: string): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i] === 0 && d.data[i + 1] === 255 && d.data[i + 2] === 255) d.data[i + 3] = 0;
      }
      ctx.putImageData(d, 0, 0);
      resolve(c);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** The bitmap at `url` as a data URL with its cyan made transparent (cached per URL). */
export function keyOut(url: string): Promise<string> {
  let p = cache.get(url);
  if (!p) {
    p = loadKeyed(url).then((c) => (c ? c.toDataURL() : url));
    cache.set(url, p);
  }
  return p;
}

/**
 * A two-state bitmap (statbtn.c: "Bitmap has up and down images in it") keyed like keyOut
 * and split into its left (up) and right (down) halves as data URLs; null if it won't load.
 */
export function keyOutHalves(url: string): Promise<[string, string] | null> {
  let p = halvesCache.get(url);
  if (!p) {
    p = loadKeyed(url).then((c) => {
      if (!c) return null;
      const w = c.width / 2;
      const half = (x: number) => {
        const h = document.createElement("canvas");
        h.width = w;
        h.height = c.height;
        h.getContext("2d")!.drawImage(c, x, 0, w, c.height, 0, 0, w, c.height);
        return h.toDataURL();
      };
      return [half(0), half(w)];
    });
    halvesCache.set(url, p);
  }
  return p;
}

/** The bitmap at `url` with its cyan made transparent (null while loading). */
export function useKeyedImage(url: string): string | null {
  const [state, setState] = useState<{ url: string; keyed: string } | null>(null);
  useEffect(() => {
    let live = true;
    void keyOut(url).then((keyed) => live && setState({ url, keyed }));
    return () => {
      live = false;
    };
  }, [url]);
  return state?.url === url ? state.keyed : null;
}

/** keyOutHalves as a hook: [up, down] data URLs, or null while loading. */
export function useKeyedHalves(url: string): [string, string] | null {
  const [state, setState] = useState<{ url: string; halves: [string, string] | null } | null>(null);
  useEffect(() => {
    let live = true;
    void keyOutHalves(url).then((halves) => live && setState({ url, halves }));
    return () => {
      live = false;
    };
  }, [url]);
  return state?.url === url ? state.halves : null;
}
