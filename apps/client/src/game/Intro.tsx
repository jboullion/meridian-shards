// The intro module (module/intro/intro.c IntroShowSplash): the splash picture with
// "Click here to log on!" under it, as wide as the picture, and the main theme (main.ogg)
// after 3 s. It comes before the login at startup and after logging off.
//
// Unlike the original, there's no logo first (logo.bmp is Near Death Studios' logo), and
// the picture is xsplash.bgf, the original Meridian 59 splash: splash.bgf in the Server 104
// files names that server. See docs/missing-features.md.

import { useEffect, useRef, useState } from "react";
import type { AssetStore } from "../assets.ts";
import type { GameAudio } from "./audio.ts";

/** intro.c */
const MUSIC_DELAY = 3000;
const SPLASH_MUSIC = "main.ogg";
const SPLASH = "xsplash.bgf";
/** BUTTON_XSIZE: the button's width without a picture */
const BUTTON_XSIZE = 300;

export function Intro({ assets, audio, onDone }: { assets: AssetStore; audio: GameAudio; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([assets.bgf(SPLASH).catch(() => null), assets.palette()]).then(([bgf, pal]) => {
      const canvas = canvasRef.current;
      const b = bgf?.bitmaps[0];
      if (!alive || !canvas) return;
      if (b) {
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
      }
      setWidth(b ? b.width : BUTTON_XSIZE);
      buttonRef.current?.focus();
    });
    // PlayMusicProc (GameAudio checks the Music option)
    const music = window.setTimeout(() => audio.handle({ type: "music", file: SPLASH_MUSIC }), MUSIC_DELAY);
    return () => {
      alive = false;
      clearTimeout(music);
    };
  }, [assets, audio]);

  return (
    <div className="intro">
      <div className="intro-stack" style={width ? { width } : undefined}>
        <canvas ref={canvasRef} className="intro-picture" />
        {/* MainButtonProc: a click, Enter or Space logs on */}
        <button ref={buttonRef} type="button" className="intro-button" onClick={onDone}>
          Click here to log on!
        </button>
      </div>
    </div>
  );
}
