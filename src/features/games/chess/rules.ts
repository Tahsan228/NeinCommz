/**
 * Chess rules.
 *
 * Complete enough to play a real game: castling (both sides, with all the
 * conditions), en passant, promotion, check, checkmate, stalemate, the
 * fifty-move rule and threefold repetition.
 *
 * Pure and free of React or the network, because chess is the one game here
 * where a subtly wrong rule is invisible until it decides a match.
 *
 * Squares are indexes 0..63, a8 = 0 and h1 = 63, matching how the board is
 * drawn from White's side.
 */

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/** A piece is two characters: colour then type, e.g. "wq". Empty is "". */
export type Piece = string;
export type Board = Piece[];

export interface Move {
  from: number;
  to: number;
  /** What the moving piece became, for a promotion. */
  promotion?: PieceType;
  /** Set on the two-square king move that is castling. */
  castle?: 'k' | 'q';
  /** Set when a pawn captures onto an empty square. */
  enPassant?: boolean;
  /** Whatever was taken, for the captured-pieces tray. */
  captured?: Piece;
}

export interface Position {
  board: Board;
  turn: Color;
  /** Castling still available, e.g. "KQkq"; "-" once nobody can. */
  castling: string;
  /** The square a pawn just skipped over, or -1. */
  epSquare: number;
  /** Plies since the last capture or pawn move — the fifty-move rule. */
  halfmove: number;
  fullmove: number;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const PIECE_VALUE: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

/* ------------------------------------------------------------- geometry -- */

export const file = (sq: number): number => sq % 8;
export const rank = (sq: number): number => Math.floor(sq / 8);
export const onBoard = (sq: number): boolean => sq >= 0 && sq < 64;

export function squareName(sq: number): string {
  return 'abcdefgh'[file(sq)] + String(8 - rank(sq));
}

export function colorOf(piece: Piece): Color | null {
  return piece ? (piece[0] as Color) : null;
}

export function typeOf(piece: Piece): PieceType | null {
  return piece ? (piece[1] as PieceType) : null;
}

/** Step offsets as [fileDelta, rankDelta] so edges can be checked properly. */
const KNIGHT_STEPS: [number, number][] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_STEPS: [number, number][] = [
  [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
];
const ROOK_DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const BISHOP_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

function shift(sq: number, df: number, dr: number): number {
  const f = file(sq) + df;
  const r = rank(sq) - dr; // rank 8 is index 0, so a rank increase moves up
  if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
  return r * 8 + f;
}

/* ------------------------------------------------------------------- FEN -- */

export function parseFen(fen: string = START_FEN): Position {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board: Board = Array(64).fill('');

  let sq = 0;
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') {
      sq += Number(ch);
      continue;
    }
    const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
    board[sq++] = color + ch.toLowerCase();
  }

  return {
    board,
    turn: (turn as Color) ?? 'w',
    castling: castling && castling !== '-' ? castling : '',
    epSquare: ep && ep !== '-' ? nameToSquare(ep) : -1,
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1),
  };
}

export function nameToSquare(name: string): number {
  const f = 'abcdefgh'.indexOf(name[0]);
  const r = 8 - Number(name[1]);
  return f < 0 || r < 0 || r > 7 ? -1 : r * 8 + f;
}

export function toFen(pos: Position): string {
  let placement = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = pos.board[r * 8 + f];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) {
        placement += empty;
        empty = 0;
      }
      const letter = piece[1];
      placement += piece[0] === 'w' ? letter.toUpperCase() : letter;
    }
    if (empty) placement += empty;
    if (r < 7) placement += '/';
  }

  return [
    placement,
    pos.turn,
    pos.castling || '-',
    pos.epSquare >= 0 ? squareName(pos.epSquare) : '-',
    pos.halfmove,
    pos.fullmove,
  ].join(' ');
}

/** The position only, ignoring clocks — what repetition actually compares. */
export function positionKey(pos: Position): string {
  return toFen(pos).split(' ').slice(0, 4).join(' ');
}

/* ------------------------------------------------------------- attacks --- */

/** Is `sq` attacked by `by`? Used for check, and for castling through check. */
export function isAttacked(board: Board, sq: number, by: Color): boolean {
  // Pawns. A white pawn attacks upward, so it sits below the square it hits.
  const pawnDir = by === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const from = shift(sq, df, pawnDir);
    if (from >= 0 && board[from] === by + 'p') return true;
  }

  for (const [df, dr] of KNIGHT_STEPS) {
    const from = shift(sq, df, dr);
    if (from >= 0 && board[from] === by + 'n') return true;
  }

  for (const [df, dr] of KING_STEPS) {
    const from = shift(sq, df, dr);
    if (from >= 0 && board[from] === by + 'k') return true;
  }

  const slide = (dirs: [number, number][], types: string[]) => {
    for (const [df, dr] of dirs) {
      let cur = shift(sq, df, dr);
      while (cur >= 0) {
        const piece = board[cur];
        if (piece) {
          if (colorOf(piece) === by && types.includes(typeOf(piece)!)) return true;
          break;
        }
        cur = shift(cur, df, dr);
      }
    }
    return false;
  };

  return slide(ROOK_DIRS, ['r', 'q']) || slide(BISHOP_DIRS, ['b', 'q']);
}

