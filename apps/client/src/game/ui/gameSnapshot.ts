// Ours: a picture of the game as the player sees it now, for the Help window's HUD page
// (HelpDialog.tsx): the 3D view (GameScene.captureView), the hands' canvas, and the interface
// drawn over them from the page itself: each element's background colour, a background picture
// (one, tiled or placed: the stone, the toolbar's buttons), border, pictures, canvases (the
// minimap) and text, in page order, clipped where the page clips. Backgrounds of several pieces
// (the stone frames), SVG and shadows are left out: it's a guide, not a screenshot.

/** A rectangle in the picture's pixels */
export interface SnapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const transparent = (c: string) => c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);

/** An element's background picture when it has exactly one (not a gradient, not several pieces) */
function singleUrl(bg: string): string | null {
  if (!bg || bg === "none" || bg.includes("gradient")) return null;
  const all = [...bg.matchAll(/url\("?([^")]+)"?\)/g)];
  return all.length === 1 ? all[0][1] : null;
}

/** The background pictures under `root`, loaded (snapshotGame draws only what's loaded) */
export async function loadBackgrounds(root: HTMLElement): Promise<Map<string, HTMLImageElement>> {
  const urls = new Set<string>();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const u = singleUrl(getComputedStyle(el).backgroundImage);
    if (u) urls.add(u);
  }
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...urls].map(async (u) => {
      const img = new Image();
      img.src = u;
      try {
        await img.decode();
        out.set(u, img);
      } catch {
        // not drawn
      }
    }),
  );
  return out;
}

/** CSS background-position's percentages or pixels, one axis */
function bgOffset(v: string, room: number): number {
  return v.endsWith("%") ? (parseFloat(v) / 100) * room : parseFloat(v) || 0;
}

/**
 * Draws `root` (the game's element) into a canvas the size it shows at.
 * @param view the 3D view's picture, drawn where the `canvas.viewport` element is
 * @param skip elements left out with everything in them (the Help window)
 */
export function snapshotGame(
  root: HTMLElement,
  view: HTMLCanvasElement | null,
  skip: (el: Element) => boolean,
  backgrounds: ReadonlyMap<string, HTMLImageElement> = new Map(),
): HTMLCanvasElement {
  const box = root.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(box.width);
  canvas.height = Math.round(box.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rel = (r: DOMRect): SnapRect => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });

  const text = (node: Text, style: CSSStyleDeclaration, alpha: number) => {
    const s = node.data;
    if (!s.trim()) return;
    ctx.font = style.font || `${style.fontSize} ${style.fontFamily}`;
    ctx.fillStyle = style.color;
    ctx.globalAlpha = alpha;
    ctx.textBaseline = "middle";
    const range = document.createRange();
    // Word by word, where the page put each (lines wrap where it wrapped them)
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      ctx.fillText(m[0], r.left - box.left, r.top - box.top + r.height / 2);
    }
  };

  const walk = (el: Element, alpha: number) => {
    if (skip(el)) return;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    const a = alpha * Number(style.opacity || 1);
    if (a <= 0.01) return;
    const r = rel(el.getBoundingClientRect());
    ctx.save();
    // Clip what it clips (the chat's log, scrolled lists)
    if (style.overflow !== "visible" || style.overflowX !== "visible" || style.overflowY !== "visible") {
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
    }
    ctx.globalAlpha = a;
    if (r.w > 0 && r.h > 0) {
      if (!transparent(style.backgroundColor)) {
        ctx.fillStyle = style.backgroundColor;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      const url = singleUrl(style.backgroundImage);
      const bg = url ? backgrounds.get(url) : undefined;
      if (bg) {
        ctx.imageSmoothingEnabled = false;
        if (!style.backgroundRepeat.includes("no-repeat")) {
          const pattern = ctx.createPattern(bg, "repeat");
          if (pattern) {
            pattern.setTransform(new DOMMatrix().translate(r.x, r.y));
            ctx.fillStyle = pattern;
            ctx.fillRect(r.x, r.y, r.w, r.h);
          }
        } else {
          // background-size: the box (cover, contain, 100%) or the picture's own; then its position
          const size = style.backgroundSize;
          const [w, h] =
            size === "cover" || size === "contain" || size.startsWith("100%")
              ? [r.w, r.h]
              : /px/.test(size)
                ? size.split(" ").map((v, i, a) => parseFloat(v) || parseFloat(a[0]) * (i ? bg.naturalHeight / bg.naturalWidth : 1))
                : [bg.naturalWidth, bg.naturalHeight];
          const [px, py] = style.backgroundPosition.split(" ");
          ctx.drawImage(bg, r.x + bgOffset(px ?? "0", r.w - w), r.y + bgOffset(py ?? "0", r.h - h), w, h);
        }
      }
      const bw = parseFloat(style.borderTopWidth);
      if (bw > 0 && style.borderTopStyle !== "none" && !transparent(style.borderTopColor)) {
        ctx.strokeStyle = style.borderTopColor;
        ctx.lineWidth = bw;
        ctx.strokeRect(r.x + bw / 2, r.y + bw / 2, r.w - bw, r.h - bw);
      }
      try {
        if (el instanceof HTMLCanvasElement) {
          if (el.classList.contains("viewport")) {
            if (view) ctx.drawImage(view, r.x, r.y, r.w, r.h);
          } else if (el.width && el.height) ctx.drawImage(el, r.x, r.y, r.w, r.h);
        } else if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) {
          ctx.imageSmoothingEnabled = style.imageRendering !== "pixelated";
          ctx.drawImage(el, r.x, r.y, r.w, r.h);
        } else if (el instanceof HTMLInputElement && el.value && el.type !== "password") {
          ctx.font = style.font;
          ctx.fillStyle = style.color;
          ctx.textBaseline = "middle";
          ctx.fillText(el.value, r.x + parseFloat(style.paddingLeft || "0"), r.y + r.h / 2);
        }
      } catch {
        // A picture from elsewhere that can't be drawn: leave it out
      }
    }
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text(child as Text, style, a);
      else if (child instanceof Element) walk(child, a);
    }
    ctx.restore();
  };
  walk(root, 1);
  return canvas;
}

/** An element's place in the snapshot, or null when it isn't showing */
export function placeOf(root: HTMLElement, el: Element | null): SnapRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || Number(style.opacity) === 0) return null;
  const box = root.getBoundingClientRect();
  const x = Math.max(r.left, box.left),
    y = Math.max(r.top, box.top);
  const w = Math.min(r.right, box.right) - x,
    h = Math.min(r.bottom, box.bottom) - y;
  return w > 2 && h > 2 ? { x: x - box.left, y: y - box.top, w, h } : null;
}
