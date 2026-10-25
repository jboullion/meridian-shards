// The in-game 3D view: the player's room with its objects, seen from the player's eyes,
// with the original client's movement (move.c). Keys come from the settings (the modern
// or the original preset, rebindable; see settings.ts). Modern defaults:
//   right button held and dragged: turn the view (the mouse captured meanwhile); right click: examine
//   WASD / arrows: move and strafe (arrows left/right turn); Shift runs
//   Space or E: open a door / take the exit you stand on (BP_REQ_GO)
//   left click: select the object under the cursor as your target
//   E: attack the target (or the closest thing you can attack); [ ] \ Esc: next, previous,
//   yourself, no target;  R: look at the target;  F or double click: pick up / activate
//   PgUp/PgDn/Home: look up, down, straight; End: turn around;  Enter: chat

import * as THREE from "three";
import { SAY } from "@shards/protocol";
import { FINENESS, SF, ceilingHeightAt, floorHeightAt, gridTextureName, leafAt, skyboxForBackground, type Bgf, type Room } from "@shards/formats";
import {
  DRAWFX, Flyers, GroundCover, Lightning, Nature, OF, ObjectsView, Puddles, RangeRings, RoomEnchantLooks, SpellEffects, type RangeRing, fxColor, type RoomEnchantKind, type FinePoint, type PuddleRoom,type GroundKind, type GroundRoom, type NatureRoom, type RockArt, PARTICLE_STEPS_PER_SECOND, PostFx, RoomView, SkyOverlaysView, TrailBlur, Waver, WeatherParticles, XlatTable, type ParticleRoom, disposeSkybox, fogEnd, objectBrightness, paletteTexture, postFxActive, type LightSource,
  type PostFxOptions,
  type NameLabel, type ViewObject, type SpriteMood, moodUniforms, renderTune, sunAt, effectUniforms, roomSurfaceTextures,
} from "@shards/render";
import {
  AMBIENT_ROOMS, AMBIENT_SCALE, type AmbientRoomSpec, AmbientLife, LiveRoom, MOVEON, PlayerMover, REMOTE_VIEW, animStep, isAmbientId, localRes, localResName, townsfolkArt,
  Critters, batsOf, critterArt, decodeNavGrid, habitatOf, hourFromSun, isImpressiveBody, type AmbientExits, type DamageDealt, type NavGrid, type NavPoint, type RemoteView, type GameSession, type WorldObject,
  FollowPlanner, navGridBuilder, AmbientStepper, type AmbientFrame, type AmbientSeed, Pets, petArt, type PetChoice, type PetOwner,
  ARENA_SEND_EVERY, ARENA_TICK_MS, ARENA_ROOM_DEFS, ArenaSim, ArenaView, arenaArt, arenaFloorArea, arenaHourAt, arenaOpenAt, buildNavGrid, hashText, makeRoster, readArenaConfigs, seasonAt,
  type AmbientPersonInfo, type ArenaEvent, type ArenaMessage, SPELL_FX, type SpellFx,
} from "@shards/world";
import type { AssetStore } from "../assets.ts";
import { gameSocketUrl } from "../host.ts";
import { RoomCache } from "../render/roomCache.ts";
import { sceneTune } from "./sceneTuning.ts";
import { markerFor, MM_OURS, MM_QUEST_NPC } from "./markers.ts";
import { startDevBridge } from "./devBridge.ts";
import { MoodDirector, type MoodFrame } from "./mood.ts";
import { SEASON_NATURE, hasSeasons } from "./seasonZone.ts";
import { loadSkybox, type LoadedRoom } from "../render/roomLoader.ts";
import { ORIGINAL_FOV } from "../viewer/roomScene.ts";
import { AmbientSounds } from "./ambientSounds.ts";
import type { GameAudio } from "./audio.ts";
import { ScreenOverlays } from "./screenOverlays.ts";
import type { SocialLink } from "./social.ts";
import { HALO_COLOR, actionsFor, getSettings, isHeld, mouseCode, onSettings, touchUi, type Action, type Mods, type Settings } from "./settings.ts";

/** Ours: a click kills a critter this far off, and an attack one this close (and ahead), fine units */
const SQUISH_RANGE = 10 * FINENESS;
const CRITTER_REACH = 1.6 * FINENESS;
const CRITTER_DEATH_VOLUME = 0.35;
/** Ours: puddles spread over this long in the rain, and dry up over this long after */
/** Ours: Limit to 60 FPS, a frame's time, and how early one may come (the screen's timing jitters) */
const FRAME_MS = 1000 / 60;
const FRAME_SLACK_MS = 2;
/** Ours: terrain where people live, kept clear of rocks (Ground Detail) */
const SETTLED = new Set(["CITY", "CASTLE", "GUILDHALL", "RESIDENCE", "TEMPLE", "SHOP"]);
/** Ours: townsfolk this near make the chatter, and critters this near squeak */
const HEARING = 14 * FINENESS;
const CRITTER_VOICE_RANGE = 8 * FINENESS;
/** Ours: how much darker the sky is in the rain */
const OVERCAST = 0.4;
/** Ours: how bright lightning makes the whole view, at most */
const LIGHTNING_FLASH = 0.16;
/** Ours: townsfolk within this many fine units of a new spell run from it */
const SCATTER_RADIUS = 6 * FINENESS;
/** Ours: townsfolk's words show within this many squares of the eye */
const SPEECH_RANGE = 12;
/** Ours: how many rooms' nav grids (ambient life) are kept */
const NAV_GRIDS_KEPT = 8;
/**
 * Ours (the same crowd as friends): with the friends feature not started yet, wait this long after
 * the scene starts for it before making a crowd of our own (ms)
 */
const SOCIAL_START_WAIT_MS = 3000;
/** The arena: how long to wait for the relay's fights before running our own (docs/adr/0007-arena.md) */
const ARENA_WAIT_MS = 4000;
/** Ours (pets, docs/adr/0006-pets.md 3.5): at most this many drawn, ours and the nearest */
const MAX_PETS = 12;
/** Players have this many overlays at least (icons.ts): fewer is a disguise or shadow form, which shows no pet (3.3) */
const MIN_PLAYER_OVERLAYS = 7;
/** Pets' names show within this many squares of the eye */
const PET_NAME_RANGE = 10;
/** Ours (following a friend): building a room's nav grid takes at most this long a frame (ms) */
const FOLLOW_BUILD_MS = 3;
/** Ours (following): don't turn towards a spot this close (fine units); we'd spin on it */
const FOLLOW_TURN_SLOP = 96;
/** Ours (health bars over friends): the bar's width a square away, and the least it shrinks to (px) */
const FRIEND_BAR_WIDTH = 120;
const FRIEND_BAR_MIN = 36;
/** Eye height above the floor (clientd3d/game.c player.height = 3/4 square). */
const EYE_HEIGHT = 768;
/** Mouse sensitivity in client angle units per pixel (4096 per circle). */
const MOUSE_TURN = 2.5;

/**
 * Ours (the Modern interface, desktop): the camera views Camera View (V) cycles, as the UE
 * remaster's (its docs/sprites.md, MRCharacter EMRViewMode):
 *   - first: our eyes, as the original
 *   - chase: behind us, orbiting with the mouse; we turn to walk the way the keys point, as seen
 *     from the camera (turned to face it, then forward, as the phone's map mode moves)
 *   - behind: fixed behind us; the mouse turns us, as in first person
 *   - front: fixed in front, looking back at us; the mouse turns us, and up looks down at us
 * The outside views draw our own sprite (walking while we move) and no first-person hands.
 */
export type ViewMode = "first" | "chase" | "behind" | "front";
const VIEW_ORDER: readonly ViewMode[] = ["first", "chase", "behind", "front"];
/** The outside views' camera, from our eyes: its distance to start with, the nearest and farthest (fine units) */
const ARM_START = 3 * FINENESS;
/** Ours, Enhanced: how strongly flames glow, and how dark the vignette makes the corners (postFx.ts) */
const GLOW_STRENGTH = 1.4;
const VIGNETTE = 0.28;
/** Ours, the moods: a lightning strike brightens the view this much more at its flash (PostFx's exposure) */
const LIGHTNING_EXPOSURE = 0.25;
/** Ours (the spell revamp, V4): no room enchantment looks (Enhanced Visuals off) */
const NO_LOOKS: ReadonlySet<RoomEnchantKind> = new Set();
/** How long after entering a room its light snaps rather than fades (it arrives just after us), ms */
const ROOM_SETTLE_MS = 1000;
/** The room's light fades to a change with this time constant, ms */
const AMBIENT_FADE_MS = 450;
/** The most a mood's haze hides (moods.json fog_max_opacity) */
const HAZE_MAX = 0.85;
/** How much of the sun the ground and the hands take (a figure's is objectsView.ts SPRITE_SUN) */
const HANDS_SUN = 0.6;
const ARM_MIN = 0.8 * FINENESS;
const ARM_MAX = 5 * FINENESS;
/** A wheel notch moves the camera this much nearer or farther (fine units) */
const ARM_STEP = FINENESS / 4;
/** How far the outside views tilt from eye level (the remaster's mr.Camera.ThirdPersonPitch, 20°) */
const THIRD_PERSON_PITCH = (20 * Math.PI) / 180;
/**
 * The outside views turn about our head and zoom toward it, from a little above (OUTSIDE_PITCH).
 * The camera also rises HEAD_DROP's worth of its distance, looking the same way, so we stand low
 * in the view (the action bar may cover our legs) with the head at the same place at any distance.
 */
const CAMERA_AIM_HEIGHT = EYE_HEIGHT;
const OUTSIDE_PITCH = (-6 * Math.PI) / 180;
const HEAD_DROP = Math.tan((3.5 * Math.PI) / 180);
/** The camera stops this far short of a wall behind it, and never nearer our eyes than the second (squares) */
const CAMERA_WALL_GAP = 0.15;
const CAMERA_NEAREST = 0.1;
/** The right button: moved further than this (px) it's a drag that turns the view, not a click */
const RIGHT_DRAG_SLOP = 4;
/** Our sprite keeps walking this long after the last step (the mover's steps come in bursts), ms */
const WALK_LINGER_MS = 150;
/** Keyboard look up/down speed, radians per second (A_LOOKUP / A_LOOKDOWN held). */
const PITCH_RATE = 1.2;
const MAX_PITCH = 1.2;
/** Touch (ours): a finger moving further than this is a drag (looking), not a tap; px */
const TAP_SLOP = 10;
/** A finger held still this long examines (the right click); ms */
const LONG_PRESS_MS = 500;
/** A second tap this soon and this close is a double tap (activate); ms, px */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP = 40;
/** Ours: a tap that misses a creature's sprite still takes it within this many CSS pixels (a fingertip) */
const TAP_REACH = 24;
/** Ours: the phone's Target button pressed again within this long goes on to the next target */
const TARGET_CYCLE_MS = 2500;
/** Dragging on the view turns this much more than the mouse does per pixel (doubled, then 10% more, after phone tests) */
const TOUCH_LOOK = 1.76;

/** The on-screen joystick's move, like the keys (-1, 0 or 1) */
export interface TouchMove {
  forward: number;
  strafe: number;
  /** Pushed far: run (Always Run runs anyway) */
  run: boolean;
}

/** A finger on the view */
interface TouchState {
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** Moved past TAP_SLOP: it's looking around */
  moved: boolean;
  /** The long press fired */
  held: boolean;
  timer: number;
}
const OF_PLAYER = 0x4;
/** statmain.c STAT_VIGOR (in stat group 1) and MIN_VIGOR */
const STAT_VIGOR = 3;
const MIN_VIGOR = 10;
/** project.h PROJ_FLAG_FOLLOWGROUND */
const PROJ_FLAG_FOLLOWGROUND = 0x1;
const OF_ATTACKABLE = 0x8;
const OF_GETTABLE = 0x10;
const OF_CONTAINER = 0x20;
const OF_NOEXAMINE = 0x40;
const OF_ACTIVATABLE = 0x800;
/** include/proto.h OF_BUYABLE: a shopkeeper or vault keeper (BP_REQ_BUY) */
const OF_BUYABLE = 0x400;
/** include/proto.h OF_OFFERABLE: takes things (monster.kod: MOB_BUYER or MOB_RECEIVE), a banker among them */
const OF_OFFERABLE = 0x200;
/** gameuser.c: at most one attack every 250 ms; the closest target must be this near */
const ATTACK_DELAY = 250;
const CLOSE_DISTANCE = 5 * FINENESS;
/** effect.c SHAKE_AMPLITUDE */
const SHAKE_AMPLITUDE = FINENESS / 4;
/** A wall within this many squares of a label's anchor doesn't hide it: signs hang on walls */
const LABEL_OCCLUSION_SLACK = 0.1;
/** Ours: a quest's "!" and "?" grow as we near them: to this many times their CSS size within MARKER_NEAR squares, from MARKER_FAR in */
const MARKER_NEAR_SCALE = 1.4;
const MARKER_NEAR = 2;
const MARKER_FAR = 8;
/** Damage numbers (ours): how long one shows, how far it rises on screen, and when it starts to fade (0..1) */
const DAMAGE_LIFE_MS = 1200;
const DAMAGE_RISE_PX = 48;
const DAMAGE_FADE = 0.6;

/** A damage number floating over what we hit */
interface DamageFloat {
  id: number;
  born: number;
  /** The top of the object's sprite, last seen (kept if it dies or goes out of sight) */
  pos: THREE.Vector3 | null;
  /** Pixels sideways, so quick hits don't stack exactly */
  dx: number;
  el: HTMLDivElement;
}

export interface GameSceneStatus {
  roomName: string;
  /** The room's file, lower case ("tosarena.roo") */
  roomFile: string;
  objects: number;
  lights: number;
  loading: boolean;
}

/** The longest the view waits for a new room's sprites and sky before showing it anyway. */
const ENTER_TIMEOUT_MS = 4000;

/** Ours: each idle slice that readies a room next door (prepareRoom) takes this long, ms: what the browser says is free, within these */
const PREPARE_MIN_MS = 2;
const PREPARE_MAX_MS = 8;
/** ...and comes at least this often, ms, even when the browser is never idle (a busy phone): 2 ms in 100 */
const PREPARE_WAIT_MS = 100;

