// Changes the server makes to the room you're in (clientd3d/roomanim.c): floors and
// ceilings that lift (BP_SECTOR_MOVE), walls and sectors showing other bitmap groups
// (BP_WALL_ANIMATE, BP_SECTOR_ANIMATE), new textures (BP_CHANGE_TEXTURE), and new depth
// and scrolling (BP_SECTOR_CHANGE).
//
// The original changes the loaded room in place; it reloads the room on every BP_PLAYER,
// after which the server sends every change again at speed 0 (user.kod ToCliPlayer). We
// keep the loaded room as the file has it (rooms are cached and shared) and change a
// copy, which the renderer and the movement code both use.

import { CHANGE_OVERRIDE, CTF, RA, ANIMATE, KOD_FINENESS, type RoomChange } from "@shards/protocol";
import { FINENESS, WF, cloneRoom, setWallHeights, type Room, type Sector, type Sidedef } from "@shards/formats";
import { animStateFrom, animStep, type AnimState } from "./animation.ts";

/** drawdefs.h HeightKodToClient */
const heightKodToClient = (h: number): number => h * (FINENESS / KOD_FINENESS);

/** roomanim.h RoomLift: a floor or ceiling on its way to dest_z */
interface Lift {
  animation: number;
  sourceZ: number;
  destZ: number;
  progress: number;
  /** Fraction of the way per ms */
  increment: number;
}

interface BitmapAnim {
  anim: AnimState;
  action: number;
}

export class LiveRoom {
  /** The room as it is now; draw and collide with this one. */
  readonly room: Room;
  /** Texture group count by grid texture id, for cycling animations (0 if unknown). */
  numGroups: (texture: number) => number = () => 0;
  private readonly lifts = new Map<number, Lift>();
  private readonly sidedefAnims = new Map<number, BitmapAnim>();
  private readonly sectorAnims = new Map<number, BitmapAnim>();
  /** Bumped whenever something the renderer draws changed. */
  version = 0;

  constructor(base: Room) {
    this.room = cloneRoom(base);
  }

  /** Whether anything is still moving (lifts, bitmap animations). */
  get animating(): boolean {
    return this.lifts.size > 0 || this.sidedefAnims.size > 0 || this.sectorAnims.size > 0;
  }

  /** Grid textures the room uses now (new ones arrive with BP_CHANGE_TEXTURE). */
  textureIds(): Set<number> {
    const ids = new Set<number>();
    for (const s of this.room.sectors) ids.add(s.floorType).add(s.ceilingType);
    for (const s of this.room.sidedefs) ids.add(s.normalType).add(s.aboveType).add(s.belowType);
    ids.delete(0);
    return ids;
  }

  apply(c: RoomChange): void {
    switch (c.type) {
      case "sectorMove":
        this.moveSector(c.animation, c.sector, c.height, c.speed);
        break;
      case "wallAnimate":
        this.forSidedefs(c.wall, (s, i) => {
          // roomanim.c WallChange: a new animation replaces the one in progress
          const a = { anim: animStateFrom(c.animation), action: c.action };
          if (c.animation.type === ANIMATE.NONE) this.sidedefDone(s, a);
          else {
            this.sidedefAnims.set(i, a);
            s.group = a.anim.group;
          }
        });
        break;
      case "sectorAnimate":
        this.forSectors(c.sector, (s, i) => {
          const a = { anim: animStateFrom(c.animation), action: c.action };
          s.group = a.anim.group;
          if (c.animation.type === ANIMATE.NONE) this.sectorAnims.delete(i);
          else this.sectorAnims.set(i, a);
        });
        break;
      case "sectorChange":
        this.forSectors(c.sector, (s) => sectorChange(s, c.depth, c.scroll));
        break;
      case "changeTexture":
        // roomanim.c TextureChange (CTF_RESET only tells the server's own bookkeeping apart)
        this.forSidedefs(c.id, (s) => {
          if (c.flags & CTF.ABOVEWALL) s.aboveType = c.texture;
          if (c.flags & CTF.NORMALWALL) s.normalType = c.texture;
          if (c.flags & CTF.BELOWWALL) s.belowType = c.texture;
        });
        this.forSectors(c.id, (s) => {
          if (c.flags & CTF.FLOOR) s.floorType = c.texture;
          if (c.flags & CTF.CEILING) s.ceilingType = c.texture;
        });
        break;
      case "sectorLight":
        // roomanim.c SectorFlickerChange: in D3D mode the flicker keeps the sector's own
        // light (RoomAnimateSingle ANIMATE_FLICKER, gD3DEnabled), so nothing changes.
        return;
    }
    this.version++;
  }

