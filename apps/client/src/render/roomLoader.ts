// Loads a room and its textures into a RoomView (shared by the viewer and the game).

import * as THREE from "three";
import { gridTextureName, splitBsf, type Bgf, type Room } from "@shards/formats";
import { RoomView, createSkybox } from "@shards/render";
import type { AssetStore } from "../assets.ts";

export interface LoadedRoom {
  room: Room;
  view: RoomView;
  textures: number;
  missingTextures: number[];
  triangles: number;
}

export async function loadRoomView(assets: AssetStore, roo: string, palette: THREE.Texture): Promise<LoadedRoom> {
  const room = await assets.room(roo);
  const ids = new Set<number>();
  for (const s of room.sectors) ids.add(s.floorType).add(s.ceilingType);
  for (const s of room.sidedefs) ids.add(s.normalType).add(s.aboveType).add(s.belowType);
  ids.delete(0);
  const textures = new Map<number, Bgf>();
  const missing: number[] = [];
  await Promise.all(
    [...ids].map(async (id) => {
      const b = await assets.bgf(gridTextureName(id));
      if (b && b.bitmaps.length) textures.set(id, b);
      else missing.push(id);
    }),
  );
  const view = new RoomView(room, textures, palette);
  let triangles = 0;
  for (const b of view.geometry.batches.values()) triangles += b.positions.length / 9;
  return { room, view, textures: textures.size, missingTextures: missing.sort((a, b) => a - b), triangles };
}

/** A sky box from a .bsf file name. */
export async function loadSkybox(assets: AssetStore, bsf: string): Promise<THREE.Group> {
  const pngs = splitBsf(await assets.fetchBytes(bsf));
  const faces = await Promise.all(pngs.map((p) => createImageBitmap(new Blob([p as BlobPart], { type: "image/png" }))));
  return createSkybox(faces);
}