/** Whether a loaded room is the file the server has: BP_PLAYER's checksum went through a 28-bit Kod integer */
const sameRoomFile = (security: number, serverSecurity: number) => (security & 0x0fffffff) === (serverSecurity & 0x0fffffff);

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(ORIGINAL_FOV.vertical, 1, 0.05, 400);
  readonly mover: PlayerMover;
  private readonly session: GameSession;
  private readonly assets: AssetStore;
  private readonly labelsEl: HTMLElement;
  /** Ours: the "!" and "?" markers' elements (drawMarkers), reused frame to frame */
  private readonly markerPool: HTMLElement[] = [];
  private readonly canvas: HTMLCanvasElement;
  private palette: THREE.Texture | null = null;
  private xlats: XlatTable | null = null;
  private objects: ObjectsView | null = null;
  /** The sun and the moon (boverlay.c) */
  private skyOverlays: SkyOverlaysView | null = null;
  private room: Room | null = null;
  private roomView: RoomView | null = null;
  private roomRes = 0;
  /** The current room as the cache loaded it (shared; never changed) */
  private loaded: LoadedRoom | null = null;
  /** The current room's file name, lower case */
  roomFile = "";
  /**
   * Ours: the room's townsfolk or inn patrons (Ambient Life), and the room they're in. `ambient`
   * is null while the crowd catches up (docs/adr/0005-friends.md 6); `ambientStep` steps it
   */
  private ambient: AmbientLife | null = null;
  private ambientStep: AmbientStepper | null = null;
  private ambientRoom = "";
  /** The crowd to make for a room: asked of the friends feature, "pending" until it says */
  private ambientSeed: { file: string; seed: AmbientSeed | null | "pending" } | null = null;
  private readonly startedAt = performance.now();
  /**
   * Ours (docs/adr/0007-arena.md): the arena's fights as we draw them, and the room they're in.
   * They come from the relay, which runs one arena for everyone on our server; with no relay (or
   * none answering in time), from a sim of our own (`arenaLocal`).
   */
  private arena: ArenaView | null = null;
  private arenaRoom = "";
  private arenaFeed: "waiting" | "relay" | "local" = "waiting";
  private arenaWaitUntil = 0;
  private arenaLocal: { sim: ArenaSim; due: number; ticks: number } | null = null;
  /** The arenas' settings by room, as the relay's defaults have them (for their hours and our own sim) */
  private readonly arenaConfigs = readArenaConfigs(undefined).configs;
  /** The busy floor as last told to the relay or our own sim */
  private arenaBusySent = false;
  /** Cheers the stands give a player's mock bout (our hits in it), heard with the arena's sounds */
  private boutCheers: ArenaEvent[] = [];
  /** The room BP_PLAYER last put us in (file, lower case) */
  private playerRoomFile = "";
  /** roomexits.json, once loaded (empty without one) */
  private ambientExits: Record<string, AmbientExits> | null = null;
  /**
   * Nav grids by room file, kept for the session so each room's is read or built once: the asset
   * build's (nav/*.nav), else built here ("build" until the ambient life has made it)
   */
  private navGrids = new Map<string, NavGrid | "loading" | "build">();
  /** Development overrides of the current room's terrain and crowd (setTestRoom) */
  private testTerrain: string[] | null = null;
  private testCrowd: AmbientRoomSpec | null | undefined = undefined;
  /** Development: the admin dashboard's link (devBridge.ts) */
  private stopDevBridge: (() => void) | null = null;
  /** Ours: the room's critters (rats, spiders and the like), and the room they're in */
  private critters: Critters | null = null;
  private critterRoom = "";
  /** Ours: birds overhead and bats in caves (Birds and Bats), and the room they're for */
  private flyers: Flyers | null = null;
  private flyersRoom = "";
  /** Ours: butterflies, fireflies, leaves and fish (Nature), and the room they're for */
  private nature: Nature | null = null;
  private natureRoom = "";
  /** Whether the room has any open sky (a sector with no ceiling texture) */
  private roomHasSky = false;
  /** Ours: grass, flowers, pebbles and stones on the ground (Ground Detail), and the room they're for */
  private groundCover: GroundCover | null = null;
  /** Ours: puddles in the rain, how far they've spread (up while it rains, down after), and their room */
  private puddles: Puddles | null = null;
  wetness = 0;
  private puddleRoom = "";
  /** Ours: lightning far off in the rain, and the view's flash with it */
  private lightning: Lightning | null = null;
  /** Ours (the spell revamp, phase 9): spells' sparks, rings and passing lights, with Enhanced Visuals */
  private spellFx: SpellEffects | null = null;
  /** Ours (the spell revamp, V5): our range rings, with Enhanced Visuals */
  private rangeRings: RangeRings | null = null;
  /** Projectiles last frame, for their trails and where they landed: id -> where, light colour */
  private fxProjectiles = new Map<number, { at: FinePoint; color: number }>();
  /** The drawing buffer's size, reused each frame */
  private readonly fxBuffer = new THREE.Vector2();
  private flashEl: HTMLDivElement | null = null;
  /** 0..1: how overcast the sky is (darkening in the rain) */
  private overcast = 0;
  /** Ours: the sounds of ambient life and the weather (Ambient Sounds), and where we were last frame */
  private ambientSounds: AmbientSounds | null = null;
  private soundAt: { x: number; y: number } | null = null;
  private groundRoom = "";
  /** floortextures.json: what each floor texture is, and its colour */
  private floorTextures = new Map<number, { kind: "grass" | "earth" | "rocky"; color: [number, number, number]; cobbled: boolean }>();
  /** watertextures.json: floor textures that are water even on a dry floor (Raza's pool) */
  private waterTextures: Set<number> = new Set();
  /** roomterrain.json, once loaded (empty without one) */
  private roomTerrain: Record<string, string[]> | null = null;
  /** The current room with the server's changes (roomanim.c); `room` is its room */
  private live: LiveRoom | null = null;
  /** How many of the world's room changes `live` has applied */
  private liveApplied = 0;
  /** The live room's version `roomView` shows */
  private liveDrawn = 0;
  /** Our own view of the changed room (the cache's view stays as the file has it) */
  private ownView: RoomView | null = null;
  /** Rain, snow, sand and fireworks (d3dparticle.c) */
  private weather: WeatherParticles | null = null;
  /** Particle steps owed (they run at the original's 70 frames a second) */
  private particleTime = 0;
  /** Ours (V6): wavering vision (EFFECT_WAVER), made when first needed */
  private waver: Waver | null = null;
  /** Blurred vision (EFFECT_BLUR), made when first needed */
  private blur: TrailBlur | null = null;
  /** Ours: Anti Aliasing, glowing flames and the vignette (postFx.ts), made when first needed */
  private postFx: PostFx | null = null;
  /** Dev tools: the season to show (0 spring .. 3 winter) instead of the server's; null: the server's */
  seasonPin: number | null = null;
  /** Ours (Seasons): how much snow lies on open ground, 0..1: it builds while it snows, melts after */
  private snowCover = 0;
  /** Ours, Enhanced: the lighting's moods (mood.ts), and this frame's (null with Enhanced off) */
  private readonly moods = new MoodDirector();
  private moodFrame: MoodFrame | null = null;
  /** Ours (the spell revamp, V4), Enhanced: the room enchantments' looks, and what's on the room */
  private readonly roomLooks = new RoomEnchantLooks();
  private lookKinds: ReadonlySet<RoomEnchantKind> = new Set();
  /** The room we last drew, and when we came into it (the light snaps on a new room) */
  private drawnRoomId = -1;
  private enteredAt = 0;
  /** The room's ambient light as drawn: with Enhanced, Darkness and Illuminate fade it rather than snap */
  private ambientShown = 0;
  /** Grid textures a change asked for that are loading */
  private textureLoads = new Set<number>();
  /** This room and the ones next to it, loaded ahead */
  private rooms: RoomCache | null = null;
  /**
   * Between leaving a room and having the next one ready (its geometry, the sprites of
   * what's in it and its sky), the view keeps its last picture instead of drawing the
   * objects in a half-loaded room.
   */
  private entering = false;
  /** Resolves when the server has sent the current room's contents (BP_ROOM_CONTENTS). */
  private contentsArrived: Promise<void> = Promise.resolve();
  private contentsResolve: (() => void) | null = null;
  private sky: THREE.Group | null = null;
  private skyName = "";
  private readonly bgfs = new Map<number, Bgf | null | undefined>();
  private readonly bgfLoads = new Map<number, Promise<void>>();
  private lights: LightSource[] = [];
  private pitch = 0;
  /** The camera view (ours, the Modern interface): first person unless Camera View changes it */
  viewMode: ViewMode = "first";
  /** The camera view changed (for the HUD's note) */
  onViewMode?: (mode: ViewMode) => void;
  /**
   * The right button held on the view (the desktop): where it went down, how far the mouse has
   * moved since (it's captured, so the cursor doesn't), and whether that makes it a drag (turning
   * the view) rather than a click (Examine, on release)
   */
  private rightDrag: { x: number; y: number; travel: number; moved: boolean; mods: Mods } | null = null;
  /** The outside views' camera distance from our eyes (fine units) */
  private arm = ARM_START;
  /** The chase view's own heading, as our angle (0..4095) */
  private chaseAngle = 0;
  /** Where we stood last frame and when we last moved: our sprite walks while we do */
  private lastPos = { x: 0, y: 0 };
  private lastStepAt = -Infinity;
  private readonly keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  private touchMove: TouchMove = { forward: 0, strafe: 0, run: false };
  private readonly touches = new Map<number, TouchState>();
  private lastTap: { x: number; y: number; at: number } | null = null;
  /** When a finger last touched the view: the browser's emulated dblclick is ignored after it */
  private lastTouchAt = -Infinity;
  private hovered: number | null = null;
  /** graphics.c UserStartDrag: a room object being dragged towards the inventory */
  private drag: number | null = null;
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private readonly unsubscribe: () => void;
  /** Ours: what real NPCs and monsters said lately (BP_SAID), by object id, drawn as speech bubbles */
  private npcSpeech = new Map<number, { text: string; until: number }>();
  private offChat: (() => void) | null = null;
  private readonly resizeObserver: ResizeObserver;
  private labelPool: HTMLDivElement[] = [];
  /** Ours: what ambient townsfolk say, over their heads */
  private speechPool: HTMLDivElement[] = [];
  /** Projectiles already seen (ambient townsfolk run from new ones), and whether the view was shaking */
  private seenShots = new Set<number>();
  private wasShaking = false;
  private damageFloats: DamageFloat[] = [];
  private readonly raycaster = new THREE.Raycaster();
  /** From our eyes to the outside views' camera, for the wall in between */
  private readonly cameraRay = new THREE.Raycaster();
  /** For hiding name labels behind walls */
  private readonly labelRay = new THREE.Raycaster();
  private overlays: ScreenOverlays | null = null;
  /** The selected target (gameuser.c idTarget), or null */
  target: number | null = null;
  /** Waiting for the user to pick a spell target (GAME_SELECT); called with the pick */
  private selectCallback: ((id: number) => void) | null = null;
  private lastAttack = 0;
  private settings: Settings = getSettings();
  private altDown = false;
  private ctrlDown = false;
  /** Frames since the last FPS report (Show FPS) */
  private fpsFrames = 0;
  private fpsSince = performance.now();
  readonly audio: GameAudio;
  private readonly offSettings: () => void;
  fog = true;
  /** command.c pinfo.resting: no moving, attacking or going through doors (mermain.c InterfaceAction) */
  resting = false;
  onStatus?: (s: GameSceneStatus) => void;
  /** Enter pressed: focus the chat input */
  onChatKey?: () => void;
  /** Look at a room object (A_LOOKMOUSE, A_LOOK): the description dialog */
  onLook?: (id: number) => void;
  /** Pick up (A_PICKUP): the gettable objects to choose from; just one is picked up at once */
  onPickup?: (ids: number[]) => void;
  /**
   * Several objects qualify (lookdlg.c DisplayLookList with LD_SINGLEAUTO): ask which one, under
   * `title` (IDS_LOOK, IDS_ATTACK, IDS_ACTIVATE, IDS_GET), with `initial` chosen to start with
   */
  onChoose?: (title: string, ids: number[], then: (id: number) => void, initial?: number) => void;
  /** Look inside a container (BP_SEND_OBJECT_CONTENTS; the contents come back as BP_OBJECT_CONTENTS) */
  onContents?: (id: number) => void;
  /** Ours: a double click on a shopkeeper or vault keeper asks for their wares or our vault */
  onBuy?: (id: number) => void;
  /** Ours: a double click on someone who only takes things (a banker): the Deposit window */
  onDeposit?: (id: number) => void;
  /** A key bound to a panel action (inventory, settings, map zoom) */
  onAction?: (a: Action) => void;
  /** Say, Tell, Yell, Broadcast, Emote keys: start a chat line with this command */
  onChatPrefix?: (prefix: string) => void;
  /** A function key with no action bound: its hotkey alias (alias.c AliasKey), 1..12 */
  onHotkey?: (n: number) => void;
  /** Show FPS: frames per second, about twice a second */
  onFps?: (fps: number) => void;
  /** Type-to-chat: a printable key starts a chat line with this text */
  onTypeChat?: (text: string) => void;
  /** The target changed (the interface shows it) */
  onTarget?: (id: number | null) => void;
  /** Selecting a spell target started (true) or ended (false) */
  onSelecting?: (on: boolean) => void;
  /** A line for the chat window from the client itself */
  onMessage?: (text: string) => void;
  /** Ours: one of the townsfolk examined (the inspect window), by their ambient id */
  onLookAmbient?: (id: number) => void;
  /**
   * Ours (docs/adr/0005-friends.md): the friends feature, for friends' health bars over their heads
   * (5) and following (4)
   */
  social: SocialLink | null = null;
  /**
   * Ours (docs/adr/0006-pets.md): our own pet (GameView sets it; null for none), our character's
   * name (pets idle by their owner's name), and every pet in the room, ours and other players'
   */
  ownPet: PetChoice | null = null;
  ownName = "";
  /** Ours (docs/adr/0010-followers.md 9.4): our companion, for its health under its name */
  companion: { id: number; hpPct: number } | null = null;
  /** Ours (docs/adr/0019-arena-bouts.md): the arena bout's fighters' health, by object, for a bar under each name */
  arenaHp = new Map<number, number>();
  /** ...and whether one holds the floor: the relay's show of NPCs gives way to it */
  arenaFloorBusy = false;
  private pets: Pets | null = null;
  private petsRoom = "";
  private petNamePool: HTMLDivElement[] = [];
  private petArtLoaded = false;
  /** Where we were last frame, for how fast our pet must go */
  private petLastAt: { x: number; y: number } | null = null;
  /** Following a friend: the plan, and whose object to walk after (their key; ids change) */
  private follow: { planner: FollowPlanner; key: string } | null = null;
  /** A room's nav grid being built for following, a slice a frame */
  private followBuild: { file: string; gen: Generator<void, NavGrid> } | null = null;
  /** Following stopped of itself (we moved, the way was lost): why, for GameView to tell the friend and the chat */
  onFollowStop?: (why: string) => void;

  constructor(canvas: HTMLCanvasElement, labels: HTMLElement, session: GameSession, assets: AssetStore, audio: GameAudio) {
    this.canvas = canvas;
    this.labelsEl = labels;
    this.session = session;
    this.assets = assets;
    this.audio = audio;
    this.audio.objectPosition = (id) => session.world.objects.get(id);
    this.audio.objectName = (id) => {
      const o = session.world.objects.get(id);
      return o ? session.resource(o.info.nameRes) : undefined;
    };
    this.offSettings = onSettings((s) => {
      this.settings = s;
      this.applyViewSettings();
      // The outside views are the Modern interface's: back to our eyes without it
      if (this.viewMode !== "first" && !this.outsideViews()) this.setViewMode("first");
    });
    this.mover = new PlayerMover({
      move: (x, y, speed) => session.requestMove(x, y, speed),
      turn: (angle) => session.requestTurn(angle),
      wade: () => {
        const file = this.session.resource(this.session.world.player?.wadingSoundRes ?? 0);
        if (file) this.audio.playLocal(file);
      },
    });
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene.background = new THREE.Color(0x000000);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.offChat = session.listen({
      chat: (line) => {
        const sender = line.sender;
        if (!sender || line.channel !== "chat") return;
        if (line.sayType !== SAY.NORMAL && line.sayType !== SAY.YELL && line.sayType !== SAY.RESOURCE) return;
        const o = session.world.objects.get(sender.id);
        if (!o || o.id === session.world.self?.id || o.info.flags & OF.PLAYER) return;
        // "Name says, "..."": the bubble holds just the words
        let text = line.spans.map((sp) => sp.text).join("").trim();
        const q = text.indexOf('"');
        if (q >= 0 && text.lastIndexOf('"') > q) text = text.slice(q + 1, text.lastIndexOf('"'));
        if (!text) return;
        this.npcSpeech.set(o.id, { text, until: performance.now() + Math.min(9000, 3000 + text.length * 60) });
      },
    });
    this.unsubscribe = session.world.on((e) => {
      const self = session.world.self;
      switch (e.type) {
        case "player": {
          // Another room (a save renumbers this one, so not by its id): a new crowd, asked for again
          // (docs/adr/0005-friends.md 6), even back in the same room after a moment elsewhere
          const file = (session.resource(e.player.roomRes) ?? "").toLowerCase();
          if (file !== this.playerRoomFile) {
            this.playerRoomFile = file;
            this.ambientSeed = null;
            this.ambientStep = null;
            this.ambient = null;
            this.ambientRoom = "";
          }
          if (e.roomChanged) {
            // Following: this should be the room the leader went to
            if (this.follow) {
              const why = this.follow.planner.enteredRoom((session.resource(e.player.roomRes) ?? "").toLowerCase());
              if (why) this.stopFollowing(why);
            }
            // BP_ROOM_CONTENTS follows BP_PLAYER on entering a room
            this.contentsArrived = new Promise((r) => (this.contentsResolve = r));
            // game.c EnterNewRoom: SetUserTargetID(INVALID_ID)
            this.setTarget(null);
            this.clearDamage();
          }
          // BP_PLAYER carries the room's background too (teleports change both)
          void this.syncRoom();
          break;
        }
        case "background":
          void this.syncSky();
          break;
        case "roomChange":
          this.applyRoomChanges();
          break;
        case "roomContents":
          this.contentsResolve?.();
          this.contentsResolve = null;
          // Ours (phase 9): a new room's projectiles didn't land here
          this.spellFx?.clear();
          this.fxProjectiles.clear();
          if (self) {
            this.mover.place(self.x, self.y, performance.now());
            this.mover.setAngle(self.angle);
            this.pitch = 0;
            this.chaseAngle = self.angle;
          }
          break;
        case "selfMoved":
          this.mover.place(e.x, e.y, performance.now());
          break;
        case "selfTurned":
          this.mover.setAngle(e.angle);
          break;
        case "objectRemoved":
          if (this.target !== null && e.id === this.target) this.setTarget(null);
          break;
        case "wait":
          // cursor.c GameWindowSetCursor: the wait cursor in GAME_WAIT
          this.canvas.classList.toggle("server-wait", e.waiting);
          break;
        case "spellFx":
          // Ours (the spell revamp, phase 9): UC_SPELL_FX, drawn with Enhanced Visuals only
          if (this.settings.enhanced) this.showSpellFx(e.fx);
          break;
        case "idsStale":
          // server.c HandleWait / HandleInvalidateData: SetUserTargetID(INVALID_ID)
          this.setTarget(null);
          if (this.selecting) this.select(null);
          this.drag = null;
          this.clearDamage();
          break;

      }
    });
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    canvas.addEventListener("mousemove", this.onCanvasMouseMove);
    canvas.addEventListener("mouseleave", this.onMouseLeave);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    // Touch on the view (the phone layout): drag to look, tap, double tap, long press
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    void this.init();
    if (import.meta.env.DEV) {
      (window as unknown as { shards: unknown }).shards = { gameScene: this, session, audio: this.audio, THREE, pose: () => this.pose() };
      // The admin dashboard (admin.html): live tuning and scene overrides, and where we are
      this.stopDevBridge = startDevBridge(this, session);
    }
  }

  private async init(): Promise<void> {
    const [pal, lightPal] = await Promise.all([this.assets.palette(), this.assets.lightPalettes()]);
    if (this.disposed) return;
    this.palette = paletteTexture(pal);
    // Ours (docs/adr/0018-seasons-water-windows.md): which textures are water, grass and foliage, and
    // windows' glass, before any room is built with them
    const [water, floors, foliage, windows] = await Promise.all([
      this.assets.waterTextures().catch(() => new Set<number>()),
      this.assets.floorTextures().catch(() => new Map()),
      this.assets.foliageTextures().catch(() => new Set<number>()),
      this.assets.windowTextures().catch(() => new Map()),
    ]);
    if (this.disposed) return;
    roomSurfaceTextures.water = water;
    roomSurfaceTextures.grass = new Set([...floors].filter(([, f]) => f.kind === "grass").map(([t]) => t));
    roomSurfaceTextures.foliage = foliage;
    roomSurfaceTextures.windows = windows;
    this.rooms = new RoomCache(this.assets, this.palette, (l) => this.prepareRoom(l));
    this.xlats = new XlatTable(pal.rgb, lightPal);
    this.objects = new ObjectsView(this.palette, this.xlats, (id) => this.bgf(id), (id) => this.session.resource(id));
    this.scene.add(this.objects.group);
    void this.assets.floorTextures().then(
      (f) => void (this.floorTextures = f),
      () => {},
    );
    void this.assets.waterTextures().then(
      (w) => void (this.waterTextures = w),
      () => {},
    );
    void this.assets.roomTerrain().then(
      (t) => void (this.roomTerrain = t),
      () => void (this.roomTerrain = {}),
    );
    void this.assets.roomExits().then(
      (e) => void (this.ambientExits = e),
      () => void (this.ambientExits = {}),
    );
    this.skyOverlays = new SkyOverlaysView(pal.rgb);
    this.scene.add(this.skyOverlays.group);
    this.applyViewSettings();
    this.overlays = new ScreenOverlays(this.labelsEl.parentElement!, pal.rgb, this.xlats, (id) => this.bgf(id));
    // Textures filtered, as the D3D client draws them (colorTexture.ts): the hands, the sun and moon too
    this.overlays.smooth = true;
    this.skyOverlays.setSmooth(true);
    this.objects.setSmoothTextures(true);
    this.weather = new WeatherParticles(await this.snowTexture());
    this.weather.onFireworkSound = (x, y) => this.audio.playAt("firework.ogg", x, y);
    this.scene.add(this.weather.group);
    this.flyers = new Flyers();
    this.scene.add(this.flyers.group);
    this.nature = new Nature();
    this.scene.add(this.nature.group);
    this.groundCover = new GroundCover();
    this.scene.add(this.groundCover.group);
    this.puddles = new Puddles();
    this.scene.add(this.puddles.group);
    this.lightning = new Lightning();
    this.scene.add(this.lightning.group);
    this.spellFx = new SpellEffects();
    // Phones get half the sparks (spellEffects.ts budget)
    this.spellFx.budget = touchUi(this.settings) ? 0.5 : 1;
    this.scene.add(this.spellFx.group);
    this.rangeRings = new RangeRings();
    this.scene.add(this.rangeRings.group);
    this.flashEl = document.createElement("div");
    this.flashEl.className = "lightning-flash";
    this.labelsEl.parentElement?.insertBefore(this.flashEl, this.labelsEl);
    void this.loadRocks(pal.rgb);
    await this.syncRoom();
    // Ours (Limit to 60 FPS): a faster screen skips frames, keeping to 60 a second on average
    let due = 0;
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      if (this.settings.frameLimit) {
        if (t < due - FRAME_SLACK_MS) return;
        due = (t - due > FRAME_MS ? t : due) + FRAME_MS;
      }
      this.frame(Math.min(250, t - this.last), t);
      this.last = t;
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** The .bgf for an icon resource: loads on first use, undefined while loading. */
  private bgf(resource: number): Bgf | null | undefined {
    if (!this.bgfLoads.has(resource)) void this.loadBgf(resource);
    return this.bgfs.get(resource);
  }

  /** Loads an icon resource's .bgf once; resolves when it's there (or known missing). */
  private loadBgf(resource: number): Promise<void> {
    let p = this.bgfLoads.get(resource);
    if (!p) {
      this.bgfs.set(resource, undefined);
      // Ambient life's art is named by file (ambientIds.ts), the rest by the server's resources
      const name = localResName(resource) ?? this.session.resource(resource);
      if (!name) {
        this.bgfs.set(resource, null);
        p = Promise.resolve();
      } else
        p = this.assets.bgf(name).then(
          (b) => void this.bgfs.set(resource, b),
          () => void this.bgfs.set(resource, null),
        );
      this.bgfLoads.set(resource, p);
    }
    return p;
  }

  /**
   * A room next door, made ready to show while the page is idle (RoomCache): its textures'
   * smoothed copies and shaded corners, then everything sent to the graphics card, a few
   * milliseconds at a time. Walking in then draws it at once.
   */
  private async prepareRoom(l: LoadedRoom): Promise<void> {
    const view = l.view;
    const idle = (): Promise<IdleDeadline | null> =>
      new Promise((r) => (typeof requestIdleCallback === "function" ? requestIdleCallback(r, { timeout: PREPARE_WAIT_MS }) : setTimeout(() => r(null), 16)));
    // a slice: what the browser says is free, within bounds
    const slice = (d: IdleDeadline | null) => Math.max(PREPARE_MIN_MS, Math.min(PREPARE_MAX_MS, d?.timeRemaining() ?? PREPARE_MIN_MS));
    const opts = { smooth: true, shadedCorners: this.settings.enhanced };
    for (;;) {
      const d = await idle();
      if (this.disposed || view.disposed) return;
      if (view.prepare(opts, slice(d))) break;
    }
    const textures = view.allTextures();
    for (let i = 0; i < textures.length; ) {
      const d = await idle();
      // the shown room may be this one by now: its frame has uploaded what it draws already
      if (this.disposed || view.disposed) return;
      const until = performance.now() + slice(d);
      while (i < textures.length && performance.now() < until) this.renderer.initTexture(textures[i++]);
    }
  }

  /** The sprites of everything in the room, once the server has said what's in it. */
  private async objectsReady(): Promise<void> {
    await this.contentsArrived;
    const res = new Set<number>();
    for (const o of this.session.world.objects.values()) {
      res.add(o.info.iconRes);
      for (const ov of o.look.overlays) res.add(ov.iconRes);
    }
    await Promise.all([...res].map((r) => this.loadBgf(r)));
  }

  private async syncRoom(): Promise<void> {
    const p = this.session.world.player;
    // The room we show isn't the server's any more (edited in the room editor, or deployed while
    // we play): the server's checksum wins, so it's loaded again in place
    const stale = !!p && p.roomRes === this.roomRes && !!this.loaded && !this.entering && !sameRoomFile(this.loaded.room.security, p.roomSecurity);
    if (!p || !this.rooms || (p.roomRes === this.roomRes && !stale)) {
      // game.c HandlePlayer loads the room again even when it's the same one; the server
      // then sends its changes again (user.kod ToCliPlayer). The room's name may have changed
      // language (language.c MenuLanguageChosen asks for everything again): the title follows
      if (!this.entering) {
        this.resetLiveRoom();
        this.status(false);
      }
      return void this.syncSky();
    }
    this.roomRes = p.roomRes;
    const name = this.session.resource(p.roomRes);
    if (!name) return;
    this.entering = true;
    this.status(true);
    void this.rooms.enter(name);
    let loaded;
    try {
      loaded = await this.rooms.get(name);
      if (!sameRoomFile(loaded.room.security, p.roomSecurity)) {
        // A copy from before the file changed (the one shown, or a neighbour loaded ahead)
        await this.assets.refresh();
        this.rooms.invalidate(name, this.loaded);
        loaded = await this.rooms.get(name);
        if (!sameRoomFile(loaded.room.security, p.roomSecurity)) console.warn(`room ${name}: its file still isn't the server's (npm run assets?)`);
      }
    } catch (e) {
      console.error(`room ${name}: ${(e as Error).message}`);
      this.entering = false;
      this.status(false);
      return;
    }
    if (this.disposed || this.roomRes !== p.roomRes) return;
    // The cache owns room views: neighbours stay loaded for when you walk back. A view replaced
    // because its file changed isn't the cache's any more, so it's disposed here once swapped out
    const replaced = this.loaded && this.loaded !== loaded && this.roomFile === name.toLowerCase() ? this.loaded : null;
    this.loaded = loaded;
    this.roomFile = name.toLowerCase();
    if (replaced || stale) this.forgetRoomCaches();
    this.resetLiveRoom();
    if (replaced) replaced.view.dispose();
    const self = this.session.world.self;
    if (self) {
      this.mover.place(self.x, self.y, performance.now());
      this.mover.setAngle(self.angle);
    }
    // Show it all at once; a slow sprite or sky can't hold the view for more than a few seconds
    await Promise.race([Promise.all([this.objectsReady(), this.syncSky()]), new Promise((r) => setTimeout(r, ENTER_TIMEOUT_MS))]);
    if (this.disposed || this.roomRes !== p.roomRes) return;
    this.entering = false;
    this.applyRoomChanges();
    this.status(false);
  }

  /**
   * Development: try the current room as other terrain (TERRAIN_* names: "CAVES", "SWAMP" ...),
   * or with another crowd (an AmbientRoomSpec; null for none), whatever the asset build and
   * AMBIENT_ROOMS say; undefined puts either back. The Proving Grounds (RID 4300) is meant for
   * this. Critters, bats, nature, ground detail, sounds and the crowd start over.
   */
  setTestRoom(o: { terrain?: string[] | null; crowd?: AmbientRoomSpec | null }): void {
    if ("terrain" in o) this.testTerrain = o.terrain ?? null;
    if ("crowd" in o) this.testCrowd = o.crowd;
    this.forgetRoomCaches();
  }

  /** Tuning changed (the admin dashboard, tuning.ts): the crowd, critters and the rest start over with it */
  retune(): void {
    this.forgetRoomCaches();
  }

  /**
   * A sprite's file changed (the admin dashboard's sprite editor saved it): loaded again, the old
   * picture kept on show until the new one is in, then every object composited anew.
   */
  async spriteChanged(file: string): Promise<void> {
    await this.assets.refresh();
    const name = file.toLowerCase();
    const loads: Promise<void>[] = [];
    for (const id of this.bgfLoads.keys()) {
      const res = localResName(id) ?? this.session.resource(id);
      if (res?.toLowerCase() !== name) continue;
      const p = this.assets.bgf(res).then(
        (b) => void this.bgfs.set(id, b),
        () => {},
      );
      this.bgfLoads.set(id, p);
      loads.push(p);
    }
    await Promise.all(loads);
    if (loads.length) this.objects?.forgetComposites();
  }

  /** The current room's terrain (roomterrain.json), unless setTestRoom says otherwise */
  private terrainHere(): string[] | undefined {
    return this.testTerrain ?? this.roomTerrain?.[this.roomFile];
  }

  /** The current room's crowd (AMBIENT_ROOMS), unless setTestRoom says otherwise */
  private crowdHere(): AmbientRoomSpec | undefined {
    return this.testCrowd === undefined ? AMBIENT_ROOMS[this.roomFile] : (this.testCrowd ?? undefined);
  }

  /**
   * The current room's file changed under us (an edit, a deploy): what was worked out from the old
   * one goes, so the crowd, critters, flyers, nature, ground detail, puddles and pets start over
   */
  private forgetRoomCaches(): void {
    this.navGrids.delete(this.roomFile);
    this.ambient = null;
    this.ambientRoom = "";
    this.critterRoom = "";
    this.flyersRoom = "";
    this.natureRoom = "";
    this.groundRoom = "";
    this.puddleRoom = "";
    this.petsRoom = "";
  }

  /**
   * Starts the current room over as the file has it (the cache's view), then applies the
   * changes the server has sent since BP_PLAYER.
   */
  private resetLiveRoom(): void {
    const loaded = this.loaded;
    if (!loaded) return;
    if (this.roomView) this.scene.remove(this.roomView.group);
    this.ownView?.dispose();
    this.ownView = null;
    this.live = new LiveRoom(loaded.room);
    // bspload.c: loading a room starts the particle emitters over
    this.weather?.reset();
    this.live.numGroups = (id) => this.roomBgf(id)?.groups.length ?? 0;
    this.liveApplied = 0;
    this.liveDrawn = 0;
    this.room = this.live.room;
    this.roomView = loaded.view;
    this.scene.add(loaded.view.group);
    this.mover.room = this.live.room;
    this.applyRoomChanges();
  }

  /** Applies the room changes the live room hasn't seen yet (BP_SECTOR_MOVE and the rest). */
  private applyRoomChanges(): void {
    const live = this.live;
    if (!live || this.entering) return;
    const changes = this.session.world.roomChanges;
    if (this.liveApplied > changes.length) this.liveApplied = 0; // a BP_PLAYER started a new list
    for (; this.liveApplied < changes.length; this.liveApplied++) live.apply(changes[this.liveApplied]);
    this.loadRoomTextures();
  }

  private roomBgf(id: number): Bgf | undefined {
    return this.loaded?.bgfs.get(id) ?? this.ownViewTextures.get(id);
  }

  /** Grid textures that changes brought in (BP_CHANGE_TEXTURE), beyond the room's own */
  private ownViewTextures = new Map<number, Bgf>();

  /** BP_CHANGE_TEXTURE can name textures the room file doesn't use: load them, then redraw */
  private loadRoomTextures(): void {
    const live = this.live;
    if (!live) return;
    for (const id of live.textureIds()) {
      if (this.roomBgf(id) || this.textureLoads.has(id)) continue;
      this.textureLoads.add(id);
      this.assets.bgf(gridTextureName(id)).then(
        (b) => {
          this.textureLoads.delete(id);
          if (!b?.bitmaps.length || this.disposed) return;
          this.ownViewTextures.set(id, b);
          this.ownView?.addTexture(id, b);
          if (this.live) this.live.version++;
        },
        () => this.textureLoads.delete(id),
      );
    }
  }

  /** Draws the live room's changes: our own view of it, built again when it changed. */
  private drawRoomChanges(dt: number): void {
    const live = this.live;
    if (!live || !this.loaded || !this.palette) return;
    live.tick(dt);
    if (live.version === this.liveDrawn) return;
    this.liveDrawn = live.version;
    if (!this.ownView) {
      const textures = new Map(this.loaded.bgfs);
      for (const [id, b] of this.ownViewTextures) textures.set(id, b);
      this.ownView = new RoomView(live.room, textures, this.palette);
      if (this.roomView) this.scene.remove(this.roomView.group);
      this.roomView = this.ownView;
      this.scene.add(this.ownView.group);
    } else this.ownView.rebuild(live.room);
  }

  private async syncSky(): Promise<void> {
    const bg = this.session.resource(this.session.world.background) ?? "";
    const bsf = skyboxForBackground(bg);
    if ((bsf ?? "") === this.skyName) return;
    this.skyName = bsf ?? "";
    if (this.sky) {
      this.scene.remove(this.sky);
      disposeSkybox(this.sky);
      this.sky = null;
    }
    if (!bsf) return;
    const sky = await loadSkybox(this.assets, bsf);
    if (this.disposed || this.skyName !== bsf) return disposeSkybox(sky);
    this.sky = sky;
    this.scene.add(sky);
  }

  private frame(dt: number, now: number): void {
    const world = this.session.world;
    const self = world.self;
    const room = this.room;
    // Entering a room: keep the last picture until the new room is ready
    if (this.entering) return;
    if (!(room && this.roomView && this.objects && self && this.mover.room === room)) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // The room's lifts and wall changes first: collision uses the heights they leave
    this.drawRoomChanges(dt);
    // --- movement (move.c) ---
    const held = (a: Action) => (isHeld(this.settings.keys, a, this.keys, this.mods()) ? 1 : 0);
    // EFFECT_PARALYZE, and GAME_WAIT while the server saves: no motion
    // and move.c: through another object's eyes, only with REMOTE_VIEW_MOVE (and not CONTROL)
    const remote = this.remoteView();
    const rv = remote?.view.flags ?? 0;
    const still = world.effects.paralyzed || world.waiting || this.resting || (remote !== null && (rv & REMOTE_VIEW.CONTROL || !(rv & REMOTE_VIEW.MOVE)));
    // The keys and the on-screen joystick add up, as two keys for the same move would
    const tm = this.touchMove;
    const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
    // With the full map open (ours), the joystick and the keys move by the map's directions: up
    // (Forward) north, Backward south, the slides and turns west and east. We turn to face that
    // way and walk forward, so the server sees plain turns and steps
    let mapWalk = false;
    if (this.mapMode && !still && !remote) {
      const north = clamp1(held("forward") - held("backward") + tm.forward);
      const east = clamp1(held("strafeRight") - held("strafeLeft") + held("turnRight") - held("turnLeft") + tm.strafe);
      if (north || east) {
        const facing = Math.round((Math.atan2(-north, east) * 4096) / (2 * Math.PI)) & 4095;
        const diff = ((facing - this.mover.angle + 6144) % 4096) - 2048;
        if (diff) this.mover.turnBy(diff);
        mapWalk = true;
      }
    }
    let forward = still ? 0 : mapWalk ? 1 : clamp1(held("forward") - held("backward") + tm.forward);
    let strafe = still || mapWalk ? 0 : clamp1(held("strafeRight") - held("strafeLeft") + tm.strafe);
    // The chase view: the keys point the way to go as the camera sees it; we turn to face that way
    // and walk forward, so the server sees plain turns and steps (as the map mode above)
    if (this.viewMode === "chase" && !mapWalk && (forward || strafe) && !remote) {
      const facing = (this.chaseAngle + Math.round((Math.atan2(strafe, forward) * 4096) / (2 * Math.PI))) & 4095;
      const diff = ((facing - this.mover.angle + 6144) % 4096) - 2048;
      if (diff) this.mover.turnBy(diff);
      forward = 1;
      strafe = 0;
    }
    // On the full map the turn keys point west and east instead (above)
    let turn = this.mapMode || (remote && !(rv & REMOTE_VIEW.TURN)) ? 0 : held("turnRight") - held("turnLeft");
    // Following a friend (ours): moving or turning ourselves stops it; else it walks for us
    let followRun: boolean | null = null;
    if (this.follow) {
      if (forward || strafe || turn) this.stopFollowing("you moved");
      else if (!still && !remote) {
        const walk = this.followFrame(now, room, self);
        if (walk) {
          forward = 1;
          followRun = walk.run;
          turn = 0;
        }
      }
    }
    // Always Run (config.ini alwaysrun): the Run/Walk key walks instead
    // mermain.c: too tired to run below MIN_VIGOR (10)
    const vigor = world.stats.get(1)?.find((st) => st.num === STAT_VIGOR)?.numeric?.value ?? MIN_VIGOR;
    const joystick = tm.forward !== 0 || tm.strafe !== 0;
    const wantsRun = followRun ?? (joystick ? tm.run || this.settings.alwaysRun : (held("run") === 1) !== this.settings.alwaysRun);
    const run = wantsRun && vigor >= MIN_VIGOR;
    const angleBefore = this.mover.angle;
    this.mover.turnKeys(turn, run, dt);
    if (remote && rv & REMOTE_VIEW.CONTROL) {
      // move.c UserTurnPlayer, REMOTE_VIEW_CONTROL: the turn turns the object we see through
      remote.obj.angle = (remote.obj.angle + this.mover.angle - angleBefore + 4096) & 4095;
      this.mover.setAngle(angleBefore);
    }
    const pitchDir = held("lookUp") - held("lookDown");
    if (pitchDir) this.pitch = this.clampPitch(this.pitch + (pitchDir * PITCH_RATE * dt) / 1000);
    this.mover.roomFlags = world.player?.roomFlags ?? 0;
    this.mover.overrideDepths = (world.player?.depths ?? [0, 0, 0]).map((d) => d << 4) as [number, number, number];
    this.mover.update({ forward, strafe, run }, dt, now, world.objects.values(), self.id);
    self.x = this.mover.x;
    self.y = this.mover.y;
    self.angle = this.mover.angle;
    world.tick(dt);
    this.updateAmbient(dt);
    this.updateCritters(dt);
    this.updatePets(dt);
    this.audio.setListener(this.mover.x, this.mover.y, this.mover.angle);

    // --- camera: our eyes, or the object's we see through (draw.c DrawRoom) ---
    const eye = remote ? this.remoteEye(remote) : { x: this.mover.x, y: this.mover.y, z: this.mover.z + EYE_HEIGHT + (this.settings.bounce ? this.mover.bounce : 0), angle: this.mover.angle };
    const a = (eye.angle * 2 * Math.PI) / 4096;
    const yaw = Math.atan2(-Math.cos(a), -Math.sin(a)); // client (cos a, sin a) -> scene (X, Z)
    // effect.c EffectShake: jiggle the view by up to a quarter square
    let jx = 0,
      jy = 0,
      jz = 0;
    if (world.effects.shake > 0) {
      const amp = Math.min(SHAKE_AMPLITUDE, world.effects.shake / 3) + 1;
      const jiggle = () => Math.floor(Math.random() * amp) - amp / 2;
      [jx, jy, jz] = [jiggle(), jiggle(), jiggle()];
    }
    // The outside views (ours): the camera swung out from our eyes, short of any wall
    const outside = this.viewMode !== "first" && !remote;
    const viewer = outside ? this.placeOutsideCamera(eye.x, eye.y, this.mover.z + CAMERA_AIM_HEIGHT) : { x: eye.x, y: eye.y };
    const viewYaw = outside ? this.camera.rotation.y : yaw;
    if (!outside) {
      this.camera.position.set((eye.x + jx) / FINENESS, (eye.z + jz) / FINENESS, (eye.y + jy) / FINENESS);
      this.camera.rotation.set(this.pitch, yaw, 0, "YXZ");
    }
    // Our sprite, seen from outside, walks while we move (the server never moves us: we do)
    if (this.mover.x !== this.lastPos.x || this.mover.y !== this.lastPos.y) this.lastStepAt = now;
    this.lastPos = { x: this.mover.x, y: this.mover.y };
    const walking = outside && now - this.lastStepAt < WALK_LINGER_MS;
    const selfLook = walking ? self.moving : self.normal;
    if (self.look !== selfLook) self.look = selfLook;

    const ambient = [...(this.ambient?.objects() ?? []), ...(this.arena?.objects() ?? []), ...(this.critters?.objects() ?? []), ...(this.pets?.objects() ?? [])];
    this.animate([...world.objects.values(), ...ambient], dt);
    const lighting = world.lighting;
    // Enhanced Lighting (the Bind Editor's Options), or the original's
    const enhanced = this.settings.enhanced;
    // Its moods: the sun, the light's tint, haze and grading (mood.ts)
    const mood = enhanced ? this.applyMood(room, now, dt) : this.noMood();
    this.applySurfaceEffects(now, dt, mood);
    this.updateRoomLooks(now, dt, enhanced);
    const ctx = {
      room,
      roomFlags: world.player?.roomFlags ?? 0,
      overrideDepths: this.mover.overrideDepths,
      ambient: this.ambientShown,
      viewerLight: remote && rv & REMOTE_VIEW.VALID_LIGHT ? remote.view.light : lighting.playerLight,
      viewer,
      yaw: viewYaw,
      fog: this.fog,
      dt,
      flicker: enhanced,
      timeMs: now,
      mood: mood ? this.spriteMood(mood) : undefined,
    };
    // The arena's spell walls animate themselves (ArenaView.update)
    const shots = this.projectileViews();
    const drawn = [...world.objects.values(), ...ambient, ...(this.arena?.fields() ?? []), ...shots];
    // Dynamic Lighting off: no light maps from torches and lamps, nor the targeting light
    this.lights = this.settings.dynamicLighting ? this.objects.lights(drawn, ctx) : [];
    const targeted = this.target !== null && this.target !== self.id ? world.objects.get(this.target) : undefined;
    // Ours (the spell revamp, phase 9): spells' passing lights, ahead of the room's own
    if (this.spellFx) this.spellFx.group.visible = enhanced;
    if (enhanced && this.spellFx) {
      this.updateSpellFx(dt, shots);
      if (this.settings.dynamicLighting) this.spellFx.addLights(this.lights);
    }
    this.updateRangeRings(dt, room, enhanced);
    // The targeting light first, so it's never past the 32 the shader takes
    if (targeted && this.settings.dynamicLighting && this.settings.targetLight && targeted.info.drawingType !== DRAWFX.INVISIBLE)
      this.lights.unshift(this.objects.targetLight(targeted, ctx));
    this.roomView.setSmoothTextures(true);
    this.roomView.setEnhanced({ softLights: enhanced, lightsStopAtWalls: enhanced, shadedCorners: enhanced });
    this.objects.shadowsOn = enhanced;
    this.roomView.setLights(this.lights);
    this.roomView.setLighting({
      viewerLight: lighting.playerLight,
      ambient: this.ambientShown,
      sunAngle: lighting.sunAngle,
      shade: lighting.shadeIntensity,
      fog: this.fog,
    });
    this.roomView.update(now);
    // Outside, our own sprite is drawn too (but not our name over it)
    const labels = this.objects.update(drawn, ctx, this.lights, outside ? -1 : self.id).filter((l) => l.id !== self.id);
    this.sky?.position.copy(this.camera.position);
    this.camera.updateMatrixWorld();
    // drawbsp.c doDrawBackground: no sun or moon when blind
    this.skyOverlays?.update(
      [...world.bgOverlays.values()].map((b) => {
        // With a mood, the sun moves smoothly between the server's hours, where its light comes from (sunPath.ts)
        const smooth = mood && this.session.resource(b.info.iconRes)?.toLowerCase() === "sun.bgf" ? sunAt(mood.hour) : null;
        // (a negative height is below the horizon: drawn as Kod's are, a WORD past 32767)
        const at = smooth ? { angle: smooth.angle, height: smooth.height < 0 ? 0xffff : Math.round(smooth.height) } : b.info;
        return { id: b.info.id, bgf: this.bgf(b.info.iconRes), group: b.look.anim.group, angle: at.angle, height: at.height };
      }),
      this.camera,
      !world.effects.blind,
    );
    this.updateHover();
    this.objects.setTarget(this.target);
    this.updateWeather(dt, room);
    this.updateFlyers(dt, room);
    this.updateNature(dt, room);
    this.updateGroundCover(dt, room);
    this.updateStorm(dt, room);
    this.updateAmbientSounds(dt);
    // Enhanced's glow and vignette draw through PostFx; without them, straight to the screen
    const flash = Math.max(this.lightning?.flash ?? 0, 0.8 * (this.spellFx?.roomFlash ?? 0));
    // (the room enchantments' looks over the mood's grade, Heat's shimmer)
    const grade = mood ? this.roomLooks.grade(mood.grade) : null;
    const post: PostFxOptions =
      mood && grade
        ? {
            bloom: mood.mood.bloom,
            vignette: mood.mood.vignette,
            grade: { ...grade, exposure: grade.exposure * (1 + LIGHTNING_EXPOSURE * flash) },
            shimmer: this.roomLooks.weight("heat"),
            timeS: (now / 1000) % 3600,
          }
        : { bloom: enhanced ? GLOW_STRENGTH : 0, vignette: enhanced ? VIGNETTE : 0 };
    // (ours, V6: invisible figures shimmer, drawn from the view behind them just after it)
    const invisible = () => this.objects?.drawInvisible(this.renderer, this.scene, this.camera);
    if (postFxActive(post))
      (this.postFx ??= new PostFx()).render(
        this.renderer, this.scene, this.camera, post,
        [this.sky, this.skyOverlays?.group, this.weather?.group, this.flyers?.group, this.objects.shadows, this.puddles?.group],
        invisible,
      );
    else {
      this.renderer.render(this.scene, this.camera);
      invisible();
    }
    // Blurred vision trails as the D3D client's; wavering vision (ours, V6) waves as the software renderer's did
    if (world.effects.blur > 0) (this.blur ??= new TrailBlur()).apply(this.renderer);
    if (world.effects.waver > 0) (this.waver ??= new Waver()).apply(this.renderer, now);
    // Ours (V6): Invert turns the view's colours too, not just the hands (draw3d.c PALETTE_INVERT)
    const invert = world.effects.invert > 0 ? "invert(1)" : "";
    if (this.renderer.domElement.style.filter !== invert) this.renderer.domElement.style.filter = invert;
    this.drawLabels(labels);
    this.drawMarkers();
    this.drawSpeech();
    this.drawPetNames();
    this.drawDamage();
    this.drawOverlays(room, lighting);
    this.takeCaptures();
    this.countFrame(now);
  }

  private captures: ((c: HTMLCanvasElement) => void)[] = [];

  /**
   * Ours (the Help window's HUD picture): the 3D view as the next frame draws it, copied. The
   * WebGL canvas keeps no picture once shown, so it's copied straight after drawing. The hands are
   * a canvas of their own (screenOverlays.ts), read whenever.
   */
  captureView(): Promise<HTMLCanvasElement> {
    return new Promise((resolve) => this.captures.push(resolve));
  }

  /**
   * Ours, for scouting screenshot tours (tools/screenshots): where we stand, as a shot in their
   * manifests: the room's number (rooms.json; several rooms can share a file, so the one with the
   * room's name), its Kod square, our facing (0-4095, 0 east) and the look's pitch in degrees.
   */
  async pose(): Promise<{ rid: number | null; room: string; row: number; col: number; angle: number; pitch: number }> {
    const p = this.session.world.player;
    const file = p ? (this.session.resource(p.roomRes) ?? "").toLowerCase() : "";
    const room = p ? (this.session.resource(p.roomNameRes) ?? "") : "";
    const rooms = (await this.assets.roomList()).filter((r) => r.roo.toLowerCase() === file);
    const rid = (rooms.find((r) => r.name === room) ?? rooms[0])?.rid ?? null;
    return {
      rid,
      room,
      row: Math.floor(this.mover.y / FINENESS) + 1,
      col: Math.floor(this.mover.x / FINENESS) + 1,
      angle: this.mover.angle,
      pitch: Math.round((this.pitch * 180) / Math.PI),
    };
  }

  private takeCaptures(): void {
    if (!this.captures.length) return;
    const src = this.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    c.getContext("2d")?.drawImage(src, 0, 0);
    for (const f of this.captures.splice(0)) f(c);
  }

  /**
   * Ours (Ambient Life): the townsfolk or inn patrons of the room, if it has any. A new crowd for
   * each room; they keep clear of whatever blocks (players, monsters, NPCs) and wait for us.
   */
  private updateAmbient(dt: number): void {
    const level = this.settings.ambientLife;
    const spec = this.crowdHere();
    // An arena's show while it's open; while it's shut, its townsfolk if it has any (the Arena of Death by day)
    const config = spec?.arena ? this.arenaConfigs[this.roomFile] : undefined;
    const arenaNow = !!spec?.arena && level !== "off" && (!config || arenaOpenAt(config.open, this.gameHour()));
    this.updateArena(dt, arenaNow ? this.roomFile : null);
    if (!spec || arenaNow || !spec.count || level === "off" || !this.ambientExits || !this.loaded) {
      this.ambient = null;
      this.ambientStep = null;
      this.ambientRoom = "";
      return;
    }
    const file = this.roomFile;
    if (this.ambientRoom !== file || !this.ambientStep) {
      this.ambient = null;
      this.ambientStep = null;
      const grid = this.navGrids.get(file);
      if (grid === undefined) return this.loadNavGrid(file, this.loaded.room);
      if (grid === "loading") return;
      // The room's crowd, the same for everyone in it (our server keeps its seed and start)
      const seed = this.crowdSeed(file);
      if (seed === "pending") return;
      this.ambientRoom = file;
      const life = new AmbientLife(this.loaded.room, spec, this.ambientExits[file], seed?.seed, grid === "build" ? undefined : grid, this.waterTextures);
      this.ambientStep = new AmbientStepper(life, seed);
      for (const f of townsfolkArt()) void this.loadBgf(localRes(f));
    }
    const world = this.session.world;
    const self = world.self;
    const fx = world.effects;
    const frame: AmbientFrame = {
      player: self ? { x: self.x, y: self.y } : null,
      facing: this.mover.angle,
      scale: AMBIENT_SCALE[level],
      obstacles: [...this.blockers()],
      hour: this.gameHour(),
      weather: fx.raining ? "rain" : fx.snowing ? "snow" : null,
      impressive: !!self && isImpressiveBody(this.session.resource(self.info.iconRes) ?? ""),
    };
    // What every client gives the shared crowd alike while it catches up: nobody of ours to react
    // to, and no players in the way (the server's other objects are the same for all). After that
    // the crowd reacts to us, and each copy drifts its own way.
    const step = this.ambientStep;
    // (Obstacles as a list: a tick may read them more than once a frame)
    const neutral: AmbientFrame = { ...frame, player: null, facing: undefined, impressive: false, obstacles: [...this.blockers(true)] };
    step.advance(Date.now(), dt, frame, neutral);
    this.ambient = step.catchingUp ? null : step.life;
    if (!this.ambient) return;
    this.scatterAmbient();
    // Built here: keep it for the next visit
    if (this.navGrids.get(file) === "build" && this.ambient.nav) this.keepNavGrid(file, this.ambient.nav);
  }

  /**
   * Ours (docs/adr/0007-arena.md): the arena's fights while we're in its room (`file`; null when
   * not, or Ambient Life is off). Watched on the relay, so everyone on our server sees the same; if
   * the relay has none or doesn't answer within ARENA_WAIT_MS, a sim of our own (the defaults, this
   * season's roster) runs here instead, much the same to look at.
   */
  private updateArena(dt: number, file: string | null): void {
    if (file !== (this.arenaRoom || null)) {
      this.arenaRoom = file ?? "";
      this.arena?.clear();
      this.arena = null;
      this.arenaLocal = null;
      this.social?.watchArena(null, null);
      this.social?.arenaBusy(false);
      this.arenaBusySent = false;
      if (!file) return;
      const view = new ArenaView();
      this.arena = view;
      this.arenaFeed = "waiting";
      this.arenaWaitUntil = performance.now() + ARENA_WAIT_MS;
      for (const f of [...townsfolkArt(), ...arenaArt()]) void this.loadBgf(localRes(f));
      this.social?.watchArena(file, (m: ArenaMessage | null) => {
        if (this.arena !== view) return;
        if (!m) return this.startLocalArena(view);
        if (this.arenaFeed === "local") {
          // The relay came back: its arena from now on
          if (m.t !== "arenaState") return;
          this.arenaLocal = null;
        }
        this.arenaFeed = "relay";
        view.receive(m);
      }, this.gameHour());
    }
    const view = this.arena;
    if (!view) return;
    // The relay keeps the arena's hours by our sun (an admin's time change too)
    this.social?.arenaHour(this.gameHour());
    // A player's mock bout on our server holds the floor: the relay's fighters (or our own sim's) give way
    if (this.arenaFloorBusy !== this.arenaBusySent) {
      this.arenaBusySent = this.arenaFloorBusy;
      this.social?.arenaBusy(this.arenaFloorBusy);
      this.arenaLocal?.sim.setBusy(this.arenaFloorBusy);
    }
    if (this.arenaFeed === "waiting" && performance.now() > this.arenaWaitUntil) this.startLocalArena(view);
    const local = this.arenaLocal;
    if (local) {
      // Fixed ticks, as the relay runs them, and a message every other one
      local.due += Math.min(dt, 1000);
      while (local.due >= ARENA_TICK_MS) {
        local.due -= ARENA_TICK_MS;
        local.sim.update(ARENA_TICK_MS, this.gameHour() ?? arenaHourAt(Date.now()));
        if (++local.ticks % ARENA_SEND_EVERY === 0) view.receive(local.sim.tick());
      }
    }
    view.update(performance.now(), dt);
  }

  /** No arena from the relay: our own, on the room's nav grid once it's there */
  private startLocalArena(view: ArenaView): void {
    if (this.arenaLocal || !this.loaded) return;
    const file = this.arenaRoom;
    const grid = this.navGrids.get(file);
    if (grid === undefined) return void this.loadNavGrid(file, this.loaded.room);
    if (grid === "loading") return;
    const config = this.arenaConfigs[file] ?? this.arenaConfigs["tosarena.roo"]!;
    // Its season's roster as the relay keeps it: the server's name, and the arena's own key
    const server = gameSocketUrl() + (ARENA_ROOM_DEFS[file]?.seasonKey ?? "");
    const season = seasonAt(Date.now());
    const nav = grid === "build" ? buildNavGrid(this.loaded.room, this.waterTextures) : grid;
    if (grid === "build") this.keepNavGrid(file, nav);
    const now = Date.now();
    const sim = new ArenaSim(nav, {
      config, roster: makeRoster(server, season, config), records: {}, champions: [], season, seed: hashText(`${server}|${now}`), now,
      floorArea: arenaFloorArea(file, nav),
    });
    sim.setBusy(this.arenaFloorBusy);
    this.arenaLocal = { sim, due: 0, ticks: 0 };
    this.arenaFeed = "local";
    view.receive(sim.state());
  }

  /** Someone in the room's crowd or the arena, as the inspect window shows them (null if gone) */
  describeAmbient(id: number): AmbientPersonInfo | null {
    return this.arena?.describe(id) ?? this.ambient?.describe(id) ?? null;
  }

  /** The arena as drawn (dev tools: window.shards.gameScene.arenaView), and its own sim when it runs one */
  get arenaView(): ArenaView | null {
    return this.arena;
  }

  get arenaSim(): ArenaSim | null {
    return this.arenaLocal?.sim ?? null;
  }

  /** Where the arena's fights come from now: the relay, our own sim, or neither yet */
  get arenaSource(): "waiting" | "relay" | "local" | null {
    return this.arena ? this.arenaFeed : null;
  }

  /**
   * The crowd to make in a room: the room's, as our server keeps it, the same for everyone in it
   * (docs/adr/0015-social-on-our-server.md), asked once per visit; "pending" until it answers, null
   * for one of our own (no answer)
   */
  private crowdSeed(file: string): AmbientSeed | null | "pending" {
    if (this.ambientSeed?.file !== file) {
      if (!this.social && performance.now() - this.startedAt < SOCIAL_START_WAIT_MS) return "pending";
      const entry: { file: string; seed: AmbientSeed | null | "pending" } = { file, seed: this.social ? "pending" : null };
      this.ambientSeed = entry;
      this.social?.ambientSeed(file, this.gameHour()).then(
        (s) => void (entry.seed = s),
        () => void (entry.seed = null),
      );
    }
    return this.ambientSeed.seed;
  }

  /**
   * Townsfolk run from big spells: a new projectile where it's cast and where it lands, and the
   * ground shaking (an earthquake) around us
   */
  /** We waved (UA_WAVE): someone close by in front of us waves back (ambient life) */
  waveAtAmbient(): void {
    this.ambient?.wavedAt({ x: this.mover.x, y: this.mover.y }, this.mover.angle);
  }

  private scatterAmbient(): void {
    const ambient = this.ambient;
    const world = this.session.world;
    if (!ambient) return;
    const shots = new Set<number>();
    for (const p of world.projectiles.values()) {
      shots.add(p.id);
      if (this.seenShots.has(p.id)) continue;
      ambient.scatter({ x: p.sourceX, y: p.sourceY }, SCATTER_RADIUS);
      ambient.scatter({ x: p.destX, y: p.destY }, SCATTER_RADIUS);
    }
    this.seenShots = shots;
    const shaking = world.effects.shake > 0;
    if (shaking && !this.wasShaking && world.self) ambient.scatter(world.self, SCATTER_RADIUS * 1.5);
    this.wasShaking = shaking;
  }

  /** Ours: lines the townsfolk say, over their heads (never in the chat), hidden by walls as names are */
  private drawSpeech(): void {
    const now = performance.now();
    const real: { obj: { id: number }; text: string; lift: number }[] = [];
    for (const [id, s] of this.npcSpeech) {
      if (s.until < now || !this.session.world.objects.has(id)) this.npcSpeech.delete(id);
      else {
        // Over the name label, and over a quest marker when it has one (30px glyph, bobbing, up to 1.4x)
        const o = this.session.world.objects.get(id)!;
        const marked = markerFor(o.info.minimapFlags, this.settings.questMarkers)?.glyph;
        real.push({ obj: { id }, text: s.text, lift: marked ? 88 : 26 });
      }
    }
    const said: { obj: { id: number }; text: string; lift?: number }[] = [...real, ...(this.ambient?.speech() ?? []), ...(this.arena?.speech() ?? [])];
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const eye = this.camera.position;
    const v = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let n = 0;
    for (const s of said) {
      const top = this.objects?.topOf(s.obj.id);
      if (!top) continue;
      v.copy(top).project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      dir.subVectors(top, eye);
      const d = dir.length();
      if (d > SPEECH_RANGE) continue;
      if (this.roomView) {
        this.labelRay.set(eye, dir.divideScalar(d));
        this.labelRay.far = d - LABEL_OCCLUSION_SLACK;
        if (this.labelRay.far > 0 && this.roomView.occludes(this.labelRay)) continue;
      }
      const el = this.speechPool[n] ?? this.labelsEl.appendChild(document.createElement("div"));
      if (!this.speechPool[n]) el.className = "speech-bubble";
      this.speechPool[n++] = el;
      if (el.textContent !== s.text) el.textContent = s.text;
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%) translateY(-${s.lift ?? 10}px)`;
      el.style.display = "";
    }
    for (let i = n; i < this.speechPool.length; i++) this.speechPool[i].style.display = "none";
  }

  /** The asset build's nav grid for a room, or "build" when there's none (or it's for another version of the room) */
  private loadNavGrid(file: string, room: Room): void {
    this.navGrids.set(file, "loading");
    const done = (bytes: Uint8Array | null) => {
      const grid = bytes ? decodeNavGrid(bytes, room) : null;
      this.keepNavGrid(file, grid ?? "build");
    };
    this.assets.navGrid(file).then(done, () => done(null));
  }

  /** At most a few rooms' grids are kept (a city's is a few hundred KB), the oldest dropped */
  private keepNavGrid(file: string, grid: NavGrid | "build"): void {
    this.navGrids.delete(file);
    this.navGrids.set(file, grid);
    while (this.navGrids.size > NAV_GRIDS_KEPT) this.navGrids.delete(this.navGrids.keys().next().value!);
  }

  /**
   * Ours: the room's critters, by its terrain (roomterrain.json): a new lot for each room, under
   * the Ambient Life setting and the Critters option
   */
  private updateCritters(dt: number): void {
    const level = this.settings.ambientLife;
    const habitat = (this.roomTerrain || this.testTerrain) && this.loaded ? habitatOf(this.roomFile, this.terrainHere()) : null;
    if (!habitat || !this.loaded || level === "off" || !this.settings.critters) {
      this.critters = null;
      this.critterRoom = "";
      return;
    }
    if (this.critterRoom !== this.roomFile || !this.critters) {
      this.critterRoom = this.roomFile;
      this.critters = new Critters(this.loaded.room, habitat, undefined, this.waterTextures);
      for (const f of critterArt(habitat)) void this.loadBgf(localRes(f));
    }
    const self = this.session.world.self;
    this.critters.update(Math.min(dt, 100), {
      player: self ? { x: self.x, y: self.y } : null, facing: this.mover.angle, scale: AMBIENT_SCALE[level], hour: this.gameHour(),
    });
  }

  /** A live critter under the cursor, not behind a wall and not far off, or null */
  /** Ours: someone of the townsfolk under the cursor, not behind a wall, or null */
  private ambientUnderCursor(): number | null {
    const life = this.ambient;
    const arena = this.arena;
    const self = this.session.world.self;
    if ((!life && !arena) || !this.objects || !this.cursorRay()) return null;
    for (const h of this.objects.pickAll(this.raycaster, self?.id)) {
      if (!life?.has(h.id) && !arena?.has(h.id)) continue;
      if (this.roomView) {
        this.raycaster.far = h.distance - LABEL_OCCLUSION_SLACK;
        const hidden = this.raycaster.far > 0 && this.roomView.occludes(this.raycaster);
        this.raycaster.far = 40;
        if (hidden) continue;
      }
      return h.id;
    }
    return null;
  }

  private critterUnderCursor(): number | null {
    const critters = this.critters;
    const self = this.session.world.self;
    if (!critters || !self || !this.objects || !this.cursorRay()) return null;
    for (const h of this.objects.pickAll(this.raycaster, self.id)) {
      if (!critters.has(h.id)) continue;
      const o = critters.objects().find((c) => c.id === h.id)!;
      if (Math.hypot(o.x - self.x, o.y - self.y) > SQUISH_RANGE) continue;
      if (this.roomView) {
        this.raycaster.far = h.distance - LABEL_OCCLUSION_SLACK;
        const hidden = this.raycaster.far > 0 && this.roomView.occludes(this.raycaster);
        this.raycaster.far = 40;
        if (hidden) continue;
      }
      return h.id;
    }
    return null;
  }

  /** A critter killed: its death sound where it was (it leaves its corpse a while) */
  private squish(id: number): void {
    const dead = this.critters?.squish(id);
    // Quieter than a real monster's death: it's only a critter
    if (dead) this.audio.playAt(dead.sound, dead.x, dead.y, CRITTER_DEATH_VOLUME);
  }

  /** Attacking with nothing real to hit: the nearest critter in reach, ahead of us */
  private squishAhead(): void {
    const self = this.session.world.self;
    const c = self ? this.critters?.nearest({ x: self.x, y: self.y }, CRITTER_REACH) : null;
    if (!c || !self) return;
    const toward = Math.round((Math.atan2(c.y - self.y, c.x - self.x) * 4096) / (2 * Math.PI));
    const off = Math.abs(((toward - this.mover.angle + 6144) % 4096) - 2048);
    if (off < 700) this.squish(c.id);
  }

  /** Dev tools: the game hour ambient life goes by instead of the sun's (null: the sun's) */
  ambientHour: number | null = null;

  /** The game hour, from where the server puts the sun (hourFromSun), or null before it's sent */
  private gameHour(): number | null {
    if (this.ambientHour !== null) return this.ambientHour;
    const sun = this.skyBody("sun.bgf");
    return sun ? hourFromSun(sun.angle) : null;
  }

  /** The sun's or the moon's background overlay (by its art), if the server has sent it */
  private skyBody(art: string): { angle: number; height: number } | null {
    for (const b of this.session.world.bgOverlays.values()) if (this.session.resource(b.info.iconRes)?.toLowerCase() === art) return b.info;
    return null;
  }

  /** Dev tools: this frame's mood (mood.ts), with Enhanced Lighting on */
  get mood(): MoodFrame | null {
    return this.moodFrame;
  }

  /** Ours, Enhanced: this frame's mood, handed to the room's shader (moodUniforms) */
  private applyMood(room: Room, now: number, dt: number): MoodFrame {
    const fx = this.session.world.effects;
    const view = this.roomView!;
    const shadows = view.sunShadows;
    const m = this.moods.frame({
      room,
      file: this.roomFile,
      terrain: this.terrainHere(),
      serverHour: this.gameHour(),
      pinnedHour: this.ambientHour,
      moon: this.skyBody("moon.bgf"),
      raining: this.settings.weather && fx.raining,
      snowing: this.settings.weather && fx.snowing,
      sunMapReady: !!shadows,
      nowMs: now,
      dtMs: dt,
    });
    view.setSunHour(m.hour);
    const u = moodUniforms;
    u.uMoodOn.value = 1;
    u.uSunDir.value = m.sunDir;
    u.uSunColor.value = [...m.sunColor];
    u.uAmbientColor.value = [...m.ambientColor];
    u.uAmbientScale.value = m.mood.ambientScale;
    u.uFogColor.value = [...m.mood.fogColor];
    u.uHazeColor.value = [...m.mood.hazeColor];
    u.uHaze.value = [m.hazeDensity, m.mood.hazeStart, HAZE_MAX];
    u.uFlameScale.value = m.mood.flameScale;
    u.uSunMap.value = shadows?.texture ?? null;
    if (shadows) u.uSunRect.value = shadows.rect;
    u.uSunMix.value = m.hour - Math.floor(m.hour);
    u.uSunShadow.value = shadows ? m.shadow : 0;
    this.moodFrame = m;
    return m;
  }

  /** The season this room shows (0 spring .. 3 winter), or null: none here, or the option off */
  private seasonHere(): number | null {
    if (!this.settings.seasons || !hasSeasons(this.roomFile, this.terrainHere())) return null;
    return this.seasonPin ?? this.session.world.season?.season ?? null;
  }

  /**
   * Ours (docs/adr/0018-seasons-water-windows.md): the seasons, the snow on the ground, Enhanced
   * Water and the windows' glow, handed to the room's shader (surfaceEffects.ts effectUniforms)
   */
  private applySurfaceEffects(now: number, dt: number, mood: MoodFrame | null): void {
    const u = effectUniforms;
    const world = this.session.world;
    u.uTime.value = (now / 1000) % 3600;
    const season = this.seasonHere();
    u.uSeasonOn.value = season === null ? 0 : 1;
    u.uSeason.value = season ?? 1;
    u.uSeasonStrength.value = renderTune("seasonStrength");
    // Snow lies while it snows here under the sky, and melts after
    const snowing = this.settings.seasons && this.settings.weather && world.effects.snowing && this.roomHasSky;
    const build = renderTune("snowBuildS") * 1000,
      melt = renderTune("snowMeltS") * 1000;
    this.snowCover = Math.max(0, Math.min(1, this.snowCover + (snowing ? dt / build : -dt / melt)));
    u.uSnow.value = this.settings.seasons ? this.snowCover : 0;
    // Enhanced Water: the sky it shows (the mood's haze, or a plain one by the room's light), the sun's glint
    u.uWaterOn.value = this.settings.enhancedWater ? 1 : 0;
    u.uWaterTune.value = [renderTune("waterReflect"), renderTune("waterWaves"), renderTune("waterWobble")];
    if (mood) {
      // The sky low over the water: the haze, a little bluer and darker
      const h = mood.mood.hazeColor;
      u.uWaterSky.value = [h[0] * 0.7, h[1] * 0.78, h[2] * 0.9];
      u.uWaterGlint.value = [mood.sunColor[0] * 1.6, mood.sunColor[1] * 1.6, mood.sunColor[2] * 1.6];
      u.uWaterSunDir.value = mood.sunDir;
    } else {
      const k = this.ambientShown / 255;
      u.uWaterSky.value = [0.5 * k, 0.56 * k, 0.62 * k];
      u.uWaterGlint.value = [0, 0, 0];
    }
    // The windows' glass, by the mood (Enhanced Lighting)
    u.uWindowGlow.value = mood ? mood.mood.windowGlow * renderTune("moodWindows") : 0;
    u.uWindowDaylight.value = mood ? mood.mood.windowDaylight * renderTune("moodWindows") : 0;
  }

  /** Enhanced off: the original's lighting, no mood */
  private noMood(): null {
    moodUniforms.uMoodOn.value = 0;
    this.roomView?.setSunHour(null);
    this.moodFrame = null;
    return null;
  }

  /** What the mood does to figures (objectsView.ts) */
  private spriteMood(m: MoodFrame): SpriteMood {
    return {
      ambientColor: m.ambientColor,
      ambientScale: m.mood.ambientScale,
      sunDir: m.sunDir,
      sunColor: m.sunColor,
      sunlitAt: (x, y) => this.roomView?.sunlitAt(x, y) ?? 1,
      shadow: moodUniforms.uSunShadow.value,
    };
  }

  /**
   * Ours, the moods: a brightness from objectBrightness (the ground's, the hands') tinted, and
   * under open sky the sun on it; `facing` is how much of the sun it takes.
   */
  private moodLit(rgb: [number, number, number], room: Room, x: number, y: number, facing: number): [number, number, number] {
    const m = this.moodFrame;
    if (!m) return rgb;
    const leaf = leafAt(room, x, y);
    const sky = !!leaf?.sector && room.sectors[leaf.sector - 1].ceilingType === 0;
    const s = sky ? m.mood.ambientScale : 1;
    const out: [number, number, number] = [rgb[0] * m.ambientColor[0] * s, rgb[1] * m.ambientColor[1] * s, rgb[2] * m.ambientColor[2] * s];
    if (!sky || m.sunDir[2] <= 0) return out;
    const k = facing * (1 - m.shadow * (1 - (this.roomView?.sunlitAt(x, y) ?? 1)));
    return [out[0] + m.sunColor[0] * k, out[1] + m.sunColor[1] * k, out[2] + m.sunColor[2] * k];
  }

  /** Room objects that block movement (move.c MoveObjectAllowed's MOVEON_NO), but us */
  /** Real objects in the way; `noPlayers`: none of the players (they differ from client to client) */
  private *blockers(noPlayers = false): Generator<NavPoint> {
    const world = this.session.world;
    for (const o of world.objects.values())
      if (o.id !== world.self?.id && o.info.moveOnType === MOVEON.NO && !(noPlayers && o.info.flags & OF.PLAYER)) yield o;
  }

  /** Ours: the ambient sounds (dev tools: window.shards.gameScene.ambientSounds.audition("thunder")) */
  get ambientSoundBoard(): AmbientSounds {
    return (this.ambientSounds ??= new AmbientSounds(this.audio));
  }

  /** The room's ambient life (dev tools: window.shards.gameScene.ambientLife) */
  get ambientLife(): AmbientLife | null {
    return this.ambient;
  }

  /**
   * Ours (Birds and Bats, under Ambient Life): flocks crossing the sky by day where the room has
   * any, a few bats under the sky at night, and bats in caves, mines and lairs at any hour
   */
  private updateFlyers(dt: number, room: Room): void {
    const flyers = this.flyers;
    const self = this.session.world.self;
    if (!flyers || !self) return;
    const level = this.settings.ambientLife;
    flyers.group.visible = !this.session.world.effects.blind;
    if (this.flyersRoom !== this.roomFile) {
      this.flyersRoom = this.roomFile;
      this.roomHasSky = room.sectors.some((s) => s.ceilingType === 0);
      flyers.clear();
    }
    const scale = this.settings.flyers ? AMBIENT_SCALE[level] : 0;
    // Bats only in caves, dungeons, crypts and Brax, and prisons (batsOf): under the roof always,
    // under the sky (Brax's graveyard and ruins) at night
    const bats = batsOf(this.roomFile, this.terrainHere());
    const cave = bats === "covered" || (bats === "necropolis" && !this.roomHasSky);
    const hour = this.gameHour();
    const night = hour !== null && (hour >= 20 || hour < 5);
    const sky = this.roomHasSky && !cave;
    const opts = {
      flocks: sky && !night ? Math.round(sceneTune("flocks") * scale) : 0,
      bats: cave ? Math.round(sceneTune("batsCave") * scale) : bats && night ? Math.round(sceneTune("batsNight") * scale) : 0,
      cave,
    };
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    flyers.setProjection(buffer.y, this.camera.fov);
    // The bats take the light where we stand
    flyers.setLight(this.lightHere(room));
    const floor = this.mover.floorBase(this.mover.x, this.mover.y) ?? this.mover.z;
    flyers.update(dt, { x: this.mover.x, y: this.mover.y, z: floor }, this.mover.angle, this.particleRoom(room), opts);
  }

  /**
   * Ours (Nature, under Ambient Life), by the room's terrain and the hour: butterflies over green
   * country by day (not in the rain), fireflies there and by water at night, leaves falling in
   * forests, and fish leaping wherever there's open water
   */
  private updateNature(dt: number, room: Room): void {
    const nature = this.nature;
    const self = this.session.world.self;
    if (!nature || !self) return;
    const world = this.session.world;
    nature.group.visible = !world.effects.blind;
    const at = this.natureRoom === this.roomFile ? this.natureAt! : (this.natureAt = this.natureQueries(room));
    if (this.natureRoom !== this.roomFile) {
      this.natureRoom = this.roomFile;
      nature.setRoom(at, room.thingsBox);
    }
    const scale = this.settings.nature ? AMBIENT_SCALE[this.settings.ambientLife] : 0;
    const t = this.terrainHere() ?? [];
    const has = (...names: string[]) => names.some((n) => t.includes(n));
    const green = has("FOREST", "FIELDS", "HILLS", "JUNGLE");
    // Ours (Seasons): leaves turn in fall, butterflies and fireflies thin out toward winter
    const season = this.seasonHere();
    nature.setSeason(season);
    const bySeason = (k: keyof typeof SEASON_NATURE) => (season === null ? 1 : SEASON_NATURE[k][season]);
    const hour = this.gameHour();
    const day = hour === null || (hour >= 7 && hour < 19);
    const night = hour !== null && (hour >= 20 || hour < 5);
    const opts = {
      butterflies: green && day && !world.effects.raining ? Math.round(sceneTune("butterflies") * scale * bySeason("butterflies")) : 0,
      fireflies: night && (green || has("SWAMP", "LAKE", "RIVER")) ? Math.round(sceneTune("fireflies") * scale * bySeason("fireflies")) : 0,
      leaves: has("FOREST", "JUNGLE") ? Math.round(sceneTune("leaves") * scale * bySeason("leaves")) : 0,
      fish: scale > 0 && !has("SEWERS", "CAVES", "MINES"),
    };
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    nature.setProjection(buffer.y, this.camera.fov);
    nature.setLight(this.lightHere(room));
    const floor = this.mover.floorBase(this.mover.x, this.mover.y) ?? this.mover.z;
    nature.update(dt, { x: this.mover.x, y: this.mover.y, z: floor }, this.mover.angle, at, opts);
  }

  private natureAt: NatureRoom | null = null;

  /**
   * Ours (Ground Detail, its own option): grass and flowers on grassy floors, dry tufts and
   * pebbles on earth, pebbles and stones on rock, under open sky (and in caves), by the floor
   * texture (floortextures.json)
   */
  private updateGroundCover(dt: number, room: Room): void {
    const cover = this.groundCover;
    const self = this.session.world.self;
    if (!cover || !self) return;
    cover.group.visible = !this.session.world.effects.blind;
    if (!this.settings.groundDetail || !this.floorTextures.size) {
      cover.clear();
      return;
    }
    if (this.groundRoom !== this.roomFile) {
      this.groundRoom = this.roomFile;
      cover.setRoom(this.roomFile, this.groundQueries(room));
    }
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    cover.setProjection(buffer.y, this.camera.fov);
    cover.setFog(this.fog);
    // Ours (Seasons): the tufts take the season, and the snow
    cover.setSeason(this.seasonHere(), this.settings.seasons ? this.snowCover : 0);
    cover.update(dt, { x: this.mover.x, y: this.mover.y });
  }

  /**
   * Ground Detail's rocks: the game's rock ornaments (ornobj.kod, boulder.kod, mollusk.kod), each
   * for the ground it suits
   */
  private async loadRocks(palette: Uint8Array): Promise<void> {
    const rocks: [string, GroundKind[]][] = [
      ["rocksm.bgf", ["grass", "earth"]],
      ["rockla.bgf", ["grass", "rocky"]],
      ["boulder.bgf", ["grass"]],
      ["rockb.bgf", ["earth", "rocky"]],
      ["molrock.bgf", ["earth"]],
      ["rockc.bgf", ["earth", "rocky"]],
      ["rock.bgf", ["rocky"]],
      ["rock2.bgf", ["rocky"]],
    ];
    const art: RockArt[] = [];
    for (const [name, kinds] of rocks) {
      if (!this.assets.has(name)) continue;
      const bgf = await this.assets.bgf(name).catch(() => null);
      const bmp = bgf?.bitmaps[bgf.groups[0]?.[0] ?? 0];
      if (bgf && bmp) art.push({ pixels: bmp.pixels, width: bmp.width, height: bmp.height, shrink: bgf.shrink, kinds });
    }
    if (!this.disposed) this.groundCover?.setRockArt(art, palette);
  }

  /**
   * Ours, with the weather (the Weather option): puddles spread on open ground as the rain goes
   * on and dry up after it; lightning strikes far off while it rains under open sky, lighting the
   * sky and the view
   */
  private updateStorm(dt: number, room: Room): void {
    const fx = this.session.world.effects;
    const on = this.settings.weather && !fx.blind;
    const raining = on && fx.raining;
    this.wetness = Math.max(0, Math.min(1, this.wetness + (raining ? dt / (sceneTune("wetUpS") * 1000) : -dt / (sceneTune("wetDownS") * 1000))));
    const puddles = this.puddles;
    if (puddles) {
      if (this.puddleRoom !== this.roomFile) {
        this.puddleRoom = this.roomFile;
        puddles.setRoom(this.roomFile, this.puddleQueries(room));
      }
      puddles.update(dt, { x: this.mover.x, y: this.mover.y }, on ? this.wetness : 0, raining);
    }
    const bolt = this.lightning;
    if (!bolt) return;
    bolt.update(dt, raining && this.roomHasSky, this.camera.position);
    const f = bolt.flash;
    // A storm's sky is darker, but for the lightning
    this.overcast += ((raining ? 1 : 0) - this.overcast) * Math.min(1, dt / 8000);
    const sky = 1 - OVERCAST * this.overcast + 1.6 * f;
    // A mood tints the sky and darkens it in a storm itself (moods.ts STORM_OVERLAYS)
    const m = this.moodFrame?.mood;
    this.sky?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const color = (o.material as THREE.MeshBasicMaterial).color;
      if (m) color.setRGB(...(m.skyTint.map((c) => c * m.skyBrightness * (1 + 1.6 * f)) as [number, number, number]));
      else color.setScalar(sky);
    });
    if (this.flashEl) this.flashEl.style.opacity = f ? (f * LIGHTNING_FLASH).toFixed(3) : "0";
  }

  /**
   * Ours (Ambient Sounds): what the ambient life and the weather did this frame, for
   * ambientSounds.ts to play. The events are taken every frame whether heard or not.
   */
  private updateAmbientSounds(dt: number): void {
    const events = this.ambient?.takeEvents() ?? [];
    const arenaEvents = [...(this.arena?.takeEvents() ?? []), ...this.boutCheers.splice(0)];
    const strike = this.lightning?.takeStrike() ?? null;
    const splashes = this.nature?.takeSplashes() ?? [];
    const sounds = (this.ambientSounds ??= new AmbientSounds(this.audio));
    const me = { x: this.mover.x, y: this.mover.y, z: this.mover.z + EYE_HEIGHT };
    const moved = this.soundAt ? Math.hypot(me.x - this.soundAt.x, me.y - this.soundAt.y) : 0;
    this.soundAt = { x: me.x, y: me.y };
    const near = HEARING * HEARING;
    const people = [...(this.ambient?.objects() ?? []), ...(this.arena?.objects() ?? [])].filter((o) => (o.x - me.x) ** 2 + (o.y - me.y) ** 2 < near).length;
    const life = this.settings.ambientLife !== "off";
    sounds.update({
      dt,
      listener: { x: me.x, y: me.y, angle: this.mover.angle },
      room: this.roomFile,
      // The historic towns' ghosts are silent: no chatter under them
      kind: life && !this.crowdHere()?.ghost ? (this.crowdHere()?.kind ?? null) : null,
      indoors: this.underRoof(me.x, me.y),
      populated: this.crowdHere() !== undefined || (this.terrainHere() ?? []).some((n) => SETTLED.has(n)),
      hour: this.gameHour(),
      people,
      raining: this.session.world.effects.raining,
      events,
      arenaEvents,
      strike,
      splashes,
      critterVoice: () => this.critters?.voice(me, CRITTER_VOICE_RANGE) ?? null,
      petVoice: () => this.petVoice(me),
      wetUnderfoot: this.puddles?.wetAt(me.x, me.y) ?? false,
      speed: dt > 0 && moved < FINENESS ? moved / dt : 0,
    });
  }

  /** Whether there's a ceiling over a point (not the sky), so sounds there are indoors */
  private underRoof(x: number, y: number): boolean {
    const room = this.room;
    const leaf = room ? leafAt(room, x, y) : null;
    return !!room && !!leaf?.sector && room.sectors[leaf.sector - 1].ceilingType !== 0;
  }

  /** Open ground under the sky, as Puddles asks about it: paving, earth or grass (floortextures.json) */
  private puddleQueries(room: Room): PuddleRoom {
    const ground = this.groundQueries(room);
    return {
      spot: (x, y) => {
        const leaf = leafAt(room, x, y);
        const s = leaf?.sector ? room.sectors[leaf.sector - 1] : null;
        if (!s || s.ceilingType !== 0 || s.flags & SF.DEPTH_MASK || this.waterTextures.has(s.floorType)) return null;
        const kind = this.floorTextures.get(s.floorType)?.kind;
        return { floor: floorHeightAt(s, x, y), ground: kind === "grass" ? "grass" : kind === "earth" ? "earth" : "paved" };
      },
      // Open water for the rain's rings, as the fish find it (natureQueries)
      water: (x, y) => {
        const leaf = leafAt(room, x, y);
        const s = leaf?.sector ? room.sectors[leaf.sector - 1] : null;
        return s && this.waterTextures.has(s.floorType) && s.ceilingType === 0 ? floorHeightAt(s, x, y) : null;
      },
      light: ground.light,
    };
  }

  /** The ground as GroundCover asks about it */
  private groundQueries(room: Room): GroundRoom {
    const t = this.terrainHere() ?? [];
    const cave = t.some((n) => n === "CAVES" || n === "MINES" || n === "LAIR");
    // No rocks in towns, castles and the like: by the room's terrain, or as ambient life knows it
    // (the castles' rooms mostly have no terrain)
    const town = t.some((n) => SETTLED.has(n)) || this.crowdHere() !== undefined;
    // Beaches have fewer rocks (2026-10-18 play test: half)
    const rocks = t.includes("BEACH") ? renderTune("beachRocks") : 1;
    return {
      spot: (x, y) => {
        const leaf = leafAt(room, x, y);
        const s = leaf?.sector ? room.sectors[leaf.sector - 1] : null;
        if (!s || s.flags & SF.DEPTH_MASK || this.waterTextures.has(s.floorType)) return null;
        // Under the sky, or anywhere in a cave
        if (s.ceilingType !== 0 && !cave) return null;
        const f = this.floorTextures.get(s.floorType);
        // Cobbles (a road) get nothing strewn on them, but in a cave
        return f ? { floor: floorHeightAt(s, x, y), kind: f.kind, color: f.color, town, bare: f.cobbled && !cave, rocks } : null;
      },
      light: (x, y, z) => {
        const leaf = leafAt(room, x, y);
        const sectorLight = leaf?.sector ? room.sectors[leaf.sector - 1].light : 0;
        const lighting = this.session.world.lighting;
        const [r, g, b] = objectBrightness({ x, y, z }, sectorLight, lighting.playerLight, this.ambientShown, []);
        // The ground faces up: it takes the sun by its height (the moods)
        return this.moodLit([r, g, b], room, x, y, Math.max(0, this.moodFrame?.sunDir[2] ?? 0));
      },
      // The floor's distance fog, so the tufts fade with it
      fogEnd: (x, y) => {
        const leaf = leafAt(room, x, y);
        const lighting = this.session.world.lighting;
        return fogEnd(leaf?.sector ? room.sectors[leaf.sector - 1].light : 0, lighting.playerLight, this.ambientShown);
      },
    };
  }

  /** The room as Nature asks about it: floors, roofs, and open water (a sector with depth, no ceiling) */
  private natureQueries(room: Room): NatureRoom {
    const p = this.particleRoom(room);
    return {
      floor: p.floor,
      roofed: p.roofed,
      water: (x, y) => {
        const leaf = leafAt(room, x, y);
        const s = leaf?.sector ? room.sectors[leaf.sector - 1] : null;
        // A floor with a water texture (watertextures.json: rivers, the sea, Raza's pool painted on a
        // dry floor). Not every sector with depth: the wheat fields and wet sand (the beach at
        // Barloque's main gate, i3) have one, and fish leapt from them
        return s && this.waterTextures.has(s.floorType) && s.ceilingType === 0 ? floorHeightAt(s, x, y) : null;
      },
    };
  }

  /** How light it is where we stand, 0..1 (D3DObjectLightingCalc, as for the hands) */
  private lightHere(room: Room): number {
    const lighting = this.session.world.lighting;
    const leaf = leafAt(room, this.mover.x, this.mover.y);
    const sectorLight = leaf?.sector ? room.sectors[leaf.sector - 1].light : 0;
    const lit = objectBrightness({ x: this.mover.x, y: this.mover.y, z: this.mover.z }, sectorLight, lighting.playerLight, this.ambientShown, this.lights);
    const [r, g, b] = this.moodLit(lit, room, this.mover.x, this.mover.y, HANDS_SUN);
    return Math.min(1, Math.max(r, g, b));
  }

  /** The room under particles and flyers (client3d.c GetPointFloor and friends) */
  private particleRoom(room: Room): ParticleRoom {
    return {
      floor: (x, y) => {
        const leaf = leafAt(room, x, y);
        return leaf?.sector ? floorHeightAt(room.sectors[leaf.sector - 1], x, y) : -1;
      },
      ceiling: (x, y) => {
        const leaf = leafAt(room, x, y);
        return leaf?.sector ? ceilingHeightAt(room.sectors[leaf.sector - 1], x, y) : -1;
      },
      roofed: (x, y) => {
        const leaf = leafAt(room, x, y);
        return !!leaf?.sector && room.sectors[leaf.sector - 1].ceilingType !== 0;
      },
    };
  }

  /** d3drender.c PARTICLES: weather follows the viewer; nothing is drawn while blind */
  private updateWeather(dt: number, room: Room): void {
    const weather = this.weather;
    if (!weather) return;
    const fx = this.session.world.effects;
    weather.group.visible = !fx.blind;
    if (fx.blind) return;
    this.particleTime += dt;
    const steps = Math.min(10, Math.floor((this.particleTime * PARTICLE_STEPS_PER_SECOND) / 1000));
    this.particleTime = steps === 10 ? 0 : this.particleTime - (steps * 1000) / PARTICLE_STEPS_PER_SECOND;
    weather.setDensity(this.settings.particleDensity);
    weather.setFov(this.camera.fov);
    const at = this.particleRoom(room);
    const weatherOn = this.settings.weather;
    weather.update(
      { x: this.mover.x, y: this.mover.y, z: this.mover.z + EYE_HEIGHT },
      // (ours, V4: Freezing's flakes and Winds' streaks, with Enhanced Visuals)
      { sand: fx.sand, wind: this.lookKinds.has("winds"), rain: fx.raining && weatherOn, snow: (fx.snowing && weatherOn) || this.lookKinds.has("freezing"), fireworks: fx.fireworks },
      steps,
      at,
    );
  }

  /** ui/weather_snow.png from the asset build (d3dparticle.c), or null to draw snow as lines */
  private async snowTexture(): Promise<THREE.Texture | null> {
    if (!this.assets.has("ui/weather_snow.png")) return null;
    try {
      const bytes = await this.assets.fetchBytes("ui/weather_snow.png");
      const image = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      // The flakes are drawn white (SNOW_R/G/B 255), so keep only the alpha: the black of the
      // transparent texels would otherwise darken them as they shrink with distance (mipmaps)
      const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
      for (let i = 0; i < rgba.length; i += 4) rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
      const tex = new THREE.DataTexture(new Uint8Array(rgba.buffer), image.width, image.height, THREE.RGBAFormat);
      tex.colorSpace = THREE.NoColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      return tex;
    } catch {
      return null;
    }
  }

  /** Show FPS (config.showFPS): frames over the last half second. */
  private countFrame(now: number): void {
    if (!this.settings.showFps) return;
    this.fpsFrames++;
    if (now - this.fpsSince < 500) return;
    this.onFps?.(Math.round((this.fpsFrames * 1000) / (now - this.fpsSince)));
    this.fpsFrames = 0;
    this.fpsSince = now;
  }

  /** The Preferences that change how objects are drawn. */
  private applyViewSettings(): void {
    if (!this.objects) return;
    const s = this.settings;
    this.objects.haloColor = HALO_COLOR[s.haloColor];
    this.objects.names = { players: s.drawPlayerNames, npcs: s.drawNpcNames, signs: s.drawSignNames };
  }

  private mods(): Mods {
    return { alt: this.altDown, ctrl: this.ctrlDown };
  }

  /** The player's light for the hand overlays (D3DObjectLightingCalc on the player). */
  private drawOverlays(room: Room, lighting: { ambient: number; playerLight: number }): void {
    const world = this.session.world;
    const self = world.self;
    if (!this.overlays || !self) return;
    const leaf = leafAt(room, this.mover.x, this.mover.y);
    const sectorLight = leaf?.sector ? room.sectors[leaf.sector - 1].light : 0;
    const dt = self.info.drawingType;
    const light: [number, number, number] =
      dt === DRAWFX.BLACK
        ? [0, 0, 0]
        : this.moodLit(objectBrightness({ x: this.mover.x, y: this.mover.y, z: this.mover.z }, sectorLight, lighting.playerLight, this.ambientShown, this.lights), room, this.mover.x, this.mover.y, HANDS_SUN);
    const alpha = dt === DRAWFX.TRANSLUCENT25 ? 0.25 : dt === DRAWFX.TRANSLUCENT75 ? 0.75 : dt === DRAWFX.TRANSLUCENT50 || dt === DRAWFX.DITHERTRANS || dt === DRAWFX.DITHERINVIS || dt === DRAWFX.DITHERGREY ? 0.5 : dt === DRAWFX.INVISIBLE ? 0.2 : 1;
    // Show your pain (config.pain) off: no red flash when hurt
    const effects = this.settings.pain ? world.effects : { ...world.effects, pain: 0 };
    // The outside views show our sprite holding them, not the first-person hands
    const hands = this.viewMode === "first" || this.remoteView() ? world.playerOverlays : [null, null];
    // Ours (V6): an invisible player's own hands sway a little as their figure ripples (the
    // original drew them in its invisible pass), slowly: a per-frame jitter was hard to look at
    const jitter = dt === DRAWFX.INVISIBLE ? 1.5 * Math.sin(performance.now() / 600) : 0;
    this.overlays.draw(hands, effects, light, alpha, jitter);
  }

  /** BP_SET_VIEW's object, when it's in the room (game.c SetPlayerRemoteView falls back to our eyes) */
  private remoteView(): { obj: WorldObject; view: RemoteView } | null {
    const view = this.session.world.remoteView;
    const obj = view ? this.session.world.objects.get(view.id) : undefined;
    return view && obj ? { obj, view } : null;
  }

  /** Where the remote eyes are: the object's place and angle, at the height the flags ask for */
  private remoteEye({ obj, view }: { obj: WorldObject; view: RemoteView }): { x: number; y: number; z: number; angle: number } {
    const ext = this.objects?.extentOf(obj.id) ?? null;
    const base = ext?.z ?? 0;
    const height = ext?.height ?? 0;
    const room = this.room;
    const leaf = room ? leafAt(room, obj.x, obj.y) : null;
    const floor = room && leaf?.sector ? floorHeightAt(room.sectors[leaf.sector - 1], obj.x, obj.y) : 0;
    const f = view.flags;
    const z =
      f & REMOTE_VIEW.VALID_HEIGHT ? floor + view.height
      : f & REMOTE_VIEW.TOP ? base + height
      : f & REMOTE_VIEW.BOTTOM ? base
      : f & REMOTE_VIEW.MID ? base + height / 2
      : EYE_HEIGHT; // player.viewHeight = player.height
    return { x: obj.x, y: obj.y, z, angle: obj.angle };
  }

  /** Projectiles as sprites for ObjectsView: fully lit, no name. */
  /**
   * Ours (the spell revamp, phase 9): where to draw an object's effect, in fine units: its middle
   * (a hit) or its feet (a ring), or null when it isn't here. We aren't drawn in the first person,
   * so our own place comes from the mover.
   */
  private fxPoint(id: number, part: "middle" | "feet"): FinePoint | null {
    if (!id) return null;
    const world = this.session.world;
    const o = world.objects.get(id);
    if (!o) return null;
    const extent = this.objects?.extentOf(id) ?? null;
    const z = extent?.z ?? (id === world.self?.id ? this.mover.z : null);
    if (z === null || z === undefined) return null;
    const height = extent?.height ?? EYE_HEIGHT;
    return { x: o.x, y: o.y, z: part === "feet" ? z : z + height * 0.55 };
  }

  /** UC_SPELL_FX: what our server asks us to draw (@shards/world spellFx.ts) */
  private showSpellFx(fx: SpellFx): void {
    const sfx = this.spellFx;
    if (!sfx) return;
    // Hits far from us light nothing (spellEffects.ts FLASH_RANGE)
    const eye = { x: this.mover.x, y: this.mover.y, z: this.mover.z };
    switch (fx.kind) {
      case SPELL_FX.IMPACT: {
        const at = this.fxPoint(fx.target, "middle");
        if (at) sfx.impact(at, fx.color, fx.size, eye);
        break;
      }
      case SPELL_FX.DRAIN: {
        const from = this.fxPoint(fx.target, "middle");
        const to = this.fxPoint(fx.source, "middle");
        if (from && to) sfx.drain(from, to, fx.color, eye);
        else if (from) sfx.impact(from, fx.color, fx.size, eye);
        break;
      }
      case SPELL_FX.CAST: {
        // Our own cast: the hands glow (we aren't drawn in the first person); anyone else's, about them
        if (fx.source === this.session.world.self?.id && this.viewMode === "first") {
          const c = fxColor(fx.color);
          this.overlays?.castGlow(c.r, c.g, c.b);
          break;
        }
        const at = this.fxPoint(fx.source, "middle");
        if (at) sfx.cast(at, fx.color, eye);
        break;
      }
      case SPELL_FX.BUFF:
      case SPELL_FX.CURSE:
      case SPELL_FX.HEAL: {
        const feet = this.fxPoint(fx.target || fx.source, "feet");
        if (feet) sfx.pulse(feet, fx.color, fx.kind === SPELL_FX.BUFF ? "buff" : fx.kind === SPELL_FX.CURSE ? "curse" : "heal");
        break;
      }
      case SPELL_FX.ROOM_FLASH:
        sfx.flashRoom();
        break;
      case SPELL_FX.QUAKE: {
        const feet = this.fxPoint(fx.source, "feet");
        if (feet) sfx.quake(feet, fx.color);
        break;
      }
    }
  }

  /**
   * Each frame with Enhanced Visuals: projectiles leave trails in their light's colour and burst
   * where they land (they vanish on arriving: project.c), and the effects move on.
   */
  /**
   * Ours (the spell revamp, V4; Enhanced Visuals): the room enchantments' looks fade toward
   * what's on the room, Silence muffles its sounds, and the room's light fades to a change
   * (Darkness, Illuminate, the hour) instead of snapping; a new room's light snaps.
   */
  private updateRoomLooks(now: number, dt: number, enhanced: boolean): void {
    const world = this.session.world;
    const roomId = world.player?.roomId ?? -1;
    if (roomId !== this.drawnRoomId) {
      this.drawnRoomId = roomId;
      this.enteredAt = now;
    }
    this.lookKinds = enhanced ? RoomEnchantLooks.kinds([...world.enchantments.room.values()].map((o) => this.session.resource(o.iconRes))) : NO_LOOKS;
    this.roomLooks.update(this.lookKinds, dt, !enhanced);
    this.audio.setMuffle(this.roomLooks.weight("silence"));
    // (the room's light comes just after we enter it)
    const target = world.lighting.ambient;
    if (!enhanced || now - this.enteredAt < ROOM_SETTLE_MS || Math.abs(target - this.ambientShown) < 0.5) this.ambientShown = target;
    else this.ambientShown += (target - this.ambientShown) * (1 - Math.exp(-dt / AMBIENT_FADE_MS));
  }

  /**
   * Ours (the spell revamp, V5; Enhanced Visuals): our range rings, from what the server has
   * told us (world.spellRanges): the spell we point at, about us, and each song we sing, about
   * whoever it's centred on, while they're in this room. Anyone else's rings never reach us.
   */
  private updateRangeRings(dt: number, room: Room, enhanced: boolean): void {
    const rings = this.rangeRings;
    if (!rings) return;
    const world = this.session.world;
    const self = world.player?.id;
    const wanted = new Map<string, RangeRing>();
    if (enhanced && self !== undefined) {
      const at = (id: number) => (id === self ? { x: this.mover.x, y: this.mover.y } : world.objects.get(id));
      const ranges = world.spellRanges;
      const p = ranges.preview;
      if (p) wanted.set("preview", { x: this.mover.x, y: this.mover.y, radius: p.radius, inner: p.inner, color: p.color });
      for (const song of ranges.songs.values()) {
        const o = at(song.source);
        if (o) wanted.set(`song:${song.spell}`, { x: o.x, y: o.y, radius: song.radius, inner: song.inner, color: song.color });
      }
    }
    if (!wanted.size && !rings.count) return;
    rings.update(wanted, dt, (x, y) => {
      const leaf = leafAt(room, x, y);
      return leaf?.sector ? floorHeightAt(room.sectors[leaf.sector - 1], x, y) : null;
    });
  }

  private updateSpellFx(dt: number, shots: ViewObject[]): void {
    const sfx = this.spellFx;
    if (!sfx) return;
    this.renderer.getDrawingBufferSize(this.fxBuffer);
    sfx.setView(this.fxBuffer.y, this.camera.fov, this.renderer.getPixelRatio());
    // Nothing in flight and nothing to land: just move the effects on
    if (shots.length === 0 && this.fxProjectiles.size === 0) {
      if (sfx.active) sfx.update(dt);
      return;
    }
    const eye = { x: this.mover.x, y: this.mover.y, z: this.mover.z };
    const now = new Map<number, { at: FinePoint; color: number }>();
    for (const v of shots) {
      const light = v.info.light;
      if (!light || !light.flags) continue;
      // about a third of a square up: the middle of a bolt's sprite
      const at = { x: v.x, y: v.y, z: (v.z ?? 0) + FINENESS / 3 };
      now.set(v.id, { at, color: light.color });
      sfx.trail(at, light.color, dt);
    }
    for (const [id, p] of this.fxProjectiles) if (!now.has(id)) sfx.arrival(p.at, p.color, eye);
    this.fxProjectiles = now;
    sfx.update(dt);
  }

  private projectileViews(): ViewObject[] {
    const room = this.room;
    // client3d.c GetPointFloor: the floor's height there, or -1 off the map
    const floor = (x: number, y: number) => {
      const leaf = room ? leafAt(room, x, y) : null;
      return room && leaf?.sector ? floorHeightAt(room.sectors[leaf.sector - 1], x, y) : -1;
    };
    // Ours: the arena's spells (ArenaView), drawn the same way
    const shots = this.arena?.shots() ?? [];
    return [...this.session.world.projectiles.values(), ...shots].map((p) => ({
      id: p.id, x: Math.round(p.x), y: Math.round(p.y), angle: p.angle, version: 0, fullBright: true,
      // project.c: from the source's height to the target's, or along the ground (PROJ_FLAG_FOLLOWGROUND)
      z: p.flags & PROJ_FLAG_FOLLOWGROUND
        ? floor(p.x, p.y)
        : floor(p.sourceX, p.sourceY) + Math.min(1, p.progress) * (floor(p.destX, p.destY) - floor(p.sourceX, p.sourceY)),
      info: { iconRes: p.info.iconRes, nameRes: 0, flags: 0, drawingType: 0, nameColor: 0, light: p.info.light },
      look: p.look,
    }));
  }

  // ---- targeting and combat (gameuser.c) ----

  setTarget(id: number | null): void {
    if (id === this.target) return;
    this.target = id;
    this.objects?.setTarget(id);
    this.onTarget?.(id);
  }

  /** Objects on screen with a flag, nearest first (client3d.c GetObjects3D over the drawn objects). */
  private visibleObjects(flag: number, maxDistance = 0): WorldObject[] {
    const world = this.session.world;
    const self = world.self;
    if (!self || world.effects.blind) return [];
    this.camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );
    // "on screen": any part of a body-sized sphere around the object is in view
    const sphere = new THREE.Sphere(new THREE.Vector3(), 0.6);
    const out: { o: WorldObject; d: number }[] = [];
    for (const o of world.objects.values()) {
      if (o.id === self.id || (flag && !(o.info.flags & flag)) || o.info.drawingType === DRAWFX.INVISIBLE) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (maxDistance > 0 && d > maxDistance) continue;
      sphere.center.set(o.x / FINENESS, (this.mover.z + EYE_HEIGHT / 2) / FINENESS, o.y / FINENESS);
      if (!frustum.intersectsSphere(sphere)) continue;
      out.push({ o, d });
    }
    return out.sort((a, b) => a.d - b.d).map((e) => e.o);
  }

  private isVisible(id: number): boolean {
    return this.visibleObjects(0).some((o) => o.id === id);
  }

  /** gameuser.c UserTargetNextOrPrevious: cycle through attackable objects on screen. */
  private cycleTarget(next: boolean): void {
    const list = this.visibleObjects(OF_ATTACKABLE);
    if (!list.length) return this.setTarget(null);
    const i = this.target === null ? -1 : list.findIndex((o) => o.id === this.target);
    if (next) this.setTarget(list[i < 0 || i + 1 === list.length ? 0 : i + 1].id);
    else this.setTarget(list[i <= 0 ? list.length - 1 : i - 1].id);
  }

  /** gameuser.c UserAttackClosest: the target if we can see it, else the closest attackable thing. */
  attack(): void {
    // intrface.c A_ATTACK: not while seeing through another object's eyes; mermain.c: nor resting
    if (this.remoteView() || this.resting || this.session.world.effects.paralyzed) return;
    const now = performance.now();
    if (now - this.lastAttack < ATTACK_DELAY) return;
    this.lastAttack = now;
    this.mover.flush(now); // MoveUpdatePosition: attack from where we really stand
    if (this.target !== null && this.target !== this.session.world.player?.id) {
      if (this.isVisible(this.target)) this.session.attack(this.target);
      else this.onMessage?.("You can't see your selected target.");
      return;
    }
    const closest = this.visibleObjects(OF_ATTACKABLE, CLOSE_DISTANCE)[0];
    if (closest) this.session.attack(closest.id);
    // Ours: nothing real to hit, but a critter at our feet
    else this.squishAhead();
  }

  /**
   * spells.c SpellCast: a spell that needs a target goes to the selected one (if it can be
   * seen), else the user picks one (GAME_SELECT).
   */
  castSpell(spell: number, numTargets: number): void {
    if (numTargets === 0) return this.session.cast(spell, []);
    const self = this.session.world.player?.id;
    if (this.target !== null) {
      if (this.target === self || this.isVisible(this.target)) this.session.cast(spell, [{ id: this.target, amount: 1 }]);
      else this.onMessage?.("You can't see your selected target.");
      return;
    }
    this.beginSelect((id) => this.session.cast(spell, [{ id, amount: 1 }]));
  }

  /** Enter target selection (GAME_SELECT): the next object clicked is passed to `cb`. */
  beginSelect(cb: (id: number) => void): void {
    if (this.locked) document.exitPointerLock();
    this.selectCallback = cb;
    this.setCursor("target");
    this.onSelecting?.(true);
  }

  get selecting(): boolean {
    return this.selectCallback !== null;
  }

  /** Finish selection with an object (the view, our portrait or an inventory item); null cancels. */
  select(id: number | null): void {
    const cb = this.selectCallback;
    this.selectCallback = null;
    this.setCursor("");
    this.onSelecting?.(false);
    if (cb && id !== null) cb(id);
  }

  /** Step bitmap-group animations (animate.c) for the look each object shows now. */
  private animate(objects: Iterable<WorldObject>, dt: number): void {
    for (const o of objects) {
      // a group change shows up in ObjectsView's sprite key, which re-composites
      animStep(o.look.anim, this.bgf(o.info.iconRes)?.groups.length ?? 0, dt);
      for (const ov of o.look.overlays) animStep(ov.anim, this.bgf(ov.iconRes)?.groups.length ?? 0, dt);
    }
    for (const p of this.session.world.projectiles.values()) animStep(p.look.anim, this.bgf(p.info.iconRes)?.groups.length ?? 0, dt);
    // animate.c AnimationTimerProc: the background overlays animate too
    for (const b of this.session.world.bgOverlays.values()) animStep(b.look.anim, this.bgf(b.info.iconRes)?.groups.length ?? 0, dt);
    // the hands: a weapon swing is an animation on the player overlay
    for (const p of this.session.world.playerOverlays) {
      if (!p) continue;
      animStep(p.look.anim, this.bgf(p.info.iconRes)?.groups.length ?? 0, dt);
      for (const ov of p.look.overlays) animStep(ov.anim, this.bgf(ov.iconRes)?.groups.length ?? 0, dt);
    }
  }

  private get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** The object under the mouse cursor. */
  private updateHover(): void {
    if (!this.objects) return;
    let ndc: THREE.Vector2 | null = null;
    // The cursor, where it was even while a right drag has the mouse captured
    if (this.mouse) {
      const r = this.canvas.getBoundingClientRect();
      ndc = new THREE.Vector2(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1);
    }
    let id: number | null = null;
    if (ndc) {
      this.raycaster.setFromCamera(ndc, this.camera);
      this.raycaster.far = 40;
      // Ambient life (ours) isn't there for the server: no cursor over it, and what's behind shows through
      // (a critter shows the cross: a click kills it)
      id = this.objects.pickAll(this.raycaster, this.session.world.self?.id).find((h) => !isAmbientId(h.id) || this.critters?.has(h.id))?.id ?? null;
    }
    // cursor.c GameWindowSetCursor: a cross over an object (with Shift over a container, the
    // "inside" one), the target cursor while choosing; nothing more (the halo is the target's alone)
    if (id !== this.hovered || this.shift !== this.hoverShift) {
      this.hovered = id;
      this.hoverShift = this.shift;
      if (this.drag === null) this.setCursor(this.selecting ? "target" : id !== null && !this.locked ? this.objectCursor(id) : "");
    }
  }

  /** Shift held at the last mouse move (cursor.c: GetKeyState(VK_SHIFT) for the inside cursor) */
  private shift = false;
  private hoverShift = false;

  private objectCursor(id: number): "cross" | "inside" {
    const o = this.session.world.objects.get(id);
    return this.shift && o && o.info.flags & OF_CONTAINER ? "inside" : "cross";
  }

  /** The view's cursor (CSS: .viewport[data-cursor], the original's cursors from the asset build) */
  private setCursor(kind: "" | "target" | "cross" | "inside" | "get"): void {
    if (kind) this.canvas.dataset.cursor = kind;
    else delete this.canvas.dataset.cursor;
  }

  // ---- pets (ours, docs/adr/0006-pets.md) ----

  /** Every pet in the room: ours always, other players' with Show Pets (and our server's word on them) */
  private updatePets(dt: number): void {
    const loaded = this.loaded;
    const world = this.session.world;
    const self = world.self;
    if (!loaded || !self) {
      this.pets = null;
      return;
    }
    if (this.petsRoom !== this.roomFile || !this.pets) {
      this.petsRoom = this.roomFile;
      this.pets = new Pets(loaded.room);
      this.petLastAt = null;
    }
    const grid = this.navGrids.get(this.roomFile);
    this.pets.setGrid(grid && typeof grid === "object" ? grid : this.ambientRoom === this.roomFile ? (this.ambient?.nav ?? null) : null);
    const owners: (PetOwner & { d: number })[] = [];
    // Ours, at the pace we go (squares per 10 s, as the server's speeds)
    const at = { x: this.mover.x, y: this.mover.y };
    const moved = this.petLastAt ? Math.hypot(at.x - this.petLastAt.x, at.y - this.petLastAt.y) : 0;
    this.petLastAt = at;
    if (this.ownPet && this.ownName) {
      const speed = dt > 0 && moved < FINENESS ? (moved / FINENESS / (dt / 1000)) * 10 : 0;
      owners.push({ id: self.id, name: this.ownName, ...at, angle: this.mover.angle, speed, pet: this.ownPet, d: 0 });
    }
    if (this.settings.showPets && this.social)
      for (const o of world.objects.values()) {
        // 3.3: only a player seen as one: not invisible, nor disguised or in shadow form
        if (o.id === self.id || !(o.info.flags & OF.PLAYER) || o.info.drawingType === DRAWFX.INVISIBLE || o.look.overlays.length < MIN_PLAYER_OVERLAYS) continue;
        const name = this.session.resource(o.info.nameRes) ?? "";
        const pet = name ? this.social.petOf(name) : null;
        if (pet) owners.push({ id: o.id, name, x: o.x, y: o.y, angle: o.angle, speed: o.motion?.speed ?? 0, pet, d: Math.hypot(o.x - at.x, o.y - at.y) });
      }
    if (owners.length && !this.petArtLoaded) {
      this.petArtLoaded = true;
      for (const f of petArt()) void this.loadBgf(localRes(f));
    }
    owners.sort((a, b) => a.d - b.d);
    this.pets.update(dt, owners.slice(0, MAX_PETS), Date.now());
  }

  /** Pets' names over their heads, as players' are but smaller (Show Pet Names), hidden by walls */
  private drawPetNames(): void {
    const named = this.settings.showPetNames ? (this.pets?.named() ?? []) : [];
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const eye = this.camera.position;
    const v = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let n = 0;
    for (const { obj, name } of named) {
      const top = this.objects?.topOf(obj.id);
      if (!top) continue;
      v.copy(top);
      dir.subVectors(v, eye);
      const d = dir.length();
      if (d > PET_NAME_RANGE) continue;
      if (this.roomView) {
        this.labelRay.set(eye, dir.divideScalar(d));
        this.labelRay.far = d - LABEL_OCCLUSION_SLACK;
        if (this.labelRay.far > 0 && this.roomView.occludes(this.labelRay)) continue;
      }
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const el = this.petNamePool[n] ?? this.labelsEl.appendChild(document.createElement("div"));
      if (!this.petNamePool[n]) el.className = "name-label pet-name";
      this.petNamePool[n++] = el;
      const shown = this.session.textFilter ? this.session.textFilter(name) : name;
      if (el.textContent !== shown) el.textContent = shown;
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -110%)`;
      el.style.display = "";
    }
    for (let i = n; i < this.petNamePool.length; i++) this.petNamePool[i].style.display = "none";
  }

  /** A pet near us to make its noise now and then (the Ambient Sounds), or null */
  private petVoice(at: { x: number; y: number }): { x: number; y: number; sound: string } | null {
    return this.pets?.voice(at, CRITTER_VOICE_RANGE, Math.random) ?? null;
  }

  // ---- following a friend (ours, docs/adr/0005-friends.md 4) ----

  /** Start walking after a friend whose character is in our room */
  startFollowing(key: string, name: string): void {
    this.follow = { planner: new FollowPlanner(name), key };
  }

  /** Stop following; `why`, when following stopped of itself, goes to onFollowStop */
  stopFollowing(why: string | null): void {
    if (!this.follow) return;
    this.follow = null;
    if (why !== null) this.onFollowStop?.(why);
  }

  get followingKey(): string | null {
    return this.follow?.key ?? null;
  }

  /** The leader's exit message (4.3), onto the trail; one we can't follow stops it */
  followExit(exit: Parameters<FollowPlanner["addExit"]>[0]): void {
    const why = this.follow?.planner.addExit(exit);
    if (why) this.stopFollowing(why);
  }

  /** The room's nav grid for following: the asset build's or the ambient life's, else built here a slice a frame */
  private followGrid(): NavGrid | null {
    const file = this.roomFile;
    const loaded = this.loaded;
    if (!file || !loaded) return null;
    const grid = this.navGrids.get(file);
    if (grid && typeof grid === "object") return grid;
    if (this.ambientRoom === file && this.ambient?.nav) return this.ambient.nav;
    if (grid === undefined) {
      this.loadNavGrid(file, loaded.room);
      return null;
    }
    if (grid === "loading") return null;
    // "build": the ambient life builds its own; otherwise we do
    if (this.ambientRoom === file && this.ambient) return null;
    if (this.followBuild?.file !== file) this.followBuild = { file, gen: navGridBuilder(loaded.room, 2, this.waterTextures) };
    const end = performance.now() + FOLLOW_BUILD_MS;
    while (performance.now() < end) {
      const r = this.followBuild.gen.next();
      if (r.done) {
        this.followBuild = null;
        this.keepNavGrid(file, r.value);
        return r.value;
      }
    }
    return null;
  }

  /** This frame of following: whether to walk (we turn to face the way here), or null to stand */
  private followFrame(now: number, room: Room, self: WorldObject): { run: boolean } | null {
    const f = this.follow!;
    const world = this.session.world;
    const id = this.social?.objectOf(f.key) ?? null;
    const leader = id !== null ? world.objects.get(id) : undefined;
    const step = f.planner.step({
      now,
      room: this.roomFile,
      self: { x: self.x, y: self.y },
      leader: leader ? { x: leader.x, y: leader.y, speed: leader.motion?.speed ?? 0 } : null,
      grid: this.followGrid(),
      size: { width: room.width, height: room.height },
      exits: this.ambientExits?.[this.roomFile],
    });
    switch (step.kind) {
      case "stop":
        this.stopFollowing(step.why);
        return null;
      case "go":
        this.mover.flush(now); // A_GO: MoveUpdatePosition first
        this.session.go();
        return null;
      case "idle":
        return null;
      case "walk": {
        const dx = step.to.x - self.x,
          dy = step.to.y - self.y;
        if (Math.hypot(dx, dy) < FOLLOW_TURN_SLOP) return null;
        const facing = Math.round((Math.atan2(dy, dx) * 4096) / (2 * Math.PI)) & 4095;
        const diff = ((facing - this.mover.angle + 6144) % 4096) - 2048;
        if (diff) this.mover.turnBy(diff);
        return { run: step.run };
      }
    }
  }

  /** Ours (markers.ts): a "!" or "?" over objects that ask for one (an unattuned travel portal, a quest giver), hidden by walls as names are */
  private drawMarkers(): void {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const eye = this.camera.position;
    let n = 0;
    for (const o of this.session.world.objects.values()) {
      const marker = markerFor(o.info.minimapFlags, this.settings.questMarkers);
      const glyph = marker?.glyph;
      const top = glyph ? this.objects?.topOf(o.id) : null;
      if (!glyph || !top) continue;
      v.copy(top).project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      dir.subVectors(top, eye);
      const dist = dir.length();
      if (this.roomView) {
        this.labelRay.set(eye, dir.divideScalar(dist));
        this.labelRay.far = dist - LABEL_OCCLUSION_SLACK;
        if (this.labelRay.far > 0 && this.roomView.occludes(this.labelRay)) continue;
      }
      const el = this.markerPool[n] ?? this.labelsEl.appendChild(document.createElement("div"));
      this.markerPool[n++] = el;
      el.className = marker.grey ? "world-marker grey" : marker.tier === "gold" ? "world-marker" : `world-marker ${marker.tier}`;
      if (el.textContent !== glyph) el.textContent = glyph;
      // Bigger up close: up to MARKER_NEAR_SCALE within MARKER_NEAR squares, the CSS size from MARKER_FAR on
      const near = Math.min(1, Math.max(0, (MARKER_FAR - dist) / (MARKER_FAR - MARKER_NEAR)));
      const grow = 1 + (MARKER_NEAR_SCALE - 1) * near;
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -150%) scale(${grow.toFixed(3)})`;
      el.style.display = "";
    }
    for (let i = n; i < this.markerPool.length; i++) this.markerPool[i].style.display = "none";
  }

  private drawLabels(labels: NameLabel[]): void {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    let n = 0;
    const eye = this.camera.position;
    const dir = new THREE.Vector3();
    for (const l of labels) {
      v.copy(l.position).project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      // D3DRenderNamesDraw3D draws names in the scene with the depth test on, so walls hide
      // them: skip a label when the room is drawn between the eye and it.
      if (this.roomView) {
        dir.subVectors(l.position, eye);
        const dist = dir.length();
        this.labelRay.set(eye, dir.divideScalar(dist));
        this.labelRay.far = dist - LABEL_OCCLUSION_SLACK;
        if (this.labelRay.far > 0 && this.roomView.occludes(this.labelRay)) continue;
      }
      const el = this.labelPool[n] ?? this.labelsEl.appendChild(document.createElement("div"));
      this.labelPool[n++] = el;
      // Ours (docs/adr/0005-friends.md 5): a friend's name in the friends colour, their health under it
      const friend = this.social?.friends.options.healthBars ? this.social.friendIds.get(l.id) : undefined;
      el.className = `name-label${l.id === this.hovered ? " hovered" : ""}${l.id === this.target ? " target" : ""}${friend ? " friend" : ""}`;
      // Ours: our companion's health under its name, as a friend's
      // and an arena bout's fighters'
      const arenaPct = this.arenaHp.get(l.id);
      const comp = this.companion && this.companion.id === l.id ? this.companion : arenaPct !== undefined ? { id: l.id, hpPct: arenaPct } : null;
      if (comp && !friend) {
        const width = Math.max(FRIEND_BAR_MIN, Math.min(FRIEND_BAR_WIDTH, FRIEND_BAR_WIDTH / Math.max(1, l.position.distanceTo(eye))));
        if (el.children.length !== 2) el.replaceChildren(document.createElement("span"), document.createElement("i"));
        const [name, bar] = [el.children[0] as HTMLElement, el.children[1] as HTMLElement];
        if (name.textContent !== l.name) name.textContent = l.name;
        bar.className = "companion-hp";
        bar.style.width = `${Math.round(width)}px`;
        bar.style.setProperty("--hp", `${comp.hpPct}%`);
        el.style.color = l.color;
      } else if (friend) {
        const hp = this.social!.friends.healthOf(friend.key);
        // Smaller further off, as the sprite is
        const width = Math.max(FRIEND_BAR_MIN, Math.min(FRIEND_BAR_WIDTH, FRIEND_BAR_WIDTH / Math.max(1, l.position.distanceTo(eye))));
        if (el.children.length !== 2) el.replaceChildren(document.createElement("span"), document.createElement("i"));
        const [name, bar] = [el.children[0] as HTMLElement, el.children[1] as HTMLElement];
        if (name.textContent !== l.name) name.textContent = l.name;
        bar.className = hp === null ? "friend-hp unknown" : "friend-hp";
        bar.style.width = `${Math.round(width)}px`;
        bar.style.setProperty("--hp", `${hp ?? 0}%`);
        el.style.color = "";
      } else {
        if (el.children.length) el.replaceChildren();
        if (el.textContent !== l.name) el.textContent = l.name;
        el.style.color = l.color;
      }
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -110%)`;
      el.style.display = "";
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = "none";
  }

  /**
   * A hit of ours (combatHit.ts): its damage floats up over what we hit. The message names it
   * rather than giving its id, so it's the target when the name matches (attacks and spells go
   * there), else the nearest object with that name.
   */
  showDamage(hit: DamageDealt): void {
    // Ours (docs/adr/0019-arena-bouts.md): the stands cheer a mock bout's blows now and then
    if (this.arenaFloorBusy && this.arena && Math.random() < 0.35) {
      const self = this.session.world.self;
      if (self) this.boutCheers.push({ type: "cheer", x: self.x, y: self.y, female: Math.random() < 0.5 });
    }
    if (!this.settings.damageNumbers) return;
    const world = this.session.world;
    const self = world.self;
    const name = hit.name.toLowerCase();
    const named = (o: WorldObject) => o.id !== self?.id && (this.session.resource(o.info.nameRes) ?? "").toLowerCase() === name;
    let hurt = this.target !== null ? world.objects.get(this.target) : undefined;
    if (!hurt || !named(hurt)) {
      hurt = undefined;
      let best = Infinity;
      for (const o of world.objects.values()) {
        const d = self ? Math.hypot(o.x - self.x, o.y - self.y) : 0;
        if (d >= best || !named(o)) continue;
        hurt = o;
        best = d;
      }
    }
    if (!hurt) return;
    const el = this.labelsEl.appendChild(document.createElement("div"));
    el.className = "damage-number";
    el.textContent = String(hit.damage);
    el.style.display = "none";
    this.damageFloats.push({ id: hurt.id, born: performance.now(), pos: this.objects?.topOf(hurt.id) ?? null, dx: (Math.random() - 0.5) * 24, el });
  }

  private drawDamage(): void {
    if (!this.damageFloats.length) return;
    const now = performance.now();
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    this.damageFloats = this.damageFloats.filter((f) => {
      const t = (now - f.born) / DAMAGE_LIFE_MS;
      if (t >= 1) {
        f.el.remove();
        return false;
      }
      f.pos = this.objects?.topOf(f.id) ?? f.pos;
      if (!f.pos) return true;
      v.copy(f.pos).project(this.camera);
      if (v.z > 1 || v.z < -1) {
        f.el.style.display = "none";
        return true;
      }
      f.el.style.display = "";
      f.el.style.opacity = String(t < DAMAGE_FADE ? 1 : (1 - t) / (1 - DAMAGE_FADE));
      f.el.style.transform = `translate(${((v.x + 1) / 2) * w + f.dx}px, ${((1 - v.y) / 2) * h - DAMAGE_RISE_PX * t}px) translate(-50%, -130%)`;
      return true;
    });
  }

  private clearDamage(): void {
    for (const f of this.damageFloats) f.el.remove();
    this.damageFloats = [];
  }

  /** The room being shown (for the minimap). */
  get currentRoom(): Room | null {
    return this.room;
  }

  private status(loading: boolean): void {
    const w = this.session.world;
    this.onStatus?.({
      roomName: w.player ? (this.session.resource(w.player.roomNameRes) ?? "") : "",
      roomFile: this.roomFile,
      objects: w.objects.size,
      lights: this.lights.length,
      loading,
    });
  }

  /** How far a room object is from us, in fine units (room_contents_node distance). */
  private distanceTo(id: number): number {
    const o = this.session.world.objects.get(id);
    const self = this.session.world.self;
    return o && self ? Math.hypot(o.x - self.x, o.y - self.y) : Infinity;
  }

  /** gameuser.c UserPickup: the gettable things in view close by; several are offered in a list. */
  pickUpNearby(): void {
    const ids = this.visibleObjects(OF_GETTABLE, CLOSE_DISTANCE).map((o) => o.id);
    if (ids.length) this.onPickup?.(ids);
  }

  /** gameuser.c UserLook (the Look key, typed "look"): everything in view that can be examined. */
  lookInView(): void {
    const ids = this.visibleObjects(0)
      .filter((o) => !(o.info.flags & OF_NOEXAMINE))
      .map((o) => o.id);
    this.choose("Look", ids, (id) => this.onLook?.(id), this.target ?? undefined);
  }

  /**
   * inventry.c InventoryLButtonUp: a container close by at a screen point (an item dropped
   * on it goes in it), or null.
   */
  containerAt(clientX: number, clientY: number): number | null {
    const saved = this.mouse;
    this.mouse = { x: clientX, y: clientY };
    const ids = this.objectsUnderCursor((o) => (o.info.flags & OF_CONTAINER) !== 0 && this.distanceTo(o.id) <= CLOSE_DISTANCE);
    this.mouse = saved;
    return ids[0] ?? null;
  }

  /**
   * client3d.c GetObjects3D at the mouse: the objects drawn under the cursor (where it was while
   * the mouse is captured), not hidden by a wall, that pass `test`, nearest first.
   */
  private objectsUnderCursor(test: (o: WorldObject) => boolean = () => true): number[] {
    if (!this.objects || !this.cursorRay()) return [];
    const hits = this.objects.pickAll(this.raycaster, this.session.world.self?.id);
    const out: WorldObject[] = [];
    for (const h of hits) {
      const o = this.session.world.objects.get(h.id);
      if (!o || !test(o)) continue;
      if (this.roomView) {
        this.raycaster.far = h.distance - LABEL_OCCLUSION_SLACK;
        const hidden = this.raycaster.far > 0 && this.roomView.occludes(this.raycaster);
        this.raycaster.far = 40;
        if (hidden) continue;
      }
      out.push(o);
    }
    return out.sort((a, b) => this.distanceTo(a.id) - this.distanceTo(b.id)).map((o) => o.id);
  }

  /** The sun or moon under the cursor, where the sky shows (no wall in front of it). */
  private skyUnderCursor(): number | null {
    if (!this.skyOverlays || !this.cursorRay()) return null;
    const id = this.skyOverlays.pick(this.raycaster);
    if (id === null) return null;
    if (this.roomView) {
      this.raycaster.far = 400;
      const hidden = this.roomView.occludes(this.raycaster);
      this.raycaster.far = 40;
      if (hidden) return null;
    }
    return id;
  }

  /** Aim this.raycaster from the eye through the cursor (where it was, while a right drag has it captured); false if there's no cursor. */
  private cursorRay(): boolean {
    let ndc: THREE.Vector2 | null = null;
    // The cursor, where it was even while a right drag has the mouse captured
    if (this.mouse) {
      const r = this.canvas.getBoundingClientRect();
      ndc = new THREE.Vector2(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1);
    }
    if (!ndc || this.session.world.effects.blind) return false;
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = 40;
    return true;
  }

  /** lookdlg.c DisplayLookList with LD_SINGLEAUTO: one object goes straight through, several are asked about. */
  private choose(title: string, ids: number[], then: (id: number) => void, initial?: number): void {
    if (!ids.length) return;
    if (ids.length === 1) return then(ids[0]);
    if (this.locked) document.exitPointerLock();
    this.onChoose?.(title, ids, then, initial);
  }

  // ---- input ----

  private readonly onMouseDown = (e: MouseEvent) => {
    // What the click is on: the cursor where it was pressed
    if (!this.locked) this.mouse = { x: e.clientX, y: e.clientY };
    if (this.selecting) {
      if (e.button === 0 && this.hovered !== null) this.select(this.hovered);
      return;
    }
    // Ours (the desktop, both interfaces): the right button turns the view while held and dragged,
    // and acts as bound (Examine) only if let go without dragging. The mouse is captured while it's
    // held (so a turn isn't stopped by the screen's edge) and freed again on letting go; the lock
    // is asked for now, while the press still counts as the user's gesture. There's no other
    // mouselook: the original's (a click, or A_MOUSELOOK) is gone.
    if (e.button === 2 && !touchUi(this.settings) && !this.locked) {
      this.rightDrag = { x: e.clientX, y: e.clientY, travel: 0, moved: false, mods: { alt: e.altKey, ctrl: e.ctrlKey } };
      window.addEventListener("mouseup", this.onRightUp);
      this.canvas.requestPointerLock().catch(() => {});
      return;
    }
    // Mouse buttons are bound like keys (config.ini mousetarget=mouse0, examine=mouse1)
    const actions = actionsFor(this.settings.keys, mouseCode(e.button), { alt: e.altKey, ctrl: e.ctrlKey });
    for (const a of actions) this.trigger(a);
    if (e.button !== 0 || this.locked) return;
    // Select Target took it (a player or a monster under the cursor)
    if (actions.includes("selectTarget") && this.objectsUnderCursor((o) => (o.info.flags & OF_ATTACKABLE) !== 0).length) return;
    // graphics.c UserStartDrag: the left button on something gettable (or a container) close by
    // starts dragging it; letting go over the inventory picks it up or looks inside
    // (mermain.c A_ENDDRAG). Several there: which one to get
    const near = this.objectsUnderCursor((o) => (o.info.flags & (OF_GETTABLE | OF_CONTAINER)) !== 0 && this.distanceTo(o.id) <= CLOSE_DISTANCE);
    if (near.length === 1) {
      this.drag = near[0];
      // graphics.c UserStartDrag: IDC_GETCURSOR while dragging
      this.setCursor("get");
      window.addEventListener("mouseup", this.onDragEnd);
      return;
    }
    if (near.length > 1) return this.choose("Get", near, (id) => this.getOrOpen(id));
  };

  /** The right button let go: a click does what it's bound to (Examine); a drag is done. */
  private readonly onRightUp = (e: MouseEvent) => {
    if (e.button !== 2) return;
    window.removeEventListener("mouseup", this.onRightUp);
    const d = this.rightDrag;
    this.rightDrag = null;
    this.canvas.removeAttribute("data-turning");
    if (this.locked) document.exitPointerLock();
    if (!d || d.moved) return;
    // As if pressed where it went down
    this.mouse = { x: d.x, y: d.y };
    for (const a of actionsFor(this.settings.keys, mouseCode(2), d.mods)) this.trigger(a);
  };

  /** mermain.c A_ENDDRAG: a container that can't be picked up is looked inside instead. */
  private getOrOpen(id: number): void {
    const o = this.session.world.objects.get(id);
    if (!o) return;
    if (o.info.flags & OF_CONTAINER && !(o.info.flags & OF_GETTABLE)) this.onContents?.(id);
    else this.session.pickUp(id);
  }

  private readonly onDragEnd = (e: MouseEvent) => {
    window.removeEventListener("mouseup", this.onDragEnd);
    const id = this.drag;
    this.drag = null;
    this.setCursor(this.hovered !== null ? this.objectCursor(this.hovered) : "");
    if (id === null) return;
    // mermain.c A_ENDDRAG: only a drop on the inventory counts
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over?.closest(".inventory-panel")) this.getOrOpen(id);
  };

  /**
   * Select Target (gameuser.c UserAttack, config.ini mousetarget): only something attackable
   * under the cursor, a player or a monster; Attack On Target attacks it too.
   */
  private selectHovered(): void {
    const ids = this.objectsUnderCursor((o) => (o.info.flags & OF_ATTACKABLE) !== 0);
    // Ours: with nothing real there, a critter under the cursor dies at once
    if (!ids.length) {
      const critter = this.critterUnderCursor();
      if (critter !== null) return this.squish(critter);
    }
    this.choose("Attack", ids, (id) => {
      this.setTarget(id);
      if (this.settings.attackOnTarget) this.attack();
    });
  }


  /**
   * Double click (merintr.c EventMouseClick: A_ACTIVATEMOUSE, gameuser.c UserActivateMouse):
   * activate what's under the cursor, or look inside a container, if it's close by and not a player.
   * Ours: a shopkeeper or vault keeper (OF_BUYABLE) shows what they sell or what we keep with
   * them, as typing "buy" or "withdraw" does; someone who only takes things (OF_OFFERABLE, not
   * attackable: a banker) opens Deposit, as typing "deposit" does. The phone has no other way.
   * At any distance: the server doesn't check it (user.kod), and they often stand behind a counter.
   * Ours (docs/adr/0009-quests.md 3.3): someone with a quest marker is talked to (activated: the
   * server sends what they have for us), before their shop when the marker is a gold "!" or "?".
   */
  private readonly onDoubleClick = (e: MouseEvent) => {
    // A double tap is the touch handlers' (the browser still sends a dblclick for it)
    if (performance.now() - this.lastTouchAt < 1000) return;
    if (!this.locked) this.mouse = { x: e.clientX, y: e.clientY };
    this.activateUnderCursor();
  };

  private activateUnderCursor(): void {
    const ids = this.objectsUnderCursor(
      (o) =>
        !(o.info.flags & OF_PLAYER) &&
        (((o.info.flags & (OF_ACTIVATABLE | OF_CONTAINER)) !== 0 && this.distanceTo(o.id) <= CLOSE_DISTANCE) ||
          (o.info.flags & OF_BUYABLE) !== 0 ||
          (o.info.flags & (OF_OFFERABLE | OF_ATTACKABLE)) === OF_OFFERABLE ||
          (o.info.minimapFlags & (MM_QUEST_NPC | MM_OURS.SERVICE)) !== 0),
    );
    this.choose("Activate", ids, (id) => {
      const o = this.session.world.objects.get(id);
      const quest = o ? o.info.minimapFlags & MM_QUEST_NPC : 0;
      if (o && o.info.flags & OF_CONTAINER) this.onContents?.(id);
      else if (o && o.info.flags & OF_ACTIVATABLE) this.session.activate(id);
      else if (quest & (MM_OURS.QUEST_OFFER | MM_OURS.QUEST_TURNIN)) this.session.activate(id);
      // Ours: a tailor or barber opens their window, which has a Shop button (docs/adr/0012-cosmetics.md)
      else if (o && o.info.minimapFlags & MM_OURS.SERVICE) this.session.activate(id);
      else if (o && o.info.flags & OF_BUYABLE) this.onBuy?.(id);
      else if (o && o.info.flags & OF_OFFERABLE) this.onDeposit?.(id);
      else if (quest) this.session.activate(id);
    });
  }

  private readonly onContextMenu = (e: MouseEvent) => {
    // No browser menu: the right button is bound like a key (Examine), acted on at mousedown
    e.preventDefault();
    if (this.selecting) this.select(null);
  };

  private readonly onCanvasMouseMove = (e: MouseEvent) => {
    this.mouse = { x: e.clientX, y: e.clientY };
    this.shift = e.shiftKey;
  };

  private readonly onMouseLeave = () => {
    this.mouse = null;
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    const d = this.rightDrag;
    if (d) {
      // Captured, the cursor stays put: count the mouse's own movement
      d.travel += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (!d.moved && d.travel > RIGHT_DRAG_SLOP) {
        d.moved = true;
        // No cursor while it turns the view (styles.css .viewport[data-turning])
        this.canvas.setAttribute("data-turning", "");
      }
      if (d.moved) this.look(e.movementX, e.movementY);
      return;
    }
    if (this.locked) this.look(e.movementX, e.movementY);
  };

  /** Mouselook, or a finger dragged across the view: turn and look up or down by pixels moved. */
  private look(dx: number, dy: number): void {
    // config.ini mouselookxscale / mouselookyscale, 1..30; 15 is our usual speed
    const sx = this.settings.mouseXScale / 15,
      sy = this.settings.mouseYScale / 15;
    const remote = this.remoteView();
    const rv = remote?.view.flags ?? 0;
    // Turning ourselves stops following (the chase view's camera turns alone)
    if (this.follow && dx && !remote && this.viewMode !== "chase") this.stopFollowing("you turned");
    // The chase view orbits the camera, not us
    if (!remote && this.viewMode === "chase") this.chaseAngle = (this.chaseAngle + Math.round(dx * MOUSE_TURN * sx) + 4096) & 4095;
    else if (!remote) this.mover.turnBy(dx * MOUSE_TURN * sx);
    else if (rv & REMOTE_VIEW.TURN) {
      // move.c: turning through another's eyes turns them only with REMOTE_VIEW_CONTROL
      const before = this.mover.angle;
      this.mover.turnBy(dx * MOUSE_TURN * sx);
      if (rv & REMOTE_VIEW.CONTROL) {
        remote.obj.angle = (remote.obj.angle + this.mover.angle - before + 4096) & 4095;
        this.mover.setAngle(before);
      }
    }
    // In front of us, moving the mouse up looks down at us (as the remaster's front view)
    const pitch = dy * 0.0025 * sy * (this.settings.invertMouse ? -1 : 1) * (this.viewMode === "front" && !remote ? -1 : 1);
    this.pitch = this.clampPitch(this.pitch - pitch);
  }

  /** Looking up and down: as far as the original lets us, or the outside views' smaller tilt. */
  private clampPitch(p: number): number {
    const limit = this.viewMode === "first" ? MAX_PITCH : THIRD_PERSON_PITCH;
    return Math.max(-limit, Math.min(limit, p));
  }

  // ---- the camera views (ours, the Modern interface) ----

  /** The outside views are the Modern interface's, on the desktop. */
  private outsideViews(): boolean {
    return this.settings.interfaceStyle === "modern" && !touchUi(this.settings);
  }

  setViewMode(mode: ViewMode): void {
    if (mode !== "first" && !this.outsideViews()) mode = "first";
    if (mode === this.viewMode) return;
    // The chase camera starts behind us; the outside views start a little above, looking down
    if (mode === "chase") this.chaseAngle = this.mover.angle;
    this.viewMode = mode;
    this.pitch = mode === "first" ? 0 : OUTSIDE_PITCH;
    const self = this.session.world.self;
    if (mode === "first" && self) self.look = self.normal;
    this.onViewMode?.(mode);
  }

  /** Camera View: first person, chase, behind, front, and round again. */
  private cycleView(): void {
    if (!this.outsideViews()) return;
    this.setViewMode(VIEW_ORDER[(VIEW_ORDER.indexOf(this.viewMode) + 1) % VIEW_ORDER.length]);
  }

  /**
   * Puts the camera `arm` behind our head (x, y, z in fine units) along the view's heading tilted by
   * the pitch, raised by HEAD_DROP of that, pulled in short of the first wall or ceiling between.
   * Returns where it is (fine units).
   */
  private placeOutsideCamera(x: number, y: number, z: number): { x: number; y: number } {
    const heading = this.viewMode === "chase" ? this.chaseAngle : this.viewMode === "front" ? (this.mover.angle + 2048) & 4095 : this.mover.angle;
    const a = (heading * 2 * Math.PI) / 4096;
    const p = this.pitch;
    // The way the camera looks, in the scene (X = x, Y = z, Z = y), and the way it goes out from
    // the head: back along that, and up by HEAD_DROP of the distance
    const look = new THREE.Vector3(Math.cos(a) * Math.cos(p), Math.sin(p), Math.sin(a) * Math.cos(p));
    const out = look.clone().negate().add(new THREE.Vector3(0, HEAD_DROP, 0));
    const reach = out.length();
    out.divideScalar(reach);
    const pivot = new THREE.Vector3(x / FINENESS, z / FINENESS, y / FINENESS);
    let dist = (this.arm / FINENESS) * reach;
    if (this.roomView) {
      this.cameraRay.set(pivot, out);
      this.cameraRay.far = dist + CAMERA_WALL_GAP;
      const hit = this.roomView.firstHit(this.cameraRay);
      if (hit !== null) dist = Math.max(CAMERA_NEAREST, hit - CAMERA_WALL_GAP);
    }
    this.camera.position.copy(pivot).addScaledVector(out, dist);
    this.camera.rotation.set(p, Math.atan2(-Math.cos(a), -Math.sin(a)), 0, "YXZ");
    return { x: this.camera.position.x * FINENESS, y: this.camera.position.z * FINENESS };
  }

  /** The wheel (ours): nearer or farther in the outside views; out of first person into the chase view. */
  private readonly onWheel = (e: WheelEvent) => {
    if (!this.outsideViews() || this.remoteView() || e.deltaY === 0) return;
    e.preventDefault();
    const out = e.deltaY > 0;
    if (this.viewMode === "first") {
      if (out) this.setViewMode("chase");
      return;
    }
    // In the chase view, all the way in goes back to our eyes (as the remaster's)
    if (!out && this.arm <= ARM_MIN && this.viewMode === "chase") return this.setViewMode("first");
    this.arm = Math.max(ARM_MIN, Math.min(ARM_MAX, this.arm + (out ? ARM_STEP : -ARM_STEP)));
  };

  // ---- touch (ours, ADR 0003): the phone layout's view ----

  /** The on-screen joystick (TouchControls.tsx): digital like the keys (move.c), and run when pushed far. */
  setTouchMove(m: TouchMove): void {
    this.touchMove = m;
  }

  /** The full map is over the view: the joystick and the movement keys move by the map's directions. */
  mapMode = false;

  /**
   * An on-screen button: the action its key would do. Ours: the phone's Target button takes the
   * closest creature in view, and presses close together go on to the next.
   */
  press(a: Action): void {
    if (a === "targetNext") return this.targetClosest();
    this.trigger(a);
  }

  /** When the phone's Target button last chose a target: within TARGET_CYCLE_MS, the next press cycles */
  private lastTargetPress = 0;

  /**
   * Ours (the phone's Target button): the closest attackable thing in view, monsters before
   * players; pressed again soon after, the next one, nearest first, as Target Next does.
   */
  private targetClosest(): void {
    const now = performance.now();
    const cycling = now - this.lastTargetPress < TARGET_CYCLE_MS;
    this.lastTargetPress = now;
    const all = this.visibleObjects(OF_ATTACKABLE);
    const list = [...all.filter((o) => !(o.info.flags & OF_PLAYER)), ...all.filter((o) => o.info.flags & OF_PLAYER)];
    if (!list.length) return this.setTarget(null);
    const i = cycling && this.target !== null ? list.findIndex((o) => o.id === this.target) : -1;
    this.setTarget(list[i < 0 || i + 1 === list.length ? 0 : i + 1].id);
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    // No emulated mousedown/mouseup for this finger: the touch handlers below do it all
    e.preventDefault();
    this.lastTouchAt = performance.now();
    this.canvas.setPointerCapture(e.pointerId);
    const t: TouchState = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, held: false, timer: 0 };
    // A long press examines what's under the finger (the right click's Examine)
    t.timer = window.setTimeout(() => {
      if (t.moved) return;
      t.held = true;
      this.mouse = { x: t.x0, y: t.y0 };
      this.trigger("examine");
    }, LONG_PRESS_MS);
    this.touches.set(e.pointerId, t);
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    if (!t.moved && Math.hypot(e.clientX - t.x0, e.clientY - t.y0) > TAP_SLOP) {
      t.moved = true;
      clearTimeout(t.timer);
    }
    const k = (TOUCH_LOOK * this.settings.touchLookScale) / 15; // Look Speed (the phone's Configuration)
    if (t.moved && !t.held) this.look((e.clientX - t.x) * k, (e.clientY - t.y) * k);
    t.x = e.clientX;
    t.y = e.clientY;
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    clearTimeout(t.timer);
    this.lastTouchAt = performance.now();
    if (!t.moved && !t.held) this.tap(t.x0, t.y0);
  };

  private readonly onPointerCancel = (e: PointerEvent) => {
    const t = this.touches.get(e.pointerId);
    if (t) clearTimeout(t.timer);
    this.touches.delete(e.pointerId);
  };

  /**
   * A tap on the view: picking a spell target; a second tap close by soon after activates (the
   * double click); else Select Target on a player or monster, or picks up (or opens) what's
   * close by, where a click would start dragging it to the inventory.
   */
  private tap(x: number, y: number): void {
    this.mouse = { x, y };
    const now = performance.now();
    const last = this.lastTap;
    this.lastTap = { x, y, at: now };
    if (this.selecting) {
      this.updateHover();
      // As below: a target just beside the fingertip counts
      if (this.hovered === null && this.withinReach(x, y, () => true)) this.updateHover();
      if (this.hovered !== null) this.select(this.hovered);
      return;
    }
    if (last && now - last.at < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_SLOP) {
      this.lastTap = null;
      this.activateUnderCursor();
      return;
    }
    // Ours: a fingertip is wider than a rat's sprite, so a creature just beside the tap counts too
    const attackable = (o: WorldObject) => (o.info.flags & OF_ATTACKABLE) !== 0;
    const reached = this.withinReach(x, y, attackable);
    if (reached) {
      this.mouse = reached;
      return this.selectHovered();
    }
    this.mouse = { x, y };
    if (this.critterUnderCursor() !== null) return this.selectHovered();
    const near = this.objectsUnderCursor((o) => (o.info.flags & (OF_GETTABLE | OF_CONTAINER)) !== 0 && this.distanceTo(o.id) <= CLOSE_DISTANCE);
    if (near.length) this.choose("Get", near, (id) => this.getOrOpen(id));
  }

  /**
   * Ours: the nearest point to (x, y), within TAP_REACH, with an object passing `test` drawn
   * under it: the point itself first, then rings around it. Leaves `this.mouse` moved.
   */
  private withinReach(x: number, y: number, test: (o: WorldObject) => boolean): { x: number; y: number } | null {
    for (let r = 0; r <= TAP_REACH; r += 8) {
      const steps = r === 0 ? 1 : 8 + r / 2;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        this.mouse = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
        if (this.objectsUnderCursor(test).length) return this.mouse;
      }
    }
    return null;
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.altDown = e.altKey;
    this.ctrlDown = e.ctrlKey;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (t?.closest?.(".dialog")) return;
    // A modal window (the options, a message box) is up: the game takes no keys, like the original's
    if (document.querySelector(".mk-modal")) return;
    // Copying selected text (the chat window's) is the browser's: Ctrl+C isn't C (Mouselook Toggle)
    if ((e.ctrlKey || e.metaKey) && (e.code === "KeyC" || e.code === "KeyX") && !window.getSelection()?.isCollapsed) return;
    const actions = actionsFor(this.settings.keys, e.code, { alt: e.altKey, ctrl: e.ctrlKey });
    // Alt alone would focus the browser menu; Alt+arrows would navigate back/forward.
    if (e.key === "Alt" || actions.length || e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    for (const a of actions) {
      // held keys repeat: zooming, and attacking (rate-limited like the original)
      if (e.repeat && a !== "mapZoomIn" && a !== "mapZoomOut" && a !== "attack") continue;
      // merintr.c interface_key_table: Shift+Tab is Tab Backward
      this.trigger(a === "tabForward" && e.shiftKey ? "tabBackward" : a);
    }
    // alias.c: F1..F12 send their hotkey aliases (when no action uses the key)
    const fkey = /^F(\d{1,2})$/.exec(e.code);
    if (!actions.length && fkey && Number(fkey[1]) >= 1 && Number(fkey[1]) <= 12 && !e.altKey && !e.ctrlKey) {
      e.preventDefault();
      if (!e.repeat) this.onHotkey?.(Number(fkey[1]));
      return;
    }
    const printable = e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!actions.length && this.settings.typeToChat && printable) {
      // The original's A_TEXTINSERT keys: typing a letter starts a chat line
      e.preventDefault();
      if (this.locked) document.exitPointerLock();
      this.onTypeChat?.(e.key);
      return;
    }
    this.keys.add(e.code);
  };

  /** One-shot actions; held ones (movement, looking up and down) are polled each frame. */
  private trigger(a: Action): void {
    switch (a) {
      case "go":
        if (this.resting) break; // mermain.c A_GO: not while resting
        if (this.follow) this.stopFollowing("you used an exit yourself");
        this.mover.flush(performance.now()); // A_GO: MoveUpdatePosition first
        this.session.go();
        break;
      case "attack":
        this.attack();
        break;
      case "targetNext":
        this.cycleTarget(true);
        break;
      case "targetPrevious":
        this.cycleTarget(false);
        break;
      case "targetSelf":
        this.setTarget(this.session.world.player?.id ?? null);
        break;
      case "targetClear":
        if (this.selecting) this.select(null);
        // intrface.c A_TARGETCLEAR: through another's eyes, Esc brings us back (UserMoveEsc)
        else if (this.remoteView()) this.session.world.endRemoteView();
        else this.setTarget(null);
        break;
      case "interact":
        // A_PICKUP: UserPickup
        this.pickUpNearby();
        break;
      case "lookAt":
        // A_LOOK: UserLook, everything in view (the target chosen to start with)
        this.lookInView();
        break;
      case "lookStraight":
        this.pitch = this.viewMode === "first" ? 0 : OUTSIDE_PITCH;
        break;
      case "cameraView":
        this.cycleView();
        break;
      case "flip":
        this.mover.turnBy(2048); // A_FLIP
        break;
      case "chat":
        if (this.locked) document.exitPointerLock();
        this.onChatKey?.();
        break;
      case "examine": {
        // A_LOOKMOUSE (config.ini examine=mouse1): UserLookMouseSquare, what's under the cursor;
        // with nothing there, the sun or moon (client3d.c GetObjects3D's background overlays)
        const ids = this.objectsUnderCursor();
        if (!ids.length) {
          // Ours: one of the townsfolk (real objects come first), shown in our own window
          const person = this.ambientUnderCursor();
          if (person !== null) {
            if (this.locked) document.exitPointerLock();
            this.onLookAmbient?.(person);
            break;
          }
          const sky = this.skyUnderCursor();
          if (sky !== null) this.onLook?.(sky);
          break;
        }
        if (this.locked) document.exitPointerLock();
        this.choose("Look", ids, (id) => this.onLook?.(id));
        break;
      }
      case "selectTarget":
        this.selectHovered();
        break;
      case "say":
      case "tell":
      case "yell":
      case "broadcast":
      case "emote":
        // Start a chat line with the command, ready for the rest
        if (this.locked) document.exitPointerLock();
        this.onChatPrefix?.(`${a} `);
        break;
      case "inventory":
      case "mapZoomIn":
      case "mapZoomOut":
      case "map":
      case "settings":
      case "configuration":
      case "actions":
      case "quickEmotes":
      case "friends":
      case "pets":
      case "companion":
      case "war":
      case "who":
      case "offer":
      case "buy":
      case "deposit":
      case "withdraw":
      case "hideInterface":
        // Panels and dialogs: free the mouse for them
        if (this.locked && a !== "mapZoomIn" && a !== "mapZoomOut" && a !== "inventory" && a !== "map" && a !== "hideInterface" && !a.startsWith("quickSlot")) document.exitPointerLock();
        this.onAction?.(a);
        break;
      case "tabForward":
      case "tabBackward":
        // intrface.c MainTab: from the view to the interface or the chat line
        if (this.locked) document.exitPointerLock();
        this.onAction?.(a);
        break;
      default:
        // The quick slots (all twenty; GameView knows which rows show), the mouse left captured
        if (a.startsWith("quickSlot")) this.onAction?.(a);
        break;
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.altDown = e.altKey;
    this.ctrlDown = e.ctrlKey;
    this.keys.delete(e.code);
    if (e.key === "Alt") e.preventDefault();
  };

  private readonly onBlur = () => {
    if (this.rightDrag) {
      window.removeEventListener("mouseup", this.onRightUp);
      this.rightDrag = null;
      this.canvas.removeAttribute("data-turning");
      if (this.locked) document.exitPointerLock();
    }
    this.keys.clear();
    this.altDown = false;
    this.ctrlDown = false;
  };

  private resize(): void {
    const w = this.canvas.clientWidth || 1,
      h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const deg = Math.PI / 180;
    const origAspect = Math.tan((ORIGINAL_FOV.horizontal / 2) * deg) / Math.tan((ORIGINAL_FOV.vertical / 2) * deg);
    this.camera.fov =
      this.camera.aspect >= origAspect
        ? ORIGINAL_FOV.vertical
        : (2 * Math.atan(Math.tan((ORIGINAL_FOV.horizontal / 2) * deg) / this.camera.aspect)) / deg;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stopDevBridge?.();
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.offChat?.();
    this.offSettings();
    this.resizeObserver.disconnect();
    window.removeEventListener("mouseup", this.onDragEnd);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onRightUp);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("mousemove", this.onCanvasMouseMove);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    for (const t of this.touches.values()) clearTimeout(t.timer);
    if (this.locked) document.exitPointerLock();
    this.objects?.dispose();
    this.skyOverlays?.dispose();
    this.overlays?.dispose();
    this.rooms?.dispose();
    this.ownView?.dispose();
    this.blur?.dispose();
    this.waver?.dispose();
    this.postFx?.dispose();
    this.weather?.dispose();
    this.flyers?.dispose();
    this.nature?.dispose();
    this.groundCover?.dispose();
    this.puddles?.dispose();
    this.ambientSounds?.stop(0);
    this.social?.watchArena(null, null);
    this.lightning?.dispose();
    this.spellFx?.dispose();
    this.rangeRings?.dispose();
    this.flashEl?.remove();
    if (this.sky) disposeSkybox(this.sky);
    this.renderer.dispose();
    this.labelsEl.replaceChildren();
  }
}

export { OF };
