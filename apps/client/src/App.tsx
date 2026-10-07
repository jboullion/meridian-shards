import { useEffect, useState } from "react";
import type { RsbBundle } from "@shards/formats";
import { AssetStore } from "./assets.ts";
import { Game } from "./game/Game.tsx";
import { desktop, devPagesEnabled, serverName, type DesktopBridge } from "./host.ts";
import { installUiTheme } from "./game/ui/kit.tsx";
import { RoomViewer } from "./viewer/RoomViewer.tsx";

const isViewer = () =>
  devPagesEnabled && (new URLSearchParams(location.search).has("viewer") || new URLSearchParams(location.search).has("rid"));

export function App() {
  const [assets, setAssets] = useState<AssetStore | null>(null);
  const [rsb, setRsb] = useState<RsbBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const store = new AssetStore();
    store
      .init()
      .then(() => {
        installUiTheme(store);
        return store.rsb();
      })
      .then((r) => {
        setRsb(r);
        setAssets(store);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return desktop ? <ServerError desktop={desktop} message={error} /> : <div className="splash error">{error}</div>;
  if (!assets || !rsb) return <div className="splash">Loading…</div>;
  if (isViewer()) return <RoomViewer assets={assets} />;
  return <Game assets={assets} rsb={rsb} />;
}

/** The desktop app couldn't load the game files from the chosen server: retry or pick another. */
function ServerError({ desktop, message }: { desktop: DesktopBridge; message: string }) {
  return (
    <div className="splash">
      <div className="server-error">
        <p className="error">
          Can't load the game from {serverName()}: {message}
        </p>
        <p>
          <button type="button" onClick={() => location.reload()}>
            Try again
          </button>
          {desktop.servers
            .filter((s) => s.origin !== desktop.server)
            .map((s) => (
              <button type="button" key={s.origin} onClick={() => desktop.selectServer(s.origin)}>
                {s.name}
              </button>
            ))}
        </p>
      </div>
    </div>
  );
}
