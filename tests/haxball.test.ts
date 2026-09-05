import { describe, expect, it } from 'vitest';
import {
  BALL_R,
  CELEBRATION_TICKS,
  COUNTDOWN_TICKS,
  DEFAULT_RULES,
  PLAYER_R,
  bounds,
  canKick,
  confinePlayer,
  createWorld,
  describeGoal,
  step,
  type Input,
  type Rules,
} from '../src/features/games/haxball/physics';

/**
 * Matches now open with a countdown during which nothing moves, so anything
 * testing the simulation itself has to get past the whistle first.
 */
function kickedOff(players: { id: string; team: 0 | 1 }[], rules?: Rules) {
  const w = createWorld(players, rules);
  w.countdown = 0;
  return w;
}

const HOLD: Input = { up: false, down: false, left: false, right: false, kick: true };
const RELEASE: Input = { up: false, down: false, left: false, right: false, kick: false };
const RIGHT: Input = { up: false, down: false, left: false, right: true, kick: false };

/** A world with one player parked just left of a stationary ball. */
function nearBall() {
  const w = kickedOff([{ id: 'a', team: 0 }]);
  w.players[0].x = w.ball.x - (PLAYER_R + BALL_R + 2);
  w.players[0].y = w.ball.y;
  w.players[0].vx = 0;
  w.players[0].vy = 0;
  return w;
}

/**
 * Run with the ball for a while.
 *
 * Power only builds while you are actually moving, so a test that wants a
 * wind-up has to dribble rather than stand on the ball. Each tick puts the
 * player back at the ball's heel and keeps it running.
 */
function dribble(w: ReturnType<typeof kickedOff>, ticks: number, input: Input = RELEASE) {
  for (let i = 0; i < ticks; i++) {
    w.players[0].x = w.ball.x - (PLAYER_R + BALL_R + 2);
    w.players[0].y = w.ball.y;
    w.players[0].vx = 1.5;
    step(w, new Map([['a', input]]));
  }
}

describe('kicking', () => {
  it('builds power by running with the ball, with no key held', () => {
    const w = nearBall();
    dribble(w, 10);
    expect(w.players[0].charge).toBeGreaterThan(0);
  });

  it('builds nothing at all while standing on a stationary ball', () => {
    // Waiting on top of the ball used to be the cheapest route to a
    // full-power shot, which made the strongest play "do nothing".
    const w = nearBall();
    for (let i = 0; i < 240; i++) {
      w.players[0].vx = 0;
      w.players[0].vy = 0;
      step(w, new Map([['a', RELEASE]]));
    }
    expect(w.players[0].charge).toBe(0);
  });

  it('holds what you have while you stop to look up', () => {
    const w = nearBall();
    dribble(w, 60);
    const banked = w.players[0].charge;
    expect(banked).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) {
      w.players[0].x = w.ball.x - (PLAYER_R + BALL_R + 2);
      w.players[0].y = w.ball.y;
      w.players[0].vx = 0;
      w.players[0].vy = 0;
      step(w, new Map([['a', RELEASE]]));
    }
    expect(w.players[0].charge).toBeCloseTo(banked, 5);
  });

  it('caps at full power however long you run with it', () => {
    const w = nearBall();
    dribble(w, 600);
    expect(w.players[0].charge).toBe(1);
  });

  it('loses the wind-up the moment the ball gets away', () => {
    const w = nearBall();
    dribble(w, 40);
    expect(w.players[0].charge).toBeGreaterThan(0);

    w.players[0].x = 60;
    w.players[0].y = 60;
    step(w, new Map([['a', RELEASE]]));
    expect(w.players[0].charge).toBe(0);
  });

  it('sends the ball a long way even off a bare touch', () => {
    const w = nearBall();
    step(w, new Map([['a', HOLD]]));
    // Not a nudge: an uncharged kick is most of a real one.
    expect(w.ball.vx).toBeGreaterThan(4);
  });

  it('hits harder after winding up', () => {
    const tap = nearBall();
    step(tap, new Map([['a', HOLD]]));

    // Three seconds of running with it is a full wind-up.
    const wound = nearBall();
    dribble(wound, 180);
    expect(wound.players[0].charge).toBeCloseTo(1, 1);
    dribble(wound, 1, HOLD);

    expect(wound.ball.vx).toBeGreaterThan(tap.ball.vx * 1.6);
  });

  it('takes about three seconds of running to wind all the way up', () => {
    const w = nearBall();
    dribble(w, 90);
    // Half the time, so about half the power.
    expect(w.players[0].charge).toBeGreaterThan(0.4);
    expect(w.players[0].charge).toBeLessThan(0.6);
  });

  it('fires on contact when the key is already down', () => {
    // Running at a loose ball with the key held should strike immediately
    // rather than waiting for a fresh press.
    const w = nearBall();
    step(w, new Map([['a', HOLD]]));
    expect(w.ball.vx).toBeGreaterThan(0);
  });

  it('spends the wind-up on the shot', () => {
    const w = nearBall();
    dribble(w, 30);
    dribble(w, 1, HOLD);
    expect(w.players[0].charge).toBe(0);
  });

  it('reports the key being held, which is what lightens the disc', () => {
    const w = nearBall();
    step(w, new Map([['a', HOLD]]));
    expect(w.players[0].kickHeld).toBe(true);
    step(w, new Map([['a', RELEASE]]));
    expect(w.players[0].kickHeld).toBe(false);
  });

  it('does nothing at all with the ball out of reach', () => {
    const w = kickedOff([{ id: 'a', team: 0 }]);
    w.players[0].x = 60;
    w.players[0].y = 60;
    for (let i = 0; i < 40; i++) step(w, new Map([['a', HOLD]]));
    expect(Math.hypot(w.ball.vx, w.ball.vy)).toBeLessThan(0.01);
    expect(w.players[0].charge).toBe(0);
  });

  it('aims from the player through the ball, which is what the guide draws', () => {
    const w = nearBall();
    step(w, new Map([['a', RELEASE]]));
    expect(w.players[0].aimX).toBeCloseTo(1, 2);
    expect(w.players[0].aimY).toBeCloseTo(0, 2);
  });
});

