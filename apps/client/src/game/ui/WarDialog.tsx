// Ours (docs/adr/0021-factions-and-the-faction-war.md, phase 5): the War window, from typing
// "war", its key (J), or the War button (WarButton.tsx). For now it is the map of the realm's
// flagpoles alone (2026-10-29: the war, ledger and battles pages were taken out; git has them).
// Lines join neighbouring poles, gold where a battle may be called, and a line under the map
// counts down to the next battle, to the clash, or to the fight's end. It comes from our server
// (factionwar.kod SendWar), asked for as the window opens and again as a battle is called, opens
// or ends.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BATTLE_FLAG, FACTION, LIEGE_NAMES, LIEGE_SHORT, POLE_FLAG, WAR_STATE, gridCell, gridName, warCommand,
  type GameSession, type WarBattle, type WarPole, type WarStatus,
} from "@shards/world";
import { Button, Window } from "./kit.tsx";
import { formatCountdown, useFactionWar, useSecondTick, type FactionWarStore } from "../factionWar.ts";

/** The towns' poles on the map (RID_TOS, RID_BAR_NORTH, RID_CORNOTH, RID_MARION, RID_RAZA, RID_JASWEST) */
const TOWN_LETTERS: Readonly<Record<number, string>> = { 50: "T", 101: "B", 150: "C", 200: "M", 300: "R", 382: "J" };

/** The lieges' colours, as their soldiers' shields (dukeshld.kod, prinshld.kod, reblshld.kod) */
const LIEGE_CLASS: Readonly<Record<number, string>> = {
  [FACTION.NEUTRAL]: "liege-none",
  [FACTION.DUKE]: "liege-duke",
  [FACTION.PRINCESS]: "liege-princess",
  [FACTION.REBEL]: "liege-rebel",
};

export function WarDialog({ store, session, onClose }: { store: FactionWarStore; session: GameSession; onClose: () => void }) {
  useFactionWar(store);
  useSecondTick(true);
  useEffect(() => {
    session.shardsCommand(warCommand());
  }, [session]);
  // A battle called, opened or ended: all of it again (the map changes too)
  const state = store.battle?.state ?? WAR_STATE.NONE;
  const last = useRef(state);
  useEffect(() => {
    if (last.current !== state) session.shardsCommand(warCommand());
    last.current = state;
  }, [session, state]);
  const s = store.status;
  return (
    <Window title="The Faction War" onClose={onClose} className="game-dialog war-window">
      <div className="war-page">{!s ? <p>Asking the heralds...</p> : <MapPage s={s} store={store} />}</div>
      <div className="mk-buttons">
        <Button isDefault onClick={onClose}>
          Close
        </Button>
      </div>
    </Window>
  );
}

function Liege({ faction, short }: { faction: number; short?: boolean }) {
  return <span className={`war-liege ${LIEGE_CLASS[faction] ?? ""}`}>{(short ? LIEGE_SHORT : LIEGE_NAMES)[faction] ?? "No liege"}</span>;
}

/** What the war is doing now, in a sentence with its countdown */
function Countdown({ b, store }: { b: WarBattle; store: FactionWarStore }) {
  if (b.state === WAR_STATE.MUSTER) {
    return (
      <>
        <Liege faction={b.attacker} short /> {b.flags & BATTLE_FLAG.SIEGE ? "lays siege to" : "marches on"} {b.room}
        {b.flags & BATTLE_FLAG.OPEN_GROUND ? (
          ", which no liege holds"
        ) : (
          <>
            , held by <Liege faction={b.defender} short />
          </>
        )}
        . The armies meet in <b>{formatCountdown(store.secondsLeft())}</b>.
      </>
    );
  }
  if (b.state === WAR_STATE.FIGHT) {
    return (
      <>
        <Liege faction={b.attacker} short /> and <Liege faction={b.defender} short /> fight at {b.room}: <b>{formatCountdown(store.secondsLeft())}</b> left.
      </>
    );
  }
  const next = store.nextSeconds();
  if (next === null) return <>No battle is called yet.</>;
  return (
    <>
      The lieges call the next battle in <b>{formatCountdown(next)}</b>.
    </>
  );
}

/** The pole the pointer is on, and where its tooltip goes in the map (px from the map's top left) */
interface Tip {
  pole: WarPole;
  x: number;
  top: number;
  bottom: number;
}

/** Each pole's centre in the map, measured, for the lines between neighbours */
interface Centres {
  w: number;
  h: number;
  at: Map<number, { x: number; y: number }>;
}

