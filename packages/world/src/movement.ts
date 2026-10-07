// The player's own movement, ported from clientd3d/move.c (UserMovePlayer,
// FindIntersection/IntersectNode, SlideAlongWall, MoveObjectAllowed,
// MoveUpdateServer/MoveUpdatePosition, UserTurnPlayer). Movement is optimistic: we
// move locally and tell the server; the server can move us back (BP_MOVE to us).
//
// Units: client fine (1024 per square), angles 0..4095 with (cos a, sin a) in x/y.

import { FINENESS, SF, WF, floorHeightAt, leafAt, type Room, type Wall } from "@shards/formats";

const MOVEUNITS = FINENESS >> 2; // draw3d.h
const MOVE_DELAY = 85; // ms per MOVEUNITS
const NUM_STEPS_PER_SECOND = 210;
const STEPS_PER_MOVE = 20;
const MAX_STEP_HEIGHT = 24 * 16; // HeightKodToClient(24)
const MOVE_INTERVAL = 250; // inform the server at most this often
const MOVE_THRESHOLD = FINENESS / 4; // compared with the *squared* distance, like the C code
const MIN_NOMOVEON = FINENESS / 4;
const MIN_HOTPLATE_DIST = FINENESS;
const TELEPORT_DELAY = 5000;
const MIN_SIDE_MOVE = MOVEUNITS / 4;
const MOVE_OFF_ROOM_INTERVAL = 1000;
const PLAYER_WIDTH = (31 * 64) / 4; // game.c player.width
const PLAYER_HEIGHT = (3 * FINENESS) / 4; // game.c player.height
const TURNDEGREES = 64; // game.h: 4096 / 64 per TURN_DELAY
const TURN_DELAY = 85;
export const SPEED_WALK = 25;
export const SPEED_RUN = 55;
const CLIMB_VELOCITY = (FINENESS * 9) / 2; // move.h, units per second
const FALL_VELOCITY = (-FINENESS * 2) / 3;
const GRAVITY = -5 * FINENESS; // moveobj.h, units / s / s
const SECTOR_DEPTHS = [0, FINENESS / 5, (2 * FINENESS) / 5, (3 * FINENESS) / 5];
const ROOM_OVERRIDE = [0, 0x1, 0x2, 0x4];

/** Object move-on types (include/proto.h MOVEON_*). */
export const MOVEON = { YES: 0, NO: 1, TELEPORTER: 2, NOTIFY: 3 } as const;

export interface MoveInput {
  /** +1 forward, -1 back */
  forward: number;
  /** +1 right, -1 left */
  strafe: number;
  run: boolean;
}

export interface MoverObject {
  id: number;
  x: number;
  y: number;
  info: { moveOnType: number };
}

export interface MoverSink {
  /** BP_REQ_MOVE with client fine coordinates (the caller converts to Kod units) */
  move(x: number, y: number, speed: number): void;
  /** BP_REQ_TURN, server angle units (same as the client's: 4096 per circle) */
  turn(angle: number): void;
  /** Play the room's wading sound (move.c: a splash while walking in water) */
  wade?(): void;
}

export class PlayerMover {
  x = 0;
  y = 0;
  /** eye-base height (floor minus water depth), smoothed like the client's motion.z */
  z = 0;
  angle = 0;
  room: Room | null = null;
  roomFlags = 0;
  overrideDepths: [number, number, number] = [0, 0, 0];
  private destZ = 0;
  private vZ = 0;
  private serverX = 0;
  private serverY = 0;
  private serverAngle = -1;
  private serverTime = 0;
  private valid = false;
  private lastFast = false;
  private moveOffRoomTime = 0;
  private nextMoveTime = 0;
  private lastNotifyId = -1;
  private readonly minDistance = Math.max(1, PLAYER_WIDTH / 2);
  private readonly sink: MoverSink;
  bounce = 0;
  private bounceTime = 0;
  /** Time of the last wading splash; -1 = out of the water (move.c last_splash 0xFFFFFFFF) */
  private lastSplash = -1;

