// Development only: the game tab's side of the admin dashboard (admin.html), over Vite's HMR
// socket (tools/dev/adminApi.ts keeps the state and relays it):
//   shards:state   from the dev server: the live tuning (tuning.ts) and scene overrides, applied
//                  here; the server keeps them, so a reloaded game tab gets them back
//   shards:game    to the dev server, for the dashboard: who we are and where, every 2 s and on
//                  each room change
//   shards:sprite  from the dev server: { name } a sprite the dashboard saved, loaded again here
// Started by GameScene in development builds, stopped when it's disposed.

import type { AmbientRoomSpec, GameSession } from "@shards/world";
import { applyTuning, TUNING_DEFAULTS, type TuningValues } from "./tuning.ts";

/** What the dashboard can set about the scene, for this client only */
export interface SceneOverrides {
  /** The hour ambient life goes by (null: the sun's) */
  ambientHour?: number | null;
  /** The season to show, 0 spring .. 3 winter (null: the server's) */
  season?: number | null;
  /** Weather as if the server had sent it (until it sends its own) */
  raining?: boolean;
  snowing?: boolean;
  /** How wet the ground is, 0-1 (puddles) */
  wetness?: number;
  /** The current room as other terrain, or with a crowd (GameScene.setTestRoom); null: as it is */
  terrain?: string[] | null;
  crowd?: AmbientRoomSpec | null;
}

export interface DevState {
  tuning: TuningValues;
  scene: SceneOverrides;
}

/** Where we are, for the dashboard */
export interface GameReport {
  character: string;
  playerId: number;
  roomFile: string;
  roomName: string;
  row: number;
  col: number;
}

/** The parts of GameScene the bridge drives */
export interface BridgeScene {
  ambientHour: number | null;
  seasonPin: number | null;
  wetness: number;
  setTestRoom(o: { terrain?: string[] | null; crowd?: AmbientRoomSpec | null }): void;
  /** Tuning changed: what was worked out from the old values starts over */
  retune(): void;
  readonly roomFile: string;
  /** A sprite's file changed: load it again and draw it anew */
  spriteChanged(file: string): Promise<void>;
}

export function startDevBridge(scene: BridgeScene, session: GameSession): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => {};
  let testRoom = "";

  const apply = (state: DevState): void => {
    // Back to the source's values first, so a reset reaches us too
    const changed = applyTuning(TUNING_DEFAULTS) || false;
    if (applyTuning(state.tuning) || changed) scene.retune();
    const s = state.scene;
    scene.ambientHour = s.ambientHour ?? null;
    scene.seasonPin = s.season ?? null;
    const fx = session.world.effects;
    if (s.raining !== undefined) fx.raining = s.raining;
    if (s.snowing !== undefined) fx.snowing = s.snowing;
    if (s.wetness !== undefined) scene.wetness = s.wetness;
    const room = JSON.stringify([s.terrain ?? null, s.crowd ?? null]);
    if (room !== testRoom) {
      testRoom = room;
      scene.setTestRoom({ terrain: s.terrain ?? null, crowd: s.crowd === null ? undefined : s.crowd });
    }
  };
  const onState = (state: DevState) => apply(state);
  hot.on("shards:state", onState);
  const onSprite = ({ name }: { name: string }) => void scene.spriteChanged(name);
  hot.on("shards:sprite", onSprite);
  hot.send("shards:game-hello", {});

  const report = (): void => {
    const self = session.world.self;
    const p = session.world.player;
    if (!self || !p) return;
    const r: GameReport = {
      character: session.resource(self.info.nameRes) ?? "",
      playerId: self.id,
      roomFile: scene.roomFile,
      roomName: document.title.replace(/^Meridian Shards — /, ""),
      row: Math.floor(self.y / 1024) + 1,
      col: Math.floor(self.x / 1024) + 1,
    };
    hot.send("shards:game", r);
  };
  const timer = setInterval(report, 2000);
  const offEvent = session.world.on((e) => {
    if (e.type === "player") setTimeout(report, 500);
  });
  report();

  return () => {
    clearInterval(timer);
    offEvent();
    hot.off("shards:state", onState);
    hot.off("shards:sprite", onSprite);
  };
}