  /**
   * roomanim.c AnimateRoom: advance by dt ms. Returns true if anything the renderer draws
   * changed. Objects standing on a lifting floor follow it, since their height is read
   * from the floor below them.
   */
  tick(dt: number): boolean {
    let changed = false;
    for (const [i, lift] of this.lifts) {
      // RoomAnimateSingle ANIMATE_FLOOR_LIFT / ANIMATE_CEILING_LIFT
      lift.progress += lift.increment * dt;
      const done = lift.progress >= 1;
      const z = done ? lift.destZ : Math.round(lift.sourceZ + lift.progress * (lift.destZ - lift.sourceZ));
      this.adjustHeight(i, lift.animation, z);
      if (done) this.lifts.delete(i);
      changed = true;
    }
    for (const [i, a] of this.sidedefAnims) {
      const s = this.room.sidedefs[i];
      if (!animStep(a.anim, this.numGroups(s.normalType || s.aboveType || s.belowType), dt)) continue;
      s.group = a.anim.group;
      if (a.anim.type === ANIMATE.NONE) {
        // RAS_DONE: the animation ended
        this.sidedefDone(s, a);
        this.sidedefAnims.delete(i);
      }
      changed = true;
    }
    for (const [i, a] of this.sectorAnims) {
      const s = this.room.sectors[i];
      if (!animStep(a.anim, this.numGroups(s.floorType || s.ceilingType), dt)) continue;
      s.group = a.anim.group;
      if (a.anim.type === ANIMATE.NONE) this.sectorAnims.delete(i);
      changed = true;
    }
    if (changed) this.version++;
    return changed;
  }

  /** roomanim.c MoveSector */
  private moveSector(animation: number, sector: number, height: number, speed: number): void {
    if (animation !== ANIMATE.FLOOR_LIFT && animation !== ANIMATE.CEILING_LIFT) return;
    const destZ = heightKodToClient(height);
    this.forSectors(sector, (s, i) => {
      // speed 0: at once
      if (speed === 0) {
        this.lifts.delete(i);
        this.adjustHeight(i, animation, destZ);
        return;
      }
      const sourceZ = animation === ANIMATE.FLOOR_LIFT ? s.floorHeight : s.ceilingHeight;
      if (sourceZ === destZ) {
        this.lifts.delete(i);
        return;
      }
      this.lifts.set(i, { animation, sourceZ, destZ, progress: 0, increment: heightKodToClient(speed) / 1000 / Math.abs(destZ - sourceZ) });
    });
  }

  /** roomanim.c SectorAdjustHeight: the sector's height, then its walls' heights */
  private adjustHeight(index: number, animation: number, z: number): void {
    const s = this.room.sectors[index];
    if (animation === ANIMATE.FLOOR_LIFT) s.floorHeight = z;
    else s.ceilingHeight = z;
    const n = index + 1;
    for (const w of this.room.walls) if (w.posSector === n || w.negSector === n) setWallHeights(w, this.room.sectors);
  }

  /** roomanim.c SidedefDoAnimation, RAS_DONE: the wall's action when its animation ends */
  private sidedefDone(s: Sidedef, a: BitmapAnim): void {
    s.group = a.anim.group;
    switch (a.action) {
      case RA.PASSABLE_END:
        s.flags |= WF.PASSABLE;
        break;
      case RA.IMPASSABLE_END:
        s.flags &= ~WF.PASSABLE;
        break;
      case RA.INVISIBLE_END:
        s.flags |= WF.PASSABLE;
        s.normalType = 0;
        break;
    }
  }

  private forSectors(serverId: number, fn: (s: Sector, index: number) => void): void {
    this.room.sectors.forEach((s, i) => s.serverId === serverId && fn(s, i));
  }

  private forSidedefs(serverId: number, fn: (s: Sidedef, index: number) => void): void {
    this.room.sidedefs.forEach((s, i) => s.serverId === serverId && fn(s, i));
  }
}

/** roomanim.c SectorChange: the depth bits and the scroll speed bits of the sector's flags */
function sectorChange(s: Sector, depth: number, scroll: number): void {
  if (depth !== CHANGE_OVERRIDE) s.flags = (s.flags & ~0x3) | depth;
  if (scroll === CHANGE_OVERRIDE) return;
  if (scroll === 0) {
    s.flags &= ~0x1fc; // SCROLL_NONE: drop every scroll bit
    return;
  }
  const direction = (s.flags & 0x70) >> 4;
  const floor = s.flags & 0x80;
  const ceiling = s.flags & 0x100;
  s.flags = (s.flags & ~0x1fc) | (scroll << 2) | (direction << 4) | floor | ceiling;
}
