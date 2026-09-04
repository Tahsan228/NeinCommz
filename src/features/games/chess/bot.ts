import {
  PIECE_VALUE,
  colorOf,
  inCheck,
  legalMoves,
  makeMove,
  typeOf,
  type Board,
  type Color,
  type Move,
  type Position,
} from './rules';

/**
 * A small chess engine: alpha-beta over a hand-written evaluation.
 *
 * It is not strong, and it is not trying to be — it is trying to be a
 * believable opponent when nobody else is around, and to lose in ways that
 * feel like mistakes rather than like a random number generator.
 *
 * Difficulty is search depth plus a deliberate blunder rate, because a weak
 * engine that plays perfectly-but-shallowly is far less fun to beat than one
 * that occasionally hangs a piece.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

interface Settings {
  depth: number;
  /** Chance of picking a merely-decent move instead of the best one. */
  blunder: number;
  label: string;
}

export const DIFFICULTY: Record<Difficulty, Settings> = {
  easy: { depth: 1, blunder: 0.35, label: 'Casual' },
  medium: { depth: 2, blunder: 0.12, label: 'Steady' },
  hard: { depth: 3, blunder: 0, label: 'Sharp' },
};

/* ------------------------------------------------------------ evaluation - */

// Bonuses from White's point of view, a8 first. Encourage the middle, push
// pawns up the board, and keep the king tucked away.
const PAWN_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_TABLE = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_TABLE = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];

const ROOK_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];

const QUEEN_TABLE = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];

const KING_TABLE = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];

const TABLES: Record<string, number[]> = {
  p: PAWN_TABLE,
  n: KNIGHT_TABLE,
  b: BISHOP_TABLE,
  r: ROOK_TABLE,
  q: QUEEN_TABLE,
  k: KING_TABLE,
};

/** Score a position in centipawns, positive meaning White is better. */
export function evaluate(board: Board): number {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece) continue;
    const type = typeOf(piece)!;
    const white = colorOf(piece) === 'w';
    // The tables are written from White's side, so Black reads them mirrored.
    const table = TABLES[type];
    const bonus = table[white ? sq : 63 - sq];
    score += (white ? 1 : -1) * (PIECE_VALUE[type] + bonus);
  }
  return score;
}

/* ---------------------------------------------------------------- search - */

const MATE = 100_000;

/** Try captures first — it makes alpha-beta cut far more of the tree. */
function ordered(pos: Position): Move[] {
  return legalMoves(pos).sort((a, b) => gain(pos, b) - gain(pos, a));
}

function gain(pos: Position, move: Move): number {
  if (!move.captured && !move.enPassant) return move.promotion ? 800 : 0;
  const victim = move.captured ? PIECE_VALUE[typeOf(move.captured)!] : PIECE_VALUE.p;
  const attacker = PIECE_VALUE[typeOf(pos.board[move.from])!];
  // Winning a queen with a pawn is worth looking at before a quiet rook move.
  return victim * 10 - attacker;
}

function search(pos: Position, depth: number, alpha: number, beta: number, root: Color): number {
  const moves = ordered(pos);

  if (moves.length === 0) {
    // Mate scores shrink with depth, so the engine prefers a faster mate and
    // delays being mated for as long as it can.
    if (inCheck(pos)) return pos.turn === root ? -MATE - depth : MATE + depth;
    return 0;
  }
  if (depth === 0) {
    const raw = evaluate(pos.board);
    return root === 'w' ? raw : -raw;
  }

  const maximising = pos.turn === root;
  let best = maximising ? -Infinity : Infinity;

  for (const move of moves) {
    const score = search(makeMove(pos, move), depth - 1, alpha, beta, root);
    if (maximising) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, score);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export interface ScoredMove {
  move: Move;
  score: number;
}

/** Every legal move, scored and sorted best-first for the side to play. */
export function rankMoves(pos: Position, depth: number): ScoredMove[] {
  const root = pos.turn;
  return ordered(pos)
    .map((move) => ({
      move,
      score: search(makeMove(pos, move), Math.max(0, depth - 1), -Infinity, Infinity, root),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Choose a move.
 *
 * `random` is injected so tests can pin the choice; in the app it is
 * Math.random. On easier settings the engine sometimes takes a move from just
 * behind the best one — never the outright worst, which reads as broken rather
 * than as beatable.
 */
export function chooseMove(
  pos: Position,
  difficulty: Difficulty = 'medium',
  random: () => number = Math.random,
): Move | null {
  const { depth, blunder } = DIFFICULTY[difficulty];
  const ranked = rankMoves(pos, depth);
  if (ranked.length === 0) return null;

  // Always take a mate when one is there, whatever the difficulty.
  if (ranked[0].score >= MATE) return ranked[0].move;

  if (random() < blunder && ranked.length > 1) {
    const pool = ranked.slice(0, Math.min(4, ranked.length));
    return pool[Math.floor(random() * pool.length)].move;
  }

  // Share the top score between equally good moves so openings vary.
  const best = ranked[0].score;
  const tied = ranked.filter((r) => r.score === best);
  return tied[Math.floor(random() * tied.length)].move;
}

/** A rough "who is winning" read for the UI, in pawns. */
export function advantage(board: Board): number {
  return Math.round(evaluate(board) / 10) / 10;
}
