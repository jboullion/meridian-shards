import { useEffect, useRef, useState } from "react";
import type { CharInfo, CharacterSlot } from "@shards/protocol";
import { SAY } from "@shards/protocol";
import {
  GameSession, type ChatLine, type ContainerContents, type DamageDealt, type LookResult, type OfferEvent, type QuestEvent, type CosmeticsEvent, type TrainingCost, type Appraisal, type Sellable, type SessionPhase, type SocialEvent, type TradeList, type TravelEvent,
  type MailNewsEvent, type GuildEvent, type MinigameEvent, localResName } from "@shards/world";
import type { RsbBundle } from "@shards/formats";
import type { AssetStore } from "../assets.ts";
import { allowPortrait, desktop, gameSocketUrl, onAndroidAway, requiredUpdate, unreachableMessage, type RequiredUpdate } from "../host.ts";
import { GameAudio } from "./audio.ts";
import { IntroBackdrop } from "./Intro.tsx";
import { CharacterCreator } from "./CharacterCreator.tsx";
import { AssetDownload } from "./AssetDownload.tsx";
import { CharacterSelect } from "./CharacterSelect.tsx";
import { GameView, appendChatLine } from "./GameView.tsx";
import { Framed } from "./TitleBar.tsx";
import { getSettings } from "./settings.ts";
import { filterIncoming, loadProfanity } from "./profanity.ts";
import { IconRenderer } from "./icons.ts";
import { QuestStore } from "./quests.ts";
import { CompanionStore } from "./companion.ts";
import { ArenaStore } from "./arenaBouts.ts";
import { FactionWarStore } from "./factionWar.ts";
import { FallenHallsStore } from "./fallenHalls.ts";
import { ConnectingScreen, LoginScreen, rememberName } from "./LoginScreen.tsx";

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
  travel: Relay<TravelEvent>;
  /** Ours: friends, pets and the shared crowd from our server (docs/adr/0015) */
  social: Relay<SocialEvent>;
  /**
   * Ours (docs/adr/0009-quests.md): our quests, kept from the first log at logon (before the game
   * view is there to listen), and what an NPC we talked to has for us
   */
  quests: QuestStore;
  questOffers: Relay<Extract<QuestEvent, { type: "offers" }>>;
  /** Ours (docs/adr/0012-cosmetics.md): a tailor's or barber's menu */
  cosmetics: Relay<CosmeticsEvent>;
  /** Ours (docs/adr/0016-abilities.md): the abilities we can train, and their prices */
  training: Relay<TrainingCost[]>;
  /** Ours: whether an item of ours can be appraised, and its price (docs/adr/0016-abilities.md) */
  appraisal: Relay<Appraisal>;
  sellable: Relay<Sellable>;
  /** Ours (docs/adr/0010-followers.md): our companion, kept from its first status at logon */
  companion: CompanionStore;
  /** Ours (docs/adr/0019-arena-bouts.md): the arena's mock bouts and our records */
  arena: ArenaStore;
  /** Ours (docs/adr/0021): the Faction War, kept from logon */
  factionWar: FactionWarStore;
  /** Ours (docs/adr/0022): the Fallen Halls and the guild window's quests, kept from logon */
  fallenHalls: FallenHallsStore;
  offers: Relay<OfferEvent>;
  looks: Relay<LookResult>;
  contents: Relay<ContainerContents>;
  damage: Relay<DamageDealt>;
  mailNews: Relay<MailNewsEvent>;
  statChange: Relay<{ stats: number[]; levels: number[] }>;
  guild: Relay<GuildEvent>;
  minigame: Relay<MinigameEvent>;
  /** BP_LOAD_MODULE / BP_UNLOAD_MODULE: the mini-games and the admin console */
  modules: Relay<{ name: string; loaded: boolean }>;
  admin: Relay<string>;
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

/**
 * Set before reloading for a server update, so the login screen can say why: "1", or "online"
 * when the page had the installed files because the server couldn't be reached (AssetStore.offline).
 */
const UPDATED_KEY = "shards.serverUpdated";

function takeUpdatedNotice(): string | null {
  try {
    const was = sessionStorage.getItem(UPDATED_KEY);
    sessionStorage.removeItem(UPDATED_KEY);
    if (was === "online") return "The server can be reached again. Please log in again.";
    return was ? "The server was updated while you were away. Please log in again." : null;
  } catch {
    return null;
  }
}

