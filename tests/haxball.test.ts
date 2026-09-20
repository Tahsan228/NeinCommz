import { describe, expect, it } from 'vitest';
import { effectiveRules, readState } from '../src/features/games/haxball/HaxballGame';
import {
  BALL_R,
  CELEBRATION_TICKS,
  COUNTDOWN_TICKS,
  PRACTICE_CELEBRATION_TICKS,
  CHARGE_PRESETS,
  DEFAULT_RULES,
  PITCH_PRESETS,
  PLAYER_R,
  POST_R,
  bounds,
  canKick,
  confineBall,
  confinePlayer,
  createWorld,
  describeGoal,
  kickoffPositions,
  posts,
  ricochet,
  step,
  type HaxPlayer,
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

  it('keeps building while you stand still with the ball at your feet', () => {
    // Requiring movement made the meter stall the moment you stopped to look
    // up with the ball still yours, which reads as the bar being broken.
    const w = nearBall();
    for (let i = 0; i < 240; i++) {
      w.players[0].vx = 0;
      w.players[0].vy = 0;
      step(w, new Map([['a', RELEASE]]));
    }
    expect(w.players[0].charge).toBe(1);
  });

  it('carries on from where it was when you stop to look up', () => {
    const w = nearBall();
    dribble(w, 60);
    const banked = w.players[0].charge;
    expect(banked).toBeGreaterThan(0);

    for (let i = 0; i < 30; i++) {
      w.players[0].x = w.ball.x - (PLAYER_R + BALL_R + 2);
      w.players[0].y = w.ball.y;
      w.players[0].vx = 0;
      w.players[0].vy = 0;
      step(w, new Map([['a', RELEASE]]));
    }
    expect(w.players[0].charge).toBeGreaterThan(banked);
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

describe('players off the pitch', () => {
  it('lets a player stand deep inside the net', () => {
    const w = kickedOff([{ id: 'a', team: 0 }]);
    const { left, goalTop, goalBottom } = bounds(w.pitch);
    const p = w.players[0];

    p.y = (goalTop + goalBottom) / 2;
    p.x = left - w.pitch.goalDepth + 4;
    confinePlayer(p, w.pitch);

    expect(p.x).toBeLessThan(left);
  });

  it('lets a player go round the back of the goal', () => {
    // Out of bounds is allowed now — it is the ball that has to stay in play.
    const w = kickedOff([{ id: 'a', team: 0 }]);
    const { left, top } = bounds(w.pitch);
    const p = w.players[0];

    p.y = top + 30; // well above the goal mouth
    p.x = left - 20;
    confinePlayer(p, w.pitch);

    expect(p.x).toBeCloseTo(left - 20, 5);
  });

  it('stops at the edge of the ground, and nowhere before it', () => {
    const w = kickedOff([{ id: 'a', team: 0 }]);
    const p = w.players[0];

    p.x = -400;
    p.y = w.pitch.h + 400;
    confinePlayer(p, w.pitch);

    expect(p.x).toBeCloseTo(PLAYER_R, 5);
    expect(p.y).toBeCloseTo(w.pitch.h - PLAYER_R, 5);
  });

  it('gives both ends the same freedom', () => {
    const w = kickedOff([{ id: 'a', team: 1 }]);
    const { right } = bounds(w.pitch);
    const p = w.players[0];

    p.y = w.pitch.h / 2;
    p.x = right + w.pitch.goalDepth;
    confinePlayer(p, w.pitch);

    expect(p.x).toBeGreaterThan(right);
  });

  it('has a mouth wide enough for two players to share', () => {
    const w = kickedOff([{ id: 'a', team: 0 }]);
    expect(w.pitch.goalHeight).toBeGreaterThan(PLAYER_R * 4);
  });

  it('leaves room behind each goal for the stadium', () => {
    // The netting used to be drawn past the edge of the canvas, which is what
    // smeared the goal whenever the replay camera looked that way.
    for (const pitch of Object.values(PITCH_PRESETS)) {
      expect(pitch.pad).toBeGreaterThan(pitch.goalDepth);
    }
  });
});

describe('the woodwork', () => {
  function ball(x: number, y: number, vx: number, vy: number) {
    return { x, y, vx, vy, r: BALL_R, m: 0.55 };
  }

  it('puts a post at each corner of each mouth', () => {
    const pitch = PITCH_PRESETS.normal;
    const { left, right, goalTop, goalBottom } = bounds(pitch);
    expect(posts(pitch)).toEqual([
      { x: left, y: goalTop },
      { x: left, y: goalBottom },
      { x: right, y: goalTop },
      { x: right, y: goalBottom },
    ]);
  });

  it('sends a ball back off the post rather than nudging it past', () => {
    // The old posts were a corner in a polyline the wall check knew nothing
    // about, so the ball was shifted a little and carried on.
    const pitch = PITCH_PRESETS.normal;
    const { right, goalTop } = bounds(pitch);
    const b = ball(right - 2, goalTop - 2, 9, 1);

    expect(ricochet(b, pitch)).toBe(true);
    expect(b.vx).toBeLessThan(0);
    expect(Math.hypot(b.x - right, b.y - goalTop)).toBeGreaterThanOrEqual(BALL_R + POST_R - 0.001);
  });

  it('leaves a ball through the middle of the mouth alone', () => {
    const pitch = PITCH_PRESETS.normal;
    const { right, goalTop, goalBottom } = bounds(pitch);
    const b = ball(right - 2, (goalTop + goalBottom) / 2, 9, 0);

    expect(ricochet(b, pitch)).toBe(false);
    expect(b.vx).toBe(9);
  });

  it('still counts a goal through the middle', () => {
    const pitch = PITCH_PRESETS.normal;
    const { right, goalTop, goalBottom } = bounds(pitch);
    const b = ball(right + BALL_R + 2, (goalTop + goalBottom) / 2, 9, 0);
    expect(confineBall(b, pitch)).toBe(0);
  });
});

describe('the kickoff', () => {
  function line(teams: (0 | 1)[]): HaxPlayer[] {
    return teams.map((team, i) => ({
      id: `p${i}`,
      team,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: PLAYER_R,
      m: 1,
      cooldown: 0,
      charge: 0,
      kickHeld: false,
      aimX: 1,
      aimY: 0,
      buffs: { speed: 0, power: 0, control: 0, aim: 0, slow: 0, reverse: 0, butter: 0, blind: 0 },
      teleports: 0,
    }));
  }

  it('starts both sides exactly as far from the ball', () => {
    // Scattering each side independently regularly put one team twice as
    // near the centre spot as the other, which decides the first touch
    // before anybody has moved.
    const pitch = PITCH_PRESETS.normal;
    const cx = pitch.w / 2;
    const cy = pitch.h / 2;

    for (let seed = 0; seed < 30; seed++) {
      let n = seed + 1;
      const random = () => {
        n = (n * 1103515245 + 12345) % 2147483648;
        return n / 2147483648;
      };

      const players = line([0, 0, 1, 1]);
      kickoffPositions(players, pitch, random);

      const reds = players.filter((p) => p.team === 0).map((p) => Math.hypot(p.x - cx, p.y - cy));
      const blues = players.filter((p) => p.team === 1).map((p) => Math.hypot(p.x - cx, p.y - cy));
      reds.sort((a, b) => a - b);
      blues.sort((a, b) => a - b);

      for (let i = 0; i < reds.length; i++) {
        expect(blues[i]).toBeCloseTo(reds[i], 6);
      }
    }
  });

  it('is still different every time', () => {
    const pitch = PITCH_PRESETS.normal;
    const a = line([0, 1]);
    const b = line([0, 1]);
    kickoffPositions(a, pitch, () => 0.2);
    kickoffPositions(b, pitch, () => 0.8);
    expect(a[0].x).not.toBeCloseTo(b[0].x, 3);
  });

  it('keeps each side in its own half', () => {
    const pitch = PITCH_PRESETS.normal;
    const players = line([0, 1]);
    kickoffPositions(players, pitch, () => 0.5);
    expect(players[0].x).toBeLessThan(pitch.w / 2);
    expect(players[1].x).toBeGreaterThan(pitch.w / 2);
  });
});

describe('the charge presets', () => {
  it('offers the default as one of the options', () => {
    // `String(1 / 180)` is not `"0.00556"`, so writing the options out by
    // hand meant a room on the default matched none of them and the dropdown
    // sat on the first — every host was told their match was on Slow.
    expect(Object.values(CHARGE_PRESETS)).toContain(DEFAULT_RULES.chargeRate);
    expect(CHARGE_PRESETS.Normal).toBe(DEFAULT_RULES.chargeRate);
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

describe('the goal that wins it', () => {
  function winningGoal() {
    const w = kickedOff([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, scoreLimit: 1 });
    const { right, goalTop, goalBottom } = bounds(w.pitch);
    w.ball.x = right + BALL_R + 2;
    w.ball.y = (goalTop + goalBottom) / 2;
    step(w, new Map());
    return w;
  }

  it('decides the match on the goal itself', () => {
    const w = winningGoal();
    expect(w.finished).toBe(true);
    expect(w.winner).toBe(0);
    expect(w.celebrating).toBe(CELEBRATION_TICKS);
  });

  it('still plays the celebration out rather than freezing on it', () => {
    // The goal sequence reads `celebrating` as its clock. Stopping the world
    // the instant the match was decided pinned that clock and the winning goal
    // was the one goal of the match nobody ever got to watch.
    const w = winningGoal();
    const started = w.celebrating;

    for (let i = 0; i < 20; i++) step(w, new Map());
    expect(w.celebrating).toBeLessThan(started);
    expect(w.tick).toBeGreaterThan(0);

    for (let i = 0; i < CELEBRATION_TICKS; i++) step(w, new Map());
    expect(w.celebrating).toBe(0);
  });

  it('stops for good once the celebration has run, without kicking off again', () => {
    const w = winningGoal();
    for (let i = 0; i < CELEBRATION_TICKS + 5; i++) step(w, new Map());

    expect(w.countdown).toBe(0);
    const frozen = w.tick;
    for (let i = 0; i < 30; i++) step(w, new Map());
    expect(w.tick).toBe(frozen);
    expect(w.score.red).toBe(1);
  });

  it('leaves the tape long enough for the replay to be cut from it', () => {
    // The clip is taken while `celebrating` counts down; a world that has
    // stopped ticking never gives the renderer a second frame to cut from.
    const w = winningGoal();
    const ticks: number[] = [];
    for (let i = 0; i < 100; i++) {
      step(w, new Map());
      ticks.push(w.tick);
    }
    expect(new Set(ticks).size).toBe(100);
  });
});

describe('how long the goal sequence gets', () => {
  it('ignores a length left behind in a room that once ran practice', () => {
    // The bug behind three separate "the replay is sped up" reports. Practice
    // used to save its overrides into the room's rules, and a stored rule
    // beats a default -- so those rooms kept a three-second goal sequence
    // long after the code that wrote it was gone.
    const poisoned = readState({ rules: { ...DEFAULT_RULES, celebrationTicks: 180 } });
    expect(poisoned.rules.celebrationTicks).toBe(CELEBRATION_TICKS);

    const ancient = readState({ rules: { celebrationTicks: 540 } });
    expect(ancient.rules.celebrationTicks).toBe(CELEBRATION_TICKS);
  });

  it('keeps every other saved rule exactly as the host left it', () => {
    const state = readState({
      rules: { ...DEFAULT_RULES, scoreLimit: 3, weather: 'snow', pitchSize: 'big' },
    });
    expect(state.rules.scoreLimit).toBe(3);
    expect(state.rules.weather).toBe('snow');
    expect(state.rules.pitchSize).toBe('big');
  });

  it('still cuts it right down for a practice, without saving that anywhere', () => {
    const state = readState({ practice: true, rules: { ...DEFAULT_RULES } });
    // What is stored stays clean...
    expect(state.rules.celebrationTicks).toBe(CELEBRATION_TICKS);
    // ...and the short one is derived at the point of play.
    expect(effectiveRules(state).celebrationTicks).toBe(PRACTICE_CELEBRATION_TICKS);
    expect(effectiveRules(state).scoreLimit).toBe(0);
  });

  it('gives the replay a sensible run at the default length', () => {
    // The replay act is a fixed share of the sequence, so this is the number
    // that decides whether slow motion is possible at all.
    const seconds = (0.92 - 0.22) * (CELEBRATION_TICKS / 60);
    expect(seconds).toBeGreaterThan(6);
  });
});
