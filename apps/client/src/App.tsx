import { useEffect, useState } from "react";
import { AssetStore } from "./assets.ts";
import { RoomViewer } from "./viewer/RoomViewer.tsx";

export function App() {
  const [assets, setAssets] = useState<AssetStore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const store = new AssetStore();
    store
      .init()
      .then(() => setAssets(store))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="splash error">{error}</div>;
  if (!assets) return <div className="splash">Loading…</div>;
  return <RoomViewer assets={assets} />;
}
