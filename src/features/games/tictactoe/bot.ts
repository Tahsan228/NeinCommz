import { emptyBoard, winner, type Board, type Mark } from './rules';

/**
 * A tic-tac-toe opponent.
 *
 * The game is small enough to solve outright, so "hard" is literally perfect
 * and cannot be beaten. That is only fun as a wall to test yourself against,
 * which is why the easier settings exist: they know the perfect move and
 * decline to play it some of the time.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY: Record<Difficulty, { label: string; mistake: number; blurb: string }> = {
  easy: { label: 'Careless', mistake: 0.55, blurb: 'Misses things. Often.' },
  medium: { label: 'Decent', mistake: 0.2, blurb: 'Punishes an obvious slip.' },
  hard: { label: 'Perfect', mistake: 0, blurb: 'Cannot be beaten. Draw at best.' },
};

export const BOT_ID = 'bot';

export function emptyCells(board: Board): number[] {
  return board.map((c, i) => (c === '' ? i : -1)).filter((i) => i >= 0);
}

const other = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X');

/**
 * Minimax with the depth folded into the score, so the engine prefers to win
 * sooner and to lose later — without it, a forced loss looks identical however
 * many moves away it is, and the bot walks straight into it.
 */
function score(board: Board, forMark: Mark, turn: Mark, depth: number): number {
  const w = winner(board);
  if (w === forMark) return 10 - depth;
  if (w === other(forMark)) return depth - 10;
  if (w === 'draw') return 0;

  const cells = emptyCells(board);
  const scores = cells.map((cell) => {
    const next = board.slice() as Board;
    next[cell] = turn;
    return score(next, forMark, other(turn), depth + 1);
  });

  return turn === forMark ? Math.max(...scores) : Math.min(...scores);
}

export interface RankedCell {
  cell: number;
  score: number;
}

/** Every empty cell, scored best-first for `mark`. */
export function rankCells(board: Board, mark: Mark): RankedCell[] {
  return emptyCells(board)
    .map((cell) => {
      const next = board.slice() as Board;
      next[cell] = mark;
      return { cell, score: score(next, mark, other(mark), 1) };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick a move. `random` is injected so tests can pin the choice.
 *
 * A mistake takes the second-best cell rather than a random one: a bot that
 * plays the single worst square available reads as broken, while one that
 * simply fails to block reads as a person not paying attention.
 */
export function chooseCell(
  board: Board,
  mark: Mark,
  difficulty: Difficulty = 'medium',
  random: () => number = Math.random,
): number | null {
  const ranked = rankCells(board, mark);
  if (ranked.length === 0) return null;

  // An immediate win is always taken, however careless the setting.
  if (ranked[0].score >= 9) return ranked[0].cell;

  if (random() < DIFFICULTY[difficulty].mistake && ranked.length > 1) {
    return ranked[1].cell;
  }

  // Share the top score, so openings are not identical every game.
  const best = ranked[0].score;
  const tied = ranked.filter((r) => r.score === best);
  return tied[Math.floor(random() * tied.length)].cell;
}

export { emptyBoard };