  constructor(sink: MoverSink) {
    this.sink = sink;
  }

  /** The server placed us (room entry, teleport, rejected move): ServerMovedPlayer. */
  place(x: number, y: number, now: number): void {
    this.x = x;
    this.y = y;
    this.serverX = x;
    this.serverY = y;
    this.serverTime = now;
    this.valid = true;
    this.nextMoveTime = 0;
    this.z = this.destZ = this.floorBase(x, y) ?? this.z;
    this.vZ = 0;
  }

  /** The server set our angle (BP_TURN to us, or room entry). */
  setAngle(angle: number): void {
    this.angle = angle & 4095;
    this.serverAngle = this.angle;
  }

  /** client3d.c GetFloorBase: floor minus water depth (or the room's override). */
  floorBase(x: number, y: number): number | null {
    if (!this.room) return null;
    const leaf = leafAt(this.room, x, y);
    if (!leaf || !leaf.sector) return null;
    const s = this.room.sectors[leaf.sector - 1];
    const depth = s.flags & SF.DEPTH_MASK;
    let height = floorHeightAt(s, x, y) - SECTOR_DEPTHS[depth];
    if (depth && this.roomFlags & ROOM_OVERRIDE[depth]) height = this.overrideDepths[depth - 1];
    return height;
  }

  /** Turn by a mouse delta in client angle units (UserTurnPlayerMouse). */
  turnBy(delta: number): void {
    this.angle = (((this.angle + delta) % 4096) + 4096) % 4096;
  }

  /** Keyboard turning at TURNDEGREES per TURN_DELAY ms (UserTurnPlayer). */
  turnKeys(dir: number, fast: boolean, dt: number): void {
    if (!dir) return;
    this.turnBy((dir * (fast ? 3 : 1) * TURNDEGREES * Math.min(dt, TURN_DELAY * 4)) / TURN_DELAY);
  }

  /**
   * One frame: move by the input (UserMovePlayer), settle height, and tell the
   * server (MoveUpdateServer, which the client also calls from its game timer).
   */
  update(input: MoveInput, dt: number, now: number, objects: Iterable<MoverObject>, selfId: number): void {
    if ((input.forward || input.strafe) && this.room && this.valid && now >= this.nextMoveTime) {
      this.step(input, dt, now, objects, selfId);
    }
    this.settleHeight(dt);
    this.updateServer(now);
  }

