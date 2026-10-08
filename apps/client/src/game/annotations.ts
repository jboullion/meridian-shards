// Map annotations (clientd3d/annotate.c): up to 20 notes per room, each a point in the
// room's fine coordinates with up to 99 characters. The original keeps them in its map
// file, found by the room's security checksum (mapfile.c MapFileFindRoom), so every
// character on that install shares them; we keep them in the page's storage per server
// and checksum.

import { FINENESS } from "@shards/formats";

export interface MapAnnotation {
  /** Room fine coordinates (x east, y south) */
  x: number;
  y: number;
  text: string;
}

/** annotate.h */
export const MAX_ANNOTATIONS = 20;
export const MAX_ANNOTATION_LEN = 100;
/** The indicator's size in fine units, and its least size in pixels */
export const MAP_ANNOTATION_SIZE = 2 * FINENESS;
export const MAP_ANNOTATION_MIN_SIZE = 14;

/** Where the annotations are kept: localStorage-like (tests pass a Map). */
export interface AnnotationStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const storageKey = (server: string, security: number) => `shards.annotations.${server}.${security >>> 0}`;

export function loadAnnotations(store: AnnotationStore, server: string, security: number): MapAnnotation[] {
  try {
    const list = JSON.parse(store.getItem(storageKey(server, security)) ?? "[]") as unknown;
    return Array.isArray(list) ? (list as MapAnnotation[]).filter((a) => a && typeof a.text === "string" && a.text).slice(0, MAX_ANNOTATIONS) : [];
  } catch {
    return [];
  }
}

export function saveAnnotations(store: AnnotationStore, server: string, security: number, list: readonly MapAnnotation[]): void {
  try {
    if (list.length) store.setItem(storageKey(server, security), JSON.stringify(list));
    else store.removeItem(storageKey(server, security));
  } catch {
    // Storage full or blocked: the notes last until the page closes
  }
}

/** MapAnnotationClick: the annotation whose square (MAP_ANNOTATION_SIZE across) holds the point, or -1 */
export function annotationAt(list: readonly MapAnnotation[], x: number, y: number): number {
  const half = MAP_ANNOTATION_SIZE / 2;
  return list.findIndex((a) => a.x <= x + half && a.x >= x - half && a.y <= y + half && a.y >= y - half);
}

/** MapDrawAnnotations: the drawn indicator's radius in pixels at a map scale (pixels per fine unit) */
export const annotationRadius = (scale: number): number => Math.max(MAP_ANNOTATION_MIN_SIZE / 2, Math.trunc((MAP_ANNOTATION_SIZE * scale) / 2));
