// Message type numbers from include/proto.h (kept in the same order).

export const AP = {
  PING: 1,
  LOGIN: 2,
  REGISTER: 3,
  REQ_GAME: 4,
  REQ_ADMIN: 5,
  RESYNC: 6,
  GETCLIENT: 7,
  GETRESOURCE: 8,
  GETALL: 9,
  REQ_MENU: 10,
  ADMINNOTE: 11,
  CLIENT_PATCH_OLD: 12,
  CLIENT_PATCH: 13,

  GETLOGIN: 21,
  GETCHOICE: 22,
  LOGINOK: 23,
  LOGINFAILED: 24,
  GAME: 25,
  ADMIN: 26,
  ACCOUNTUSED: 27,
  TOOMANYLOGINS: 28,
  TIMEOUT: 29,
  CREDITS: 30,
  DOWNLOAD: 31,
  UPLOAD: 32,
  NOCREDITS: 33,
  MESSAGE: 34,
  DELETERSC: 35,
  DELETEALLRSC: 36,
  NOCHARACTERS: 37,
  GUEST: 38,
  SERVICEREPORT: 39,
} as const;

export const BP = {
  ECHO_PING: 1,
  RESYNC: 2,
  PING: 3,
  ROUNDTRIP1: 4,
  ROUNDTRIP2: 5,
  SYSTEM: 6,

  LOGOFF: 20,
  WAIT: 21,
  UNWAIT: 22,
  CHANGE_PASSWORD: 23,
  AD_SELECTED: 24,

  CHANGE_RESOURCE: 30,
  SYS_MESSAGE: 31,
  MESSAGE: 32,

  SEND_PLAYER: 40,
  SEND_STATS: 41,
  SEND_ROOM_CONTENTS: 42,
  SEND_OBJECT_CONTENTS: 43,
  SEND_PLAYERS: 44,
  SEND_CHARACTERS: 45,
  USE_CHARACTER: 46,
  DELETE_CHARACTER: 47,
  NEW_CHARINFO: 48,
  SEND_CHARINFO: 49,
  SEND_SPELLS: 50,
  SEND_SKILLS: 51,
  SEND_STAT_GROUPS: 52,
  SEND_ENCHANTMENTS: 53,
  REQ_QUIT: 54,
  SAY_BLOCKED: 55,
  CHARINFO_OK: 56,
  CHARINFO_NOT_OK: 57,
  LOAD_MODULE: 58,
  UNLOAD_MODULE: 59,

  REQ_ADMIN: 60,
  REQ_DM: 61,
  REQ_ADMIN_QUEST: 62,

  EFFECT: 70,

  MAIL: 80,
  REQ_GET_MAIL: 81,
  SEND_MAIL: 82,
  DELETE_MAIL: 83,
  DELETE_NEWS: 84,
  REQ_ARTICLES: 85,
  REQ_ARTICLE: 86,
  POST_ARTICLE: 87,
  REQ_LOOKUP_NAMES: 88,

  ACTION: 90,
  REQ_MOVE: 100,
  REQ_TURN: 101,
  REQ_GO: 102,
  REQ_ATTACK: 103,
  REQ_SHOOT: 104,
  REQ_CAST: 105,
  REQ_USE: 106,
  REQ_UNUSE: 107,
  REQ_APPLY: 108,
  REQ_ACTIVATE: 109,
  SAY_TO: 110,
  SAY_GROUP: 111,
  REQ_PUT: 112,
  REQ_GET: 113,
  REQ_GIVE: 114,
  REQ_TAKE: 115,
  REQ_LOOK: 116,
  REQ_INVENTORY: 117,
  REQ_DROP: 118,
  REQ_HIDE: 119,
  REQ_OFFER: 120,
  ACCEPT_OFFER: 121,
  CANCEL_OFFER: 122,
  REQ_COUNTEROFFER: 123,
  REQ_BUY: 124,
  REQ_BUY_ITEMS: 125,
  CHANGE_DESCRIPTION: 126,
  REQ_INVENTORY_MOVE: 127,

  PLAYER: 130,
  STAT: 131,
  STAT_GROUP: 132,
  STAT_GROUPS: 133,
  ROOM_CONTENTS: 134,
  OBJECT_CONTENTS: 135,
  PLAYERS: 136,
  PLAYER_ADD: 137,
  PLAYER_REMOVE: 138,
  CHARACTERS: 139,
  CHARINFO: 140,
  SPELLS: 141,
  SPELL_ADD: 142,
  SPELL_REMOVE: 143,
  SKILLS: 144,
  SKILL_ADD: 145,
  SKILL_REMOVE: 146,
  ADD_ENCHANTMENT: 147,
  REMOVE_ENCHANTMENT: 148,
  QUIT: 149,
  BACKGROUND: 150,
  PLAYER_OVERLAY: 151,
  ADD_BG_OVERLAY: 152,
  REMOVE_BG_OVERLAY: 153,
  CHANGE_BG_OVERLAY: 154,
  USERCOMMAND: 155,
  REQ_STAT_CHANGE: 156,
  CHANGED_STATS: 157,
  CHANGED_STATS_OK: 158,
  CHANGED_STATS_NOT_OK: 159,

  PASSWORD_OK: 160,
  PASSWORD_NOT_OK: 161,
  ADMIN: 162,

  PLAY_WAVE: 170,
  PLAY_MUSIC: 171,
  PLAY_MIDI: 172,
  STOP_WAVE: 173,

  LOOK_NEWSGROUP: 180,
  ARTICLES: 181,
  ARTICLE: 182,

  LOOKUP_NAMES: 190,

  MOVE: 200,
  TURN: 201,
  SHOOT: 202,
  USE: 203,
  UNUSE: 204,
  USE_LIST: 205,
  SAID: 206,
  LOOK: 207,
  INVENTORY: 208,
  INVENTORY_ADD: 209,
  INVENTORY_REMOVE: 210,
  OFFER: 211,
  OFFER_CANCELED: 212,
  OFFERED: 213,
  COUNTEROFFER: 214,
  COUNTEROFFERED: 215,
  BUY_LIST: 216,
  CREATE: 217,
  REMOVE: 218,
  CHANGE: 219,
  LIGHT_AMBIENT: 220,
  LIGHT_PLAYER: 221,
  LIGHT_SHADING: 222,
  SECTOR_MOVE: 223,
  SECTOR_LIGHT: 224,
  WALL_ANIMATE: 225,
  SECTOR_ANIMATE: 226,
  CHANGE_TEXTURE: 227,
  INVALIDATE_DATA: 228,
  RADIUS_SHOOT: 229,
  REQ_DEPOSIT: 230,
  WITHDRAWAL_LIST: 231,
  REQ_WITHDRAWAL: 232,
  REQ_WITHDRAWAL_ITEMS: 233,
  XLAT_OVERRIDE: 234,
  WALL_SCROLL: 235,
  SECTOR_SCROLL: 236,
  SET_VIEW: 237,
  RESET_VIEW: 238,
  SECTOR_CHANGE: 239,
  REQ_GET_FROM_CONTAINER: 240,
} as const;