  private step(input: MoveInput, dt: number, now: number, objects: Iterable<MoverObject>, selfId: number): void {
    const room = this.room!;
    const origX = this.x,
      origY = this.y;
    // Direction (A_FORWARD, A_SLIDELEFT, ...): offsets in eighths of a circle
    const f = Math.sign(input.forward),
      s = Math.sign(input.strafe);
    const eighths = f > 0 ? (s > 0 ? 1 : s < 0 ? 7 : 0) : f < 0 ? (s > 0 ? 3 : s < 0 ? 5 : 4) : s > 0 ? 2 : 6;
    const angle = (this.angle + (eighths * 4096) / 8) % 4096;
    let distance = input.run ? 2 * MOVEUNITS : MOVEUNITS;
    this.lastFast = input.run;

    // Wading slows you down
    const leaf0 = leafAt(room, this.x, this.y);
    const depth = leaf0?.sector ? room.sectors[leaf0.sector - 1].flags & SF.DEPTH_MASK : 0;
    distance = [distance, (distance * 3) / 4, distance / 2, distance / 4][depth];

    dt = Math.max(1, dt);
    if (dt < MOVE_DELAY) distance = (distance * dt) / MOVE_DELAY;

    const rad = (angle * 2 * Math.PI) / 4096;
    const dx = Math.trunc(distance * Math.cos(rad)),
      dy = Math.trunc(distance * Math.sin(rad));
    const numSteps = Math.max(1, Math.min(STEPS_PER_MOVE, Math.floor((NUM_STEPS_PER_SECOND * dt) / 1000)));
    const xinc = Math.trunc(dx / numSteps),
      yinc = Math.trunc(dy / numSteps);
    let lastX = this.x,
      lastY = this.y;
    let x = lastX,
      y = lastY;
    let moved = false;

    for (let i = 0; i < numSteps; i++) {
      x = lastX + xinc;
      y = lastY + yinc;
      const z = Math.max(this.z, this.floorBase(lastX, lastY) ?? this.z);
      const leaf = leafAt(room, x, y);
      if (!leaf || !leaf.sector) {
        x = lastX;
        y = lastY;
        break;
      }
      // Like the C code: one slide (its cached blocking-node pass), then check again,
      // slide again, and finally try small sideways steps.
      let wall = this.findIntersection(lastX, lastY, x, y, z);
      if (wall) [x, y] = slideAlongWall(wall, lastX, lastY, x, y);
      wall = this.findIntersection(lastX, lastY, x, y, z);
      if (wall) {
        [x, y] = slideAlongWall(wall, lastX, lastY, x, y);
        wall = this.findIntersection(lastX, lastY, x, y, z);
        if (wall) {
          // Try a little sideways step either way
          for (const side of [3, 1]) {
            const a = ((angle + (side * 4096) / 4) % 4096) * ((2 * Math.PI) / 4096);
            x = lastX + Math.trunc(MIN_SIDE_MOVE * Math.cos(a));
            y = lastY + Math.trunc(MIN_SIDE_MOVE * Math.sin(a));
            wall = this.findIntersection(lastX, lastY, x, y, z);
            if (!wall) break;
          }
          if (wall) {
            x = lastX;
            y = lastY;
            break;
          }
        }
      }
      // Off the room's edge: ask the server (edge exits) at most once a second; don't move.
      if (!this.isInRoom(x, y)) {
        if (now - this.moveOffRoomTime >= MOVE_OFF_ROOM_INTERVAL) {
          this.sink.move(x, y, SPEED_WALK);
          this.moveOffRoomTime = now;
        }
        x = lastX;
        y = lastY;
        break;
      }
      this.moveOffRoomTime = 0;
      const allowed = this.objectAllowed(objects, selfId, lastX, lastY, x, y, z, now);
      if (allowed === "blocked") {
        x = lastX;
        y = lastY;
        break;
      }
      if (allowed !== "ok") {
        [x, y] = allowed;
        moved = true;
        break;
      }
      lastX = x;
      lastY = y;
      moved = true;
    }
    if (!moved && x === this.x && y === this.y) return;
    this.x = x;
    this.y = y;
    // Climb or fall to the new floor (move.c: v_z with CLIMB/FALL velocity)
    const fz = this.floorBase(x, y);
    if (fz !== null) {
      this.destZ = fz;
      if (fz > this.z && this.vZ <= 0) this.vZ = CLIMB_VELOCITY;
      else if (fz < this.z && this.vZ >= 0) this.vZ = FALL_VELOCITY;
    }
    // Walking bob (BounceUser): BOUNCE_HEIGHT * sin(t), t advancing one radian per MOVE_DELAY
    this.bounceTime += Math.min(dt, MOVE_DELAY) / MOVE_DELAY;
    this.bounce = (FINENESS >> 5) * Math.sin(this.bounceTime);

    // move.c: splash while wading, spaced out more the deeper the water
    const floor0 = this.floorBase(origX, origY);
    if (
      depth !== 0 &&
      !(this.roomFlags & ROOM_OVERRIDE[depth]) &&
      this.z <= (floor0 ?? this.z) &&
      (this.lastSplash < 0 || now - this.lastSplash > 500 * depth)
    ) {
      this.sink.wade?.();
      this.lastSplash = now;
    }
    if (depth === 0) this.lastSplash = -1;
  }

