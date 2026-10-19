// Ours (docs/adr/0018-seasons-water-windows.md): which rooms have seasons. The mainland does; the
// island of Ko'catan (jungle: its weather never snows, shards-server WEATHER_MASK_JUNGLE), the
// Black Desert (badlands), the lava of the Underworld and the necromancers' arena, and the ice
// cave (always winter) don't. A room's terrain (roomterrain.json) says, or its name when it has none.

const UNSEASONAL_TERRAIN = new Set(["JUNGLE", "BADLANDS", "LAVA", "TUNDRA"]);
/** Rooms without a terrain of their own that aren't on the mainland: Ko'catan and the desert */
const UNSEASONAL_FILES = /^(koc|kocatan|desert|waylay)/;

/** Whether a room (its file, lower case, and its terrain) has seasons */
export function hasSeasons(file: string, terrain: readonly string[] | undefined): boolean {
  if ((terrain ?? []).some((t) => UNSEASONAL_TERRAIN.has(t))) return false;
  return !UNSEASONAL_FILES.test(file);
}

/** How many of each of Nature's creatures by season (0 spring .. 3 winter), of the usual (moods.json seasons) */
export const SEASON_NATURE = {
  butterflies: [1, 0.7, 0.2, 0],
  fireflies: [0.4, 1, 0.3, 0],
  leaves: [0.15, 0.25, 1, 0.05],
} as const;
