// Chess (module/chess): the board, its encoding as the game's state string, and the
// rules. The server only stores the state and passes it between the players (minigame.kod);
// the clients check every move. Ported from board.c and cmove.c, quirks included, so our
// players and the original's agree on what's legal.
//
// The state string (board.c): 64 bytes, one per square, top row first, each the piece
// (1 pawn, 2 rook, 3 knight, 4 bishop, 5 queen, 6 king, 7 none) with the colour in bit 7
// (0 white, 1 black, shown as red); then a byte of turn and castling flags, one of en
// passant, and one of resignations, each with bit 0 set. White starts at the top.

export const WHITE = 0;
export const BLACK = 1;
export const OBSERVER = 2;

export const PIECE = { PAWN: 1, ROOK: 2, KNIGHT: 3, BISHOP: 4, QUEEN: 5, KING: 6, NONE: 7 } as const;

export const BOARD_SIZE = 8;
/** board.h BOARD_STATE_LEN */
export const BOARD_STATE_LEN = 64 + 3;

export interface Square {
  color: number;
  piece: number;
}

export interface Point {
  /** Column */
  x: number;
  /** Row */
  y: number;
}

export interface Board {
  /** [row][col] */
  squares: Square[][];
  /** Whose turn it is */
  moveColor: number;
  canCastle: { left: boolean; right: boolean }[];
  /** The last move was a pawn's two squares forward; passant is the square it skipped */
  enPassant: boolean;
  passant: Point;
  whiteResigned: boolean;
  blackResigned: boolean;
}

const sgn = (v: number) => (v === 0 ? 0 : v > 0 ? 1 : -1);
const other = (color: number) => (color === WHITE ? BLACK : WHITE);

/** BoardInitialize */
export function initialBoard(): Board {
  const squares: Square[][] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    squares.push([]);
    for (let j = 0; j < BOARD_SIZE; j++) squares[i].push({ color: i < BOARD_SIZE / 2 ? WHITE : BLACK, piece: PIECE.NONE });
  }
  for (let j = 0; j < BOARD_SIZE; j++) {
    squares[1][j].piece = PIECE.PAWN;
    squares[6][j].piece = PIECE.PAWN;
  }
  const back = [PIECE.ROOK, PIECE.KNIGHT, PIECE.BISHOP, PIECE.KING, PIECE.QUEEN, PIECE.BISHOP, PIECE.KNIGHT, PIECE.ROOK];
  back.forEach((p, j) => {
    squares[0][j].piece = p;
    squares[7][j].piece = p;
  });
  return {
    squares,
    moveColor: WHITE,
    canCastle: [
      { left: true, right: true },
      { left: true, right: true },
    ],
    enPassant: false,
    passant: { x: 0, y: 0 },
    whiteResigned: false,
    blackResigned: false,
  };
}

export function cloneBoard(b: Board): Board {
  return {
    ...b,
    squares: b.squares.map((r) => r.map((s) => ({ ...s }))),
    canCastle: b.canCastle.map((c) => ({ ...c })),
    passant: { ...b.passant },
  };
}

/** BoardEncode: the state string, one byte per character (Latin-1) */
export function encodeBoard(b: Board): string {
  const bytes: number[] = [];
  for (const row of b.squares) for (const s of row) bytes.push(s.piece | (s.color << 7));
  bytes.push(
    0x01 | (b.moveColor << 1) | (b.canCastle[WHITE].left ? 0x04 : 0) | (b.canCastle[WHITE].right ? 0x08 : 0) |
      (b.canCastle[BLACK].left ? 0x10 : 0) | (b.canCastle[BLACK].right ? 0x20 : 0),
  );
  bytes.push((0x01 | (b.enPassant ? 0x02 : 0) | (b.passant.y << 2) | (b.passant.x << 5)) & 0xff);
  bytes.push(0x01 | (b.whiteResigned ? 0x02 : 0) | (b.blackResigned ? 0x04 : 0));
  return String.fromCharCode(...bytes);
}

/** BoardDecode; an empty state (no move yet) is the starting position (chess.c ChessGotState) */
export function decodeBoard(s: string): Board {
  if (!s) return initialBoard();
  const at = (i: number) => s.charCodeAt(i) & 0xff;
  const b = initialBoard();
  let index = 0;
  for (let i = 0; i < BOARD_SIZE; i++)
    for (let j = 0; j < BOARD_SIZE; j++) {
      b.squares[i][j] = { color: (at(index) & 0x80) >> 7, piece: at(index) & 0x07 };
      index++;
    }
  const flags = at(index++);
  b.moveColor = (flags & 0x02) >> 1;
  b.canCastle = [
    { left: (flags & 0x04) !== 0, right: (flags & 0x08) !== 0 },
    { left: (flags & 0x10) !== 0, right: (flags & 0x20) !== 0 },
  ];
  const passant = at(index++);
  b.enPassant = (passant & 0x02) !== 0;
  b.passant = { y: (passant & 0x1c) >> 2, x: (passant & 0xe0) >> 5 };
  const resigned = at(index);
  b.whiteResigned = (resigned & 0x02) !== 0;
  b.blackResigned = (resigned & 0x04) !== 0;
  return b;
}

