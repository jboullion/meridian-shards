// The admin dashboard (admin.html, development only): the local server and the game tabs from a
// browser tab of their own. Ours (docs/admin-console.md has the in-game console):
//   Spawn    monsters on the Proving Grounds' pads or beside us, and clearing up
//   Items    anything, into our inventory
//   Spells   cast at what's in our room (the dummies), as us
//   Rooms    every room: go there, rebuild it on the server, open it in the room editor
//   World    the server's time of day; our client's hour, weather, terrain and crowd
//   Quests   write quests and place their givers, then try them out on you (QuestsTab.tsx)
//   Sprites  paint and fix the game's sprites, hair and facial hair, import pictures (SpritesTab.tsx)
//   Tuning   ambient life's numbers, live in the game tabs; saved back to the source
//   Server   build and reload the Kod, save, and any maintenance command
// The server side is tools/dev/adminApi.ts; the game tab's side is game/devBridge.ts.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AssetStore } from "../assets.ts";
import { IconRenderer } from "../game/icons.ts";
import { TUNING_DEFAULTS, TUNING_TABLES, type TuningValues } from "../game/tuning.ts";
import type { SceneOverrides } from "../game/devBridge.ts";
import {
  buildKod, castSpell, findRoom, giveItem, loadCatalog, maint, objectsHere, provingGrounds, PROVING_GROUNDS_RID, saveTuning, spawnBeside, travelHere, travelMove,
  useDevLink, type Catalog, type CatalogEntry, type GameReport, type TravelHere, type TravelPoint,
} from "./api.ts";
import { QuestsTab } from "./QuestsTab.tsx";
import { SpritesTab } from "./SpritesTab.tsx";

const TABS = ["Spawn", "Items", "Spells", "Rooms", "World", "Quests", "Sprites", "Tuning", "Server"] as const;
type Tab = (typeof TABS)[number];

// ---------------------------------------------------------------- pictures from the game files

const assets = new AssetStore();
const assetsReady = assets.init();
const iconFiles: string[] = [];
let icons: IconRenderer | null = null;

function Picture({ file }: { file: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    void assetsReady.then(async () => {
      icons ??= new IconRenderer(assets, (id) => iconFiles[id - 1]);
      let id = iconFiles.indexOf(file) + 1;
      if (!id) id = iconFiles.push(file);
      const u = await icons.icon(id);
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [file]);
  return <span className="pic">{url ? <img src={url} alt="" /> : null}</span>;
}

// ---------------------------------------------------------------- the frame

export function Dashboard() {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("shards.admin.tab") as Tab | null) ?? "Spawn");
  const [log, setLog] = useState<{ at: string; text: string; error?: boolean }[]>([]);
  const [server, setServer] = useState<"up" | "down" | "?">("?");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const link = useDevLink();
  const me = link.game;

  const say = (text: string, error = false) => setLog((l) => [{ at: new Date().toLocaleTimeString(), text, error }, ...l].slice(0, 80));
  /** Runs an action, logging what it said or what went wrong */
  const act = (what: string, fn: () => Promise<string | void>) => () => {
    void fn().then(
      (r) => say(r ? `${what}: ${r}` : what),
      (e: unknown) => say(`${what}: ${(e as Error).message}`, true),
    );
  };

  useEffect(() => {
    const ping = () => void maint("show clock").then(() => setServer("up"), () => setServer("down"));
    ping();
    const t = setInterval(ping, 10000);
    void loadCatalog().then(setCatalog, (e: unknown) => say(`The server's Kod couldn't be read: ${(e as Error).message}`, true));
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("shards.admin.tab", tab);
    } catch {
      // Not kept
    }
  }, [tab]);

  const needMe = (): GameReport => {
    if (!me) throw new Error("No game tab is in the game: log in at http://localhost:5173 first");
    return me;
  };

  let page: ReactNode;
  if (tab === "Spawn") page = <SpawnPanel catalog={catalog} act={act} needMe={needMe} />;
  else if (tab === "Items") page = <ItemsPanel catalog={catalog} act={act} needMe={needMe} />;
  else if (tab === "Spells") page = <SpellsPanel catalog={catalog} act={act} needMe={needMe} me={me} />;
  else if (tab === "Rooms") page = <RoomsPanel act={act} needMe={needMe} />;
  else if (tab === "World") page = <WorldPanel act={act} needMe={needMe} me={me} scene={link.state.scene} setScene={(scene) => link.set({ scene })} />;
  else if (tab === "Quests") page = <QuestsTab act={act} needMe={needMe} me={me} catalog={catalog} />;
  else if (tab === "Sprites") page = <SpritesTab say={say} />;
  else if (tab === "Tuning") page = <TuningPanel act={act} tuning={link.state.tuning} setTuning={(tuning) => link.set({ tuning })} />;
  else page = <ServerPanel act={act} say={say} />;

  return (
    <div className="dash">
      <header>
        <h1>Shards Admin</h1>
        <span className={`dot ${server}`} title="blakserv's maintenance port" /> server {server}
        <span className="me">
          {me ? (
            <>
              <b>{me.character}</b> in {me.roomName} <span className="dim">({me.roomFile}, row {me.row}, col {me.col})</span>
            </>
          ) : (
            <span className="dim">No game tab in the game: log in at localhost:5173</span>
          )}
        </span>
        <button onClick={act("Off to the Proving Grounds", async () => void (await maint(`send object ${needMe().playerId} TeleportTo RID int ${PROVING_GROUNDS_RID}`)))}>
          Proving Grounds
        </button>
        <button onClick={act("Edit this room", async () => editRoom(needMe().roomFile))}>Edit this room</button>
      </header>
      <nav>
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <main>{page}</main>
      <aside className="log">
        {log.map((l, i) => (
          <div key={i} className={l.error ? "error" : ""}>
            <span className="dim">{l.at}</span> {l.text}
          </div>
        ))}
      </aside>
    </div>
  );
}