describe('pace', () => {
  it('keeps players well under the old top speed', () => {
    const w = kickedOff([{ id: 'a', team: 0 }]);
    // Start from the left so a short run does not end against the far wall.
    w.players[0].x = bounds(w.pitch).left + 40;
    w.players[0].y = w.pitch.h / 2;
    for (let i = 0; i < 120; i++) step(w, new Map([['a', RIGHT]]));
    // The previous settings topped out near 6.6 px/tick; this is deliberately
    // about half that, which is the whole point of the change.
    expect(Math.hypot(w.players[0].vx, w.players[0].vy)).toBeLessThan(4);
  });

  it('still lets a host wind the speed back up', () => {
    const slow = kickedOff([{ id: 'a', team: 0 }]);
    const fast = kickedOff([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, playerAccel: 0.4 });

    // Spawns are random now, so compare the top speed each one reaches rather
    // than where they happen to be after a fixed run — a quick player simply
    // reaches the far wall sooner and sits against it at nearly zero. Start
    // both from the same spot too, or a bad draw puts the fast one against
    // the wall before it has got going.
    const topSpeed = (w: ReturnType<typeof kickedOff>) => {
      w.players[0].x = bounds(w.pitch).left + 40;
      w.players[0].y = w.pitch.h / 2;
      w.players[0].vx = 0;
      w.players[0].vy = 0;

      let best = 0;
      for (let i = 0; i < 90; i++) {
        step(w, new Map([['a', RIGHT]]));
        best = Math.max(best, Math.hypot(w.players[0].vx, w.players[0].vy));
      }
      return best;
    };

    expect(topSpeed(fast)).toBeGreaterThan(topSpeed(slow));
  });
});

