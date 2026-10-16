// The fast travel table in the server's Kod (shards-server util/travelnet.kod GetPoints), read
// and rewritten for the admin dashboard's "Move portal here" (adminApi.ts /__admin/travel/*).
// Each row is [id, name, network, room, portal row, portal col, arrival row, arrival col,
// arrival angle], and optionally the portal's fine row and column; only the squares, the
// angle and the fine position are ever changed, never the id.

export interface TravelPoint {
  /** The id as written: a number, or a constant */
  id: string;
  name: string;
  net: string;
  /** The room's constant (RID_TOS) and its number */
  ridName: string;
  rid: number | null;
  row: number;
  col: number;
  arrivalRow: number;
  arrivalCol: number;
  angle: string;
  /** The portal's place within its square (0-63), when the row gives one; else its middle */
  fineRow: number | null;
  fineCol: number | null;
}

const ROW = /^(\s*\[\s*)(\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\w+)(?:,\s*(\d+),\s*(\d+))?(\s*\].*)$/;

/** Kod angles go clockwise from east, MAX_ANGLE (4096) to the turn (blakston.khd ANGLE_*) */
const ANGLES = ["ANGLE_EAST", "ANGLE_SOUTH_EAST", "ANGLE_SOUTH", "ANGLE_SOUTH_WEST", "ANGLE_WEST", "ANGLE_NORTH_WEST", "ANGLE_NORTH", "ANGLE_NORTH_EAST"];

/** The nearest of the eight compass constants to a Kod angle */
export function nearestAngle(angle: number): string {
  const eighth = Math.round((((angle % 4096) + 4096) % 4096) / 512) % 8;
  return ANGLES[eighth]!;
}

/** Every `RID_X = n` in blakston.khd */
export function readRids(khd: string): Map<string, number> {
  return new Map([...khd.matchAll(/^\s*(RID_\w+)\s*=\s*(\d+)/gm)].map((m) => [m[1]!.toUpperCase(), Number(m[2])]));
}

/** GetPoints' body: from its `return [` to the `];` that closes it */
function tableSpan(kod: string): { start: number; end: number } {
  const at = kod.search(/^\s*GetPoints\(\)/m);
  if (at < 0) throw new Error("travelnet.kod has no GetPoints");
  const start = kod.indexOf("return [", at);
  const end = kod.indexOf("];", start);
  if (start < 0 || end < 0) throw new Error("GetPoints' table isn't `return [ ... ];`");
  return { start, end };
}

export function readPoints(kod: string, rids: Map<string, number>): TravelPoint[] {
  const { start, end } = tableSpan(kod);
  const out: TravelPoint[] = [];
  for (const line of kod.slice(start, end).split(/\r?\n/)) {
    const m = ROW.exec(line);
    if (!m) continue;
    out.push({
      id: m[2]!,
      name: m[3]!,
      net: m[4]!,
      ridName: m[5]!,
      rid: rids.get(m[5]!.toUpperCase()) ?? null,
      row: Number(m[6]),
      col: Number(m[7]),
      arrivalRow: Number(m[8]),
      arrivalCol: Number(m[9]),
      angle: m[10]!,
      fineRow: m[11] === undefined ? null : Number(m[11]),
      fineCol: m[12] === undefined ? null : Number(m[12]),
    });
  }
  return out;
}

/** GetHistoricLinks' pairs: a museum portal's point and the town it leads to (a town's portal leads back) */
export function readHistoricLinks(kod: string): [string, string][] {
  const at = kod.search(/^\s*GetHistoricLinks\(\)/m);
  if (at < 0) return [];
  const start = kod.indexOf("return [", at);
  const end = kod.indexOf("];", start);
  return [...kod.slice(start + "return [".length, end).matchAll(/\[\s*(\w+),\s*(\w+)\s*,/g)].map((m) => [m[1]!, m[2]!]);
}

/** The points with each historic one's other end, by its name resource (leadsTo) */
export function withLinks(points: TravelPoint[], links: [string, string][]): (TravelPoint & { leadsTo?: string })[] {
  const name = (id: string | undefined) => points.find((p) => p.id === id)?.name;
  return points.map((p) => {
    const other = links.find(([museum]) => museum === p.id)?.[1] ?? links.find(([, town]) => town === p.id)?.[0];
    const leadsTo = name(other);
    return leadsTo ? { ...p, leadsTo } : p;
  });
}

/** Lines in the table that aren't a point (a half-done edit), which would fail the Kod build */
export function strayLines(kod: string): string[] {
  const { start, end } = tableSpan(kod);
  return kod
    .slice(start, end)
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !ROW.test(l));
}

export interface PointChange {
  portal?: { row: number; col: number };
  arrival?: { row: number; col: number; angle: string };
}

/** The file with one point's row changed; everything else, line endings too, as it was. A moved
 *  portal stands in its square's middle (its fine position is dropped). */
export function movePoint(kod: string, id: string, change: PointChange): string {
  const { start, end } = tableSpan(kod);
  const lines = kod.slice(start, end).split("\n");
  let found = false;
  const changed = lines.map((raw) => {
    const cr = raw.endsWith("\r") ? "\r" : "";
    const line = cr ? raw.slice(0, -1) : raw;
    const m = ROW.exec(line);
    if (!m || m[2] !== id) return raw;
    found = true;
    const [row, col] = change.portal ? [change.portal.row, change.portal.col] : [m[6], m[7]];
    const [arow, acol, angle] = change.arrival ? [change.arrival.row, change.arrival.col, change.arrival.angle] : [m[8], m[9], m[10]];
    const fine = !change.portal && m[11] !== undefined ? `, ${m[11]}, ${m[12]}` : "";
    return `${m[1]}${m[2]}, ${m[3]}, ${m[4]}, ${m[5]}, ${row}, ${col}, ${arow}, ${acol}, ${angle}${fine}${m[13]}${cr}`;
  });
  if (!found) throw new Error(`No travel point ${id} in GetPoints`);
  return kod.slice(0, start) + changed.join("\n") + kod.slice(end);
}
