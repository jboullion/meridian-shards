import { useEffect, useState } from "react";
import type { CharInfo, CharacterSlot } from "@shards/protocol";
import { SAY } from "@shards/protocol";
import {
  GameSession, type ChatLine, type ContainerContents, type DamageDealt, type LookResult, type OfferEvent, type SessionPhase, type TradeList,
} from "@shards/world";
import type { RsbBundle } from "@shards/formats";
import type { AssetStore } from "../assets.ts";
import { desktop, gameSocketUrl } from "../host.ts";
import { GameAudio } from "./audio.ts";
import { CharacterCreator } from "./CharacterCreator.tsx";
import { AssetDownload } from "./AssetDownload.tsx";
import { CharacterSelect } from "./CharacterSelect.tsx";
import { GameView, appendChatLine } from "./GameView.tsx";
import { Framed } from "./TitleBar.tsx";
import { getSettings } from "./settings.ts";
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
  looks: Relay<LookResult>;
  contents: Relay<ContainerContents>;
  damage: Relay<DamageDealt>;
}

/**
 * msgfiltr.c: speech from ignored players, all broadcasts or everyone (the Who window's
 * choices) isn't shown. Our own lines always are.
 */
export function ignoredLine(line: ChatLine, ownName: string): boolean {
  // MessageSaid: speech from non-players (SAY_RESOURCE) always shows
  if (!line.sender || line.sayType === SAY.RESOURCE) return false;
  const name = line.sender.name.toLowerCase();
  if (name === ownName.toLowerCase()) return false;
  const s = getSettings();
  return s.ignoreEveryone || s.ignored.includes(name) || (s.ignoreBroadcasts && line.sayType === SAY.EVERYONE);
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
  /** The creator is open for this empty slot once BP_CHARINFO arrives */
  const [creating, setCreating] = useState<{ slotId: number; info: CharInfo | null } | null>(null);
  /** The game options the server keeps for us (UC_RECEIVE_PREFERENCES) */
  const [serverPrefs, setServerPrefs] = useState<number | null>(null);
  /** The last ping's round trip (lagbox.c) */
  const [latency, setLatency] = useState<number | null>(null);

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
    const looks = new Relay<LookResult>();
    const contents = new Relay<ContainerContents>();
    const damage = new Relay<DamageDealt>();
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
        chat: (line) => {
          const self = s.world.self;
          const tell = line.sayType === SAY.GROUP && line.sender && line.sender.id !== s.world.player?.id;
          if (ignoredLine(line, self ? (s.resource(self.info.nameRes) ?? "") : "")) {
            // msgfiltr.c MessageSaid: tell the server we didn't hear a tell (SendSayBlocked)
            const st = getSettings();
            if (tell && (st.ignoreEveryone || st.ignored.includes(line.sender!.name.toLowerCase()))) s.sayBlocked(line.sender!.id);
            return;
          }
          setChat((c) => appendChatLine(c, line));
          // ...and a ding for tells
          if (tell) audio.playLocal("imp.ogg");
        },
        preferences: setServerPrefs,
        latency: setLatency,
        look: looks.emit,
        contents: (container, items) => contents.emit({ container, items }),
        trade: trades.emit,
        offer: offers.emit,
        sound: (e) => audio.handle(e),
        damageDealt: damage.emit,
      },
    );
    setPhase("connecting");
    setLive({ session: s, audio, icons: new IconRenderer(assets, (id) => s.resource(id)), trades, offers, looks, contents, damage });
  };

  const logout = () => {
    session?.close();
    setLive(null);
    setCreating(null);
    setPhase("offline");
  };

  if (!live || !session || phase === "offline" || phase === "closed")
    return (
      <Framed assets={assets}>
        <LoginScreen assets={assets} onLogin={login} error={error} onClearError={() => setError(null)} />
        <AssetDownload />
      </Framed>
    );
  if (phase === "connecting" || phase === "login")
    return (
      <Framed assets={assets}>
        <ConnectingScreen />
        <AssetDownload />
      </Framed>
    );
  if (phase === "characters" && creating?.info)
    return (
      <Framed assets={assets}>
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
      </Framed>
    );
  if (phase === "characters")
    return (
      <Framed assets={assets}>
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
      </Framed>
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
      looks={live.looks.on}
      contents={live.contents.on}
      damage={live.damage.on}
      onLogout={logout}
      serverPrefs={serverPrefs}
      latency={latency}
    />
  );
}
