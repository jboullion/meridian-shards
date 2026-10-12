// The intro module (module/intro/intro.c IntroShowSplash): the splash picture, and the main theme
// (main.ogg) after 3 s. It's behind the login dialog at startup and after logging off.
//
// Unlike the original, there's no logo first (logo.bmp is Near Death Studios' logo), the
// picture is xsplash.bgf, the original Meridian 59 splash (splash.bgf in the Server 104 files
// names that server), and there's no "Click here to log on!" button: the login dialog is open
// over the picture from the start (ours, 2026-10-12: one screen, not two). See
// docs/missing-features.md.

import { useEffect, useRef } from "react";
import type { AssetStore } from "../assets.ts";
import type { GameAudio } from "./audio.ts";

/** intro.c */
const MUSIC_DELAY = 3000;
const SPLASH_MUSIC = "main.ogg";
const SPLASH = "xsplash.bgf";

/** The splash picture filling the screen behind the login dialog (it keeps its shape), and its music */
export function SplashPicture({ assets, audio }: { assets: AssetStore; audio: GameAudio | null }) {
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

  useEffect(() => {
    if (!audio) return;
    // PlayMusicProc (GameAudio checks the Music option)
    const music = window.setTimeout(() => audio.handle({ type: "music", file: SPLASH_MUSIC }), MUSIC_DELAY);
    return () => clearTimeout(music);
  }, [audio]);

  return <canvas ref={canvasRef} className="intro-picture" aria-hidden />;
}
