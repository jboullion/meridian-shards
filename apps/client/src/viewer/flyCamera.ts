// Free camera for the room viewer: click to capture the mouse (pointer lock), then
// mouse to look, WASD to move, Space/C (or E/Q) up/down, Shift for speed. Esc releases.

import * as THREE from "three";

export class FlyCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  speed = 4; // squares per second
  private keys = new Set<string>();
  private readonly el: HTMLElement;
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (document.pointerLockElement !== this.el) return;
    this.keys.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.el) return;
    this.yaw -= e.movementX * 0.0025;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.0025));
  };
  private readonly onClick = () => {
    if (document.pointerLockElement !== this.el) this.el.requestPointerLock();
  };
  private readonly onBlur = () => this.keys.clear();

  constructor(camera: THREE.PerspectiveCamera, el: HTMLElement) {
    this.camera = camera;
    this.el = el;
    el.addEventListener("click", this.onClick);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("blur", this.onBlur);
  }

  /** Client angle units (4096 per circle, 0 = east, increasing towards south) to a yaw. */
  setClientAngle(angle: number): void {
    // Scene: -Z is "north" (client -y). A client angle a points along (cos a, sin a) in
    // client x/y = scene (X, Z). Three's camera looks down -Z at yaw 0.
    const a = (angle * 2 * Math.PI) / 4096;
    this.yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
  }

  update(dt: number): void {
    const fast = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 4 : 1;
    const v = this.speed * fast * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.camera.position;
    if (this.keys.has("KeyW")) p.addScaledVector(fwd, v);
    if (this.keys.has("KeyS")) p.addScaledVector(fwd, -v);
    if (this.keys.has("KeyD")) p.addScaledVector(right, v);
    if (this.keys.has("KeyA")) p.addScaledVector(right, -v);
    if (this.keys.has("Space") || this.keys.has("KeyE")) p.y += v;
    if (this.keys.has("KeyC") || this.keys.has("KeyQ")) p.y -= v;
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  dispose(): void {
    this.el.removeEventListener("click", this.onClick);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("blur", this.onBlur);
  }
}