/** PieceCanMove: the piece at p1 (ours) can move to p2, check aside */
function pieceCanMove(b: Board, p1: Point, p2: Point, color: number): boolean {
  if (p1.x === p2.x && p1.y === p2.y) return false;
  const piece = b.squares[p1.y][p1.x].piece;
  const s2 = b.squares[p2.y][p2.x];
  switch (piece) {
    case PIECE.PAWN: {
      const direction = color === WHITE ? 1 : -1;
      const dy = p2.y - p1.y;
      if (dy === 0 || Math.abs(dy) > 2 || sgn(dy) !== direction) return false;
      switch (Math.abs(p2.x - p1.x)) {
        case 0:
          if (s2.piece !== PIECE.NONE) return false;
          break;
        case 1: {
          // En passant
          const behind = b.squares[p2.y - direction]?.[p2.x];
          if (b.enPassant && behind && behind.piece === PIECE.PAWN && behind.color !== color && p2.x === b.passant.x && p2.y === b.passant.y) break;
          if (s2.piece === PIECE.NONE || s2.color === color) return false;
          break;
        }
        default:
          return false;
      }
      if (Math.abs(dy) === 2 && ((color === WHITE && p1.y !== 1) || (color === BLACK && p1.y !== 6))) return false;
      break;
    }
    case PIECE.ROOK:
      if (p1.x !== p2.x && p1.y !== p2.y) return false;
      break;
    case PIECE.KNIGHT:
      if (Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y) !== 3) return false;
      if (Math.abs(p2.x - p1.x) === 3 || Math.abs(p2.y - p1.y) === 3) return false;
      break;
    case PIECE.BISHOP:
      if (Math.abs(p2.x - p1.x) !== Math.abs(p2.y - p1.y)) return false;
      break;
    case PIECE.QUEEN:
      if (p1.x !== p2.x && p1.y !== p2.y && Math.abs(p2.x - p1.x) !== Math.abs(p2.y - p1.y)) return false;
      break;
    case PIECE.KING:
      if (isLegalCastle(b, p1, p2, color)) break;
      if (Math.abs(p2.x - p1.x) > 1 || Math.abs(p2.y - p1.y) > 1) return false;
      break;
    default:
      return false;
  }
  if (s2.piece !== PIECE.NONE && s2.color === color) return false;
  if (piece !== PIECE.KNIGHT && !pathIsClear(b, p1, p2, color)) return false;
  return true;
}

/** PathIsClear: nothing between p1 and p2, and p2 not ours */
function pathIsClear(b: Board, p1: Point, p2: Point, color: number): boolean {
  const dx = sgn(p2.x - p1.x);
  const dy = sgn(p2.y - p1.y);
  let x = p1.x + dx;
  let y = p1.y + dy;
  while (x !== p2.x || y !== p2.y) {
    if (b.squares[y][x].piece !== PIECE.NONE) return false;
    x += dx;
    y += dy;
  }
  return !(b.squares[y][x].piece !== PIECE.NONE && b.squares[y][x].color === color);
}

/** SquareIsAttacked: a piece of `color` could move to p */
function squareIsAttacked(b: Board, p: Point, color: number): boolean {
  for (let i = 0; i < BOARD_SIZE; i++)
    for (let j = 0; j < BOARD_SIZE; j++)
      if (b.squares[i][j].piece !== PIECE.NONE && b.squares[i][j].color === color && pieceCanMove(b, { x: j, y: i }, p, color)) return true;
  return false;
}

/** IsLegalCastle: the king to column 1 or 5 on its home row, allowed, the way clear and unattacked */
function isLegalCastle(b: Board, p1: Point, p2: Point, color: number): boolean {
  if (!((color === WHITE && p2.y === 0 && (p2.x === 1 || p2.x === 5)) || (color === BLACK && p2.y === BOARD_SIZE - 1 && (p2.x === 1 || p2.x === 5))))
    return false;
  const left = p2.x === 1;
  if ((left && !b.canCastle[color].left) || (!left && !b.canCastle[color].right)) return false;
  const [clearMin, clearMax] = left ? [1, 2] : [4, 6];
  for (let i = clearMin; i <= clearMax; i++) if (b.squares[p2.y][i].piece !== PIECE.NONE) return false;
  const [safeMin, safeMax] = left ? [1, 3] : [3, 5];
  for (let i = safeMin; i <= safeMax; i++) if (squareIsAttacked(b, { x: i, y: p2.y }, other(color))) return false;
  return true;
}

