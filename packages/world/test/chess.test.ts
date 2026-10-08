import { describe, expect, test } from "vitest";
import {
  BLACK, PIECE, WHITE, decodeBoard, encodeBoard, gameStatus, initialBoard, isLegalMove, needsPromotion, performMove, type Board, type Point,
} from "../src/chess.ts";

const p = (y: number, x: number): Point => ({ x, y });
/** A legal move, made */
function move(b: Board, from: Point, to: Point): void {
  expect(isLegalMove(b, from, to, b.moveColor)).toBe(true);
  performMove(b, from, to);
}

describe("chess (module/chess)", () => {
  test("the state string: 64 squares then three flag bytes, round trip", () => {
    const b = initialBoard();
    const s = encodeBoard(b);
    expect(s.length).toBe(67);
    // White's back row at the top: rook, knight, bishop, king, queen...
    expect([...s.slice(0, 5)].map((c) => c.charCodeAt(0))).toEqual([2, 3, 4, 6, 5]);
    // Empty squares on red's half carry the red bit
    expect(s.charCodeAt(32)).toBe(0x87);
    expect(s.charCodeAt(64)).toBe(0x3d);
    expect(decodeBoard(s)).toEqual(b);
    expect(decodeBoard("")).toEqual(initialBoard());
  });

  test("pawns and knights", () => {
    const b = initialBoard();
    expect(isLegalMove(b, p(1, 4), p(3, 4), WHITE)).toBe(true);
    expect(isLegalMove(b, p(1, 4), p(4, 4), WHITE)).toBe(false);
    expect(isLegalMove(b, p(1, 4), p(0, 4), WHITE)).toBe(false);
    expect(isLegalMove(b, p(0, 1), p(2, 0), WHITE)).toBe(true);
    expect(isLegalMove(b, p(0, 0), p(2, 0), WHITE)).toBe(false);
  });

  test("fool's mate (mirrored: white's king starts in column 3)", () => {
    const b = initialBoard();
    move(b, p(1, 2), p(2, 2));
    move(b, p(6, 3), p(4, 3));
    move(b, p(1, 1), p(3, 1));
    expect(gameStatus(b).message).toBe("");
    move(b, p(7, 4), p(3, 0));
    expect(b.moveColor).toBe(WHITE);
    expect(gameStatus(b)).toEqual({ message: "Checkmate!", over: true });
  });

  test("castling moves the rook and ends the right to castle", () => {
    const b = initialBoard();
    for (const x of [4, 5, 6]) b.squares[0][x].piece = PIECE.NONE;
    expect(isLegalMove(b, p(0, 3), p(0, 5), WHITE)).toBe(true);
    performMove(b, p(0, 3), p(0, 5));
    expect(b.squares[0][5].piece).toBe(PIECE.KING);
    expect(b.squares[0][4].piece).toBe(PIECE.ROOK);
    expect(b.squares[0][7].piece).toBe(PIECE.NONE);
    expect(b.canCastle[WHITE]).toEqual({ left: false, right: false });
    expect(decodeBoard(encodeBoard(b))).toEqual(b);
  });

  test("en passant, and promotion", () => {
    const b = initialBoard();
    move(b, p(1, 4), p(3, 4));
    move(b, p(6, 0), p(5, 0));
    move(b, p(3, 4), p(4, 4));
    move(b, p(6, 3), p(4, 3));
    expect(b.enPassant).toBe(true);
    expect(b.passant).toEqual({ x: 3, y: 5 });
    move(b, p(4, 4), p(5, 3));
    expect(b.squares[4][3].piece).toBe(PIECE.NONE);
    expect(decodeBoard(encodeBoard(b)).passant).toEqual(b.passant);
    const c = initialBoard();
    c.squares[6][0] = { color: WHITE, piece: PIECE.PAWN };
    c.squares[7][0].piece = PIECE.NONE;
    expect(needsPromotion(c, p(6, 0), p(7, 0))).toBe(true);
    performMove(c, p(6, 0), p(7, 0), PIECE.QUEEN);
    expect(c.squares[7][0]).toEqual({ color: WHITE, piece: PIECE.QUEEN });
    expect(c.moveColor).toBe(BLACK);
  });

  test("resigning ends the game", () => {
    const b = initialBoard();
    b.blackResigned = true;
    expect(gameStatus(decodeBoard(encodeBoard(b)))).toEqual({ message: "Red resigned.", over: true });
  });
});
