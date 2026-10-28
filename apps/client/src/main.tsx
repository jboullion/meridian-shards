import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// No browser menu on a right click, as in a game: our own right clicks (inventory, quick slots, the
// map) still happen. Text fields keep it, for pasting and spelling.
window.addEventListener("contextmenu", (e) => {
  const t = e.target;
  if (t instanceof HTMLElement && t.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")) return;
  e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
