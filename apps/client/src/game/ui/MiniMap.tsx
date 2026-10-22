// The minimap (clientd3d/map.c MapDraw with bMiniMap): the room's walls in black on
// the map paper (mapbkgnd.bmp, scrolling with the player), a dot per object with
// minimap flags, and the player's arrow, centred on the player and zoomable (+/-).
// Map annotations (annotate.c) are drawn as annotate.bmp; a right click on the map (the
// Look action, gameuser.c UserLookMouseSquare) adds or edits one, and hovering shows it.

import { useEffect, useRef, useState } from "react";
import { annotationAt, annotationRadius, type MapAnnotation } from "../annotations.ts";
import { FINENESS, type Room } from "@shards/formats";
import { DRAWFX, OF } from "@shards/render";
import type { WorldState } from "@shards/world";
import { currentSocial } from "../social.ts";
import { markerFor, TIER_COLOR, type MarkerTier } from "../markers.ts";
import type { MapWay } from "../questWays.ts";

/** include/proto.h MM_* (ours: not MM_TEMPSAFE, 0x200, or MM_NO_PVP, 0x2000: the guardian angel's
 *  light blue and the PvP opt-out's white went with random PvP) */
const MM = {
  PLAYER: 0x1, ENEMY: 0x2, FRIEND: 0x4, GUILDMATE: 0x8, BUILDER_GROUP: 0x10, MONSTER: 0x20, NPC: 0x40,
  MINION_OTHER: 0x80, MINION_SELF: 0x100, MINIBOSS: 0x400, BOSS: 0x800, RARE_ITEM: 0x1000,
} as const;

const COLOR = {
  wall: "rgb(0,0,0)",
  player: "rgb(0,0,255)",
  object: "rgb(255,0,0)",
  minion: "rgb(0,200,0)",
  minionOther: "rgb(70,5,130)",
  friend: "rgb(0,255,120)",
  enemy: "rgb(255,0,0)",
  guildmate: "rgb(255,255,0)",
  builder: "rgb(0,255,0)",
  npc: "rgb(0,0,0)",
  miniboss: "rgb(160,66,194)",
  boss: "rgb(127,0,0)",
  rareItem: "rgb(237,255,9)",
  /** Ours: a friend's pin (docs/adr/0005-friends.md 3, Map marker) */
  friendPin: "rgb(60,220,120)",
};
const WF_MAP_NEVER = 0x8;
const PLAYER_WIDTH = (31 * 64) / 4; // game.c player.width
/**
 * Ours: the player's arrow is never shorter than this from its middle to its tip (px). The
 * original sizes it with the map only, which leaves a few pixels, no direction to see, when a big
 * room fills a phone's map.
 */
const MIN_ARROW = 9;
/** Ours: the quest way's chevrons stop growing with the zoom here (pixels from the tip to the middle) */
const CHEVRON_MAX = 9;
const OBJECT_RADIUS = FINENESS / 4;

