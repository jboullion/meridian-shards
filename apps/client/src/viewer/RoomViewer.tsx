import { useEffect, useRef, useState } from "react";
import type { AssetStore } from "../assets.ts";
import { DEFAULT_LIGHTING, SLICE_ROOMS, roomAmbient } from "../data/slice.ts";
import { RoomScene, type RoomStats } from "./roomScene.ts";

export function RoomViewer({ assets }: { assets: AssetStore }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<RoomScene | null>(null);
  const [rid, setRid] = useState(() => Number(new URLSearchParams(location.search).get("rid")) || 301);
  const [lighting, setLighting] = useState({ ...DEFAULT_LIGHTING, fog: true });
  const room = SLICE_ROOMS.find((r) => r.rid === rid)!;
  const ambient = roomAmbient(room, lighting.brightness);
  const sceneLighting = { ...lighting, ambient };
  const [stats, setStats] = useState<RoomStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [fov, setFov] = useState<number | null>(null);

  useEffect(() => {
    const s = new RoomScene(canvasRef.current!, assets, sceneLighting);
    setScene(s);
    const t = setInterval(() => setFps(s.fps), 500);
    return () => {
      clearInterval(t);
      s.dispose();
    };
    // the scene is created once; lighting changes go through setLighting below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  useEffect(() => {
    if (!scene) return;
    const url = new URL(location.href);
    url.searchParams.set("rid", String(rid));
    history.replaceState(null, "", url);
    let current = true;
    scene
      .loadRoom(room.roo, room.teleport)
      .then((st) => current && setStats(st))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [scene, rid, room]);

  useEffect(() => scene?.setLighting({ ...lighting, ambient }), [scene, lighting, ambient]);
  useEffect(() => scene?.setFov(fov), [scene, fov]);

  const slider = (key: "brightness" | "viewerLight" | "shade" | "sunAngle", label: string, max: number) => (
    <label className="slider">
      <span>
        {label} <b>{lighting[key]}</b>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        value={lighting[key]}
        onChange={(e) => setLighting({ ...lighting, [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <div className="viewer">
      <canvas ref={canvasRef} className="viewport" />
      <aside className="panel">
        <h1>Meridian Shards</h1>
        <p className="sub">Room viewer</p>
        <select
          value={rid}
          onChange={(e) => {
            setError(null);
            setRid(Number(e.target.value));
          }}
        >
          {SLICE_ROOMS.map((r) => (
            <option key={r.rid} value={r.rid}>
              {r.rid} {r.name}
            </option>
          ))}
        </select>
        <h2>View</h2>
        <select value={fov ?? ""} onChange={(e) => setFov(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Original (50° × 32°, wider if the window is)</option>
          <option value="45">45° vertical</option>
          <option value="60">60° vertical</option>
          <option value="75">75° vertical</option>
        </select>
        <h2>Light</h2>
        {slider("brightness", "Time of day (brightness)", 100)}
        <p className="note">
          Room ambient <b>{ambient}</b> = base {room.baseLight} + outdoors {room.outsideFactor} × (brightness − 50) / 4
        </p>
        {slider("viewerLight", "Player light", 255)}
        {slider("shade", "Sun shading", 63)}
        {slider("sunAngle", "Sun angle", 4095)}
        <label className="check">
          <input type="checkbox" checked={lighting.fog} onChange={(e) => setLighting({ ...lighting, fog: e.target.checked })} />
          Distance fog (D3D client)
        </label>
        <button onClick={() => setLighting({ ...DEFAULT_LIGHTING, fog: true })}>Server defaults</button>
        <h2>Room</h2>
        {error && <p className="error">{error}</p>}
        {stats && (
          <ul className="stats">
            <li>{stats.triangles.toLocaleString()} triangles</li>
            <li>{stats.textures} textures</li>
            {stats.missingTextures.length > 0 && <li>missing: {stats.missingTextures.join(", ")}</li>}
            <li>checksum {stats.securityOk ? "ok" : "MISMATCH"}</li>
            <li>loaded in {stats.loadMs.toFixed(0)} ms</li>
            <li>{fps.toFixed(0)} fps</li>
          </ul>
        )}
        <p className="help">
          Click the view to look around. WASD move, Space/C up/down, Shift faster, Esc to release the mouse.
        </p>
      </aside>
    </div>
  );
}
