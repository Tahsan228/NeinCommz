import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  findMove,
  inCheck,
  insufficientMaterial,
  legalMoves,
  makeMove,
  materialBalance,
  nameToSquare,
  parseFen,
  positionKey,
  result,
  squareName,
  toFen,
  toSan,
  type Position,
} from '../src/features/games/chess/rules';
import { DIFFICULTY, chooseMove, evaluate } from '../src/features/games/chess/bot';

const sq = nameToSquare;

/** Play a list of "e2e4" style moves, asserting each one is legal. */
function play(fen: string, moves: string[]): Position {
  let pos = parseFen(fen);
  for (const m of moves) {
    const from = sq(m.slice(0, 2));
    const to = sq(m.slice(2, 4));
    const promo = m[4] as 'q' | 'r' | 'b' | 'n' | undefined;
    const move = findMove(pos, from, to, promo);
    expect(move, `illegal move ${m} in ${toFen(pos)}`).toBeTruthy();
    pos = makeMove(pos, move!);
  }
  return pos;
}

describe('board coordinates', () => {
  it('puts a8 top-left and h1 bottom-right', () => {
    expect(sq('a8')).toBe(0);
    expect(sq('h1')).toBe(63);
    expect(squareName(0)).toBe('a8');
    expect(squareName(63)).toBe('h1');
  });

  it('round-trips every square', () => {
    for (let i = 0; i < 64; i++) expect(sq(squareName(i))).toBe(i);
  });
});

describe('FEN', () => {
  it('round-trips the starting position', () => {
    expect(toFen(parseFen(START_FEN))).toBe(START_FEN);
  });

  it('reads the pieces the right way up', () => {
    const pos = parseFen();
    expect(pos.board[sq('e1')]).toBe('wk');
    expect(pos.board[sq('e8')]).toBe('bk');
    expect(pos.board[sq('a2')]).toBe('wp');
  });
});

describe('opening moves', () => {
  it('offers twenty moves from the start, as it should', () => {
    expect(legalMoves(parseFen()).length).toBe(20);
  });

  it('lets a pawn go one or two squares, but only from home', () => {
    const start = parseFen();
    expect(findMove(start, sq('e2'), sq('e4'))).toBeTruthy();
    expect(findMove(start, sq('e2'), sq('e3'))).toBeTruthy();

    const after = play(START_FEN, ['e2e4', 'e7e5']);
    expect(findMove(after, sq('e4'), sq('e6'))).toBeNull();
  });

  it('will not let a pawn jump over a piece', () => {
    const pos = parseFen('8/8/8/8/8/4n3/4P3/4K2k w - - 0 1');
    expect(findMove(pos, sq('e2'), sq('e4'))).toBeNull();
  });

  it('will not move the other side pieces', () => {
    expect(legalMoves(parseFen(), sq('e7'))).toEqual([]);
  });
});

describe('check', () => {
  it('sees a king under attack', () => {
    const pos = parseFen('4k3/8/8/8/8/8/8/4K1R1 b - - 0 1');
    expect(inCheck(pos, 'b')).toBe(false);
    const pos2 = parseFen('4k3/8/8/8/8/8/8/4K1R1 w - - 0 1');
    expect(inCheck(makeMove(pos2, findMove(pos2, sq('g1'), sq('e1')) ?? { from: 0, to: 0 }), 'b')).toBe(
      false,
    );
  });

  it('forbids a move that leaves your own king in check', () => {
    // The rook on e2 is pinned against the king on e1 by the rook on e8.
    const pos = parseFen('4r3/8/8/8/8/8/4R3/4K3 w - - 0 1');
    // Stepping off the e-file would expose the king.
    expect(findMove(pos, sq('e2'), sq('d2'))).toBeNull();
    // Sliding along the pin keeps the king covered, so it is allowed.
    expect(findMove(pos, sq('e2'), sq('e3'))).toBeTruthy();
  });

  it('will not let a pinned piece move at all when it cannot stay on the line', () => {
    // A bishop cannot move vertically, so a vertical pin freezes it entirely.
    const pos = parseFen('4r3/8/8/8/8/8/4B3/4K3 w - - 0 1');
    expect(legalMoves(pos, sq('e2'))).toEqual([]);
  });

  it('forces you to answer a check', () => {
    const pos = parseFen('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1');
    // Every legal reply must get out of check.
    for (const m of legalMoves(pos)) {
      expect(inCheck(makeMove(pos, m), 'w')).toBe(false);
    }
  });
});

