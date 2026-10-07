// The desktop app's game file download (apps/desktop/src/assetCache.ts downloadAll), shown at
// the bottom of the login and character screens while it runs: a green bar like the health
// bar (statmain.c via graphctl.c: green on dark red, white Arial numbers). Once every file is
// on disk nothing in the game waits on the network. It's hidden when there was nothing to
// download, and says "ready" for a few seconds after one (a server update's few files can
// finish before the page is up).

import { useEffect, useState } from "react";
import { desktop, type DesktopAssetProgress } from "../host.ts";

const MB = 2 ** 20;
const READY_MS = 4000;

export function AssetDownload() {
  const [p, setP] = useState<DesktopAssetProgress | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(
    () =>
      desktop?.onAssets((next) => {
        setP(next);
        if (next.state !== "done") setHidden(false);
      }),
    [],
  );
  const done = p?.state === "done";
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setHidden(true), READY_MS);
    return () => clearTimeout(t);
  }, [done]);

  if (!p || p.state === "checking" || hidden || (done && !p.fetched)) return null;
  const pct = p.totalBytes ? Math.min(100, (p.doneBytes * 100) / p.totalBytes) : 100;
  const label =
    p.state === "done"
      ? "Game files ready"
      : p.state === "error"
        ? `Some game files didn't download (${p.failed}); they'll load as you play`
        : "Downloading game files (you can play while it finishes)";
  return (
    <div className="asset-download" role="status">
      <div className="label">{label}</div>
      <div className="stat-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="fill" style={{ width: `${pct}%` }} />
        <span className="num xp">
          {(p.doneBytes / MB).toFixed(0)} / {(p.totalBytes / MB).toFixed(0)} MB
        </span>
      </div>
    </div>
  );
}
