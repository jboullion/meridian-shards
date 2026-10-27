// The Music & Sounds tab: every track and sound in the asset build, to listen to here or in the
// game tab, with who plays it (the rooms and Kod that name it, the client's own sounds). A game
// track can be heard as written too: its XMI rendered with gm.dls or GeneralUser GS, beside the
// recording the client plays. Our own pieces (tools/music/pieces) are rebuilt from here; the game
// tabs fetch them anew. The server side is tools/dev/audioApi.ts.
//
// Keys in the list: Up and Down move, Space plays or stops.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { buildPiece, loadAudio, musicInGame, renderOriginal, soundInGame, type AudioFile, type AudioList, type PieceInfo } from "./api.ts";

type Say = (text: string, error?: boolean) => void;
type Act = (what: string, fn: () => Promise<string | void>) => () => void;

const FILTERS = ["All", "Music", "Sounds", "Ambient", "Ours", "Unused"] as const;
type Filter = (typeof FILTERS)[number];

/** A row: a file in the asset build, or a piece of ours not built yet */
type Row = AudioFile | { name: string; kind: "music"; piece: string; unbuilt: true };
const isFile = (r: Row): r is AudioFile => !("unbuilt" in r);

const matches = (f: Filter, r: Row) =>
  f === "All" ||
  (f === "Music" && r.kind === "music") ||
  (f === "Sounds" && r.kind === "sound") ||
  (f === "Ambient" && r.kind === "ambient") ||
  (f === "Ours" && !!r.piece) ||
  (f === "Unused" && isFile(r) && r.users.length === 0);

const time = (s: number | null | undefined) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const assetUrl = (f: AudioFile) => `/assets/${f.name}?v=${f.hash}`;

/** Who plays it, in a few words */
function usedBy(f: AudioFile): string {
  if (!f.users.length) return "not used";
  const labels = [...new Set(f.users.map((u) => (u.where === "client" ? `client: ${u.label}` : u.label)))];
  return labels.length > 3 ? `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more` : labels.join(", ");
}