export function MiniMap({
  world, getRoom, zoom, paper, annotations, annotationIcon, onAnnotate, onClick, tooltips = false, questMarkers = true, getWay,
}: {
  /** Ours (docs/adr/0009-quests.md 5): our tracked quests' area here (a gold wash) and the way out toward them; none with Show the way off */
  getWay?: () => MapWay | null;
  /** Ours (docs/adr/0009-quests.md 2): quests' "!" and "?" and the rings round their targets */
  questMarkers?: boolean;
  /** Ours (the Modern interface): a left click on the map, which opens or closes the full map */
  onClick?: () => void;
  world: WorldState;
  getRoom: () => Room | null;
  zoom: number;
  /** URL of the map paper bitmap */
  paper: string;
  /** The room's annotations to draw (Map annotations on), or none */
  annotations?: readonly MapAnnotation[];
  /** URL of annotate.bmp */
  annotationIcon?: string;
  /** A right click on the map, in room fine coordinates (annotate.c MapAnnotationClick) */
  onAnnotate?: (x: number, y: number) => void;
  /** Show an annotation's text on hover (MapAnnotationGetText) */
  tooltips?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef(zoom);
  const annotationsRef = useRef(annotations);
  const questMarkersRef = useRef(questMarkers);
  const getWayRef = useRef(getWay);
  // Callers pass a new getRoom on every render (typing, zooming); keeping it in a ref stops
  // the drawing loop restarting, which dropped the paper for a frame or two.
  const getRoomRef = useRef(getRoom);
  /** The last frame's mapping (map.c xoffsetMiniMap, yoffsetMiniMap, scaleMiniMap) for MapScreenToRoom */
  const mapping = useRef<{ xo: number; yo: number; scale: number } | null>(null);
  const [hoverText, setHoverText] = useState<string | undefined>(undefined);
  useEffect(() => {
    zoomRef.current = zoom;
    annotationsRef.current = annotations;
    getRoomRef.current = getRoom;
    questMarkersRef.current = questMarkers;
    getWayRef.current = getWay;
  }, [zoom, annotations, getRoom, questMarkers, getWay]);
  /** MapScreenToRoom with bMiniMap */
  const toRoom = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const m = mapping.current;
    const canvas = canvasRef.current;
    if (!m || !canvas || m.scale === 0) return null;
    const r = canvas.getBoundingClientRect();
    // Ours: the canvas may be zoomed (the Modern HUD's size), so page pixels to the canvas's own
    const k = r.width ? canvas.clientWidth / r.width : 1;
    return [Math.trunc(((e.clientX - r.left) * k - m.xo) / m.scale), Math.trunc(((e.clientY - r.top) * k - m.yo) / m.scale)];
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let pattern: CanvasPattern | null = null;
    const img = new Image();
    img.onload = () => (pattern = ctx.createPattern(img, "repeat"));
    img.src = paper;
    let icon: HTMLImageElement | null = null;
    if (annotationIcon) {
      const i = new Image();
      i.onload = () => (icon = i);
      i.src = annotationIcon;
    }
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 33) return; // ~30 fps is plenty
      last = t;
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const room = getRoomRef.current();
      const self = world.self;
      if (!room || !self) {
        ctx.fillStyle = pattern ?? "#bbb";
        ctx.fillRect(0, 0, w, h);
        return;
      }
      const scale = Math.min(w / room.width, h / room.height) * zoomRef.current;
      const px = self.x,
        py = self.y;
      const xo = Math.floor(w / 2 - px * scale),
        yo = Math.floor(h / 2 - py * scale);
      mapping.current = { xo, yo, scale };

      // Paper scrolls with the player
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (pattern) {
        pattern.setTransform(new DOMMatrix().translate(-Math.floor(px * scale) % 64, -Math.floor(py * scale) % 64));
        ctx.fillStyle = pattern;
      } else ctx.fillStyle = "#bbb";
      ctx.fillRect(0, 0, w, h);

      // Walls (MapDrawWalls): every wall with a sidedef that may show on the map
      ctx.strokeStyle = COLOR.wall;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const wall of room.walls) {
        const sd = room.sidedefs[(wall.posSidedef || wall.negSidedef) - 1];
        if (!sd || sd.flags & WF_MAP_NEVER) continue;
        ctx.moveTo(Math.trunc(wall.x0 * scale) + xo + 0.5, Math.trunc(wall.y0 * scale) + yo + 0.5);
        ctx.lineTo(Math.trunc(wall.x1 * scale) + xo + 0.5, Math.trunc(wall.y1 * scale) + yo + 0.5);
      }
      ctx.stroke();

      // Ours (docs/adr/0009-quests.md 5.2): a tracked quest's area, washed gold, under the objects
      const way = getWayRef.current?.() ?? null;
      if (way?.wash) {
        ctx.fillStyle = "rgba(255,196,40,0.18)";
        ctx.fillRect(0, 0, w, h);
      }

      // Annotations (MapDrawAnnotations): annotate.bmp, at least 14 pixels across
      const notes = annotationsRef.current;
      if (notes && icon) {
        const r = annotationRadius(scale);
        ctx.imageSmoothingEnabled = false;
        for (const n of notes) ctx.drawImage(icon, xo + Math.trunc(n.x * scale) - r, yo + Math.trunc(n.y * scale) - r, 2 * r, 2 * r);
      }

      // Objects (MapDrawObjects)
      const radius = Math.max(1, OBJECT_RADIUS * scale);
      const dot = (stroke: string, fill: string, r: number, x: number, y: number, width = 2) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = width;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      };
      for (const o of world.objects.values()) {
        if (o.id === self.id) continue;
        const mm = o.info.minimapFlags;
        if (o.info.drawingType === DRAWFX.INVISIBLE || mm === 0) continue;
        const x = xo + o.x * scale,
          y = yo + o.y * scale;
        // Ours (markers.ts): travel portals, with a gold "!" until we attune to them; quests'
        // "!" and "?" in place of the NPC's dot, and a gold ring round a monster we're to kill
        const marker = markerFor(mm, questMarkersRef.current);
        if (marker?.map === "glyph" && marker.glyph) {
          glyphMark(ctx, marker.glyph, marker.grey, marker.tier, x, y, Math.max(7, 3.2 * radius));
          continue;
        }
        if (marker?.map === "portal") {
          portalSign(ctx, x, y, Math.max(3, 1.6 * radius));
          continue;
        }
        if (marker?.map === "ring") targetRing(ctx, x, y, Math.max(3, 2.4 * radius));
        if (o.info.flags & OF.PLAYER) {
          if (mm & MM.BUILDER_GROUP) dot(COLOR.builder, COLOR.player, 2.6 * radius, x, y);
          if (mm & MM.FRIEND) dot(COLOR.friend, COLOR.player, 1.6 * radius, x, y, 4);
          if (mm & MM.ENEMY) dot(COLOR.enemy, COLOR.player, 1.6 * radius, x, y, 4);
          if (mm & MM.GUILDMATE) dot(COLOR.guildmate, COLOR.player, 1.6 * radius, x, y, 4);
        }
        if (mm & MM.PLAYER) dot(COLOR.player, COLOR.player, radius, x, y);
        else if (mm & MM.MINION_SELF) dot(COLOR.minion, COLOR.minion, radius, x, y);
        else if (mm & MM.MINION_OTHER) dot(COLOR.minionOther, COLOR.minionOther, radius, x, y);
        else if (mm & MM.MONSTER) dot(COLOR.object, COLOR.object, radius, x, y);
        else if (mm & MM.NPC) dot(COLOR.npc, COLOR.npc, radius, x, y);
        else if (mm & MM.RARE_ITEM) star(ctx, radius * 3, x, y);
        else if (mm & MM.MINIBOSS) {
          dot(COLOR.miniboss, COLOR.object, radius * 2.1, x, y, 3);
          dot(COLOR.object, COLOR.object, radius * 1.2, x, y);
        } else if (mm & MM.BOSS) {
          dot(COLOR.boss, COLOR.object, radius * 2.6, x, y, 3);
          dot(COLOR.object, COLOR.object, radius * 1.6, x, y);
        }
      }

      // Ours: friends' pins (Map marker), over their dots
      const marked = currentSocial()?.markerIds();
      if (marked?.size)
        for (const id of marked) {
          const o = world.objects.get(id);
          if (o) pin(ctx, xo + o.x * scale, yo + o.y * scale, Math.max(5, 2.2 * radius));
        }

      // Ours (5.3): the way out toward a tracked quest's rooms: a gold chevron on each exit to take
      // that's on the map, else an arrow at the map's rim toward the nearest
      if (way?.marks.length) {
        const cx0 = xo + px * scale,
          cy0 = yo + py * scale;
        const rim = Math.min(w, h) / 2 - 9;
        const points = way.marks.map((m) => {
          const [tx, ty] =
            m.kind === "door"
              ? [(m.col - 0.5) * 1024, (m.row - 0.5) * 1024]
              : m.side === "N"
                ? [px, 0]
                : m.side === "S"
                  ? [px, room.height]
                  : m.side === "W"
                    ? [0, py]
                    : [room.width, py];
          return { x: xo + tx * scale, y: yo + ty * scale };
        });
        const onMap = points.filter((p) => Math.hypot(p.x - w / 2, p.y - h / 2) <= rim);
        // Capped: a small room's map is zoomed right in, and the chevrons grew to cover it
        const size = Math.min(CHEVRON_MAX, Math.max(6, 2.6 * radius));
        for (const p of onMap) chevron(ctx, p.x, p.y, Math.atan2(p.y - cy0, p.x - cx0), size);
        if (!onMap.length) {
          const p = points.reduce((a, b) => (Math.hypot(b.x - cx0, b.y - cy0) < Math.hypot(a.x - cx0, a.y - cy0) ? b : a));
          const ang = Math.atan2(p.y - cy0, p.x - cx0);
          chevron(ctx, w / 2 + Math.cos(ang) * rim, h / 2 + Math.sin(ang) * rim, ang, size * 1.3);
        }
      }

      // The player. Ours: a filled arrowhead, outlined, at fractional pixels. The original's
      // (MapDrawPlayer: a line through us with a head in front) rounded each point on its own,
      // so it bent and twitched as we turned.
      const a = (self.angle * 2 * Math.PI) / 4096;
      const size = Math.max(scale * ((PLAYER_WIDTH * 3) / 4), MIN_ARROW);
      const cx = xo + px * scale,
        cy = yo + py * scale;
      const at = (d: number, side: number) => {
        const c = Math.cos(a),
          s = Math.sin(a);
        return [cx + (d * c - side * s) * size, cy + (d * s + side * c) * size] as const;
      };
      ctx.beginPath();
      ctx.moveTo(...at(1, 0));
      ctx.lineTo(...at(-0.7, 0.62));
      ctx.lineTo(...at(-0.35, 0));
      ctx.lineTo(...at(-0.7, -0.62));
      ctx.closePath();
      ctx.fillStyle = COLOR.player;
      ctx.fill();
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [world, paper, annotationIcon]);

  return (
    <canvas
      ref={canvasRef}
      className={onClick ? "minimap clickable" : "minimap"}
      onClick={onClick}
      title={tooltips ? hoverText : undefined}
      onContextMenu={(e) => {
        if (!onAnnotate) return;
        e.preventDefault();
        e.stopPropagation();
        const p = toRoom(e);
        if (p) onAnnotate(p[0], p[1]);
      }}
      onMouseMove={(e) => {
        if (!tooltips || !annotations?.length) return;
        const p = toRoom(e);
        const i = p ? annotationAt(annotations, p[0], p[1]) : -1;
        setHoverText(i >= 0 ? annotations[i].text : undefined);
      }}
    />
  );
}