export function kingSquare(board: Board, color: Color): number {
  return board.indexOf(color + 'k');
}

export function inCheck(pos: Position, color: Color = pos.turn): boolean {
  const king = kingSquare(pos.board, color);
  return king >= 0 && isAttacked(pos.board, king, color === 'w' ? 'b' : 'w');
}

/* --------------------------------------------------------- move making --- */

/** Apply a move. Returns a new position; the input is untouched. */
export function makeMove(pos: Position, move: Move): Position {
  const board = pos.board.slice();
  const piece = board[move.from];
  const type = typeOf(piece);
  const color = colorOf(piece) as Color;

  let captured = board[move.to];

  board[move.to] = piece;
  board[move.from] = '';

  if (move.enPassant) {
    // The taken pawn is beside the destination, not on it.
    const victim = move.to + (color === 'w' ? 8 : -8);
    captured = board[victim];
    board[victim] = '';
  }

  if (move.promotion) board[move.to] = color + move.promotion;

  if (move.castle) {
    // The king has already moved; bring the rook round it.
    const backRank = color === 'w' ? 56 : 0;
    if (move.castle === 'k') {
      board[backRank + 5] = board[backRank + 7];
      board[backRank + 7] = '';
    } else {
      board[backRank + 3] = board[backRank + 0];
      board[backRank + 0] = '';
    }
  }

  // Castling rights, lost by moving the king or a rook, or by a rook being
  // captured on its home square.
  let castling = pos.castling;
  const drop = (flags: string) => {
    for (const f of flags) castling = castling.replace(f, '');
  };
  if (type === 'k') drop(color === 'w' ? 'KQ' : 'kq');
  if (move.from === 63 || move.to === 63) drop('K');
  if (move.from === 56 || move.to === 56) drop('Q');
  if (move.from === 7 || move.to === 7) drop('k');
  if (move.from === 0 || move.to === 0) drop('q');

  // A double pawn push leaves a square behind it that can be captured onto.
  const epSquare =
    type === 'p' && Math.abs(rank(move.to) - rank(move.from)) === 2
      ? (move.from + move.to) / 2
      : -1;

  return {
    board,
    turn: color === 'w' ? 'b' : 'w',
    castling,
    epSquare,
    halfmove: type === 'p' || captured ? 0 : pos.halfmove + 1,
    fullmove: pos.fullmove + (color === 'b' ? 1 : 0),
  };
}

/* ------------------------------------------------------ move generation --- */

/** Moves ignoring check. Legality is filtered afterwards by legalMoves(). */
function pseudoMoves(pos: Position, from: number): Move[] {
  const piece = pos.board[from];
  const color = colorOf(piece);
  if (!color || color !== pos.turn) return [];

  const type = typeOf(piece)!;
  const moves: Move[] = [];
  const enemy = color === 'w' ? 'b' : 'w';

  const add = (to: number, extra: Partial<Move> = {}) => {
    moves.push({ from, to, captured: pos.board[to] || undefined, ...extra });
  };

  if (type === 'p') {
    const dir = color === 'w' ? 1 : -1;
    const startRank = color === 'w' ? 6 : 1;
    const lastRank = color === 'w' ? 0 : 7;

    const one = shift(from, 0, dir);
    if (one >= 0 && !pos.board[one]) {
      if (rank(one) === lastRank) {
        for (const p of ['q', 'r', 'b', 'n'] as PieceType[]) add(one, { promotion: p });
      } else {
        add(one);
        const two = shift(from, 0, dir * 2);
        if (rank(from) === startRank && two >= 0 && !pos.board[two]) add(two);
      }
    }

    for (const df of [-1, 1]) {
      const to = shift(from, df, dir);
      if (to < 0) continue;
      const target = pos.board[to];
      if (target && colorOf(target) === enemy) {
        if (rank(to) === lastRank) {
          for (const p of ['q', 'r', 'b', 'n'] as PieceType[]) add(to, { promotion: p });
        } else {
          add(to);
        }
      } else if (!target && to === pos.epSquare) {
        add(to, { enPassant: true });
      }
    }
    return moves;
  }

  if (type === 'n' || type === 'k') {
    for (const [df, dr] of type === 'n' ? KNIGHT_STEPS : KING_STEPS) {
      const to = shift(from, df, dr);
      if (to >= 0 && colorOf(pos.board[to]) !== color) add(to);
    }

    if (type === 'k') {
      // Castling: rights intact, squares empty, and the king may not start in,
      // pass through, or land on check.
      const backRank = color === 'w' ? 56 : 0;
      const rights = color === 'w' ? { k: 'K', q: 'Q' } : { k: 'k', q: 'q' };

      if (
        pos.castling.includes(rights.k) &&
        !pos.board[backRank + 5] &&
        !pos.board[backRank + 6] &&
        !isAttacked(pos.board, backRank + 4, enemy) &&
        !isAttacked(pos.board, backRank + 5, enemy) &&
        !isAttacked(pos.board, backRank + 6, enemy)
      ) {
        add(backRank + 6, { castle: 'k' });
      }

      if (
        pos.castling.includes(rights.q) &&
        !pos.board[backRank + 1] &&
        !pos.board[backRank + 2] &&
        !pos.board[backRank + 3] &&
        !isAttacked(pos.board, backRank + 4, enemy) &&
        !isAttacked(pos.board, backRank + 3, enemy) &&
        !isAttacked(pos.board, backRank + 2, enemy)
      ) {
        add(backRank + 2, { castle: 'q' });
      }
    }
    return moves;
  }

  const dirs =
    type === 'r' ? ROOK_DIRS : type === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];

  for (const [df, dr] of dirs) {
    let to = shift(from, df, dr);
    while (to >= 0) {
      const target = pos.board[to];
      if (!target) {
        add(to);
      } else {
        if (colorOf(target) !== color) add(to);
        break;
      }
      to = shift(to, df, dr);
    }
  }
  return moves;
}