describe('match limits', () => {
  function scoreForRed(w: ReturnType<typeof kickedOff>) {
    const { right, goalTop, goalBottom } = bounds(w.pitch);
    w.ball.x = right + BALL_R + 2;
    w.ball.y = (goalTop + goalBottom) / 2;
    step(w, new Map());
  }

  it('ends the match when the score limit is reached', () => {
    const w = kickedOff([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, scoreLimit: 1 });
    scoreForRed(w);
    expect(w.score.red).toBe(1);

    // Run out the celebration; the match should be over, not kicking off again.
    for (let i = 0; i < 200; i++) step(w, new Map());
    expect(w.finished).toBe(true);
    expect(w.winner).toBe(0);
  });

  it('keeps playing when the score limit is not yet met', () => {
    const w = kickedOff([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, scoreLimit: 3 });
    scoreForRed(w);
    for (let i = 0; i < 200; i++) step(w, new Map());
    expect(w.finished).toBe(false);
    expect(w.score.red).toBe(1);
  });

  it('ends on the clock and calls a level game a draw', () => {
    const w = kickedOff([{ id: 'a', team: 0 }], {
      ...DEFAULT_RULES,
      scoreLimit: 0,
      timeLimitSec: 1,
    });
    for (let i = 0; i < 70; i++) step(w, new Map());
    expect(w.finished).toBe(true);
    expect(w.winner).toBeNull();
  });

  it('stops stepping once finished', () => {
    const w = kickedOff([{ id: 'a', team: 0 }], {
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
    const w = kickedOff([{ id: 'a', team: 0 }], {
      ...DEFAULT_RULES,
      scoreLimit: 0,
      timeLimitSec: 0,
    });
    for (let i = 0; i < 400; i++) step(w, new Map());
    expect(w.finished).toBe(false);
  });
});


describe('kickoff countdown', () => {
  it('freezes everything until the whistle', () => {
    const w = createWorld([{ id: 'a', team: 0 }]);
    expect(w.countdown).toBe(COUNTDOWN_TICKS);

    const startX = w.players[0].x;
    const right: Input = { up: false, down: false, left: false, right: true, kick: false };
    for (let i = 0; i < 60; i++) step(w, new Map([['a', right]]));

    // Still counting down, so nobody has moved and the clock has not started.
    expect(w.players[0].x).toBe(startX);
    expect(w.tick).toBe(0);
    expect(w.countdown).toBe(COUNTDOWN_TICKS - 60);
  });

  it('releases play once it reaches zero', () => {
    const w = createWorld([{ id: 'a', team: 0 }]);
    const right: Input = { up: false, down: false, left: false, right: true, kick: false };
    for (let i = 0; i < COUNTDOWN_TICKS; i++) step(w, new Map([['a', right]]));
    expect(w.countdown).toBe(0);

    const startX = w.players[0].x;
    for (let i = 0; i < 30; i++) step(w, new Map([['a', right]]));
    expect(w.players[0].x).toBeGreaterThan(startX);
    expect(w.tick).toBe(30);
  });
});

describe('reach', () => {
  it('knows when the ball is close enough to strike', () => {
    const w = nearBall();
    expect(canKick(w.players[0], w.ball)).toBe(true);
  });

  it('knows when it is not, which is what hides the aim guide', () => {
    const w = nearBall();
    w.players[0].x = 40;
    w.players[0].y = 40;
    expect(canKick(w.players[0], w.ball)).toBe(false);
  });

  it('builds no charge at all while the ball is out of reach', () => {
    const w = nearBall();
    w.players[0].x = 40;
    w.players[0].y = 40;
    const hold: Input = { up: false, down: false, left: false, right: false, kick: true };
    for (let i = 0; i < 60; i++) step(w, new Map([['a', hold]]));
    expect(w.players[0].charge).toBe(0);
  });
});

describe('players in the goal', () => {
  it('lets a player stand behind the goal line between the posts', () => {
    const w = kickedOff([{ id: 'a', team: 0 }]);
    const { left, goalTop, goalBottom } = bounds(w.pitch);
    const p = w.players[0];

    // Aim for deep inside the net, level with the middle of the mouth.
    p.y = (goalTop + goalBottom) / 2;
    p.x = left - 200;
    confinePlayer(p, w.pitch);

    // Held at the netting, not shoved back onto the pitch.
    expect(p.x).toBeLessThan(left);
    expect(p.x).toBeCloseTo(left - w.pitch.goalDepth + PLAYER_R, 5);
  });

  it('still keeps a player out of the wall away from the mouth', () => {
    const w = kickedOff([{ id: 'a', team: 0 }]);
    const { left, top } = bounds(w.pitch);
    const p = w.players[0];

    p.y = top + 30; // well above the goal mouth
    p.x = left - 200;
    confinePlayer(p, w.pitch);

    expect(p.x).toBeCloseTo(left + PLAYER_R, 5);
  });

  it('treats the posts as the walls once a player is inside the net', () => {
    const w = kickedOff([{ id: 'a', team: 0 }]);
    const { left, goalTop, goalBottom } = bounds(w.pitch);
    const p = w.players[0];

    p.y = (goalTop + goalBottom) / 2;
    p.x = left - w.pitch.goalDepth + PLAYER_R; // inside the goal
    p.y = goalTop - 50; // try to slide out through the side netting
    confinePlayer(p, w.pitch);

    // Being out of the mouth pushes them back onto the pitch rather than
    // letting them wander behind the goal.
    expect(p.x).toBeGreaterThanOrEqual(left);
  });

  it('gives both ends the same freedom', () => {
    const w = kickedOff([{ id: 'a', team: 1 }]);
    const { right, goalTop, goalBottom } = bounds(w.pitch);
    const p = w.players[0];

    p.y = (goalTop + goalBottom) / 2;
    p.x = right + 200;
    confinePlayer(p, w.pitch);

    expect(p.x).toBeGreaterThan(right);
    expect(p.x).toBeCloseTo(right + w.pitch.goalDepth - PLAYER_R, 5);
  });

  it('has a mouth wide enough for two players to share', () => {
    const w = kickedOff([{ id: 'a', team: 0 }]);
    expect(w.pitch.goalHeight).toBeGreaterThan(PLAYER_R * 4);
  });
});

describe('who gets the credit', () => {
  function pitch() {
    const w = createWorld([
      { id: 'red1', team: 0 },
      { id: 'red2', team: 0 },
      { id: 'blue1', team: 1 },
    ]);
    w.countdown = 0;
    return w;
  }

  it('credits the last toucher with the goal', () => {
    const w = pitch();
    w.touches = [{ id: 'red1', team: 0, tick: 100 }];
    w.tick = 110;
    const g = describeGoal(w, 0);
    expect(g.scorer).toBe('red1');
    expect(g.ownGoal).toBe(false);
  });

  it('credits an assist to the team-mate who touched it before', () => {
    const w = pitch();
    w.touches = [
      { id: 'red2', team: 0, tick: 80 },
      { id: 'red1', team: 0, tick: 100 },
    ];
    w.tick = 110;
    expect(describeGoal(w, 0).assist).toBe('red2');
  });

  it('gives no assist to an opponent', () => {
    const w = pitch();
    w.touches = [
      { id: 'blue1', team: 1, tick: 80 },
      { id: 'red1', team: 0, tick: 100 },
    ];
    w.tick = 110;
    expect(describeGoal(w, 0).assist).toBeNull();
  });

  it('gives no assist for a pass from ages ago', () => {
    const w = pitch();
    w.touches = [
      { id: 'red2', team: 0, tick: 10 },
      { id: 'red1', team: 0, tick: 1000 },
    ];
    w.tick = 1010;
    expect(describeGoal(w, 0).assist).toBeNull();
  });

  it('marks an own goal and awards nobody an assist for it', () => {
    const w = pitch();
    // A red player put it in, but blue is credited with the goal.
    w.touches = [
      { id: 'red2', team: 0, tick: 80 },
      { id: 'red1', team: 0, tick: 100 },
    ];
    w.tick = 110;
    const g = describeGoal(w, 1);
    expect(g.ownGoal).toBe(true);
    expect(g.assist).toBeNull();
    expect(g.team).toBe(1);
  });

  it('survives a goal with no recorded touches at all', () => {
    const w = pitch();
    w.touches = [];
    const g = describeGoal(w, 0);
    expect(g.scorer).toBeNull();
    expect(g.assist).toBeNull();
  });

  it('collapses a run of touches by the same player', () => {
    const w = pitch();
    const input: Input = { up: false, down: false, left: false, right: false, kick: false };
    w.players[0].x = w.ball.x - (PLAYER_R + BALL_R + 1);
    w.players[0].y = w.ball.y;
    for (let i = 0; i < 30; i++) step(w, new Map([['red1', input]]));
    // Repeated contact by one player must not fill the history and push the
    // real assist out of the window.
    expect(w.touches.filter((t) => t.id === 'red1').length).toBeLessThanOrEqual(2);
  });

  it('restarts behind a countdown once the celebration ends', () => {
    const w = pitch();
    const { right, goalTop, goalBottom } = bounds(w.pitch);
    w.ball.x = right + BALL_R + 2;
    w.ball.y = (goalTop + goalBottom) / 2;
    step(w, new Map());
    expect(w.celebrating).toBeGreaterThan(0);

    for (let i = 0; i < CELEBRATION_TICKS + 2; i++) step(w, new Map());
    expect(w.celebrating).toBe(0);
    expect(w.countdown).toBeGreaterThan(0);
    expect(w.goal).toBeNull();
  });
});

describe('what the replay slows down on', () => {
  function pitchWith(id: string) {
    const w = createWorld([{ id, team: 0 }]);
    w.countdown = 0;
    return w;
  }

  it('slows on the strike when the ball went straight in', () => {
    const w = pitchWith('red1');
    w.touches = [{ id: 'red1', team: 0, tick: 100 }];
    w.tick = 140;
    w.lastBounceTick = -1;
    expect(describeGoal(w, 0).shotTick).toBe(100);
  });

  it('slows on the wall when the shot went in off the boards', () => {
    const w = pitchWith('red1');
    // Struck at 100, came off a wall at 130 — the bounce is the moment.
    w.touches = [{ id: 'red1', team: 0, tick: 100 }];
    w.lastBounceTick = 130;
    w.tick = 150;
    expect(describeGoal(w, 0).shotTick).toBe(130);
  });

  it('still slows on the strike when the bounce came first', () => {
    const w = pitchWith('red1');
    // A bounce, then somebody put it away: the strike is the later moment.
    w.lastBounceTick = 80;
    w.touches = [{ id: 'red1', team: 0, tick: 120 }];
    w.tick = 140;
    expect(describeGoal(w, 0).shotTick).toBe(120);
  });

  it('records a bounce off the side wall away from the goal', () => {
    const w = pitchWith('red1');
    const { left, top } = bounds(w.pitch);
    // Well above the mouth, heading into the left wall.
    w.ball.x = left + BALL_R - 1;
    w.ball.y = top + 40;
    w.ball.vx = -6;
    w.ball.vy = 0;
    step(w, new Map());
    expect(w.lastBounceTick).toBe(w.tick);
  });

  it('records a bounce off the top wall', () => {
    const w = pitchWith('red1');
    const { top } = bounds(w.pitch);
    w.ball.x = w.pitch.w / 2;
    w.ball.y = top + BALL_R - 1;
    w.ball.vy = -6;
    w.ball.vx = 0;
    step(w, new Map());
    expect(w.lastBounceTick).toBe(w.tick);
  });

  it('ignores clipping the post, which is not a moment worth slowing on', () => {
    const w = pitchWith('red1');
    const { left, goalTop } = bounds(w.pitch);
    // Right on the post: a bounce here is the frame, not a rebound off a wall.
    w.ball.x = left + BALL_R - 1;
    w.ball.y = goalTop - 4;
    w.ball.vx = -6;
    w.ball.vy = 0;
    step(w, new Map());
    expect(w.lastBounceTick).toBe(-1);
  });

  it('leaves the bounce unset when the ball has hit nothing', () => {
    const w = pitchWith('red1');
    w.ball.x = w.pitch.w / 2;
    w.ball.y = w.pitch.h / 2;
    w.ball.vx = 2;
    w.ball.vy = 0;
    for (let i = 0; i < 10; i++) step(w, new Map());
    expect(w.lastBounceTick).toBe(-1);
  });
});

describe('practice settings', () => {
  it('can cut the goal sequence right down', () => {
    const w = createWorld([{ id: 'a', team: 0 }], {
      ...DEFAULT_RULES,
      celebrationTicks: 90,
      scoreLimit: 0,
      timeLimitSec: 0,
    });
    w.countdown = 0;

    const { right, goalTop, goalBottom } = bounds(w.pitch);
    w.ball.x = right + BALL_R + 2;
    w.ball.y = (goalTop + goalBottom) / 2;
    step(w, new Map());

    expect(w.celebrating).toBe(90);
    // And with no limits at all, a goal never ends the session.
    for (let i = 0; i < 400; i++) step(w, new Map());
    expect(w.finished).toBe(false);
  });
});