/** IsInCheck */
export function isInCheck(b: Board, color: number): boolean {
  for (let i = 0; i < BOARD_SIZE; i++)
    for (let j = 0; j < BOARD_SIZE; j++)
      if (b.squares[i][j].piece === PIECE.KING && b.squares[i][j].color === color) return squareIsAttacked(b, { x: j, y: i }, other(color));
  return false;
}

/** ChessMoveIsLegal: the piece at p1 (of `color`) may go to p2 without leaving its king in check */
export function isLegalMove(b: Board, p1: Point, p2: Point, color: number): boolean {
  if (!pieceCanMove(b, p1, p2, color)) return false;
  const after = cloneBoard(b);
  performMove(after, p1, p2);
  return !isInCheck(after, color);
}

/** ChessMovePerform asks for a piece here: a pawn reaching the far row */
export function needsPromotion(b: Board, p1: Point, p2: Point): boolean {
  return b.squares[p1.y][p1.x].piece === PIECE.PAWN && ((b.moveColor === WHITE && p2.y === BOARD_SIZE - 1) || (b.moveColor === BLACK && p2.y === 0));
}

/**
 * ChessMovePerform: make the move (assumed legal), with the rook in a castle, the pawn
 * taken en passant, the castling and en passant flags, and the turn passing. `promotion`
 * is the piece a pawn becomes on the far row (the original asks; without one it stays a pawn).
 */
export function performMove(b: Board, p1: Point, p2: Point, promotion?: number): void {
  let piece = b.squares[p1.y][p1.x].piece;
  if (promotion !== undefined && needsPromotion(b, p1, p2)) piece = promotion;
  b.squares[p1.y][p1.x].piece = piece;
  pieceMove(b, p1, p2);
  if (piece === PIECE.KING && Math.abs(p2.x - p1.x) > 1) {
    // The rook too
    if (p2.x === 1) pieceMove(b, { x: 0, y: p2.y }, { x: 2, y: p2.y });
    else pieceMove(b, { x: 7, y: p2.y }, { x: 4, y: p2.y });
  }
  if (piece === PIECE.PAWN && b.enPassant && p2.x === b.passant.x && p2.y === b.passant.y) {
    const direction = b.moveColor === WHITE ? 1 : -1;
    b.squares[p2.y - direction][p2.x].piece = PIECE.NONE;
  }
  if (piece === PIECE.KING) b.canCastle[b.moveColor] = { left: false, right: false };
  else if (piece === PIECE.ROOK && ((b.moveColor === WHITE && p1.y === 0) || (b.moveColor === BLACK && p1.y === 7))) {
    if (p1.x === 0) b.canCastle[b.moveColor].left = false;
    else if (p1.x === 7) b.canCastle[b.moveColor].right = false;
  }
  if (piece === PIECE.PAWN && Math.abs(p2.y - p1.y) > 1) {
    b.enPassant = true;
    b.passant = { x: p1.x, y: Math.trunc((p1.y + p2.y) / 2) };
  } else b.enPassant = false;
  b.moveColor = other(b.moveColor);
}

/** PieceMove */
function pieceMove(b: Board, p1: Point, p2: Point): void {
  b.squares[p2.y][p2.x].color = b.squares[p1.y][p1.x].color;
  b.squares[p2.y][p2.x].piece = b.squares[p1.y][p1.x].piece;
  b.squares[p1.y][p1.x].piece = PIECE.NONE;
}

/** HasLegalMove: every piece of `color` to every square, until one is legal */
export function hasLegalMove(b: Board, color: number): boolean {
  for (let i = 0; i < BOARD_SIZE; i++)
    for (let j = 0; j < BOARD_SIZE; j++) {
      if (b.squares[i][j].piece === PIECE.NONE || b.squares[i][j].color !== color) continue;
      for (let k = 0; k < BOARD_SIZE; k++) for (let l = 0; l < BOARD_SIZE; l++) if (isLegalMove(b, { x: j, y: i }, { x: l, y: k }, color)) return true;
    }
  return false;
}

/** ChessDlgShowGameStatus: the status line and whether the game is over */
export function gameStatus(b: Board): { message: "" | "White resigned." | "Red resigned." | "Checkmate!" | "Stalemate!" | "Check!"; over: boolean } {
  if (b.whiteResigned) return { message: "White resigned.", over: true };
  if (b.blackResigned) return { message: "Red resigned.", over: true };
  if (!hasLegalMove(b, b.moveColor)) return { message: isInCheck(b, b.moveColor) ? "Checkmate!" : "Stalemate!", over: true };
  if (isInCheck(b, b.moveColor)) return { message: "Check!", over: false };
  return { message: "", over: false };
}
