// Ours: the character creator's "Skip the tutorial" (CharacterCreator.tsx). The choice of a starting
// city is kept per server and character name until the new character first enters the game; then
// GameView sends it once (UC_SHARDS "start <city>", shards-server util/shardsabilities.kod
// StartCity), which our server takes only from a character made within the hour.

/** The cities a new character may start in, as the server's start command names them */
export const START_CITIES = [
  { key: "marion", label: "Marion" },
  { key: "jasper", label: "Jasper" },
  { key: "cornoth", label: "Cor Noth" },
  { key: "barloque", label: "Barloque" },
  { key: "tos", label: "Tos" },
] as const;
export type StartCity = (typeof START_CITIES)[number]["key"];

const key = (server: string, name: string) => `shards.startCity.${server}.${name.toLowerCase()}`;

/** Remembers a new character's starting city (null: the tutorial, in Raza) */
export function rememberStartCity(store: Pick<Storage, "setItem" | "removeItem">, server: string, name: string, city: StartCity | null): void {
  try {
    if (city) store.setItem(key(server, name), city);
    else store.removeItem(key(server, name));
  } catch {
    // Storage unavailable: the character starts in Raza
  }
}

/** The starting city chosen for this character, once: it's forgotten as it's read */
export function takeStartCity(store: Pick<Storage, "getItem" | "removeItem">, server: string, name: string): StartCity | null {
  try {
    const city = store.getItem(key(server, name));
    store.removeItem(key(server, name));
    return START_CITIES.some((c) => c.key === city) ? (city as StartCity) : null;
  } catch {
    return null;
  }
}