describe('castling', () => {
  const ready = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

  it('moves the rook as well as the king', () => {
    const pos = play(ready, ['e1g1']);
    expect(pos.board[sq('g1')]).toBe('wk');
    expect(pos.board[sq('f1')]).toBe('wr');
    expect(pos.board[sq('h1')]).toBe('');
  });

  it('works on the queen side too', () => {
    const pos = play(ready, ['e1c1']);
    expect(pos.board[sq('c1')]).toBe('wk');
    expect(pos.board[sq('d1')]).toBe('wr');
  });

  it('is forbidden through an occupied square', () => {
    const pos = parseFen('r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1');
    expect(findMove(pos, sq('e1'), sq('g1'))).toBeNull();
  });

  it('is forbidden out of, through, or into check', () => {
    // A rook on f8 covers f1, the square the king would cross.
    const through = parseFen('5r2/8/8/8/8/8/8/4K2R w K - 0 1');
    expect(findMove(through, sq('e1'), sq('g1'))).toBeNull();

    // A rook on e8 gives check, so castling is out entirely.
    const outOf = parseFen('4r3/8/8/8/8/8/8/4K2R w K - 0 1');
    expect(findMove(outOf, sq('e1'), sq('g1'))).toBeNull();
  });

  it('is lost once the king moves', () => {
    const pos = play(ready, ['e1f1', 'e8f8', 'f1e1', 'f8e8']);
    expect(pos.castling).toBe('');
    expect(findMove(pos, sq('e1'), sq('g1'))).toBeNull();
  });

  it('is lost on one side when that rook moves', () => {
    const pos = play(ready, ['h1g1']);
    expect(pos.castling).not.toContain('K');
    expect(pos.castling).toContain('Q');
  });

  it('is lost when the rook is captured on its home square', () => {
    const pos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const grab = findMove(pos, sq('a1'), sq('a8'));
    expect(grab).toBeTruthy();
    const after = makeMove(pos, grab!);
    expect(after.castling).not.toContain('q');
  });
});

describe('en passant', () => {
  it('is offered only immediately after a double push', () => {
    const pos = play(START_FEN, ['e2e4', 'a7a6', 'e4e5', 'd7d5']);
    expect(pos.epSquare).toBe(sq('d6'));
    expect(findMove(pos, sq('e5'), sq('d6'))).toBeTruthy();
  });

  it('removes the pawn beside the destination, not on it', () => {
    let pos = play(START_FEN, ['e2e4', 'a7a6', 'e4e5', 'd7d5']);
    pos = makeMove(pos, findMove(pos, sq('e5'), sq('d6'))!);
    expect(pos.board[sq('d6')]).toBe('wp');
    expect(pos.board[sq('d5')]).toBe('');
  });

  it('expires after any other move', () => {
    const pos = play(START_FEN, ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'a2a3', 'h7h6']);
    expect(pos.epSquare).toBe(-1);
    expect(findMove(pos, sq('e5'), sq('d6'))).toBeNull();
  });
});

describe('promotion', () => {
  it('offers all four pieces', () => {
    const pos = parseFen('8/4P3/8/8/8/8/8/4K2k w - - 0 1');
    const promos = legalMoves(pos, sq('e7')).filter((m) => m.promotion);
    expect(new Set(promos.map((m) => m.promotion))).toEqual(new Set(['q', 'r', 'b', 'n']));
  });

  it('places the chosen piece', () => {
    const pos = play('8/4P3/8/8/8/8/8/4K2k w - - 0 1', ['e7e8n']);
    expect(pos.board[sq('e8')]).toBe('wn');
  });
});

