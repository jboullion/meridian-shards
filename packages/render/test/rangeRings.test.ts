// Range rings (rangeRings.ts): one mesh a ring, laid on the floor, broken where the floor jumps,
// sliding with a moving centre, and gone (disposed) once no longer wanted.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { RangeRings, type RangeRing } from "../src/rangeRings.ts";

const RING: RangeRing = { x: 10240, y: 10240, radius: 4096, inner: 0, color: 31 };
const flat = () => 0;
const vertices = (rings: RangeRings) => ((rings.group.children[0] as THREE.Mesh).geometry.getAttribute("position") as THREE.BufferAttribute).count;

describe("RangeRings", () => {
  it("lays a ring on the floor and fades it away when it's no longer wanted", () => {
    const rings = new RangeRings();
    rings.update(new Map([["preview", RING]]), 16, flat);
    expect(rings.count).toBe(1);
    const mesh = rings.group.children[0] as THREE.Mesh;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    // on the floor, a little above it, at the radius (in squares)
    expect(pos.getY(1)).toBeCloseTo(0.06);
    expect(Math.hypot(pos.getX(1) - 10, pos.getZ(1) - 10)).toBeCloseTo(4);
    for (let i = 0; i < 30; i++) rings.update(new Map(), 16, flat);
    expect(rings.count).toBe(0);
    expect(rings.group.children).toHaveLength(0);
  });

  it("breaks where the floor jumps, and draws Earthquake's inner ring too", () => {
    const flatRings = new RangeRings();
    flatRings.update(new Map([["q", RING]]), 16, flat);
    const ledge = new RangeRings();
    // a raised floor east of the centre
    ledge.update(new Map([["q", RING]]), 16, (x) => (x > 10240 + 2048 ? 2048 : 0));
    expect(vertices(ledge)).toBeLessThan(vertices(flatRings));
    const quake = new RangeRings();
    quake.update(new Map([["q", { ...RING, inner: 2048 }]]), 16, flat);
    expect(vertices(quake)).toBeGreaterThan(vertices(flatRings));
  });

  it("slides with a moving centre, laying itself again only once it's gone far", () => {
    const rings = new RangeRings();
    let laid = 0;
    const floor = () => {
      laid++;
      return 0;
    };
    rings.update(new Map([["song", RING]]), 16, floor);
    const once = laid;
    rings.update(new Map([["song", { ...RING, x: RING.x + 100 }]]), 16, floor);
    expect(laid).toBe(once);
    expect(rings.group.children[0].position.x).toBeCloseTo(100 / 1024);
    rings.update(new Map([["song", { ...RING, x: RING.x + 2048 }]]), 16, floor);
    expect(laid).toBeGreaterThan(once);
    expect(rings.group.children[0].position.x).toBe(0);
  });
});