  /** moveobj.c MoveSingleVertically for the player. */
  private settleHeight(dt: number): void {
    if (this.vZ === 0) return;
    this.z += (dt * this.vZ) / 1000;
    if (this.vZ > 0) {
      if (this.z >= this.destZ) {
        this.z = this.destZ;
        this.vZ = 0;
      }
    } else if (this.z <= this.destZ) {
      this.z = this.destZ;
      this.vZ = 0;
    } else this.vZ += (GRAVITY * dt) / 1000;
  }

  /**
   * move.c MoveUpdatePosition: send our exact position now (if it moved past the
   * threshold), before attacking or going through a door, so the server judges range
   * from where we really stand.
   */
  flush(now: number): void {
    if (!this.valid) return;
    const ddx = this.serverX - this.x,
      ddy = this.serverY - this.y;
    if (ddx * ddx + ddy * ddy > MOVE_THRESHOLD) {
      this.sink.move(this.x, this.y, this.lastFast ? SPEED_RUN : SPEED_WALK);
      this.serverX = this.x;
      this.serverY = this.y;
      this.serverTime = now;
    }
  }

  private updateServer(now: number): void {
    if (now - this.serverTime < MOVE_INTERVAL || !this.valid) return;
    const ddx = this.serverX - this.x,
      ddy = this.serverY - this.y;
    if (ddx * ddx + ddy * ddy > MOVE_THRESHOLD) {
      this.sink.move(this.x, this.y, this.lastFast ? SPEED_RUN : SPEED_WALK);
      this.serverX = this.x;
      this.serverY = this.y;
      this.serverTime = now;
    }
    if (this.serverAngle !== this.angle) {
      this.sink.turn(this.angle);
      this.serverAngle = this.angle;
      this.serverTime = now;
    }
  }

  private isInRoom(x: number, y: number): boolean {
    const b = this.room!.thingsBox;
    return !(x <= 0 || x >= b.maxX || y <= 0 || y >= b.maxY);
  }

  /** move.c FindIntersection: the first wall (depth-first) blocking a step. */
  private findIntersection(oldX: number, oldY: number, newX: number, newY: number, z: number): Wall | null {
    const room = this.room!;
    const visit = (idx: number): Wall | null => {
      const n = room.nodes[idx];
      if (!n || n.type !== "internal") return null;
      const w = this.intersectNode(idx, oldX, oldY, newX, newY, z);
      if (w) return w;
      return (n.pos ? visit(n.pos - 1) : null) ?? (n.neg ? visit(n.neg - 1) : null);
    };
    return room.nodes.length ? visit(0) : null;
  }

  /** move.c IntersectNode */
  private intersectNode(idx: number, oldX: number, oldY: number, newX: number, newY: number, z: number): Wall | null {
    const room = this.room!;
    const n = room.nodes[idx];
    if (n.type !== "internal") return null;
    const md = this.minDistance;
    const [bx0, by0, bx1, by1] = n.bbox;
    if (bx0 - newX > md || newX - bx1 > md || by0 - newY > md || newY - by1 > md) return null;
    const planeDistance = n.a * newX + n.b * newY + n.c;
    const oldDistance = n.a * oldX + n.b * oldY + n.c;
    if (Math.abs(planeDistance) / FINENESS > md || Math.abs(planeDistance) > Math.abs(oldDistance)) return null;
    const md2 = md * md;
    for (const wi of n.walls) {
      const w = room.walls[wi];
      if (newX < Math.min(w.x0, w.x1) - md || newX > Math.max(w.x0, w.x1) + md) continue;
      if (newY < Math.min(w.y0, w.y1) - md || newY > Math.max(w.y0, w.y1) + md) continue;
      // The side we're on decides which sidedef we'd walk through
      const sdNum = oldDistance > 0 ? w.posSidedef : w.negSidedef;
      const otherNum = oldDistance > 0 ? w.negSector : w.posSector;
      if (!sdNum) continue;
      const sd = room.sidedefs[sdNum - 1];
      const belowHeight = otherNum ? SECTOR_DEPTHS[room.sectors[otherNum - 1].flags & SF.DEPTH_MASK] : 0;
      // Passable if: low enough step, enough headroom, and the wall is passable
      if (
        (!sd.belowType || w.z1 - belowHeight - z <= MAX_STEP_HEIGHT) &&
        (!sd.aboveType || w.z2 - z >= PLAYER_HEIGHT) &&
        sd.flags & WF.PASSABLE
      )
        continue;
      let ddx = newX - w.x0,
        ddy = newY - w.y0;
      const d0 = ddx * ddx + ddy * ddy;
      ddx = newX - w.x1;
      ddy = newY - w.y1;
      const d1 = ddx * ddx + ddy * ddy;
      const lx = w.x1 - w.x0,
        ly = w.y1 - w.y0;
      const lenWall2 = lx * lx + ly * ly;
      if (d0 > lenWall2) {
        const ox = oldX - w.x1,
          oy = oldY - w.y1;
        if (d1 < md2 && d1 <= ox * ox + oy * oy) return w;
      } else if (d1 > lenWall2) {
        const ox = oldX - w.x0,
          oy = oldY - w.y0;
        if (d0 < md2 && d0 <= ox * ox + oy * oy) return w;
      } else return w;
    }
    return null;
  }

