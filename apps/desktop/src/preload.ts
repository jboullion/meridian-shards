// The page's window.shardsDesktop (apps/client/src/host.ts DesktopBridge). Sandboxed
// preloads run as CommonJS with only `electron` available, so this file imports nothing
// else at run time (vite.config.ts builds it on its own).

import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAssetProgress, DesktopBridge, DesktopConfig, DesktopUpdate, DesktopWindowState } from "../../client/src/host.ts";

const config = ipcRenderer.sendSync("shards:config") as DesktopConfig;

let update: DesktopUpdate | null = null;
const listeners = new Set<(u: DesktopUpdate) => void>();
ipcRenderer.on("shards:update", (_e, u: DesktopUpdate) => {
  update = u;
  for (const fn of listeners) fn(u);
});

let assets: DesktopAssetProgress | null = null;
const assetListeners = new Set<(p: DesktopAssetProgress) => void>();
ipcRenderer.on("shards:assets", (_e, p: DesktopAssetProgress) => {
  assets = p;
  for (const fn of assetListeners) fn(p);
});

let windowState: DesktopWindowState = { maximized: false, fullscreen: false };
const windowListeners = new Set<(s: DesktopWindowState) => void>();
ipcRenderer.on("shards:window-state", (_e, s: DesktopWindowState) => {
  windowState = s;
  for (const fn of windowListeners) fn(s);
});

const bridge: DesktopBridge = {
  ...config,
  selectServer: (origin) => ipcRenderer.send("shards:select-server", origin),
  setPhase: (phase) => ipcRenderer.send("shards:phase", phase),
  toggleFullscreen: () => ipcRenderer.send("shards:fullscreen"),
  onUpdate: (fn) => {
    listeners.add(fn);
    if (update) fn(update);
    return () => {
      listeners.delete(fn);
    };
  },
  onAssets: (fn) => {
    assetListeners.add(fn);
    if (assets) fn(assets);
    return () => {
      assetListeners.delete(fn);
    };
  },
  installUpdate: () => ipcRenderer.send("shards:install-update"),
  windowControl: (action) => ipcRenderer.send("shards:window", action),
  onWindowState: (fn) => {
    windowListeners.add(fn);
    fn(windowState);
    return () => {
      windowListeners.delete(fn);
    };
  },
};

contextBridge.exposeInMainWorld("shardsDesktop", bridge);
