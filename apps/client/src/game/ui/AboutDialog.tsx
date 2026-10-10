// The About box (clientd3d/about.c, client.rc IDD_ABOUT): who made it, the credits from
// about.bgf scrolling a pixel every 80 ms (a click shows the next page), and in the game
// two figures (resource 19999) who now and then swing at each other, with a clash.

import { useEffect, useRef, useState } from "react";
import { ANIMATE } from "@shards/protocol";
import type { GameSession } from "@shards/world";
import type { AssetStore } from "../../assets.ts";
import type { GameAudio } from "../audio.ts";
import type { IconRenderer } from "../icons.ts";
import { getSettings } from "../settings.ts";
import { Button, Window, at } from "./kit.tsx";

/** about.c */
const ABOUT_INTERVAL = 80;
const ABOUT_RSC = 19999;
const DUDE_X = [40, 110];
/** NUMDEGREES * 3/4 and 1/4: facing each other */
const DUDE_ANGLE = [3072, 1024];
const SOUNDS = ["swrdmtl1.ogg", "swrdmtl2.ogg", "swrdmtl3.ogg"];

/** The credits' page, scrolled: about.bgf's bitmaps drawn in the palette */
function Credits({ assets }: { assets: AssetStore }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(0);
  const pages = useRef(1);
  useEffect(() => {
    let timer = 0;
    let alive = true;
    void Promise.all([assets.bgf("about.bgf"), assets.palette()]).then(([bgf, pal]) => {
      const canvas = canvasRef.current;
      if (!alive || !bgf || !canvas || !bgf.bitmaps.length) return;
      pages.current = bgf.bitmaps.length;
      const b = bgf.bitmaps[page % bgf.bitmaps.length];
      const ctx = canvas.getContext("2d")!;
      // AboutInitDialog sizes the window to the page's width; its height keeps square pixels
      canvas.width = b.width;
      canvas.height = Math.max(1, Math.round((b.width * canvas.clientHeight) / Math.max(1, canvas.clientWidth)));
      // The page's pixels in colour, once; each tick draws the window onto it
      const full = new ImageData(b.width, b.height);
      for (let i = 0; i < b.pixels.length; i++) {
        const v = b.pixels[i];
        full.data.set([pal.rgb[v * 3], pal.rgb[v * 3 + 1], pal.rgb[v * 3 + 2], 255], i * 4);
      }
      const src = document.createElement("canvas");
      src.width = b.width;
      src.height = b.height;
      src.getContext("2d")!.putImageData(full, 0, 0);
      let y = 0;
      const tick = () => {
        // AboutTimer: the window's rows from scroll_y, wrapping round
        const h = canvas.height;
        ctx.drawImage(src, 0, y, b.width, Math.min(h, b.height - y), 0, 0, b.width, Math.min(h, b.height - y));
        if (b.height - y < h) ctx.drawImage(src, 0, 0, b.width, h - (b.height - y), 0, b.height - y, b.width, h - (b.height - y));
        y = (y + 1) % b.height;
      };
      tick();
      timer = window.setInterval(tick, ABOUT_INTERVAL);
    });
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [assets, page]);
  return (
    <canvas
      ref={canvasRef}
      className="about-credits"
      // AboutLButtonDown: the next page, from the top
      onClick={() => setPage((p) => (p + 1) % pages.current)}
    />
  );
}

/** The two figures: group 0 standing, and now and then groups 3-4 once (a swing) with a sword sound */
function Dudes({ icons, audio }: { icons: IconRenderer; audio: GameAudio }) {
  const [groups, setGroups] = useState([0, 0]);
  const [urls, setUrls] = useState<(string | null)[]>([null, null]);
  useEffect(() => {
    const swing: { until: number; start: number }[] = [
      { until: 0, start: 0 },
      { until: 0, start: 0 },
    ];
    const timer = window.setInterval(() => {
      const now = Date.now();
      setGroups(
        swing.map((s, i) => {
          if (now >= s.until && Math.floor(Math.random() * 30) === 0) {
            // ANIMATE_ONCE, groups 3..4, 400 ms each, then group 0
            swing[i] = { start: now, until: now + 800 };
            if (getSettings().sound) audio.playLocal(SOUNDS[Math.floor(Math.random() * SOUNDS.length)]);
          }
          return now < swing[i].until ? 3 + Math.min(1, Math.floor((now - swing[i].start) / 400)) : 0;
        }),
      );
    }, ABOUT_INTERVAL);
    return () => clearInterval(timer);
  }, [audio]);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      groups.map((g, i) =>
        icons.object({ iconRes: ABOUT_RSC, animation: { type: ANIMATE.NONE, group: g }, overlays: [], translation: 0 }, { angle: DUDE_ANGLE[i], group: g }),
      ),
    ).then((u) => alive && setUrls(u));
    return () => {
      alive = false;
    };
  }, [icons, groups]);
  return (
    <div className="about-dudes">
      {urls.map((u, i) => u && <img key={i} src={u} alt="" draggable={false} style={{ left: `${(DUDE_X[i] / 150) * 100}%` }} />)}
    </div>
  );
}

export function AboutDialog({
  assets, session, icons, audio, onClose,
}: {
  assets: AssetStore;
  /** In the game: the figures (their picture is a game resource) */
  session?: GameSession;
  icons?: IconRenderer;
  audio?: GameAudio;
  onClose: () => void;
}) {
  return (
    <div className="mk-modal">
      <Window title="About Meridian" dlu={[189, 281]} onClose={onClose} className="about-dialog">
        <div className="about-text" style={at([0, 4, 189, 34])}>
          <p>Meridian Shards client (version {__APP_VERSION__})</p>
          <p>Based on Meridian 59, Copyright © 1994-2012 Andrew Kirmse and Chris Kirmse</p>
          <p>Free software under the GNU GPL, version 2</p>
        </div>
        {session?.resource(ABOUT_RSC) && icons && audio && (
          <div style={at([19, 40, 150, 100])}>
            <Dudes icons={icons} audio={audio} />
          </div>
        )}
        <div className="about-scroll" style={at([23, 146, 143, 105])}>
          <Credits assets={assets} />
        </div>
        <Button at={[74, 260, 40, 14]} isDefault onClick={onClose}>
          OK
        </Button>
      </Window>
    </div>
  );
}
