// First: a storage that works before any module reads it (itch.io's iframe)
import "./storageGuard.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import { runsInstalled, startWebApp } from "./webApp.ts";
import { startCacheStats } from "./cacheStats.ts";

// No browser menu on a right click, as in a game: our own right clicks (inventory, quick slots, the
// map) still happen. Text fields keep it, for pasting and spelling.
window.addEventListener("contextmenu", (e) => {
  const t = e.target;
  if (t instanceof HTMLElement && t.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")) return;
  e.preventDefault();
});

// The browser's installable app (docs/adr/0032-installable-web-client.md): the service worker, the install offer
startWebApp();
// How well the browser keeps the game files cached (cacheStats.ts; ADR 0032 decision 7)
startCacheStats(runsInstalled);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