export function Game({
  assets, rsb, retryLogin,
}: {
  assets: AssetStore;
  rsb: RsbBundle;
  /** Ours: a login tried while the game files couldn't be loaded (App.tsx), to go on with now they have */
  retryLogin?: { username: string; password: string } | null;
}) {
  const [live, setLive] = useState<Live | null>(null);
  const session = live?.session ?? null;
  const [phase, setPhase] = useState<SessionPhase | "offline">("offline");
  const [characters, setCharacters] = useState<CharacterSlot[]>([]);
  const [motd, setMotd] = useState("");
  // Ours: the apps' installed files, the server out of reach, say so at once (and the login says it again)
  const [error, setError] = useState<string | null>(() => takeUpdatedNotice() ?? (assets.offline && !retryLogin ? unreachableMessage() : null));
  const [chat, setChat] = useState<ChatLine[]>([]);
  /** The creator is open for this empty slot once BP_CHARINFO arrives */
  const [creating, setCreating] = useState<{ slotId: number; info: CharInfo | null } | null>(null);
  /** The game options the server keeps for us (UC_RECEIVE_PREFERENCES) */
  const [serverPrefs, setServerPrefs] = useState<number | null>(null);
  /** The last ping's round trip (lagbox.c) */
  const [latency, setLatency] = useState<number | null>(null);
  /** The desktop app's /U, /W and /Q (config.c ConfigOverride), this start only */
  const [launch] = useState(() => desktop?.launch ?? null);
  /** /Q (config.quickstart): until the game starts, an error, or logging off */
  const quickstart = useRef(launch?.quickstart === true);
  /** The intro (module/intro): its picture behind the login dialog, at startup (unless /Q) and after logging off */
  const [intro, setIntro] = useState(() => launch?.quickstart !== true);
  /** Plays the splash's music (main.ogg) until logging on, as the intro module does until it unloads */
  const [introAudio, setIntroAudio] = useState<GameAudio | null>(() => new GameAudio(assets));

  /** Ours: a newer version that must be installed before logging in (host.ts requiredUpdate) */
  const [required, setRequired] = useState<RequiredUpdate | null>(null);
  const onLoginScreen = !live || !session || phase === "offline" || phase === "closed";
  useEffect(() => {
    if (!onLoginScreen) return;
    let on = true;
    void requiredUpdate().then((r) => on && setRequired(r));
    return () => {
      on = false;
    };
  }, [onLoginScreen]);

  // The desktop app asks before closing the window mid-game
  useEffect(() => desktop?.setPhase(phase), [phase]);
  // On a phone, the screens before the game may turn upright (easier for typing); the game is landscape
  const upright = phase !== "entering" && phase !== "game";
  useEffect(() => allowPortrait(upright), [upright]);

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
      // Closed already after logging off; not when the game is unmounted by an error (App.tsx GameCrashed)
      live.session.close();
    };
  }, [live]);

  const login = (username: string, password: string) => {
    setError(null);
    // Created on the login click, so the browser lets the page play sound.
    const audio = new GameAudio(assets);
    // Ours: nobody plays on an old version (host.ts requiredUpdate); the login screen says how to update
    void requiredUpdate().then((needed) => {
      if (needed) {
        audio.dispose();
        quickstart.current = false;
        setRequired(needed);
        return;
      }
      introAudio?.dispose();
      setIntroAudio(null);
      rememberName(username);
      // A server updated since this page loaded has new files (rsc0000.rsb, rooms) that the
      // login depends on: reload to get them, and the client that goes with them
      void assets
        .changedOnServer()
        .catch(() => false)
        .then((changed) => {
          if (!changed) return connect(username, password, audio);
          audio.dispose();
          try {
            sessionStorage.setItem(UPDATED_KEY, assets.offline ? "online" : "1");
          } catch {
            // no notice then
          }
          location.reload();
        });
    });
  };

  const connect = (username: string, password: string, audio: GameAudio) => {
    const trades = new Relay<TradeList>();
    const travel = new Relay<TravelEvent>();
    const social = new Relay<SocialEvent>();
    // The session is made below; the store only speaks once the game has begun
    let speak: (text: string) => void = () => {};
    const quests = new QuestStore(assets, (text) => speak(text));
    const questOffers = new Relay<Extract<QuestEvent, { type: "offers" }>>();
    const cosmetics = new Relay<CosmeticsEvent>();
    const training = new Relay<TrainingCost[]>();
    const appraisal = new Relay<Appraisal>();
    const sellable = new Relay<Sellable>();
    const companion = new CompanionStore();
    const arena = new ArenaStore();
    const factionWar = new FactionWarStore();
    const fallenHalls = new FallenHallsStore();
    const offers = new Relay<OfferEvent>();
    const looks = new Relay<LookResult>();
    const contents = new Relay<ContainerContents>();
    const damage = new Relay<DamageDealt>();
    const mailNews = new Relay<MailNewsEvent>();
    const statChange = new Relay<{ stats: number[]; levels: number[] }>();
    const guild = new Relay<GuildEvent>();
    const minigame = new Relay<MinigameEvent>();
    const modules = new Relay<{ name: string; loaded: boolean }>();
    const admin = new Relay<string>();
    const s = new GameSession(
      { url: gameSocketUrl(), username, password, secretKey: __SECRET_KEY__, lookupResource: (id, lang) => rsb.get(id, lang), pingIntervalMs: 0 },
      {
        phase: (p) => {
          setPhase(p);
          if (p === "closed") {
            // Never leave the socket open behind the login screen: the server would keep the account in use
            s.close();
            setLive(null);
          }
          if (p === "game" || p === "closed") quickstart.current = false;
        },
        characters: (c, m) => {
          setCharacters([...c]);
          if (m) setMotd(m);
          // charpick.c ChooseCharacter: with /Q and just one character (made already), enter
          if (quickstart.current && c.length === 1 && c[0].flags !== 1) {
            quickstart.current = false;
            s.useCharacter(c[0].id);
          }
        },
        error: (e) => {
          quickstart.current = false;
          setError(e);
        },
        charInfo: (info) => {
          setCreating((c) => (c ? { ...c, info } : c));
          // Ours: in game, for the companion's looks
          companion.setCharInfo(info);
        },
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
        mailNews: mailNews.emit,
        statChange: (stats, levels) => statChange.emit({ stats, levels }),
        guild: guild.emit,
        minigame: minigame.emit,
        module: (name, loaded) => modules.emit({ name, loaded }),
        admin: admin.emit,
        contents: (container, items) => contents.emit({ container, items }),
        trade: trades.emit,
        travel: travel.emit,
        social: social.emit,
        quest: (e) => (e.type === "offers" ? questOffers.emit(e) : e.type === "board" ? fallenHalls.handleBoard(e.offers) : quests.handle(e)),
        cosmetics: (e) => cosmetics.emit(e),
        training: training.emit,
        appraisal: appraisal.emit,
        sellable: sellable.emit,
        companion: (e) => companion.handle(e),
        arena: (s) => arena.handle(s),
        factionWar: (e) => factionWar.handle(e),
        fallenHalls: (s) => fallenHalls.handle(s),
        offer: offers.emit,
        sound: (e) => audio.handle(e),
        damageDealt: damage.emit,
      },
    );
    speak = (text) => s.localMessage(text);
    // srvrstr.c: the profanity filter on every line shown
    s.textFilter = filterIncoming;
    s.setLanguage(getSettings().language);
    void loadProfanity(assets);
    setPhase("connecting");
    setLive({ session: s, audio, icons: new IconRenderer(assets, (id) => localResName(id) ?? s.resource(id)), trades, travel, social, quests, questOffers, cosmetics, training, appraisal, sellable, companion, arena, factionWar, fallenHalls, offers, looks, contents, damage, mailNews, statChange, guild, minigame, modules, admin });
  };

  const logout = () => {
    quickstart.current = false;
    session?.close();
    setLive(null);
    setCreating(null);
    setPhase("offline");
    // The intro module loads again (intro.c GetModuleInfo)
    setIntro(true);
    setIntroAudio((a) => a ?? new GameAudio(assets));
  };

  // The Android app was in the background longer than it keeps the connection: log off, and say why
  useEffect(() =>
    onAndroidAway(() => {
      if (!session) return;
      logout();
      setError("You were away from the game for 5 minutes, so you've been logged off.");
    }),
  );

  // login.c GetLogin: with /Q, no login dialog; log on with /U and /W at once
  // Ours: and a login tried before the game files could be loaded (App.tsx), now they are
  const autoLogin = useRef(
    retryLogin ?? (launch?.quickstart === true && launch.username && launch.password ? { username: launch.username, password: launch.password } : null),
  );
  useEffect(() => {
    const first = autoLogin.current;
    if (!first) return;
    autoLogin.current = null;
    login(first.username, first.password);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at startup
  }, []);

  if (!live || !session || phase === "offline" || phase === "closed")
    return (
      <Framed assets={assets}>
        <LoginScreen
          assets={assets}
          required={required}
          onLogin={login}
          error={error}
          onClearError={() => setError(null)}
          initialUsername={launch?.username}
          initialPassword={launch?.password}
          behind={intro ? <IntroBackdrop assets={assets} audio={introAudio} /> : undefined}
        />
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
      travel={live.travel.on}
      socialEvents={live.social.on}
      quests={live.quests}
      questOffers={live.questOffers.on}
      cosmetics={live.cosmetics.on}
      training={live.training.on}
      appraisal={live.appraisal.on}
      sellable={live.sellable.on}
      companion={live.companion}
      arena={live.arena}
      factionWar={live.factionWar}
      fallenHalls={live.fallenHalls}
      offers={live.offers.on}
      phase={phase}
      chat={chat}
      looks={live.looks.on}
      contents={live.contents.on}
      damage={live.damage.on}
      mailNews={live.mailNews.on}
      statChange={live.statChange.on}
      languages={rsb.languages()}
      guild={live.guild.on}
      minigame={live.minigame.on}
      modules={live.modules.on}
      admin={live.admin.on}
      onLogout={(why?: string) => {
        logout();
        // Study mode logging off by itself: say why on the login screen
        if (why) setError(why);
      }}
      serverPrefs={serverPrefs}
      latency={latency}
    />
  );
}
