import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import type { RsbBundle } from "@shards/formats";
import { AssetStore } from "./assets.ts";
import { Game } from "./game/Game.tsx";
import { LoginScreen } from "./game/LoginScreen.tsx";
import { Framed } from "./game/TitleBar.tsx";
import { devPagesEnabled, serverName, unreachableMessage } from "./host.ts";
import { installUiTheme } from "./game/ui/kit.tsx";

/** The room viewer (a developer page): loaded only in development, so production builds don't carry it */
const RoomViewer = import.meta.env.DEV ? lazy(() => import("./viewer/RoomViewer.tsx").then((m) => ({ default: m.RoomViewer }))) : null;

const isViewer = () =>
  devPagesEnabled && (new URLSearchParams(location.search).has("viewer") || new URLSearchParams(location.search).has("rid"));

type Login = { username: string; password: string };

/** Ours: what to tell the player when the game files couldn't be loaded */
function loadFailure(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  // fetch rejects with a TypeError when there's no answer at all; a proxy with the server down answers 502-504
  if (navigator.onLine === false || e instanceof TypeError || /HTTP 5\d\d/.test(message)) return unreachableMessage();
  return `Can't load the game from ${serverName()}: ${message}`;
}

export function App() {
  const [loaded, setLoaded] = useState<{ assets: AssetStore; rsb: RsbBundle } | null>(null);
  /** Ours: the game files couldn't be loaded; `attempt` counts the tries, so each failure is said */
  const [failure, setFailure] = useState<{ store: AssetStore; message: string; attempt: number } | null>(null);
  /** A login tried while they couldn't, to go on with once they can */
  const [retryLogin, setRetryLogin] = useState<Login | null>(null);
  /** Ours: the game crashed (GameCrashed); remounting it starts over at the login */
  const [crash, setCrash] = useState<{ message: string; attempt: number } | null>(null);

  const load = useCallback(() => {
    const store = new AssetStore();
    store
      .init()
      .then(() => {
        installUiTheme(store);
        return store.rsb();
      })
      .then((rsb) => {
        setFailure(null);
        setLoaded({ assets: store, rsb });
      })
      .catch((e: unknown) => {
        console.error("Can't load the game files:", e);
        setFailure((f) => ({ store, message: loadFailure(e), attempt: (f?.attempt ?? 0) + 1 }));
      });
  }, []);

  useEffect(load, [load]);

  // Coming back online tries again by itself
  useEffect(() => {
    if (!failure) return;
    window.addEventListener("online", load);
    return () => window.removeEventListener("online", load);
  }, [failure, load]);

  if (failure)
    return (
      <StartupFailure
        key={failure.attempt}
        assets={failure.store}
        message={failure.message}
        login={retryLogin}
        onLogin={(login) => {
          setRetryLogin(login);
          load();
        }}
      />
    );
  if (!loaded)
    return (
      <Framed>
        <div className="splash">Loading…</div>
      </Framed>
    );
  if (RoomViewer && isViewer())
    return (
      <Suspense fallback={<div className="splash">Loading…</div>}>
        <RoomViewer assets={loaded.assets} />
      </Suspense>
    );
  if (crash)
    return (
      <StartupFailure
        key={`crash${crash.attempt}`}
        assets={loaded.assets}
        message={crash.message}
        login={retryLogin}
        onLogin={(login) => {
          setRetryLogin(login);
          setCrash(null);
        }}
      />
    );
  return (
    <GameCrashed onCrash={(e) => setCrash((c) => ({ message: `Something went wrong: ${e.message}`, attempt: (c?.attempt ?? 0) + 1 }))}>
      <Game assets={loaded.assets} rsb={loaded.rsb} retryLogin={retryLogin} />
    </GameCrashed>
  );
}

/**
 * Ours: the login screen, saying what went wrong, when the game couldn't start (the server out
 * of reach, its files failing, the game crashing), instead of a bare message on black. Logging
 * in tries again, and goes on to log in when it works.
 */
function StartupFailure({
  assets, message, login, onLogin,
}: {
  /** Without a manifest when the files failed: the dialogs are drawn without the game's bitmaps */
  assets: AssetStore;
  message: string;
  login: Login | null;
  onLogin: (login: Login) => void;
}) {
  const [notice, setNotice] = useState<string | null>(message);
  return (
    <Framed assets={assets.has("ui/icon1.ico") ? assets : null}>
      <LoginScreen
        assets={assets}
        required={null}
        error={notice}
        onClearError={() => setNotice(null)}
        onLogin={(username, password) => onLogin({ username, password })}
        initialUsername={login?.username}
        initialPassword={login?.password}
      />
    </Framed>
  );
}

/** Ours: an error while drawing the game shows the login screen with it (StartupFailure), not an empty page */
class GameCrashed extends Component<{ children: ReactNode; onCrash: (e: Error) => void }> {
  state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  componentDidCatch(e: Error): void {
    console.error("The game crashed:", e);
    this.props.onCrash(e);
  }

  render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}