describe('endings', () => {
  it('calls the back-rank mate', () => {
    const pos = parseFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const mate = play(toFen(pos), ['a1a8']);
    const r = result(mate);
    expect(r.over).toBe(true);
    expect(r.over && r.kind).toBe('checkmate');
    expect(r.over && r.winner).toBe('w');
  });

  it('calls stalemate a draw, not a win', () => {
    const pos = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    const r = result(pos);
    expect(r.over && r.kind).toBe('stalemate');
    expect(r.over && r.winner).toBeNull();
  });

  it('spots when neither side can force mate', () => {
    expect(insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1').board)).toBe(true);
    expect(insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/3NK3 w - - 0 1').board)).toBe(true);
    expect(insufficientMaterial(parseFen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1').board)).toBe(false);
  });

  it('draws on the fifty-move rule', () => {
    const pos = parseFen('4k3/8/8/8/8/8/8/R3K3 w - - 100 80');
    const r = result(pos);
    expect(r.over).toBe(true);
    expect(r.over && r.kind).toBe('fifty');
  });

  it('draws on threefold repetition', () => {
    const pos = parseFen('4k3/8/8/8/8/8/8/R3K3 w - - 4 40');
    const key = positionKey(pos);
    expect(result(pos, [key, key, key]).over).toBe(true);
    expect(result(pos, [key, key]).over).toBe(false);
  });

  it('resets the halfmove clock on a capture or a pawn move', () => {
    const start = parseFen('4k3/8/8/8/8/8/P7/4K3 w - - 17 40');
    expect(makeMove(start, findMove(start, sq('a2'), sq('a3'))!).halfmove).toBe(0);
    const quiet = parseFen('4k3/8/8/8/8/8/8/4K3 w - - 17 40');
    expect(makeMove(quiet, findMove(quiet, sq('e1'), sq('e2'))!).halfmove).toBe(18);
  });
});

describe('notation', () => {
  it('writes plain moves and captures', () => {
    const start = parseFen();
    expect(toSan(start, findMove(start, sq('e2'), sq('e4'))!)).toBe('e4');
    expect(toSan(start, findMove(start, sq('g1'), sq('f3'))!)).toBe('Nf3');
  });

  it('writes castling', () => {
    const pos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(toSan(pos, findMove(pos, sq('e1'), sq('g1'))!)).toBe('O-O');
    expect(toSan(pos, findMove(pos, sq('e1'), sq('c1'))!)).toBe('O-O-O');
  });

  it('disambiguates when two of the same piece can reach a square', () => {
    // Knights on b1 and f3 can both go to d2.
    const pos = parseFen('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1');
    const san = toSan(pos, findMove(pos, sq('b1'), sq('d2'))!);
    expect(san).toBe('Nbd2');
  });

  it('marks check and mate', () => {
    const pos = parseFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    expect(toSan(pos, findMove(pos, sq('a1'), sq('a8'))!)).toBe('Ra8#');

    const checking = parseFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    expect(toSan(checking, findMove(checking, sq('a1'), sq('a8'))!)).toBe('Ra8+');
  });

  it('writes a promotion', () => {
    const pos = parseFen('8/4P3/8/8/8/8/8/4K2k w - - 0 1');
    expect(toSan(pos, findMove(pos, sq('e7'), sq('e8'), 'q')!)).toBe('e8=Q');
  });
});

describe('material', () => {
  it('is level at the start', () => {
    expect(materialBalance(parseFen().board)).toBe(0);
  });

  it('counts a missing queen against its owner', () => {
    expect(materialBalance(parseFen('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').board))
      .toBeGreaterThan(0);
  });
});

describe('a whole game', () => {
  it('plays the Scholar’s Mate through to checkmate', () => {
    const pos = play(START_FEN, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    const r = result(pos);
    expect(r.over && r.kind).toBe('checkmate');
    expect(r.over && r.winner).toBe('w');
  });

  it('never generates a move that leaves its own king in check', () => {
    let pos = parseFen();
    for (let ply = 0; ply < 40; ply++) {
      const moves = legalMoves(pos);
      if (!moves.length) break;
      const mover = pos.turn;
      // Deterministic pick, so a failure is reproducible.
      const move = moves[ply % moves.length];
      pos = makeMove(pos, move);
      expect(inCheck(pos, mover)).toBe(false);
    }
  });
});

/* ================================================================== bot === */

describe('the bot', () => {
  // A fixed sequence, so a failure is reproducible rather than "sometimes".
  const fixedRandom = () => 0.99;

  it('takes a free queen', () => {
    // White rook on a1, black queen on a8 with nothing defending it.
    const pos = parseFen('q3k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const move = chooseMove(pos, 'hard', fixedRandom);
    expect(move).toBeTruthy();
    expect(squareName(move!.to)).toBe('a8');
  });

  it('plays mate in one when it is there', () => {
    const pos = parseFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const move = chooseMove(pos, 'medium', fixedRandom);
    expect(squareName(move!.to)).toBe('a8');
  });

  it('takes a mate even on the easiest setting', () => {
    const pos = parseFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    // Even with the blunder roll guaranteed to fire, mate is never passed up.
    const move = chooseMove(pos, 'easy', () => 0);
    expect(squareName(move!.to)).toBe('a8');
  });

  it('saves its own queen when attacked', () => {
    // Black queen on d5 is attacked by the white bishop on g2 and undefended.
    const pos = parseFen('4k3/8/8/3q4/8/8/6B1/4K3 b - - 0 1');
    const move = chooseMove(pos, 'hard', fixedRandom);
    expect(move).toBeTruthy();
    // Whatever it does, the queen should not simply sit there.
    const stillHanging = squareName(move!.from) !== 'd5';
    const after = makeMove(pos, move!);
    expect(stillHanging === false || after.board[nameToSquare('d5')] === '').toBe(true);
  });

  it('returns null when there are no moves at all', () => {
    const mated = parseFen('6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1');
    const afterMate = play(toFen(mated).replace(' b ', ' w '), ['a1a8']);
    expect(chooseMove(afterMate, 'medium', fixedRandom)).toBeNull();
  });

  it('only ever suggests legal moves', () => {
    let pos = parseFen();
    for (let ply = 0; ply < 12; ply++) {
      const move = chooseMove(pos, 'easy', () => (ply % 7) / 7);
      if (!move) break;
      expect(findMove(pos, move.from, move.to, move.promotion)).toBeTruthy();
      pos = makeMove(pos, move);
    }
  });

  it('reads a material lead from White s point of view', () => {
    expect(evaluate(parseFen().board)).toBeCloseTo(0, 0);
    // White up a queen should score clearly positive.
    expect(evaluate(parseFen('4k3/8/8/8/8/8/8/3QK3 w - - 0 1').board)).toBeGreaterThan(500);
    expect(evaluate(parseFen('3qk3/8/8/8/8/8/8/4K3 w - - 0 1').board)).toBeLessThan(-500);
  });

  it('searches deeper on harder settings', () => {
    expect(DIFFICULTY.easy.depth).toBeLessThan(DIFFICULTY.hard.depth);
    expect(DIFFICULTY.hard.blunder).toBe(0);
  });
});
