// Ours: a page in another site's iframe (itch.io) may be refused localStorage when the browser
// blocks third-party storage, and reading `window.localStorage` then throws. The game's settings,
// quick slots and the rest use it freely, so put a store in memory in its place: they work, and
// are forgotten when the page closes. Imported first in main.tsx, before anything reads storage.

function usable(): boolean {
  try {
    const s = window.localStorage;
    s.setItem("shards.probe", "1");
    s.removeItem("shards.probe");
    return true;
  } catch {
    return false;
  }
}

if (!usable()) {
  const items = new Map<string, string>();
  const memory: Storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(String(key)) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(String(key)),
    setItem: (key, value) => void items.set(String(key), String(value)),
  };
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => memory });
  } catch {
    // Nothing more to do: the game goes on, and whatever reads storage may fail
  }
}
