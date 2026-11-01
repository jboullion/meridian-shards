// Ours: the browser client as an installed app (docs/adr/0032-installable-web-client.md). In a plain
// browser (not the desktop or Android app, which have their own windows, nor the itch.io build in
// itch.io's iframe) this registers the service worker (apps/client/pwa/sw.js), keeps the browser's
// install offer for the login screen's Install link, and, once installed and running in its own
// window, asks to keep its storage, asks before closing mid-game (as the desktop app does) and
// tells the title bar when it has the window's top to itself (the window controls overlay).

import { useSyncExternalStore } from "react";
import { desktop, hostedServer } from "./host.ts";

/** A plain browser on the page's own server: the only host that installs */
const browserHost = !desktop && !hostedServer;

/**
 * Set false to unregister the service worker in every browser that loads this page (a kill
 * switch beside the worker's own, apps/client/pwa/sw.js KILL_SWITCH, which is the one to use if a
 * bad worker keeps pages from loading). Without a worker the game still plays in a tab.
 */
const SERVICE_WORKER = true;

/** Running as the installed app, in a window of its own (the manifest's display modes; iOS's home screen) */
export function runsInstalled(): boolean {
  if (!browserHost) return false;
  if ((navigator as { standalone?: boolean }).standalone) return true;
  return matchMedia("(display-mode: standalone), (display-mode: window-controls-overlay)").matches;
}

/** Chrome and Edge's install offer (not in TypeScript's DOM types) */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let offer: BeforeInstallPromptEvent | null = null;
const offerListeners = new Set<() => void>();
const offerChanged = () => offerListeners.forEach((fn) => fn());

/** Shows the browser's install dialog. */
async function install(): Promise<void> {
  const e = offer;
  if (!e) return;
  // An offer is good for one prompt; the browser makes another if the player says no
  offer = null;
  offerChanged();
  await e.prompt().catch(() => {});
}

/** The Install link's action while the browser offers to install the game; null otherwise (and when installed). */
export function useInstallOffer(): (() => void) | null {
  const available = useSyncExternalStore(
    (fn) => {
      offerListeners.add(fn);
      return () => offerListeners.delete(fn);
    },
    () => offer !== null,
  );
  return available && !runsInstalled() ? () => void install() : null;
}

/** The window controls overlay (Chrome and Edge's installed apps on the desktop; not in TypeScript's DOM types) */
interface WindowControlsOverlay extends EventTarget {
  visible: boolean;
}

const overlay = browserHost ? (navigator as { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay : undefined;

/**
 * Whether the installed app has the window's top to itself, the system's buttons over its corner
 * (the player can switch it on and off from the window): then our title bar is the window's, as
 * on the desktop (TitleBar.tsx, styles.css .title-bar.overlay). Not in full screen, which has no
 * system buttons: the bar kept the overlay's padding there and stopped short of the screen's edge.
 */
export function useTitleBarOverlay(): boolean {
  return useSyncExternalStore(
    (fn) => {
      overlay?.addEventListener("geometrychange", fn);
      document.addEventListener("fullscreenchange", fn);
      return () => {
        overlay?.removeEventListener("geometrychange", fn);
        document.removeEventListener("fullscreenchange", fn);
      };
    },
    () => overlay?.visible === true && !document.fullscreenElement,
  );
}

const askFirst = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  // Older Chrome and Edge show the dialog only with this set
  e.returnValue = "";
};
let asking = false;

/**
 * The installed app asks before its window closes (or reloads) mid-game, as the desktop app's
 * close does (Game.tsx, the session phase); a browser tab doesn't, and the apps ask themselves.
 */
export function askBeforeClosing(inGame: boolean): void {
  const ask = inGame && runsInstalled();
  if (ask === asking) return;
  asking = ask;
  if (ask) window.addEventListener("beforeunload", askFirst);
  else window.removeEventListener("beforeunload", askFirst);
}

/** At startup (main.tsx), before the browser's install offer can come. */
export function startWebApp(): void {
  if (!browserHost) return;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Ours, not the browser's own banner: the login screen's Install link
    e.preventDefault();
    offer = e as BeforeInstallPromptEvent;
    offerChanged();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    offerChanged();
  });
  // Installed, the game's files may be cached for good (a later step of the ADR): ask the browser to keep them
  if (runsInstalled()) void navigator.storage?.persist?.().catch(() => {});
  // A service worker needs https (or localhost); its scope is the client's base, /play/ on our server
  if ("serviceWorker" in navigator && isSecureContext) {
    const base = import.meta.env.BASE_URL;
    const register = async () => {
      try {
        if (SERVICE_WORKER) await navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: "none" });
        else for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      } catch (e) {
        console.warn("service worker:", e);
      }
    };
    // After the page has loaded, so it doesn't compete with the game's first files
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });
  }
}
