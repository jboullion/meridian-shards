// Interface bitmaps drawn "transparently" by the original (OBB_TRANSPARENT: inuse.bmp,
// selftrgt.bmp, the view corners) use cyan, palette index 254, for the see-through
// parts. Browsers show that cyan, so key it out once on a canvas.

import { useEffect, useState } from "react";

const cache = new Map<string, Promise<string>>();

function keyOut(url: string): Promise<string> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<string>((resolve) => {
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
        resolve(c.toDataURL());
      };
      img.onerror = () => resolve(url);
      img.src = url;
    });
    cache.set(url, p);
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
