// Object flags as the original game sends them, and how we read them (ADR 0005).
//
// Upstream packs four things into one 32-bit `flags` (include/proto.h:357-411): how you may
// move onto the object, the player type, the drawing effect, and the minimap relations. The
// rest of the client works with those as separate fields (drawingType, nameColor,
// minimapFlags, objectType, moveOnType) and reads `flags` with the bit layout below (OF), so
// normalizeFlags() unpacks them once, here, following the original client's own rules:
//   names drawn:  clientd3d/d3drender_objects.c (players only)
//   name colours: clientd3d/color.c GetPlayerNameColor
//   minimap dots: clientd3d/map.c MapDrawObjects
//   hanging:      clientd3d/moveobj.c (OF_HANGING on a non-player)
//   bouncing:     clientd3d/object.c ObjectIsBouncing (both light bits)

/** Upstream's bits, as sent (include/proto.h) */
export const UF = {
  MOVEON_MASK: 0x00000003,
  PLAYER: 0x00000004,
  /** Overlaps ACTIVATABLE: on an OF_PLAYER object it marks a non-player that looks like one */
  FALSEPLAYER: 0x00000800,
  /** Our own object only: safety is on */
  SAFETY: 0x00002000,
  PLAYER_MASK: 0x0001c000,
  /** Overlaps PF_CREATOR: only on non-players */
  HANGING: 0x00010000,
  FLICKERING: 0x00020000,
  FLASHING: 0x00040000,
  /** Both light bits: the object bounces instead */
  BOUNCING: 0x00060000,
  EFFECT_MASK: 0x01f00000,
  ENEMY: 0x02000000,
  FRIEND: 0x04000000,
  GUILDMATE: 0x08000000,
} as const;

/** Upstream's player types, the OF_PLAYER_MASK bits (PF_*) */
export const PF = { KILLER: 0x4000, OUTLAW: 0x8000, DM: 0xc000, CREATOR: 0x10000, SUPER: 0x14000, EVENTCHAR: 0x1c000 } as const;

/**
 * The `flags` layout the rest of the client reads (the render package's OF table uses the
 * same bits). The bits upstream shares with it keep their meaning; the others are set here.
 */
export const OF = {
  DISPLAY_NAME: 0x1, SIGN: 0x2, PLAYER: 0x4, ATTACKABLE: 0x8, GETTABLE: 0x10, CONTAINER: 0x20, NOEXAMINE: 0x40,
  HANGING: 0x100, OFFERABLE: 0x200, BUYABLE: 0x400, ACTIVATABLE: 0x800, APPLYABLE: 0x1000, NPC: 0x2000,
  BOUNCING: 0x10000, FLICKERING: 0x20000, FLASHING: 0x40000, PHASING: 0x80000,
} as const;

/** Bits upstream and our layout agree on */
const SHARED = OF.PLAYER | OF.ATTACKABLE | OF.GETTABLE | OF.CONTAINER | OF.NOEXAMINE | OF.OFFERABLE | OF.BUYABLE | OF.ACTIVATABLE | OF.APPLYABLE | OF.PHASING;

/** Drawing effects (DRAWFX_*): upstream sends the index in flags bits 20-24 */
export const DRAWFX = { PLAIN: 0, BLACK: 4, INVISIBLE: 5 } as const;

/** Object types (OT_*): upstream's player types */
export const OT = { NONE: 0, KILLER: 1, OUTLAW: 2, DM: 3, CREATOR: 4, SUPER: 5, MODERATOR: 6, EVENTCHAR: 7 } as const;

/** Minimap bits (MM_*) the minimap draws; upstream can only tell us these */
export const MM = { PLAYER: 0x1, ENEMY: 0x2, FRIEND: 0x4, GUILDMATE: 0x8, MONSTER: 0x20 } as const;

/** color.c NAME_COLOR_*: blakston.pal 254 cyan, 251 yellow and 250 green for the palette ones */
const NAME_COLOR = {
  NORMAL: 0xffffff, OUTLAW: 0xfc8000, KILLER: 0xff0000, EVENT: 0xff00ff, CREATOR: 0xffff00, SUPER: 0x00ff00, DM: 0x00ffff, BLACK: 0x000000,
} as const;

export interface UnpackedFlags {
  /** In our layout (OF) */
  flags: number;
  drawingType: number;
  minimapFlags: number;
  nameColor: number;
  objectType: number;
  moveOnType: number;
  /** Our own object only: safety is on (OF_SAFETY) */
  safety: boolean;
}

/** Unpacks upstream's `flags` (see the top of this file). */
export function normalizeFlags(sent: number): UnpackedFlags {
  const player = (sent & UF.PLAYER) !== 0;
  const drawingType = (sent & UF.EFFECT_MASK) >>> 20;
  let flags = sent & SHARED;
  // d3drender_objects.c draws names over players only
  if (player) flags |= OF.DISPLAY_NAME;
  // moveobj.c: OF_HANGING counts on non-players (on players the bit is PF_CREATOR)
  if (!player && sent & UF.HANGING) flags |= OF.HANGING;
  // object.c ObjectIsBouncing: both light bits mean bouncing, and neither light effect
  if ((sent & UF.BOUNCING) === UF.BOUNCING) flags |= OF.BOUNCING;
  else flags |= sent & (UF.FLICKERING | UF.FLASHING);

  const playerType = player ? sent & UF.PLAYER_MASK : 0;
  const objectType =
    playerType === PF.KILLER ? OT.KILLER
    : playerType === PF.OUTLAW ? OT.OUTLAW
    : playerType === PF.DM ? OT.DM
    : playerType === PF.CREATOR ? OT.CREATOR
    : playerType === PF.SUPER ? OT.SUPER
    : playerType === PF.EVENTCHAR ? OT.EVENTCHAR
    : OT.NONE;

  // color.c GetPlayerNameColor
  const nameColor =
    drawingType === DRAWFX.BLACK ? NAME_COLOR.BLACK
    : objectType === OT.DM ? NAME_COLOR.DM
    : objectType === OT.KILLER ? NAME_COLOR.KILLER
    : objectType === OT.OUTLAW ? NAME_COLOR.OUTLAW
    : objectType === OT.CREATOR ? NAME_COLOR.CREATOR
    : objectType === OT.SUPER ? NAME_COLOR.SUPER
    : objectType === OT.EVENTCHAR ? NAME_COLOR.EVENT
    : NAME_COLOR.NORMAL;

  // map.c MapDrawObjects: attackable objects only; players blue with rings, the rest red
  let minimapFlags = 0;
  if (sent & OF.ATTACKABLE) {
    if (player) {
      minimapFlags |= MM.PLAYER;
      if (sent & UF.ENEMY) minimapFlags |= MM.ENEMY;
      if (sent & UF.FRIEND) minimapFlags |= MM.FRIEND;
      if (sent & UF.GUILDMATE) minimapFlags |= MM.GUILDMATE;
    } else minimapFlags |= MM.MONSTER;
  }

  return {
    flags, drawingType, minimapFlags, nameColor, objectType,
    moveOnType: sent & UF.MOVEON_MASK,
    safety: (sent & UF.SAFETY) !== 0,
  };
}