function MapPage({ s, store }: { s: WarStatus; store: FactionWarStore }) {
  const battle = store.battle ?? s.battle;
  const [tip, setTip] = useState<Tip | null>(null);
  const map = useRef<HTMLDivElement>(null);
  const tipEl = useRef<HTMLDivElement>(null);
  // Kept inside the map: at the edges it slides along rather than hang off the window
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const m = map.current?.getBoundingClientRect();
    const r = tipEl.current?.getBoundingClientRect();
    if (!tip || !m || !r) return setShift(0);
    const half = r.width / 2;
    setShift(Math.min(Math.max(tip.x, half + 2), m.width - half - 2) - tip.x);
  }, [tip]);
  const [centres, setCentres] = useState<Centres | null>(null);
  useLayoutEffect(() => {
    const el = map.current;
    if (!el) return;
    const measure = () => {
      const m = el.getBoundingClientRect();
      const at = new Map<number, { x: number; y: number }>();
      for (const p of el.querySelectorAll<HTMLElement>("[data-rid]")) {
        const r = p.getBoundingClientRect();
        at.set(Number(p.dataset.rid), { x: r.left + r.width / 2 - m.left, y: r.top + r.height / 2 - m.top });
      }
      setCentres({ w: m.width, h: m.height, at });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.poles]);
  const cells = s.poles.map((p) => ({ p, at: gridCell(p.rid) })).filter((c) => c.at);
  const counts = [FACTION.DUKE, FACTION.PRINCESS, FACTION.REBEL, FACTION.NEUTRAL].map((f) => s.poles.filter((p) => p.owner === f).length);
  // The fronts drawn last, over the plain links
  const links = [...s.links].sort((x, y) => Number(x.front) - Number(y.front));
  const onFront = (rid: number) => s.links.some((l) => l.front && (l.a === rid || l.b === rid));
  const show = (p: WarPole, el: HTMLElement) => {
    const m = map.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!m) return;
    setTip({ pole: p, x: r.left + r.width / 2 - m.left, top: r.top - m.top, bottom: r.bottom - m.top });
  };
  // The tooltip's pole as the server last told us, so it follows a battle called under it
  const tp = tip ? (s.poles.find((p) => p.rid === tip.pole.rid) ?? tip.pole) : null;
  // Above the pole, or below it in the top rows where there's no room above
  const below = tip !== null && tip.top < 60;
  return (
    <>
      <div className="war-map" ref={map} role="img" aria-label="The realm's flagpoles" onMouseLeave={() => setTip(null)}>
        {centres && (
          <svg className="war-links" width={centres.w} height={centres.h} aria-hidden="true">
            {links.map((l) => {
              const a = centres.at.get(l.a);
              const b = centres.at.get(l.b);
              if (!a || !b) return null;
              const lit = tip !== null && (tip.pole.rid === l.a || tip.pole.rid === l.b);
              return <line key={`${l.a}-${l.b}`} className={`war-link${l.front ? " front" : ""}${lit ? " lit" : ""}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
          </svg>
        )}
        {cells.map(({ p, at }) => (
          <span
            key={p.rid}
            data-rid={p.rid}
            className={`war-pole ${LIEGE_CLASS[p.owner] ?? ""}${p.flags & POLE_FLAG.TOWN ? " town" : ""}${p.flags & POLE_FLAG.BATTLE ? " battle" : ""}${p.flags & POLE_FLAG.HALF_STAFF ? " half" : ""}${tip?.pole.rid === p.rid ? " hover" : ""}`}
            style={{ gridColumn: at!.col, gridRow: at!.row }}
            onMouseEnter={(e) => show(p, e.currentTarget)}
            onClick={(e) => (tip?.pole.rid === p.rid ? setTip(null) : show(p, e.currentTarget))}
          >
            {p.flags & POLE_FLAG.BATTLE ? "⚔" : p.flags & POLE_FLAG.TOWN ? (TOWN_LETTERS[p.rid] ?? p.name[0]) : ""}
          </span>
        ))}
        {tip && tp && (
          <div className={`war-tip${below ? " below" : ""}`} style={{ left: tip.x + shift, top: below ? tip.bottom : tip.top }} ref={tipEl} role="tooltip">
            <div className="war-tip-name">
              {tp.name}
              {gridName(tp.rid) ? <span className="war-tip-grid"> {gridName(tp.rid)}</span> : null}
            </div>
            <div>
              {tp.owner === FACTION.NEUTRAL ? (
                "No liege holds it"
              ) : (
                <>
                  Held by <Liege faction={tp.owner} />
                </>
              )}
            </div>
            {tp.flags & POLE_FLAG.TOWN ? <div className="war-tip-note">The town's own pole: it follows its capture points</div> : null}
            {tp.flags & POLE_FLAG.BATTLE ? (
              <div className="war-tip-note battle">
                {battle.state === WAR_STATE.MUSTER
                  ? `The armies meet here in ${formatCountdown(store.secondsLeft())}`
                  : `The armies fight here: ${formatCountdown(store.secondsLeft())} left`}
              </div>
            ) : onFront(tp.rid) ? (
              <div className="war-tip-note">On a front</div>
            ) : null}
            {tp.flags & POLE_FLAG.HALF_STAFF ? <div className="war-tip-note">Flags at half-staff</div> : null}
          </div>
        )}
      </div>
      <p className={`war-countdown${battle.state !== WAR_STATE.NONE ? " on" : ""}`}>
        <Countdown b={battle} store={store} />
      </p>
      <p className="war-map-caption">
        The realm's flagpoles, north at the top. Large squares are the towns' own poles: Tos, Barloque, Cor Noth, Marion, Jasper and Raza. Lines join neighbours; the gold ones are fronts, where a
        battle may be called.
      </p>
      <p className="war-legend">
        <Liege faction={FACTION.DUKE} short /> {counts[0]}, <Liege faction={FACTION.PRINCESS} short /> {counts[1]}, <Liege faction={FACTION.REBEL} short /> {counts[2]}, <Liege faction={FACTION.NEUTRAL} short /> {counts[3]}
      </p>
    </>
  );
}
