import { describe, expect, it } from 'vitest';
import {
  BALL_R,
  DEFAULT_RULES,
  PLAYER_R,
  bounds,
  createWorld,
  step,
  type Input,
} from '../src/features/games/haxball/physics';

const HOLD: Input = { up: false, down: false, left: false, right: false, kick: true };
const RELEASE: Input = { up: false, down: false, left: false, right: false, kick: false };
const RIGHT: Input = { up: false, down: false, left: false, right: true, kick: false };

/** A world with one player parked just left of a stationary ball. */
function nearBall() {
  const w = createWorld([{ id: 'a', team: 0 }]);
  w.players[0].x = w.ball.x - (PLAYER_R + BALL_R + 2);
  w.players[0].y = w.ball.y;
  w.players[0].vx = 0;
  w.players[0].vy = 0;
  return w;
}

describe('charged shots', () => {
  it('builds charge while the kick key is held, without touching the ball', () => {
    const w = nearBall();
    for (let i = 0; i < 10; i++) step(w, new Map([['a', HOLD]]));
    expect(w.players[0].charge).toBeGreaterThan(0);
    expect(w.players[0].charge).toBeLessThanOrEqual(1);
    // The shot goes out on release, so nothing has moved yet.
    expect(Math.abs(w.ball.vx)).toBeLessThan(0.01);
  });

  it('caps the charge at full power however long you hold', () => {
    const w = nearBall();
    for (let i = 0; i < 600; i++) step(w, new Map([['a', HOLD]]));
    expect(w.players[0].charge).toBe(1);
  });

  it('kicks harder the longer it was charged', () => {
    const tap = nearBall();
    step(tap, new Map([['a', HOLD]]));
    step(tap, new Map([['a', RELEASE]]));

    const full = nearBall();
    for (let i = 0; i < 60; i++) step(full, new Map([['a', HOLD]]));
    step(full, new Map([['a', RELEASE]]));

    expect(tap.ball.vx).toBeGreaterThan(0);
    expect(full.ball.vx).toBeGreaterThan(tap.ball.vx * 2);
  });

  it('resets the charge once the shot is away', () => {
    const w = nearBall();
    for (let i = 0; i < 30; i++) step(w, new Map([['a', HOLD]]));
    step(w, new Map([['a', RELEASE]]));
    expect(w.players[0].charge).toBe(0);
  });

  it('does nothing on release when the ball is out of reach', () => {
    const w = createWorld([{ id: 'a', team: 0 }]);
    w.players[0].x = 60;
    w.players[0].y = 60;
    for (let i = 0; i < 40; i++) step(w, new Map([['a', HOLD]]));
    step(w, new Map([['a', RELEASE]]));
    expect(Math.hypot(w.ball.vx, w.ball.vy)).toBeLessThan(0.01);
  });

  it('aims from the player through the ball, which is what the guide draws', () => {
    const w = nearBall();
    step(w, new Map([['a', HOLD]]));
    // The player sits directly left of the ball, so the shot travels right.
    expect(w.players[0].aimX).toBeCloseTo(1, 2);
    expect(w.players[0].aimY).toBeCloseTo(0, 2);
  });
});

describe('pace', () => {
  it('keeps players well under the old top speed', () => {
    const w = createWorld([{ id: 'a', team: 0 }]);
    for (let i = 0; i < 240; i++) step(w, new Map([['a', RIGHT]]));
    // The previous settings topped out near 6.6 px/tick; this is deliberately
    // about half that, which is the whole point of the change.
    expect(Math.hypot(w.players[0].vx, w.players[0].vy)).toBeLessThan(4);
  });

  it('still lets a host wind the speed back up', () => {
    const slow = createWorld([{ id: 'a', team: 0 }]);
    const fast = createWorld([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, playerAccel: 0.4 });
    for (let i = 0; i < 240; i++) {
      step(slow, new Map([['a', RIGHT]]));
      step(fast, new Map([['a', RIGHT]]));
    }
    expect(Math.abs(fast.players[0].vx)).toBeGreaterThan(Math.abs(slow.players[0].vx));
  });
});

describe('match limits', () => {
  function scoreForRed(w: ReturnType<typeof createWorld>) {
    const { right, goalTop, goalBottom } = bounds(w.pitch);
    w.ball.x = right + BALL_R + 2;
    w.ball.y = (goalTop + goalBottom) / 2;
    step(w, new Map());
  }

  it('ends the match when the score limit is reached', () => {
    const w = createWorld([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, scoreLimit: 1 });
    scoreForRed(w);
    expect(w.score.red).toBe(1);

    // Run out the celebration; the match should be over, not kicking off again.
    for (let i = 0; i < 200; i++) step(w, new Map());
    expect(w.finished).toBe(true);
    expect(w.winner).toBe(0);
  });

  it('keeps playing when the score limit is not yet met', () => {
    const w = createWorld([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, scoreLimit: 3 });
    scoreForRed(w);
    for (let i = 0; i < 200; i++) step(w, new Map());
    expect(w.finished).toBe(false);
    expect(w.score.red).toBe(1);
  });

  it('ends on the clock and calls a level game a draw', () => {
    const w = createWorld([{ id: 'a', team: 0 }], {
      ...DEFAULT_RULES,
      scoreLimit: 0,
      timeLimitSec: 1,
    });
    for (let i = 0; i < 70; i++) step(w, new Map());
    expect(w.finished).toBe(true);
    expect(w.winner).toBeNull();
  });

  it('stops stepping once finished', () => {
    const w = createWorld([{ id: 'a', team: 0 }], {
      ...DEFAULT_RULES,
      scoreLimit: 0,
      timeLimitSec: 1,
    });
    for (let i = 0; i < 70; i++) step(w, new Map());
    const frozen = w.tick;
    step(w, new Map());
    expect(w.tick).toBe(frozen);
  });

  it('plays on forever when both limits are switched off', () => {
    const w = createWorld([{ id: 'a', team: 0 }], {
      ...DEFAULT_RULES,
      scoreLimit: 0,
      timeLimitSec: 0,
    });
    for (let i = 0; i < 400; i++) step(w, new Map());
    expect(w.finished).toBe(false);
  });
});
