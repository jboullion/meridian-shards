import { useEffect, useState } from "react";
import type { CharInfo, CharacterSlot } from "@shards/protocol";
import { GameSession, type ChatLine, type LookResult, type OfferEvent, type SessionPhase, type TradeList } from "@shards/world";
import type { RsbBundle } from "@shards/formats";
import type { AssetStore } from "../assets.ts";
import { desktop, gameSocketUrl } from "../host.ts";
import { GameAudio } from "./audio.ts";
import { CharacterCreator } from "./CharacterCreator.tsx";
import { AssetDownload } from "./AssetDownload.tsx";
import { CharacterSelect } from "./CharacterSelect.tsx";
import { GameView, MAX_CHAT_LINES } from "./GameView.tsx";
import { IconRenderer } from "./icons.ts";
import { ConnectingScreen, LoginScreen } from "./LoginScreen.tsx";

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

/** Set before reloading for a server update, so the login screen can say why. */
const UPDATED_KEY = "shards.serverUpdated";

function takeUpdatedNotice(): string | null {
  try {
    const was = sessionStorage.getItem(UPDATED_KEY);
    sessionStorage.removeItem(UPDATED_KEY);
    return was ? "The server was updated while you were away. Please log in again." : null;
  } catch {
    return null;
  }
}

export function Game({ assets, rsb }: { assets: AssetStore; rsb: RsbBundle }) {
  const [live, setLive] = useState<Live | null>(null);
  const session = live?.session ?? null;
  const [phase, setPhase] = useState<SessionPhase | "offline">("offline");
  const [characters, setCharacters] = useState<CharacterSlot[]>([]);
  const [motd, setMotd] = useState("");
  const [error, setError] = useState<string | null>(takeUpdatedNotice);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [look, setLook] = useState<LookResult | null>(null);
  /** The creator is open for this empty slot once BP_CHARINFO arrives */
  const [creating, setCreating] = useState<{ slotId: number; info: CharInfo | null } | null>(null);

  // The desktop app asks before closing the window mid-game
  useEffect(() => desktop?.setPhase(phase), [phase]);

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
    // A server updated since this page loaded has new files (rsc0000.rsb, rooms) that the
    // login depends on: reload to get them, and the client that goes with them
    void assets
      .changedOnServer()
      .catch(() => false)
      .then((changed) => {
        if (!changed) return connect(username, password, audio);
        audio.dispose();
        try {
          sessionStorage.setItem(UPDATED_KEY, "1");
        } catch {
          // no notice then
        }
        location.reload();
      });
  };

  const connect = (username: string, password: string, audio: GameAudio) => {
    const trades = new Relay<TradeList>();
    const offers = new Relay<OfferEvent>();
    const s = new GameSession(
      { url: gameSocketUrl(), username, password, secretKey: __SECRET_KEY__, lookupResource: (id) => rsb.get(id), pingIntervalMs: 0 },
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
    return (
      <>
        <LoginScreen assets={assets} onLogin={login} error={error} onClearError={() => setError(null)} />
        <AssetDownload />
      </>
    );
  if (phase === "connecting" || phase === "login")
    return (
      <>
        <ConnectingScreen />
        <AssetDownload />
      </>
    );
  if (phase === "characters" && creating?.info)
    return (
      <>
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
          onClearError={() => setError(null)}
        />
        <AssetDownload />
      </>
    );
  if (phase === "characters")
    return (
      <>
        <CharacterSelect
          characters={characters}
          motd={motd}
          error={error}
          session={session}
          onLogout={logout}
          onClearError={() => setError(null)}
          onCreate={(slotId) => {
            // charpick.c: picking "<New character>" asks the server for the creator's choices
            setError(null);
            setCreating({ slotId, info: null });
            session.requestCharInfo();
          }}
        />
        <AssetDownload />
      </>
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
