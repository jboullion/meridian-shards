import { useEffect, useState, type FormEvent } from "react";
import type { CharInfo, CharacterSlot } from "@shards/protocol";
import { GameSession, type ChatLine, type LookResult, type OfferEvent, type SessionPhase, type TradeList } from "@shards/world";
import type { RsbBundle } from "@shards/formats";
import type { AssetStore } from "../assets.ts";
import { GameAudio } from "./audio.ts";
import { CharacterCreator } from "./CharacterCreator.tsx";
import { GameView, MAX_CHAT_LINES } from "./GameView.tsx";
import { IconRenderer } from "./icons.ts";

/** A tiny event relay: session events that arrive before (or without) a listener are dropped. */
class Relay<T> {
  private readonly fns = new Set<(v: T) => void>();
  emit = (v: T) => {
    for (const fn of this.fns) fn(v);
  };
  on = (fn: (v: T) => void) => {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  };
}

/** Things that live as long as one connection. */
interface Live {
  session: GameSession;
  audio: GameAudio;
  icons: IconRenderer;
  trades: Relay<TradeList>;
  offers: Relay<OfferEvent>;
}

const wsUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

function readRemembered(): string {
  try {
    return localStorage.getItem("shards.username") ?? "";
  } catch {
    return "";
  }
}

export function Game({ assets, rsb }: { assets: AssetStore; rsb: RsbBundle }) {
  const [live, setLive] = useState<Live | null>(null);
  const session = live?.session ?? null;
  const [phase, setPhase] = useState<SessionPhase | "offline">("offline");
  const [characters, setCharacters] = useState<CharacterSlot[]>([]);
  const [motd, setMotd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [look, setLook] = useState<LookResult | null>(null);
  /** The creator is open for this empty slot once BP_CHARINFO arrives */
  const [creating, setCreating] = useState<{ slotId: number; info: CharInfo | null } | null>(null);

  // Keep-alive pings from a worker, so background tabs stay connected.
  useEffect(() => {
    if (!live) return;
    const worker = new Worker(new URL("./pingWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = () => live.session.ping();
    const onUnload = () => live.session.close();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      worker.terminate();
      window.removeEventListener("beforeunload", onUnload);
      live.audio.dispose();
    };
  }, [live]);

  const login = (username: string, password: string) => {
    setError(null);
    try {
      localStorage.setItem("shards.username", username);
    } catch {
      // storage unavailable: fine
    }
    // Created on the login click, so the browser lets the page play sound.
    const audio = new GameAudio(assets);
    const trades = new Relay<TradeList>();
    const offers = new Relay<OfferEvent>();
    const s = new GameSession(
      { url: wsUrl(), username, password, secretKey: __SECRET_KEY__, lookupResource: (id) => rsb.get(id), pingIntervalMs: 0 },
      {
        phase: (p) => {
          setPhase(p);
          if (p === "closed") setLive(null);
        },
        characters: (c, m) => {
          setCharacters([...c]);
          if (m) setMotd(m);
        },
        error: setError,
        charInfo: (info) => setCreating((c) => (c ? { ...c, info } : c)),
        chat: (line) => setChat((c) => [...c.slice(-(MAX_CHAT_LINES - 1)), line]),
        look: setLook,
        trade: trades.emit,
        offer: offers.emit,
        sound: (e) => audio.handle(e),
      },
    );
    setPhase("connecting");
    setLive({ session: s, audio, icons: new IconRenderer(assets, (id) => s.resource(id)), trades, offers });
  };

  const logout = () => {
    session?.close();
    setLive(null);
    setCreating(null);
    setPhase("offline");
  };

  if (!live || !session || phase === "offline" || phase === "closed")
    return <LoginScreen onLogin={login} error={error} />;
  if (phase === "connecting" || phase === "login")
    return <div className="splash">Connecting…</div>;
  if (phase === "characters" && creating?.info)
    return (
      <CharacterCreator
        info={creating.info}
        slotId={creating.slotId}
        session={session}
        icons={live.icons}
        error={error}
        onCancel={() => {
          setCreating(null);
          setError(null);
        }}
      />
    );
  if (phase === "characters")
    return (
      <CharacterSelect
        characters={characters}
        motd={motd}
        error={error}
        session={session}
        onLogout={logout}
        onCreate={(slotId) => {
          // charpick.c: picking "<New character>" asks the server for the creator's choices
          setError(null);
          setCreating({ slotId, info: null });
          session.requestCharInfo();
        }}
      />
    );
  return (
    <GameView
      session={session}
      assets={assets}
      audio={live.audio}
      icons={live.icons}
      trades={live.trades.on}
      offers={live.offers.on}
      phase={phase}
      chat={chat}
      look={look}
      onCloseLook={() => setLook(null)}
      onLogout={logout}
    />
  );
}

function LoginScreen({ onLogin, error }: { onLogin: (u: string, p: string) => void; error: string | null }) {
  const [username, setUsername] = useState(readRemembered);
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (username && password) onLogin(username.trim(), password);
  };
  return (
    <div className="screen">
      <form className="card" onSubmit={submit}>
        <h1>Meridian Shards</h1>
        <p className="sub">A new account is created the first time you log in with a name.</p>
        <label>
          Account
          <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={!username || !password}>
          Enter the shard
        </button>
        <p className="sub">
          <a href="?viewer">Room viewer</a>
        </p>
      </form>
    </div>
  );
}

function CharacterSelect({
  characters, motd, error, session, onLogout, onCreate,
}: {
  characters: CharacterSlot[];
  motd: string;
  error: string | null;
  session: GameSession;
  onLogout: () => void;
  onCreate: (slotId: number) => void;
}) {
  const created = characters.filter((c) => c.flags !== 1);
  const free = characters.filter((c) => c.flags === 1);
  return (
    <div className="screen">
      <div className="card wide">
        <h1>Choose your character</h1>
        {motd && motd !== "<Default>" && <p className="motd">{motd}</p>}
        <ul className="characters">
          {created.map((c) => (
            <li key={c.id}>
              <button onClick={() => session.useCharacter(c.id)}>{c.name}</button>
            </li>
          ))}
          {free.length > 0 && (
            <li>
              <button className="new-character" onClick={() => onCreate(free[0].id)}>
                &lt;New character&gt;
              </button>
            </li>
          )}
        </ul>
        {free.length > 0 && (
          <p className="sub">
            {free.length} free slot{free.length === 1 ? "" : "s"}.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={onLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