  /** move.c MoveObjectAllowed: monsters/players block; teleporters pause; hotplates notify. */
  private objectAllowed(
    objects: Iterable<MoverObject>, selfId: number, oldX: number, oldY: number, newX: number, newY: number, z: number, now: number,
  ): "ok" | "blocked" | [number, number] {
    for (const o of objects) {
      if (o.id === selfId) continue;
      const dx = Math.abs(o.x - newX),
        dy = Math.abs(o.y - newY);
      switch (o.info.moveOnType) {
        case MOVEON.NOTIFY:
          if (dx > MIN_HOTPLATE_DIST || dy > MIN_HOTPLATE_DIST) {
            if (o.id === this.lastNotifyId) this.lastNotifyId = -1;
            continue;
          }
          if (o.id !== this.lastNotifyId) {
            this.serverTime = 0; // force the position update (MoveUpdateServer)
            this.lastNotifyId = o.id;
          }
          break;
        case MOVEON.NO: {
          if (dx > MIN_NOMOVEON || dy > MIN_NOMOVEON || dx * dx + dy * dy > MIN_NOMOVEON * MIN_NOMOVEON) continue;
          const newDistance = dx * dx + dy * dy;
          const ox = Math.abs(o.x - this.x),
            oy = Math.abs(o.y - this.y);
          if (newDistance > ox * ox + oy * oy) break; // moving away is fine
          // Slide around a square of side MIN_NOMOVEON
          let nx = newX,
            ny = newY;
          if (dx < MIN_NOMOVEON) nx = o.x > nx ? o.x - MIN_NOMOVEON : o.x + MIN_NOMOVEON;
          else if (dy < MIN_NOMOVEON) ny = o.y > ny ? o.y - MIN_NOMOVEON : o.y + MIN_NOMOVEON;
          return this.findIntersection(oldX, oldY, nx, ny, z) ? "blocked" : [nx, ny];
        }
        case MOVEON.TELEPORTER:
          if (dx > MIN_NOMOVEON || dy > MIN_NOMOVEON || dx * dx + dy * dy > MIN_NOMOVEON * MIN_NOMOVEON) continue;
          this.nextMoveTime = now + TELEPORT_DELAY;
          break;
      }
    }
    return "ok";
  }
}

/** move.c SlideAlongWall: keep the component of the move along the wall. */
function slideAlongWall(w: Wall, xOld: number, yOld: number, xNew: number, yNew: number): [number, number] {
  const dx = xNew - xOld,
    dy = yNew - yOld;
  const wx = w.x1 - w.x0,
    wy = w.y1 - w.y0;
  const num = dx * wx + dy * wy;
  const denom = wx * wx + wy * wy || 1;
  return [xOld + Math.round((wx * num) / denom), yOld + Math.round((wy * num) / denom)];
}