type Act = (what: string, fn: () => Promise<string | void>) => () => void;

async function editRoom(roomFile: string): Promise<string> {
  const res = await fetch(`/__dev/editor/open?room=${encodeURIComponent(roomFile)}`);
  return ((await res.json()) as { message: string }).message;
}

/** A searchable list of catalog entries with pictures */
function Pick<T extends CatalogEntry>({ list, picked, onPick, extra }: { list: T[] | undefined; picked: T | null; onPick: (e: T) => void; extra?: (e: T) => string }) {
  const [find, setFind] = useState("");
  const shown = useMemo(() => {
    const f = find.trim().toLowerCase();
    return (list ?? []).filter((e) => !f || e.name.toLowerCase().includes(f) || e.className.toLowerCase().includes(f)).slice(0, 200);
  }, [list, find]);
  return (
    <div className="pick">
      <input placeholder="Find by name or class" value={find} onChange={(e) => setFind(e.target.value)} />
      <div className="rows">
        {!list && <div className="dim">Reading the server's Kod...</div>}
        {shown.map((e) => (
          <div key={e.className} className={`row ${picked?.className === e.className ? "on" : ""}`} onClick={() => onPick(e)}>
            <Picture file={e.icon} />
            <span>{e.name}</span>
            <span className="dim">
              {e.className}
              {extra ? ` ${extra(e)}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the panels

function SpawnPanel({ catalog, act, needMe }: { catalog: Catalog | null; act: Act; needMe: () => GameReport }) {
  const [picked, setPicked] = useState<CatalogEntry | null>(null);
  const [pad, setPad] = useState(1);
  const [count, setCount] = useState(1);
  const name = picked?.className ?? "";
  return (
    <section className="split">
      <Pick list={catalog?.monsters} picked={picked} onPick={setPicked} />
      <div className="side">
        <h2>{picked ? picked.name : "Pick a monster"}</h2>
        <label>
          How many <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
        </label>
        <label>
          Pad
          <select value={pad} onChange={(e) => setPad(Number(e.target.value))}>
            {["top left", "top right", "bottom left", "bottom right", "middle"].map((p, i) => (
              <option key={p} value={i + 1}>
                {i + 1}: {p}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!picked} onClick={act(`Spawn ${count} ${name} on pad ${pad}`, async () => `${await provingGrounds("SpawnMonster", `what class ${name} pad int ${pad} count int ${count}`)} made`)}>
          Spawn on the Proving Grounds' pad
        </button>
        <button disabled={!picked} onClick={act(`Spawn ${count} ${name} beside you`, async () => `${await spawnBeside(name, needMe(), count)} made`)}>
          Spawn beside me
        </button>
        <h2>The Proving Grounds</h2>
        <button onClick={act("Clear monsters", async () => `${await provingGrounds("ClearMonsters")} deleted`)}>Clear monsters</button>
        <button onClick={act("Clear items", async () => `${await provingGrounds("ClearItems")} deleted`)}>Clear items</button>
        <button onClick={act("Reset the dummies", async () => void (await provingGrounds("ResetDummies")))}>Reset the dummies</button>
        <p className="dim">Monsters spawned beside you anywhere else stay until killed (they're kept from the disposal sweep).</p>
      </div>
    </section>
  );
}

function ItemsPanel({ catalog, act, needMe }: { catalog: Catalog | null; act: Act; needMe: () => GameReport }) {
  const [picked, setPicked] = useState<Catalog["items"][number] | null>(null);
  const [amount, setAmount] = useState(1);
  return (
    <section className="split">
      <Pick list={catalog?.items} picked={picked} onPick={setPicked} extra={(e) => (e.stack ? "(a stack)" : "")} />
      <div className="side">
        <h2>{picked ? picked.name : "Pick an item"}</h2>
        {picked?.stack && (
          <label>
            How many <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 1)} />
          </label>
        )}
        <button disabled={!picked} onClick={act(`Give ${picked?.className}`, async () => giveItem(picked!.className, needMe().playerId, amount, picked!.stack))}>
          Give it to me
        </button>
        <p className="dim">It goes straight into your inventory, as `create object` and `NewHold`.</p>
      </div>
    </section>
  );
}

function SpellsPanel({ catalog, act, needMe, me }: { catalog: Catalog | null; act: Act; needMe: () => GameReport; me: GameReport | null }) {
  const [picked, setPicked] = useState<Catalog["spells"][number] | null>(null);
  const [power, setPower] = useState(50);
  const [targets, setTargets] = useState<{ id: number; className: string }[]>([]);
  const [target, setTarget] = useState(0);
  return (
    <section className="split">
      <Pick list={catalog?.spells} picked={picked} onPick={setPicked} extra={(e) => `SID ${e.sid}`} />
      <div className="side">
        <h2>{picked ? picked.name : "Pick a spell"}</h2>
        <button
          onClick={act("What's in the room", async () => {
            const list = await objectsHere(needMe());
            setTargets(list);
            if (!list.some((t) => t.id === target)) setTarget(list.find((t) => t.className === "TrainingDummy")?.id ?? 0);
            return `${list.length} things`;
          })}
        >
          Find targets in my room
        </button>
        <label>
          At
          <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
            <option value={0}>myself</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.className} #{t.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Power <input type="number" min={1} max={99} value={power} onChange={(e) => setPower(Number(e.target.value) || 50)} />
        </label>
        <button
          disabled={!picked}
          onClick={act(`Cast ${picked?.name}`, async () => {
            const caster = needMe().playerId;
            const out = await castSpell(picked!.sid, caster, target || caster, power);
            return /completed/i.test(out) ? "cast" : out.split("\n").slice(-4).join(" ");
          })}
        >
          Cast it as me
        </button>
        <p className="dim">
          Cast by the server as {me?.character ?? "you"}, without mana, reagents or the spell being known. Object numbers change at every save: find targets again after one.
        </p>
      </div>
    </section>
  );
}

function RoomsPanel({ act, needMe }: { act: Act; needMe: () => GameReport }) {
  const [rooms, setRooms] = useState<{ rid: number; name: string; roo: string }[]>([]);
  const [find, setFind] = useState("");
  useEffect(() => {
    void assetsReady.then(() => assets.roomList()).then(setRooms);
  }, []);
  const shown = rooms.filter((r) => {
    const f = find.trim().toLowerCase();
    return !f || r.name.toLowerCase().includes(f) || r.roo.includes(f) || String(r.rid).startsWith(f);
  });
  return (
    <section>
      <input placeholder="Find a room by name, file or number" value={find} onChange={(e) => setFind(e.target.value)} />
      <table>
        <tbody>
          {shown.slice(0, 300).map((r) => (
            <tr key={r.rid}>
              <td className="dim">{r.rid}</td>
              <td>{r.name}</td>
              <td className="dim">{r.roo}</td>
              <td className="buttons">
                <button onClick={act(`Go to ${r.name}`, async () => void (await maint(`send object ${needMe().playerId} TeleportTo RID int ${r.rid}`)))}>Go</button>
                <button onClick={act(`Rebuild ${r.name}`, async () => void (await maint(`send object ${await findRoom(r.rid)} Recreate`)))}>Rebuild</button>
                <button onClick={act(`Edit ${r.roo}`, () => editRoom(r.roo))}>Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** "Move portal here": this room's travel point, moved to where we stand (tools/dev/adminApi.ts travelMove) */
function PortalPlacer({ act, me }: { act: Act; me: GameReport | null }) {
  const [asked, setAsked] = useState(0);
  const [busy, setBusy] = useState(false);
  const playerId = me?.playerId;
  const roomFile = me?.roomFile;
  // The answer for one question (who, which room, which try); a newer question shows as asking
  const question = `${playerId}|${roomFile}|${asked}`;
  const [answer, setAnswer] = useState<{ question: string; here?: TravelHere; problem?: string } | null>(null);
  useEffect(() => {
    if (!playerId) return;
    let live = true;
    void travelHere(playerId).then(
      (here) => live && setAnswer({ question, here }),
      (e: unknown) => live && setAnswer({ question, problem: (e as Error).message }),
    );
    return () => {
      live = false;
    };
  }, [playerId, question]);
  const current = answer?.question === question ? answer : null;
  const here = current?.here ?? null;
  const problem = current?.problem ?? null;
  const points = here?.points ?? [];
  const label = (p: TravelPoint) => {
    const name = (rsc: string) => rsc.replace(/^travel_name_/, "").replace(/_/g, " ");
    return p.leadsTo ? `${name(p.name)} → ${name(p.leadsTo)}` : name(p.name);
  };
  const move = (p: TravelPoint, part: "portal" | "arrival") =>
    act(`${part === "portal" ? "Move portal here" : "Arrival here"} (point ${p.id})`, async () => {
      if (!me) throw new Error("No game tab is in the game");
      const what = part === "portal" ? `point ${p.id}'s portal to your square` : `point ${p.id}'s arrival to your square, facing the way you face`;
      const then = part === "portal" ? ", then rebuilds this room (its monsters and items start over)" : "";
      if (!window.confirm(`Move ${what}? This rewrites travelnet.kod, builds the Kod and runs reload system, which saves the game${then}.`)) return "not done";
      setBusy(true);
      try {
        const r = await travelMove(me.playerId, p.id, part);
        setAnswer((a) => (a?.here ? { ...a, here: { ...a.here, points: a.here.points.map((x) => (x.id === p.id ? { ...r.point, leadsTo: x.leadsTo } : x)) } } : a));
        return r.steps.join(", ");
      } finally {
        setBusy(false);
      }
    });
  return (
    <>
      <h2>This room's portals</h2>
      {!me ? (
        <p className="dim">No game tab in the game.</p>
      ) : problem ? (
        <>
          <p className="dim">{problem}</p>
          <div className="buttons">
            <button onClick={() => setAsked((n) => n + 1)}>Ask again</button>
          </div>
        </>
      ) : !here ? (
        <p className="dim">Asking the server…</p>
      ) : !points.length ? (
        <p className="dim">RID {here.rid} has no travel point. A new one needs an id and a name in GetPoints (shards-server util/travelnet.kod): add it by hand.</p>
      ) : (
        <>
          {points.map((p) => (
            <div key={p.id}>
              <p>
                Point {p.id} ({label(p)}): portal at row {p.row}, col {p.col}
                {p.fineRow !== null ? ` (fine ${p.fineRow}, ${p.fineCol})` : ""}; arrival at row {p.arrivalRow}, col {p.arrivalCol}, facing{" "}
                {p.angle.replace(/^ANGLE_/, "").toLowerCase().replace("_", " ")}.
              </p>
              <div className="buttons">
                <button disabled={busy} onClick={move(p, "portal")}>Move portal here</button>
                <button disabled={busy} onClick={move(p, "arrival")}>Arrival here</button>
              </div>
            </div>
          ))}
          <p className="dim">
            Stand on the square you want (you're on row {me.row}, col {me.col}). For the arrival, face the way players should face too. Each move builds the Kod and runs
            reload system, a few seconds.
          </p>
        </>
      )}
    </>
  );
}

const TERRAINS = ["", "FIELDS", "FOREST", "HILLS", "JUNGLE", "SWAMP", "DESERT", "MOUNTAIN", "CAVES", "SEWERS", "NECROPOLIS", "CITY", "SHOP"];
const CROWDS: Record<string, SceneOverrides["crowd"]> = {
  "": null,
  town: { kind: "town", count: 8, place: "tos", guards: 1, livery: 0 },
  inn: { kind: "inn", count: 5, place: "tos" },
  castle: { kind: "castle", count: 8, faction: "princess", guards: 1, place: "castle" },
  shop: { kind: "shop", count: 2, place: "tos" },
};

/** The main network's points (shards-server util/travelnet.kod GetPoints) */
const TRAVEL_POINTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 90];

function WorldPanel({ act, needMe, me, scene, setScene }: { act: Act; needMe: () => GameReport; me: GameReport | null; scene: SceneOverrides; setScene: (s: SceneOverrides) => void }) {
  const hour = (h: number) => act(`The server's hour: ${h}`, async () => void (await maint(`send object 0 SetHour iNum int ${h}`)));
  const crowdKey = Object.entries(CROWDS).find(([, v]) => JSON.stringify(v) === JSON.stringify(scene.crowd ?? null))?.[0] ?? "";
  return (
    <section className="cols">
      <div>
        <h2>The server's time (everyone)</h2>
        <div className="buttons">
          <button onClick={hour(6)}>Morning</button>
          <button onClick={hour(13)}>Afternoon</button>
          <button onClick={hour(18)}>Evening</button>
          <button onClick={hour(23)}>Night</button>
          <button onClick={act("Real time", async () => void (await maint("send object 0 SystemInitGameHour")))}>Real time</button>
        </div>
        <p className="dim">The sun, the light and the lamps follow, for every player.</p>
        <h2>Fast travel (you)</h2>
        <div className="buttons">
          <button onClick={act("Attune to every portal", async () => void (await maint(...TRAVEL_POINTS.map((id) => `send object ${needMe().playerId} AttunePortal id int ${id}`))))}>
            Attune to every portal
          </button>
          <button onClick={act("Forget every portal", async () => void (await maint(`set object ${needMe().playerId} plAttunedPortals nil 0`)))}>Forget every portal</button>
          <button
            onClick={act("End the PvP lockout", async () => {
              const me = needMe().playerId;
              await maint(`set object ${me} piTimeAttackedPlayer int 0`, `set object ${me} piTimeAttackedByPlayer int 0`, `send object ${me} SendPvPUntil`);
            })}
          >
            End the PvP lockout
          </button>
        </div>
        <p className="dim">Portals you've forgotten show their gold "!" again once you re-enter the room.</p>
        <PortalPlacer act={act} me={me} />
      </div>
      <div>
        <h2>Our client only (the game tabs)</h2>
        <label>
          Ambient life's hour {scene.ambientHour ?? "(the sun's)"}
          <input type="range" min={-1} max={23} value={scene.ambientHour ?? -1} onChange={(e) => setScene({ ...scene, ambientHour: Number(e.target.value) < 0 ? null : Number(e.target.value) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={!!scene.raining} onChange={(e) => setScene({ ...scene, raining: e.target.checked })} /> Rain
        </label>
        <label className="check">
          <input type="checkbox" checked={!!scene.snowing} onChange={(e) => setScene({ ...scene, snowing: e.target.checked })} /> Snow
        </label>
        <label>
          Wet ground {(scene.wetness ?? 0).toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={scene.wetness ?? 0} onChange={(e) => setScene({ ...scene, wetness: Number(e.target.value) })} />
        </label>
        <label>
          The room as terrain
          <select value={scene.terrain?.[0] ?? ""} onChange={(e) => setScene({ ...scene, terrain: e.target.value ? [e.target.value] : null })}>
            {TERRAINS.map((t) => (
              <option key={t} value={t}>
                {t || "(as it is)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          With a crowd
          <select value={crowdKey} onChange={(e) => setScene({ ...scene, crowd: CROWDS[e.target.value] ?? null })}>
            {Object.keys(CROWDS).map((k) => (
              <option key={k} value={k}>
                {k || "(as it is)"}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setScene({ raining: false, snowing: false, wetness: 0 })}>Put it all back</button>
        <p className="dim">Rain and snow last until the server sends its own weather. Terrain and crowd change critters, bats, nature, ground detail, sounds and people, not the server.</p>
      </div>
    </section>
  );
}

function TuningPanel({ act, tuning, setTuning }: { act: Act; tuning: TuningValues; setTuning: (t: TuningValues) => void }) {
  const value = (table: string, key: string) => tuning[table]?.[key] ?? TUNING_DEFAULTS[table]![key]!;
  const set = (table: string, key: string, v: number) => {
    const next: TuningValues = { ...tuning, [table]: { ...tuning[table] } };
    if (v === TUNING_DEFAULTS[table]![key]) delete next[table]![key];
    else next[table]![key] = v;
    setTuning(next);
  };
  const changed = Object.values(tuning).reduce((n, t) => n + Object.keys(t).length, 0);
  const groups = TUNING_TABLES.flatMap((t) => Object.entries(t.table).map(([key, e]) => ({ table: t.id, key, e })));
  const byGroup = new Map<string, typeof groups>();
  for (const g of groups) byGroup.set(g.e.group, [...(byGroup.get(g.e.group) ?? []), g]);
  return (
    <section>
      <div className="buttons sticky">
        <span>{changed ? `${changed} changed, live in the game tabs` : "All as the source has them"}</span>
        <button disabled={!changed} onClick={() => setTuning({})}>
          Reset all
        </button>
        <button
          disabled={!changed}
          onClick={act("Save as defaults", async () => {
            if (!window.confirm("Write these values into the source files? The game tabs reload with them.")) return "not saved";
            const r = await saveTuning(tuning);
            return r.written.length ? `wrote ${r.written.join(", ")}` : "nothing to write";
          })}
        >
          Save as defaults
        </button>
      </div>
      {[...byGroup].map(([group, entries]) => (
        <div key={group} className="group">
          <h2>{group}</h2>
          {entries.map(({ table, key, e }) => {
            const v = value(table, key);
            const isChanged = tuning[table]?.[key] !== undefined;
            return (
              <label key={`${table}.${key}`} className={`slider ${isChanged ? "changed" : ""}`} title={`${table}.${key} (source: ${TUNING_DEFAULTS[table]![key]})`}>
                <span>{e.label}</span>
                <input type="range" min={e.min} max={e.max} step={e.step} value={v} onChange={(ev) => set(table, key, Number(ev.target.value))} />
                <input type="number" min={e.min} max={e.max} step={e.step} value={v} onChange={(ev) => set(table, key, Number(ev.target.value))} />
              </label>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function ServerPanel({ act, say }: { act: Act; say: (t: string, error?: boolean) => void }) {
  const [command, setCommand] = useState("");
  const [out, setOut] = useState("");
  const run = () => {
    const c = command.trim();
    if (!c) return;
    void maint(c).then(
      ([o]) => setOut((x) => `${x}> ${c}\n${o}\n`),
      (e: unknown) => say((e as Error).message, true),
    );
  };
  const careful = (what: string, cmd: string, warning: string) =>
    act(what, async () => (window.confirm(warning) ? (await maint(cmd))[0]?.split("\n").slice(-3).join(" ") : "not done"));
  return (
    <section>
      <div className="buttons">
        <button
          onClick={act("Build the Kod", async () => {
            const r = await buildKod();
            setOut((x) => `${x}${r.tail}\n`);
            return r.ok ? "built (reload system to use it)" : "the build failed: see below";
          })}
        >
          Build the Kod
        </button>
        <button onClick={careful("Reload system", "reload system", "Reload system saves the game and reloads all the Kod; anyone logged in waits a moment. Go ahead?")}>Reload system</button>
        <button onClick={careful("Save game", "save game", "Save the game now? Object numbers change.")}>Save game</button>
        <button
          onClick={act("Who", async () => {
            const [who] = await maint("who");
            setOut((x) => `${x}${who}\n`);
          })}
        >
          Who
        </button>
      </div>
      <div className="command">
        <input placeholder="A maintenance command: show object 123, send object 0 ..." value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
        <button onClick={run}>Send</button>
        <button onClick={() => setOut("")}>Clear</button>
      </div>
      <pre className="out">{out}</pre>
    </section>
  );
}
