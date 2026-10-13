// The intro module (module/intro/intro.c IntroShowSplash): the picture behind the login dialog,
// and the main theme (main.ogg) after 3 s. It's behind the login dialog at startup and after
// logging off.
//
// Unlike the original, there's no logo first (logo.bmp is Near Death Studios' logo), and there's
// no "Click here to log on!" button: the login dialog is open over the picture from the start
// (ours, 2026-10-12: one screen, not two). The picture is ours too (2026-10-13): places in the
// game, taken by the screenshot tour (tools/screenshots/backgrounds.json) and shipped with the
// game files (login/backgrounds.json), fading from one to the next in a random order; the
// desktop's pictures on the desktop, the phone's on the phone. Without them it's xsplash.bgf,
// the original Meridian 59 splash (splash.bgf in the Server 104 files names that server). See
// docs/missing-features.md.

import { useEffect, useRef, useState } from "react";
import type { AssetStore } from "../assets.ts";
import type { GameAudio } from "./audio.ts";
import { getSettings, touchUi } from "./settings.ts";

/** intro.c */
const MUSIC_DELAY = 3000;
const SPLASH_MUSIC = "main.ogg";
const SPLASH = "xsplash.bgf";

/** Ours: how long each background stays, and how long one takes to fade into the next (styles.css .intro-slide) */
const HOLD_MS = 6000;
const FADE_MS = 1500;

/** The picture filling the screen behind the login dialog, and its music */
export function IntroBackdrop({ assets, audio }: { assets: AssetStore; audio: GameAudio | null }) {
  /** The backgrounds for this layout; null until known, empty for the original's splash */
  const [pictures, setPictures] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    const layout = touchUi(getSettings()) ? "mobile" : "modern";
    const other = layout === "mobile" ? "modern" : "mobile";
    void assets
      .loginBackgrounds()
      .catch(() => [])
      .then((list) => {
        // This layout's picture of each place, else the other's (it's cropped to fit either way)
        if (alive) setPictures(list.flatMap((b) => b.files[layout] ?? b.files[other] ?? []));
      });
    return () => {
      alive = false;
    };
  }, [assets]);

  useEffect(() => {
    if (!audio) return;
    // PlayMusicProc (GameAudio checks the Music option)
    const music = window.setTimeout(() => audio.handle({ type: "music", file: SPLASH_MUSIC }), MUSIC_DELAY);
    return () => clearTimeout(music);
  }, [audio]);

  if (!pictures) return null;
  return pictures.length ? <Slideshow assets={assets} pictures={pictures} /> : <SplashPicture assets={assets} />;
}

/** A shuffled copy (Fisher-Yates) */
function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Ours: the backgrounds one after another, each faded in over the last. Two pictures take turns:
 * the next is loaded into the hidden one, then faded in on top while the last stays under it (so
 * the screen never dims between them), and the last is put away once it's covered. Every picture
 * shows once before any shows again, and never twice running.
 */
function Slideshow({ assets, pictures }: { assets: AssetStore; pictures: string[] }) {
  const [layers, setLayers] = useState<[string | null, string | null]>([null, null]);
  /** The picture fading in or shown, and the one under it until it's covered */
  const [state, setState] = useState<{ front: 0 | 1 | null; under: 0 | 1 | null }>({ front: null, under: null });

  useEffect(() => {
    let alive = true;
    let timer = 0;
    let covered = 0;
    let order: string[] = [];
    let next = 0;
    let shown: 0 | 1 = 1;
    let failures = 0;
    const pick = () => {
      if (next >= order.length) {
        const last = order[order.length - 1];
        order = shuffled(pictures);
        if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1]!, order[0]!];
        next = 0;
      }
      return order[next++]!;
    };
    const step = async () => {
      const url = assets.url(pick());
      const img = new Image();
      try {
        await new Promise((loaded, failed) => {
          img.onload = loaded;
          img.onerror = failed;
          img.src = url;
        });
        // Decoded ahead if it can be, so the fade starts smoothly; but decode() waits for as
        // long as the page isn't drawn (a hidden tab), so not for long
        await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
        failures = 0;
      } catch {
        // A picture that won't load is skipped, unless none will
        if (alive && ++failures < pictures.length) void step();
        return;
      }
      if (!alive) return;
      const layer: 0 | 1 = shown === 0 ? 1 : 0;
      shown = layer;
      setLayers((l) => (layer === 0 ? [url, l[1]] : [l[0], url]));
      // Shown once the hidden picture has its new source, so it fades in rather than popping (a
      // timer, not requestAnimationFrame, which waits for as long as the tab is hidden)
      window.setTimeout(() => {
        if (!alive) return;
        setState((s) => ({ front: layer, under: s.front }));
        // Covered now: the last one can go (out of sight), ready to take the next
        covered = window.setTimeout(() => alive && setState((s) => ({ ...s, under: null })), FADE_MS + 100);
      }, 50);
      if (pictures.length > 1) timer = window.setTimeout(() => void step(), HOLD_MS + FADE_MS);
    };
    void step();
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(covered);
    };
  }, [assets, pictures]);

  return (
    <>
      {layers.map((src, i) =>
        src ? (
          <img
            key={i}
            className={state.front === i ? "intro-slide shown front" : state.under === i ? "intro-slide shown" : "intro-slide"}
            src={src}
            alt=""
            aria-hidden
            draggable={false}
          />
        ) : null,
      )}
    </>
  );
}

/** The original's splash picture (xsplash.bgf), keeping its shape */
function SplashPicture({ assets }: { assets: AssetStore }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([assets.bgf(SPLASH).catch(() => null), assets.palette()]).then(([bgf, pal]) => {
      const canvas = canvasRef.current;
      const b = bgf?.bitmaps[0];
      if (!alive || !canvas || !b) return;
      // The first bitmap, in the game palette
      canvas.width = b.width;
      canvas.height = b.height;
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(b.width, b.height);
      for (let i = 0; i < b.pixels.length; i++) {
        const v = b.pixels[i];
        img.data[i * 4] = pal.rgb[v * 3];
        img.data[i * 4 + 1] = pal.rgb[v * 3 + 1];
        img.data[i * 4 + 2] = pal.rgb[v * 3 + 2];
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      canvas.classList.add("ready");
    });
    return () => {
      alive = false;
    };
  }, [assets]);

  return <canvas ref={canvasRef} className="intro-picture" aria-hidden />;
}
