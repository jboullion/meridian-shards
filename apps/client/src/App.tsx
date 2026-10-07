import { useEffect, useState } from "react";
import type { RsbBundle } from "@shards/formats";
import { AssetStore } from "./assets.ts";
import { Game } from "./game/Game.tsx";
import { RoomViewer } from "./viewer/RoomViewer.tsx";

const isViewer = () => new URLSearchParams(location.search).has("viewer") || new URLSearchParams(location.search).has("rid");

export function App() {
  const [assets, setAssets] = useState<AssetStore | null>(null);
  const [rsb, setRsb] = useState<RsbBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const store = new AssetStore();
    store
      .init()
      .then(() => store.rsb())
      .then((r) => {
        setRsb(r);
        setAssets(store);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="splash error">{error}</div>;
  if (!assets || !rsb) return <div className="splash">Loading…</div>;
  if (isViewer()) return <RoomViewer assets={assets} />;
  return <Game assets={assets} rsb={rsb} />;
}
