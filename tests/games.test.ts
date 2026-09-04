import { describe, expect, it } from 'vitest';
import { emptyBoard, isLegalMove, winner, winningLine } from '../src/features/games/tictactoe/rules';
import {
  authorFor,
  chainForAuthor,
  isComplete,
  kindForStep,
  totalSteps,
} from '../src/features/games/gartic/rounds';
import {
  BALL_R,
  PLAYER_R,
  bounds,
  collide,
  confineBall,
  confinePlayer,
  createWorld,
  step,
  type Disc,
  type Input,
} from '../src/features/games/haxball/physics';

describe('tic-tac-toe rules', () => {
  it('finds a row, a column and a diagonal', () => {
    expect(winner(['X', 'X', 'X', '', '', '', '', '', ''])).toBe('X');
    expect(winner(['O', '', '', 'O', '', '', 'O', '', ''])).toBe('O');
    expect(winner(['X', '', '', '', 'X', '', '', '', 'X'])).toBe('X');
  });

  it('calls a full board with no line a draw', () => {
    expect(winner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'])).toBe('draw');
  });

  it('returns null while the game is still going', () => {
    expect(winner(['X', 'O', '', '', '', '', '', '', ''])).toBeNull();
    expect(winner(emptyBoard())).toBeNull();
  });

  it('reports which line won, for highlighting', () => {
    expect(winningLine(['X', '', '', '', 'X', '', '', '', 'X'])).toEqual([0, 4, 8]);
    expect(winningLine(emptyBoard())).toBeNull();
  });

  it('rejects taken and out-of-range cells', () => {
    const b = emptyBoard();
    b[4] = 'X';
    expect(isLegalMove(b, 4)).toBe(false);
    expect(isLegalMove(b, 0)).toBe(true);
    expect(isLegalMove(b, 9)).toBe(false);
    expect(isLegalMove(b, -1)).toBe(false);
  });
});

describe('gartic round rotation', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('starts every chain with its own owner', () => {
    expect(order.map((_, c) => authorFor(c, 0, order))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('gives each player exactly one chain per step', () => {
    for (let s = 0; s < order.length; s++) {
      const authors = order.map((_, c) => authorFor(c, s, order));
      expect(new Set(authors).size).toBe(order.length);
    }
  });

  it('never hands a player the same chain twice', () => {
    for (const player of order) {
      const chains = order.map((_, s) => chainForAuthor(player, s, order));
      expect(new Set(chains).size).toBe(order.length);
    }
  });

  it('round-trips between the two directions', () => {
    for (let c = 0; c < order.length; c++) {
      for (let s = 0; s < order.length; s++) {
        expect(chainForAuthor(authorFor(c, s, order), s, order)).toBe(c);
      }
    }
  });

  it('alternates prompt, draw, guess', () => {
    expect(kindForStep(0)).toBe('prompt');
    expect(kindForStep(1)).toBe('drawing');
    expect(kindForStep(2)).toBe('guess');
    expect(kindForStep(3)).toBe('drawing');
  });

  it('ends after one step per player', () => {
    expect(totalSteps(5)).toBe(5);
    expect(isComplete(4, 5)).toBe(false);
    expect(isComplete(5, 5)).toBe(true);
  });
});

describe('haxball physics', () => {
  const disc = (over: Partial<Disc>): Disc => ({ x: 0, y: 0, vx: 0, vy: 0, r: 10, m: 1, ...over });

  it('leaves separated discs alone', () => {
    const a = disc({ x: 0 });
    const b = disc({ x: 100 });
    expect(collide(a, b)).toBe(false);
    expect(b.x).toBe(100);
  });

  it('pushes overlapping discs apart', () => {
    const a = disc({ x: 0 });
    const b = disc({ x: 15 });
    expect(collide(a, b)).toBe(true);
    expect(b.x - a.x).toBeCloseTo(20, 5);
  });

  it('moves the lighter disc further when separating', () => {
    const heavy = disc({ x: 0, m: 1 });
    const light = disc({ x: 15, m: 0.25 });
    collide(heavy, light);
    expect(Math.abs(light.x - 15)).toBeGreaterThan(Math.abs(heavy.x - 0));
  });

  it('does not add energy to discs already flying apart', () => {
    const a = disc({ x: 0, vx: -5 });
    const b = disc({ x: 15, vx: 5 });
    collide(a, b);
    expect(a.vx).toBe(-5);
    expect(b.vx).toBe(5);
  });

  it('keeps players inside the pitch', () => {
    const { left, top } = bounds();
    const p = disc({ x: left - 40, y: top - 40, r: PLAYER_R });
    confinePlayer(p);
    expect(p.x).toBeCloseTo(left + PLAYER_R, 5);
    expect(p.y).toBeCloseTo(top + PLAYER_R, 5);
  });

  it('bounces the ball off a side wall away from the goal mouth', () => {
    const { left, top } = bounds();
    const b = disc({ x: left - 5, y: top + 10, vx: -6, r: BALL_R });
    expect(confineBall(b)).toBeNull();
    expect(b.vx).toBeGreaterThan(0);
  });

  it('scores when the ball crosses the line inside the mouth', () => {
    const { left, right, goalTop, goalBottom } = bounds();
    const mid = (goalTop + goalBottom) / 2;
    expect(confineBall(disc({ x: left - BALL_R - 2, y: mid, vx: -6, r: BALL_R }))).toBe(1);
    expect(confineBall(disc({ x: right + BALL_R + 2, y: mid, vx: 6, r: BALL_R }))).toBe(0);
  });

  it('does not score on a ball only partly over the line', () => {
    const { left, goalTop, goalBottom } = bounds();
    const mid = (goalTop + goalBottom) / 2;
    expect(confineBall(disc({ x: left, y: mid, vx: -6, r: BALL_R }))).toBeNull();
  });

  it('starts a match with the teams on opposite halves and the ball centred', () => {
    const w = createWorld([
      { id: 'a', team: 0 },
      { id: 'b', team: 1 },
    ]);
    expect(w.players[0].x).toBeLessThan(w.ball.x);
    expect(w.players[1].x).toBeGreaterThan(w.ball.x);
    expect(w.score).toEqual({ red: 0, blue: 0 });
  });

  it('moves a player who is holding a direction', () => {
    const w = createWorld([{ id: 'a', team: 0 }]);
    w.countdown = 0; // skip the kickoff freeze
    const startX = w.players[0].x;
    const input: Input = { up: false, down: false, left: false, right: true, kick: false };
    for (let i = 0; i < 10; i++) step(w, new Map([['a', input]]));
    expect(w.players[0].x).toBeGreaterThan(startX);
  });

  it('does not let diagonal movement outrun the axes', () => {
    const straight = createWorld([{ id: 'a', team: 0 }]);
    const diagonal = createWorld([{ id: 'a', team: 0 }]);
    straight.countdown = 0;
    diagonal.countdown = 0;
    const right: Input = { up: false, down: false, left: false, right: true, kick: false };
    const rightUp: Input = { up: true, down: false, left: false, right: true, kick: false };

    for (let i = 0; i < 20; i++) {
      step(straight, new Map([['a', right]]));
      step(diagonal, new Map([['a', rightUp]]));
    }
    const speed = (w: typeof straight) => Math.hypot(w.players[0].vx, w.players[0].vy);
    expect(speed(diagonal)).toBeLessThanOrEqual(speed(straight) + 1e-9);
  });

  it('freezes play after a goal and then resets to kickoff', () => {
    const w = createWorld([
      { id: 'a', team: 0 },
      { id: 'b', team: 1 },
    ]);
    w.countdown = 0;
    const { right, goalTop, goalBottom } = bounds();
    w.ball.x = right + BALL_R + 2;
    w.ball.y = (goalTop + goalBottom) / 2;
    step(w, new Map());

    expect(w.score.red).toBe(1);
    expect(w.celebrating).toBeGreaterThan(0);

    const frozen = w.celebrating;
    for (let i = 0; i < frozen; i++) step(w, new Map());
    expect(w.celebrating).toBe(0);
    expect(w.ball.vx).toBe(0);
    expect(w.score.red).toBe(1);
  });
});
