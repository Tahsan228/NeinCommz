import { describe, expect, it } from 'vitest';
import {
  BALL_R,
  BUFF_TICKS,
  DEFAULT_RULES,
  ORB_RARE,
  PLAYER_R,
  SPEED_MULTIPLIER,
  bounds,
  createWorld,
  pickOrbKind,
  spawnOrbs,
  step,
  type Input,
  type World,
} from '../src/features/games/haxball/physics';

const HOLD: Input = { up: false, down: false, left: false, right: false, kick: true };
const IDLE: Input = { up: false, down: false, left: false, right: false, kick: false };
const RIGHT: Input = { up: false, down: false, left: false, right: true, kick: false };

function withOrbs(): World {
  const w = createWorld([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, powerUps: true });
  w.countdown = 0;
  return w;
}

/** Drop an orb of a chosen kind right on top of the player. */
function placeOrb(w: World, kind: 'speed' | 'power' | 'control' | 'aim' | 'teleport') {
  w.orbs = [{ id: 0, x: w.players[0].x, y: w.players[0].y, kind, active: true, respawnIn: 0 }];
}

describe('orbs', () => {
  it('only appear when the mode is on', () => {
    const plain = createWorld([{ id: 'a', team: 0 }]);
    expect(plain.orbs).toEqual([]);
    expect(withOrbs().orbs.length).toBeGreaterThan(0);
  });

  it('spawn inside the pitch', () => {
    const w = withOrbs();
    const { left, right, top, bottom } = bounds(w.pitch);
    for (const orb of spawnOrbs(w.pitch)) {
      expect(orb.x).toBeGreaterThan(left);
      expect(orb.x).toBeLessThan(right);
      expect(orb.y).toBeGreaterThan(top);
      expect(orb.y).toBeLessThan(bottom);
    }
  });

  it('keeps the strong ones uncommon', () => {
    // A fixed sequence, so this is a statement about the weighting rather
    // than a coin flip that sometimes fails the build.
    let rare = 0;
    for (let i = 0; i < 1000; i++) {
      const kind = pickOrbKind(() => (i % 100) / 100);
      if (ORB_RARE.includes(kind)) rare++;
    }
    expect(rare / 1000).toBeLessThan(0.35);
  });

  it('is taken by running over it, and does not linger', () => {
    const w = withOrbs();
    placeOrb(w, 'speed');
    step(w, new Map([['a', IDLE]]));
    expect(w.orbs[0].active).toBe(false);
    expect(w.players[0].buffs.speed).toBeGreaterThan(0);
  });

  it('comes back somewhere else after a while', () => {
    const w = withOrbs();
    placeOrb(w, 'speed');
    step(w, new Map([['a', IDLE]]));
    expect(w.orbs[0].active).toBe(false);

    for (let i = 0; i < 60 * 13; i++) step(w, new Map([['a', IDLE]]));
    expect(w.orbs[0].active).toBe(true);
  });

  it('runs out', () => {
    const w = withOrbs();
    placeOrb(w, 'speed');
    step(w, new Map([['a', IDLE]]));
    for (let i = 0; i < BUFF_TICKS + 5; i++) step(w, new Map([['a', IDLE]]));
    expect(w.players[0].buffs.speed).toBe(0);
  });
});

describe('what each one does', () => {
  it('speed actually makes you faster', () => {
    const topSpeed = (buffed: boolean) => {
      const w = withOrbs();
      w.orbs = [];
      w.players[0].x = bounds(w.pitch).left + 40;
      w.players[0].y = w.pitch.h / 2;
      if (buffed) w.players[0].buffs.speed = BUFF_TICKS;
      let best = 0;
      for (let i = 0; i < 90; i++) {
        step(w, new Map([['a', RIGHT]]));
        best = Math.max(best, Math.abs(w.players[0].vx));
      }
      return best;
    };
    expect(topSpeed(true)).toBeGreaterThan(topSpeed(false) * 1.3);
    expect(SPEED_MULTIPLIER).toBeGreaterThan(1);
  });

  it('power actually makes the shot harder', () => {
    const hit = (buffed: boolean) => {
      const w = withOrbs();
      w.orbs = [];
      w.players[0].x = w.ball.x - (PLAYER_R + BALL_R + 2);
      w.players[0].y = w.ball.y;
      if (buffed) w.players[0].buffs.power = BUFF_TICKS;
      step(w, new Map([['a', HOLD]]));
      return w.ball.vx;
    };
    expect(hit(true)).toBeGreaterThan(hit(false) * 1.3);
  });

  it('control winds the shot up faster', () => {
    const charge = (buffed: boolean) => {
      const w = withOrbs();
      w.orbs = [];
      w.players[0].x = w.ball.x - (PLAYER_R + BALL_R + 2);
      w.players[0].y = w.ball.y;
      if (buffed) w.players[0].buffs.control = BUFF_TICKS;
      for (let i = 0; i < 30; i++) step(w, new Map([['a', IDLE]]));
      return w.players[0].charge;
    };
    expect(charge(true)).toBeGreaterThan(charge(false) * 2);
  });

  it('aim sends the shot at the goal rather than wherever you stood', () => {
    const w = withOrbs();
    w.orbs = [];
    // Standing beside the ball, so a plain kick would send it sideways.
    w.players[0].x = w.ball.x;
    w.players[0].y = w.ball.y - (PLAYER_R + BALL_R + 2);
    w.players[0].buffs.aim = BUFF_TICKS;
    step(w, new Map([['a', HOLD]]));
    // Red attacks right, so an aimed shot travels right regardless.
    expect(w.ball.vx).toBeGreaterThan(0);
  });

  it('banks a teleport rather than firing it straight away', () => {
    const w = withOrbs();
    placeOrb(w, 'teleport');
    step(w, new Map([['a', IDLE]]));
    expect(w.players[0].teleports).toBe(1);
  });

  it('spends a teleport reaching for a ball too far to touch', () => {
    const w = withOrbs();
    w.orbs = [];
    w.players[0].x = bounds(w.pitch).left + 40;
    w.players[0].y = w.pitch.h / 2;
    w.players[0].teleports = 1;
    const before = Math.hypot(w.ball.x - w.players[0].x, w.ball.y - w.players[0].y);

    step(w, new Map([['a', HOLD]]));

    expect(w.players[0].teleports).toBe(0);
    const after = Math.hypot(w.ball.x - w.players[0].x, w.ball.y - w.players[0].y);
    expect(after).toBeLessThan(before);
  });

  it('will not teleport without one banked', () => {
    const w = withOrbs();
    w.orbs = [];
    w.players[0].x = bounds(w.pitch).left + 40;
    w.players[0].y = w.pitch.h / 2;
    const startX = w.players[0].x;
    step(w, new Map([['a', HOLD]]));
    expect(w.players[0].x).toBeCloseTo(startX, 1);
  });
});
