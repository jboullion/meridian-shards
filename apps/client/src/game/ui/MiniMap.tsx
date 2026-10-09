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

/** include/proto.h MM_* */
const MM = {
  PLAYER: 0x1, ENEMY: 0x2, FRIEND: 0x4, GUILDMATE: 0x8, BUILDER_GROUP: 0x10, MONSTER: 0x20, NPC: 0x40,
  MINION_OTHER: 0x80, MINION_SELF: 0x100, TEMPSAFE: 0x200, MINIBOSS: 0x400, BOSS: 0x800, RARE_ITEM: 0x1000,
  NO_PVP: 0x2000,
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
  noPvp: "rgb(255,255,255)",
  npc: "rgb(0,0,0)",
  tempsafe: "rgb(0,170,255)",
  miniboss: "rgb(160,66,194)",
  boss: "rgb(127,0,0)",
  rareItem: "rgb(237,255,9)",
};
const WF_MAP_NEVER = 0x8;
const PLAYER_WIDTH = (31 * 64) / 4; // game.c player.width
/**
 * Ours: the player's arrow is never shorter than this from its middle to its tip (px). The
 * original sizes it with the map only, which leaves a few pixels, no direction to see, when a big
 * room fills a phone's map.
 */
const MIN_ARROW = 9;
const OBJECT_RADIUS = FINENESS / 4;

export function MiniMap({
  world, getRoom, zoom, paper, annotations, annotationIcon, onAnnotate, onClick, tooltips = false,
}: {
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
  }, [zoom, annotations, getRoom]);
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
        if (o.info.flags & OF.PLAYER) {
          if (mm & MM.BUILDER_GROUP) dot(COLOR.builder, COLOR.player, 2.6 * radius, x, y);
          if (mm & MM.FRIEND) dot(COLOR.friend, COLOR.player, 1.6 * radius, x, y, 4);
          if (mm & MM.ENEMY) dot(COLOR.enemy, COLOR.player, 1.6 * radius, x, y, 4);
          if (mm & MM.GUILDMATE) dot(COLOR.guildmate, COLOR.player, 1.6 * radius, x, y, 4);
        }
        if (mm & MM.PLAYER) dot(COLOR.player, COLOR.player, radius, x, y);
        else if (mm & MM.TEMPSAFE) dot(COLOR.tempsafe, COLOR.tempsafe, radius, x, y);
        else if (mm & MM.NO_PVP) dot(COLOR.noPvp, COLOR.noPvp, radius, x, y);
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

      // The player (MapDrawPlayer): a line through us with an arrowhead in front
      const mm = self.info.minimapFlags;
      ctx.strokeStyle = mm & MM.TEMPSAFE ? COLOR.tempsafe : mm & MM.NO_PVP ? COLOR.noPvp : COLOR.player;
      ctx.lineWidth = 2;
      const a = (self.angle * 2 * Math.PI) / 4096;
      const arrowScale = Math.max(scale, MIN_ARROW / ((PLAYER_WIDTH * 3) / 4));
      const off = (d: number, ang: number) => [Math.trunc(d * Math.cos(ang) * arrowScale), Math.trunc(d * Math.sin(ang) * arrowScale)];
      const [dx, dy] = off((PLAYER_WIDTH * 3) / 4, a);
      const [ldx, ldy] = off(PLAYER_WIDTH / 4, a + Math.PI / 2);
      const [rdx, rdy] = off(PLAYER_WIDTH / 4, a - Math.PI / 2);
      const cx = xo + Math.trunc(px * scale),
        cy = yo + Math.trunc(py * scale);
      ctx.beginPath();
      ctx.moveTo(cx - dx, cy - dy);
      ctx.lineTo(cx + dx, cy + dy);
      ctx.lineTo(cx + ldx, cy + ldy);
      ctx.lineTo(cx + rdx, cy + rdy);
      ctx.lineTo(cx + dx, cy + dy);
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