/** Every move that does not leave your own king in check. */
export function legalMoves(pos: Position, from?: number): Move[] {
  const squares =
    from !== undefined ? [from] : pos.board.map((_, i) => i).filter((i) => colorOf(pos.board[i]) === pos.turn);

  const out: Move[] = [];
  for (const sq of squares) {
    for (const move of pseudoMoves(pos, sq)) {
      const after = makeMove(pos, move);
      // makeMove flips the turn, so check the side that just moved.
      if (!inCheck(after, pos.turn)) out.push(move);
    }
  }
  return out;
}

export function findMove(pos: Position, from: number, to: number, promotion?: PieceType): Move | null {
  return (
    legalMoves(pos, from).find(
      (m) => m.to === to && (!m.promotion || !promotion || m.promotion === promotion),
    ) ?? null
  );
}

/* -------------------------------------------------------------- endings --- */

export type Result =
  | { over: false }
  | { over: true; kind: 'checkmate'; winner: Color }
  | { over: true; kind: 'stalemate' | 'fifty' | 'repetition' | 'material'; winner: null };

/** Neither side has enough left to force mate. */
export function insufficientMaterial(board: Board): boolean {
  const pieces = board.filter(Boolean).map((p) => typeOf(p)!);
  if (pieces.some((t) => t === 'p' || t === 'r' || t === 'q')) return false;
  const minor = pieces.filter((t) => t === 'n' || t === 'b').length;
  return minor <= 1; // K v K, K+N v K, K+B v K
}

export function result(pos: Position, history: string[] = []): Result {
  if (legalMoves(pos).length === 0) {
    return inCheck(pos)
      ? { over: true, kind: 'checkmate', winner: pos.turn === 'w' ? 'b' : 'w' }
      : { over: true, kind: 'stalemate', winner: null };
  }
  if (pos.halfmove >= 100) return { over: true, kind: 'fifty', winner: null };
  if (insufficientMaterial(pos.board)) return { over: true, kind: 'material', winner: null };

  const key = positionKey(pos);
  if (history.filter((h) => h === key).length >= 3) {
    return { over: true, kind: 'repetition', winner: null };
  }
  return { over: false };
}

/* ------------------------------------------------------------- notation --- */

/** Standard algebraic notation, with the disambiguation real games need. */
export function toSan(pos: Position, move: Move): string {
  if (move.castle) return move.castle === 'k' ? 'O-O' : 'O-O-O';

  const piece = pos.board[move.from];
  const type = typeOf(piece)!;
  const capture = Boolean(move.captured) || move.enPassant;
  let san = '';

  if (type === 'p') {
    if (capture) san += 'abcdefgh'[file(move.from)] + 'x';
    san += squareName(move.to);
    if (move.promotion) san += '=' + move.promotion.toUpperCase();
  } else {
    san += type.toUpperCase();

    // Only disambiguate when another piece of the same kind could also go there.
    const rivals = legalMoves(pos).filter(
      (m) => m.to === move.to && m.from !== move.from && typeOf(pos.board[m.from]) === type,
    );
    if (rivals.length) {
      const sameFile = rivals.some((m) => file(m.from) === file(move.from));
      const sameRank = rivals.some((m) => rank(m.from) === rank(move.from));
      if (!sameFile) san += 'abcdefgh'[file(move.from)];
      else if (!sameRank) san += String(8 - rank(move.from));
      else san += squareName(move.from);
    }

    if (capture) san += 'x';
    san += squareName(move.to);
  }

  const after = makeMove(pos, move);
  if (inCheck(after)) san += legalMoves(after).length === 0 ? '#' : '+';
  return san;
}

/** Material balance in centipawns, positive when White is ahead. */
export function materialBalance(board: Board): number {
  let total = 0;
  for (const piece of board) {
    if (!piece) continue;
    const v = PIECE_VALUE[typeOf(piece)!];
    total += colorOf(piece) === 'w' ? v : -v;
  }
  return total;
}