function invert(o: Record<string, number>): Map<number, string> {
  return new Map(Object.entries(o).map(([k, v]) => [v, k]));
}
const AP_NAMES = invert(AP);
const BP_NAMES = invert(BP);
export const apName = (t: number): string => AP_NAMES.get(t) ?? `AP_${t}`;
export const bpName = (t: number): string => BP_NAMES.get(t) ?? `BP_${t}`;

/** Animation types (include/proto.h). */
export const ANIMATE = {
  NONE: 1,
  CYCLE: 2,
  ONCE: 3,
  TRANSLATION: 9,
  EFFECT: 10,
} as const;

/** Server angle units per full circle. */
export const MAX_ANGLE = 4096;
/** Kod units per grid square. Server coordinates are 1-based (first square starts at 64). */
export const KOD_FINENESS = 64;

/** Object ids carry a 4-bit tag in the top bits; tag 1 = "number" item with an amount. */
export const CLIENT_TAG_NUMBER = 1;
export const objTag = (id: number): number => (id >>> 28) & 0xf;
export const objId = (id: number): number => id & 0x0fffffff;

/** LA_* login-message actions. */
export const LA = { NOTHING: 0, LOGOFF: 1 } as const;

/** Version our client reports (clientd3d/client.h MAJOR_REV/MINOR_REV). */
export const CLIENT_MAJOR = 50;
export const CLIENT_MINOR = 55;

/** Movement speeds the original client sends (clientd3d/move.c). */
export const SPEED_WALK = 25;
export const SPEED_RUN = 55;

/** Genders for character creation (kod blakston.khd). */
export const GENDER = { MALE: 1, FEMALE: 2 } as const;
