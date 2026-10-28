// Ours (docs/adr/0011-fast-travel.md 4.4): crossed swords, "PvP" and a clock by the minimap while
// the PvP lockout runs (UC_PVP_UNTIL): no fast travel, Elusion or Rescue until it ends.

import { useEffect, useState } from "react";

/** Seconds as a clock: 1:58, or 1:02:05 past the hour */
const clock = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

export function PvpLockout({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [until]);
  const left = Math.ceil((until - now) / 1000);
  if (left <= 0) return null;
  return (
    <div className="pvp-lockout" title="You fought another player: no fast travel, Elusion or Rescue until this runs out">
      <span aria-hidden>⚔</span> PvP {clock(left)}
    </div>
  );
}