export function AudioTab({ act, say }: { act: Act; say: Say }) {
  const [data, setData] = useState<AudioList | null>(null);
  const [filter, setFilter] = useState<Filter>(() => (localStorage.getItem("shards.admin.audio.filter") as Filter | null) ?? "Music");
  const [find, setFind] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [bank, setBank] = useState("gm");
  const [original, setOriginal] = useState<{ name: string; bank: string; url: string; midi: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const reload = () =>
    loadAudio().then(setData, (e: unknown) => say(`The music and sounds couldn't be listed: ${(e as Error).message}`, true));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("shards.admin.audio.filter", filter);
    } catch {
      // Not kept
    }
  }, [filter]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const built = new Set(data.files.map((f) => f.name));
    const unbuilt: Row[] = data.pieces.filter((p) => !built.has(p.file)).map((p) => ({ name: p.file || p.name, kind: "music", piece: p.name, unbuilt: true }));
    return [...unbuilt, ...data.files];
  }, [data]);
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return rows.filter((r) => matches(filter, r) && (!q || r.name.includes(q) || (isFile(r) && r.users.some((u) => u.label.toLowerCase().includes(q) || u.path.toLowerCase().includes(q)))));
  }, [rows, filter, find]);
  const row = rows.find((r) => r.name === picked) ?? null;
  const file = row && isFile(row) ? row : null;
  const piece: PieceInfo | null = (row?.piece && data?.pieces.find((p) => p.name === row.piece)) || null;

  /** Picks a row and puts it in the player */
  const select = (r: Row) => {
    setPicked(r.name);
    setLoop(r.kind === "music");
    const a = player.current;
    if (!a) return;
    if (!isFile(r)) {
      a.pause();
      a.removeAttribute("src");
      return;
    }
    const url = assetUrl(r);
    if (!a.src.endsWith(url)) a.src = url;
  };
  /** Picks a row and plays it here, from the start */
  const play = (r: Row) => {
    select(r);
    const a = player.current;
    if (!a || !isFile(r)) return;
    a.currentTime = 0;
    void a.play().catch(() => {});
  };
  const stop = () => player.current?.pause();
  const toggle = (r: Row) => (picked === r.name && playing ? stop() : play(r));

  const onKey = (e: KeyboardEvent) => {
    const i = shown.findIndex((r) => r.name === picked);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (!next) return;
      if (playing) play(next);
      else select(next);
      listRef.current?.querySelector(`[data-name="${CSS.escape(next.name)}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === " " && row) {
      e.preventDefault();
      toggle(row);
    }
  };

  const showOriginal = act(`The original MIDI of ${file?.name} (${bank})`, async () => {
    if (!file) return;
    setBusy("original");
    try {
      const r = await renderOriginal(file.name, bank);
      setOriginal({ name: file.name, bank, url: r.url, midi: r.midi });
      return `${file.xmi}, ${time(r.seconds)}`;
    } finally {
      setBusy(null);
    }
  });
  const rebuild = act(`Rebuild ${piece?.title}`, async () => {
    if (!piece) return;
    setBusy("build");
    try {
      const r = await buildPiece(piece.name);
      await reload();
      setPicked(r.file);
      const a = player.current;
      if (a && a.src.includes(`/assets/${r.file}`)) {
        const at = a.currentTime;
        a.src = `/assets/${r.file}?v=${r.hash}`;
        a.currentTime = at;
        if (playing) void a.play().catch(() => {});
      }
      return `${r.file}, ${time(r.seconds)}: the game tabs play the new one`;
    } finally {
      setBusy(null);
    }
  });

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, rows.filter((r) => matches(f, r)).length])), [rows]);

  return (
    <section className="split audio">
      <div className="pick" onKeyDown={onKey}>
        <div className="buttons">
          {FILTERS.map((f) => (
            <button key={f} className={f === filter ? "on" : ""} onClick={() => setFilter(f)}>
              {f} <span className="dim">{counts[f] ?? ""}</span>
            </button>
          ))}
        </div>
        <input placeholder="Find by file, room or Kod file" value={find} onChange={(e) => setFind(e.target.value)} />
        <div className="rows" ref={listRef} tabIndex={0}>
          {!data && <div className="dim">Reading the asset build and the Kod...</div>}
          {shown.map((r) => (
            <div key={r.name} data-name={r.name} className={`row ${picked === r.name ? "on" : ""}`} onClick={() => select(r)}>
              <button
                className="playbtn"
                disabled={!isFile(r)}
                title={picked === r.name && playing ? "Stop" : "Play here"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(r);
                }}
              >
                {picked === r.name && playing ? "■" : "▶"}
              </button>
              <div className="name">
                {r.name} {r.piece && <span className="tag">ours</span>}
                <div className="dim small">{isFile(r) ? usedBy(r) : "not built yet"}</div>
              </div>
              <span className="dim">{isFile(r) ? time(r.seconds) : ""}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="side">
        <h2>{row ? row.name : "Pick a track or sound"}</h2>
        <audio ref={player} controls loop={loop} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
        {file && (
          <>
            <p className="dim">
              {file.kind === "music" ? "Music" : file.kind === "ambient" ? "Ambient (ours, client-side)" : "Sound"}
              {file.seconds != null && `, ${time(file.seconds)}`}, {kb(file.size)}
            </p>
            <div className="buttons">
              <button onClick={() => play(file)}>Play here</button>
              <label className="check">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop
              </label>
            </div>
            <div className="buttons">
              {file.kind === "music" ? (
                <>
                  <button onClick={act(`${file.name} in the game`, async () => musicInGame(file.name))}>Play in game</button>
                  <button onClick={act("The room's music again", async () => musicInGame(null))}>Room's music</button>
                </>
              ) : (
                <button onClick={act(`${file.name} in the game`, async () => soundInGame(file.name))}>Play in game</button>
              )}
            </div>
          </>
        )}

        {file?.xmi && (
          <>
            <h2>As written</h2>
            <p className="dim">
              {file.xmi}, rendered from its MIDI. The first time takes a few seconds.
            </p>
            <div className="buttons">
              <select value={bank} onChange={(e) => setBank(e.target.value)}>
                {(data?.banks ?? ["gm"]).map((b) => (
                  <option key={b} value={b}>
                    {b === "gm" ? "gm.dls (Windows)" : b === "generaluser" ? "GeneralUser GS" : b}
                  </option>
                ))}
              </select>
              <button disabled={busy === "original"} onClick={showOriginal}>
                {busy === "original" ? "Rendering..." : "Render the MIDI"}
              </button>
            </div>
            {original?.name === file.name && (
              <>
                <audio controls loop src={original.url} />
                <a className="dim" href={original.midi}>
                  Download the MIDI
                </a>
              </>
            )}
          </>
        )}

        {piece && (
          <>
            <h2>Ours: {piece.title}</h2>
            {piece.error ? <p className="error">{piece.error}</p> : <p>{piece.about}</p>}
            <p className="dim">
              tools/music/pieces/{piece.name}.ts: {piece.bars} bars, {time(piece.seconds)}; {piece.parts.join(", ")}
            </p>
            <div className="buttons">
              <button disabled={busy === "build"} onClick={rebuild}>
                {busy === "build" ? "Building..." : file ? "Rebuild" : "Build"}
              </button>
              <a className="dim" href={`/__admin/audio/file?name=${piece.name}.mid`}>
                Download the MIDI
              </a>
            </div>
          </>
        )}

        {file && file.users.length > 0 && (
          <>
            <h2>Played by</h2>
            <table className="users">
              <tbody>
                {file.users.map((u, i) => (
                  <tr key={i}>
                    <td>{u.label}</td>
                    <td className="dim">{u.where === "kod" ? `kod/${u.path}` : u.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {!row && (
          <p className="dim">
            New music: add a piece to tools/music/pieces (princess.ts shows how), then Rebuild it under Ours. A room plays it once its Kod names the file
            (castle2a_music = princess.ogg).
          </p>
        )}
      </div>
    </section>
  );
}
