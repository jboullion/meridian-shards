// The chess module's window (module/chess chess.c, chess.rc IDD_CHESS): the board, the
// players' names with whose turn it is, the status (check, checkmate...), and Resign,
// Restart game, Reset players and Close window. The server loads it with BP_LOAD_MODULE
// "chess.dll" when someone uses a chess board, and passes the state string between the
// players; the moves are checked here (packages/world chess.ts). Pawns reaching the far row
// ask what to become (IDD_PROMOTION).

import { useState } from "react";
import { buildMinigameResetPlayers, buildMinigameState } from "@shards/protocol";
import {
  BLACK, OBSERVER, PIECE, WHITE, gameStatus, initialBoard, isLegalMove, needsPromotion, performMove, cloneBoard, encodeBoard,
  type Board, type GameSession, type Point,
} from "@shards/world";
import type { AssetStore } from "../../assets.ts";
import { useKeyedImage } from "./keyed.ts";
import { Button, Check, MessageBox, Text, Window } from "./kit.tsx";

/** The game as the server has told us: our player number, the board once it's come, the names */
export interface ChessState {
  game: number;
  /** WHITE, BLACK or OBSERVER (chess.c HandleGameStart: player 1, 2, or more) */
  color: number;
  /** null until the first state (b.valid) */
  board: Board | null;
  /** IDC_WHITENAME, IDC_BLACKNAME */
  names: [string, string];
}

/** board.c piece_bitmaps: white's and red's, pawn to king */
const PIECE_FILES = ["pawn", "rook", "knight", "bishop", "queen", "king"];

function PieceImage({ assets, color, piece }: { assets: AssetStore; color: number; piece: number }) {
  const url = useKeyedImage(assets.url(`ui/${color === WHITE ? "w" : "r"}${PIECE_FILES[piece - 1]}.bmp`));
  return url ? <img src={url} alt="" draggable={false} /> : null;
}

export function ChessWindow({
  session, assets, state, onBoard, onClose,
}: {
  session: GameSession;
  assets: AssetStore;
  state: ChessState;
  /** Our move made the board this (the server doesn't send it back to the mover) */
  onBoard: (b: Board) => void;
  onClose: () => void;
}) {
  const { board, color, game } = state;
  /** board.c move_started, move_pos1 */
  const [from, setFrom] = useState<Point | null>(null);
  const [promoting, setPromoting] = useState<{ from: Point; to: Point } | null>(null);
  const [askResign, setAskResign] = useState(false);
  const status = board ? gameStatus(board) : { message: "", over: false };
  const player = color !== OBSERVER;

  /** ChessSendMove: the board to the server, and to us */
  const send = (b: Board) => {
    session.send(buildMinigameState(game, encodeBoard(b)));
    onBoard(b);
  };

  /** BoardSquareSelect: the first click picks one of our pieces, the second moves it if that's legal */
  const click = (row: number, col: number) => {
    if (!board || board.moveColor !== color || board.whiteResigned || board.blackResigned) return;
    if (from) {
      const to = { x: col, y: row };
      setFrom(null);
      if (!isLegalMove(board, from, to, color)) return;
      if (needsPromotion(board, from, to)) return setPromoting({ from, to });
      const next = cloneBoard(board);
      performMove(next, from, to);
      return send(next);
    }
    const s = board.squares[row][col];
    if (s.piece === PIECE.NONE || s.color !== color) return;
    setFrom({ x: col, y: row });
  };

  const mover = board?.moveColor ?? WHITE;
  return (
    // Modeless, like the original's: the game goes on around it
    <>
      <Window title="Chess" dlu={[338, 239]} onClose={onClose} className="game-dialog dlu chess-window">
        <div className="chess-board-box">
          <div className={board ? "chess-board" : "chess-board invalid"}>
            {board &&
              board.squares.map((row, i) =>
                row.map((s, j) => (
                  <button
                    type="button"
                    key={`${i}-${j}`}
                    // BoardDraw: palette white and black squares, the picked one orange
                    className={`chess-square ${(i + j) % 2 === 0 ? "light" : "dark"}${from && from.x === j && from.y === i ? " selected" : ""}`}
                    aria-label={`row ${i + 1}, column ${j + 1}`}
                    onMouseDown={() => click(i, j)}
                  >
                    {s.piece !== PIECE.NONE && <PieceImage assets={assets} color={s.color} piece={s.piece} />}
                  </button>
                )),
              )}
          </div>
        </div>
        {/* ChessDlgShowMover: "(to move)" and the title font on the side to move */}
        <Text at={[251, 15, 66, 8]}>{mover === WHITE ? "White (to move):" : "White:"}</Text>
        <Text at={[251, 27, 74, 21]} wrap className={mover === WHITE ? "chess-mover" : undefined}>
          {state.names[WHITE]}
        </Text>
        <Text at={[251, 57, 65, 8]}>{mover === BLACK ? "Red (to move):" : "Red:"}</Text>
        <Text at={[251, 69, 74, 21]} wrap className={mover === BLACK ? "chess-mover" : undefined}>
          {state.names[BLACK]}
        </Text>
        <Text at={[251, 102, 79, 13]}>{status.message}</Text>
        <Button at={[266, 160, 50, 14]} disabled={!board || status.over || !player} onClick={() => setAskResign(true)}>
          Resign
        </Button>
        <Button
          at={[266, 179, 50, 14]}
          disabled={!status.over || !player}
          onClick={() => {
            setFrom(null);
            send(initialBoard());
          }}
        >
          Restart game
        </Button>
        <Button at={[266, 198, 50, 14]} disabled={!status.over || !player} onClick={() => session.send(buildMinigameResetPlayers(game))}>
          Reset players
        </Button>
        <Button at={[266, 217, 50, 14]} onClick={onClose}>
          Close window
        </Button>
      </Window>
      {askResign && board && (
        <MessageBox
          kind="yesno"
          defaultNo
          text="Are you sure you want to resign?"
          onResult={(yes) => {
            setAskResign(false);
            if (!yes) return;
            const next = cloneBoard(board);
            if (color === WHITE) next.whiteResigned = true;
            if (color === BLACK) next.blackResigned = true;
            send(next);
          }}
        />
      )}
      {promoting && board && (
        <PromotionDialog
          onChoose={(piece) => {
            const next = cloneBoard(board);
            performMove(next, promoting.from, promoting.to, piece);
            setPromoting(null);
            send(next);
          }}
        />
      )}
    </>
  );
}

/** chess.c ChessPromotionDialogProc (IDD_PROMOTION): Queen to start with; closing takes the choice too */
function PromotionDialog({ onChoose }: { onChoose: (piece: number) => void }) {
  const [piece, setPiece] = useState<number>(PIECE.QUEEN);
  const choices: [string, number, number][] = [
    ["Queen", PIECE.QUEEN, 13],
    ["Knight", PIECE.KNIGHT, 30],
    ["Rook", PIECE.ROOK, 47],
    ["Bishop", PIECE.BISHOP, 64],
  ];
  return (
    <div className="mk-modal">
      <Window title="Pawn promotion" dlu={[75, 108]} onClose={() => onChoose(piece)}>
        {choices.map(([label, p, y]) => (
          <Check key={p} at={[15, y, 45, 10]} radio name="promotion" label={label} checked={piece === p} onChange={() => setPiece(p)} />
        ))}
        <Button at={[12, 86, 50, 14]} isDefault onClick={() => onChoose(piece)}>
          OK
        </Button>
      </Window>
    </div>
  );
}
