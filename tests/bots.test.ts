import { describe, expect, it } from 'vitest';
import { emptyBoard, winner, type Board } from '../src/features/games/tictactoe/rules';
import {
  DIFFICULTY,
  chooseCell,
  emptyCells,
  rankCells,
} from '../src/features/games/tictactoe/bot';
import { BOT_PREFIX, botInput, botInputs, isBot } from '../src/features/games/haxball/bot';
import { bounds, createWorld, step } from '../src/features/games/haxball/physics';

const fixed = () => 0.99;

/** Build a board from a compact string, "" for empty. */
const board = (cells: string): Board =>
  cells.split('').map((c) => (c === '.' ? '' : c)) as Board;

describe('tic-tac-toe bot', () => {
  it('takes an immediate win', () => {
    // X on the top row needs c1 to finish it.
    expect(chooseCell(board('XX.OO....'), 'X', 'hard', fixed)).toBe(2);
  });

  it('blocks an immediate loss when it has no win of its own', () => {
    // O threatens the top row and X has nothing better, so X must take c1.
    expect(chooseCell(board('OO.X.....'), 'X', 'hard', fixed)).toBe(2);
  });

  it('prefers its own win to blocking one', () => {
    // Both sides are one move from finishing; taking the win beats defending.
    expect(chooseCell(board('OO.XX....'), 'X', 'hard', fixed)).toBe(5);
  });

  it('takes a win even on the most careless setting', () => {
    // Winning is never passed up, whatever the mistake rate.
    expect(chooseCell(board('XX.OO....'), 'X', 'easy', () => 0)).toBe(2);
  });

  it('always draws against itself when both sides play perfectly', () => {
    // The classic property of solved tic-tac-toe. Cheaper than exploring every
    // human reply, and it fails loudly if the search is subtly wrong.
    for (let seed = 0; seed < 6; seed++) {
      let b = emptyBoard();
      let turn: 'X' | 'O' = 'X';
      let guard = 0;
      // A different deterministic tie-break each run, so it is not one line.
      const rng = () => ((seed + guard) % 7) / 7;

      while (!winner(b) && guard++ < 9) {
        const cell = chooseCell(b, turn, 'hard', rng);
        if (cell === null) break;
        b = b.slice() as Board;
        b[cell] = turn;
        turn = turn === 'X' ? 'O' : 'X';
      }
      expect(winner(b)).toBe('draw');
    }
  });

  it('never loses from a position where it can still hold the draw', () => {
    // X has taken a corner and the centre; O must take the opposite corner.
    const cell = chooseCell(board('X...O....'), 'O', 'hard', fixed);
    const next = board('X...O....');
    next[cell!] = 'O';
    // Whatever X does next, the perfect bot must not end up losing.
    for (const reply of emptyCells(next)) {
      const after = next.slice() as Board;
      after[reply] = 'X';
      const answer = chooseCell(after, 'O', 'hard', fixed);
      if (answer === null) continue;
      const settled = after.slice() as Board;
      settled[answer] = 'O';
      expect(winner(settled)).not.toBe('X');
    }
  });

  it('returns null on a full board', () => {
    expect(chooseCell(board('XOXXOOOXX'), 'X', 'hard', fixed)).toBeNull();
  });

  it('prefers a faster win to a slower one', () => {
    const ranked = rankCells(board('XX.OO....'), 'X');
    expect(ranked[0].cell).toBe(2);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('gets harder as the setting goes up', () => {
    expect(DIFFICULTY.easy.mistake).toBeGreaterThan(DIFFICULTY.medium.mistake);
    expect(DIFFICULTY.hard.mistake).toBe(0);
  });
});

describe('haxball bots', () => {
  function pitchWithBot() {
    const w = createWorld([
      { id: BOT_PREFIX + '1', team: 0 },
      { id: 'human', team: 1 },
    ]);
    w.countdown = 0;
    return w;
  }

  it('recognises its own ids', () => {
    expect(isBot(BOT_PREFIX + '1')).toBe(true);
    expect(isBot('some-uuid')).toBe(false);
  });

  it('stands still during the countdown', () => {
    const w = pitchWithBot();
    w.countdown = 60;
    const input = botInput(w, BOT_PREFIX + '1', 0, 'medium', fixed);
    expect(input).toMatchObject({ up: false, down: false, left: false, right: false, kick: false });
  });

  it('stands still while a goal is being celebrated', () => {
    const w = pitchWithBot();
    w.celebrating = 40;
    const input = botInput(w, BOT_PREFIX + '1', 0, 'medium', fixed);
    expect(input.left || input.right || input.up || input.down).toBe(false);
  });

  it('moves towards the ball when it is the closest', () => {
    const w = pitchWithBot();
    const bot = w.players[0];
    // Park the ball well to the bot's right, everyone else far away.
    w.ball.x = bot.x + 250;
    w.ball.y = bot.y;
    w.players[1].x = w.pitch.w - 40;

    const input = botInput(w, BOT_PREFIX + '1', 0, 'medium', fixed);
    expect(input.right).toBe(true);
    expect(input.left).toBe(false);
  });

  it('produces an input for every bot and none for people', () => {
    const w = createWorld([
      { id: BOT_PREFIX + '1', team: 0 },
      { id: BOT_PREFIX + '2', team: 0 },
      { id: 'human', team: 1 },
    ]);
    w.countdown = 0;
    const inputs = botInputs(w, 'medium', fixed);
    expect(inputs.size).toBe(2);
    expect(inputs.has('human')).toBe(false);
  });

  it('actually gets a bot moving over a few seconds of play', () => {
    const w = pitchWithBot();
    const bot = w.players[0];
    w.ball.x = bot.x + 200;
    w.ball.y = bot.y + 60;
    const startX = bot.x;

    for (let i = 0; i < 120; i++) {
      step(w, botInputs(w, 'medium', fixed));
    }
    expect(Math.abs(w.players[0].x - startX)).toBeGreaterThan(10);
  });

  it('will not kick the ball towards its own goal', () => {
    const w = pitchWithBot();
    const { left } = bounds(w.pitch);
    const bot = w.players[0];

    // The red bot is goal-side of the ball, so a kick would travel left --
    // straight into the net it is defending.
    w.ball.x = left + 90;
    w.ball.y = w.pitch.h / 2;
    bot.x = w.ball.x + bot.r + w.ball.r + 2;
    bot.y = w.ball.y;
    step(w, new Map()); // let the world work out the aim vector

    const input = botInput(w, BOT_PREFIX + '1', 0, 'hard', fixed);
    expect(input.kick).toBe(false);
  });

  it('never aims at a spot inside a goal', () => {
    const w = pitchWithBot();
    const { left, right } = bounds(w.pitch);
    const bot = w.players[0];
    w.ball.x = left + 5;
    w.ball.y = w.pitch.h / 2;

    // Run it forward and check the bot stays on the pitch of its own accord.
    for (let i = 0; i < 200; i++) step(w, botInputs(w, 'hard', fixed));
    expect(w.players[0].x).toBeGreaterThanOrEqual(left - w.pitch.goalDepth);
    expect(w.players[0].x).toBeLessThanOrEqual(right + w.pitch.goalDepth);
    expect(bot).toBeTruthy();
  });
});