/** Ours (docs/adr/0009-quests.md 5.3): a gold chevron pointing the way (angle in radians, 0 east) */
function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number): void {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const at = (d: number, side: number) => [x + d * c - side * s, y + d * s + side * c] as const;
  ctx.beginPath();
  ctx.moveTo(...at(size, 0));
  ctx.lineTo(...at(-size * 0.6, size * 0.75));
  ctx.lineTo(...at(-size * 0.15, 0));
  ctx.lineTo(...at(-size * 0.6, -size * 0.75));
  ctx.closePath();
  ctx.fillStyle = "rgb(255,200,40)";
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgb(40,20,0)";
  ctx.stroke();
}

/** Ours: a friend's pin, its point on them */
function pin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y - 2 * r, r, Math.PI * 0.75, Math.PI * 0.25);
  ctx.closePath();
  ctx.fillStyle = COLOR.friendPin;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgb(0,0,0)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - 2 * r, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgb(255,255,255)";
  ctx.fill();
}

/** map.c DrawMinimapStar: a five-pointed star for rare items. */
function star(ctx: CanvasRenderingContext2D, size: number, x: number, y: number): void {
  ctx.beginPath();
  for (let i = 0; i < 11; i++) {
    const r = (size * ((i % 2) + 1)) / 2;
    const w = ((Math.PI * 2) / 10) * i;
    ctx.lineTo(x + r * Math.sin(w), y + r * Math.cos(w));
  }
  ctx.fillStyle = COLOR.rareItem;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.rareItem;
  ctx.stroke();
}

/** Ours (markers.ts): a gold "!" or "?" standing on the spot (grey: not yet), outlined to read on any floor */
function glyphMark(ctx: CanvasRenderingContext2D, glyph: string, grey: boolean, tier: MarkerTier, x: number, y: number, size: number): void {
  ctx.save();
  ctx.font = `bold ${Math.round(size * 1.6)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 3;
  const [fill, outline] = TIER_COLOR[tier];
  ctx.strokeStyle = grey ? "rgb(30,30,30)" : outline;
  ctx.strokeText(glyph, x, y + size * 0.6);
  ctx.fillStyle = grey ? "rgb(170,170,170)" : fill;
  ctx.fillText(glyph, x, y + size * 0.6);
  ctx.restore();
}

/** Ours (markers.ts): a gold ring round a monster that counts for one of our quest steps */
function targetRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, r / 3);
  ctx.strokeStyle = "rgb(255,200,40)";
  ctx.stroke();
}

/** Ours (markers.ts): an attuned travel portal, a small purple ring */
function portalSign(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, r / 2);
  ctx.strokeStyle = "rgb(190,120,255)";
  ctx.stroke();
}
