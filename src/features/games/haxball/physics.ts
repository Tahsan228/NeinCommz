/**
 * A small deterministic 2D world: discs on a pitch, elastic collisions, and a
 * ball you can kick. Kept free of React and of the network so it can be
 * stepped identically on the host and reasoned about in tests.
 *
 * This is a simplified take on Haxball rather than a clone: same shape of
 * game, considerably simpler collision resolution.
 */

export const PITCH = {
  w: 840,
  h: 440,
  /** Playing area inset from the canvas edge. */
  pad: 34,
  goalHeight: 150,
  goalDepth: 26,
};

export const PLAYER_R = 15;
export const BALL_R = 9;

const PLAYER_ACCEL = 0.42;
const PLAYER_DAMP = 0.94;
const BALL_DAMP = 0.985;
const KICK_POWER = 5.6;
const KICK_RANGE = 6;
const PLAYER_MASS = 1;
const BALL_MASS = 0.55;
const RESTITUTION = 0.62;
const MAX_BALL_SPEED = 16;

export interface Disc {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
}

export interface HaxPlayer extends Disc {
  id: string;
  team: 0 | 1;
  /** Frames of kick cooldown remaining, so holding the key does not machine-gun. */
  cooldown: number;
}

export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  kick: boolean;
}

export const NO_INPUT: Input = { up: false, down: false, left: false, right: false, kick: false };

export interface World {
  players: HaxPlayer[];
  ball: Disc;
  score: { red: number; blue: number };
  /** Frames left of the post-goal freeze, during which nothing moves. */
  celebrating: number;
  lastScorer: 0 | 1 | null;
  tick: number;
}

export function bounds() {
  const left = PITCH.pad;
  const right = PITCH.w - PITCH.pad;
  const top = PITCH.pad;
  const bottom = PITCH.h - PITCH.pad;
  const goalTop = (PITCH.h - PITCH.goalHeight) / 2;
  const goalBottom = goalTop + PITCH.goalHeight;
  return { left, right, top, bottom, goalTop, goalBottom };
}

export function kickoffPositions(players: HaxPlayer[]): void {
  const cx = PITCH.w / 2;
  const cy = PITCH.h / 2;
  const perTeam = [0, 0];
  for (const p of players) {
    const i = perTeam[p.team]++;
    const dir = p.team === 0 ? -1 : 1;
    p.x = cx + dir * (110 + i * 58);
    p.y = cy + (i % 2 === 0 ? -1 : 1) * Math.floor(i / 2 + 0.5) * 70;
    p.vx = 0;
    p.vy = 0;
  }
}

export function createWorld(players: { id: string; team: 0 | 1 }[]): World {
  const list: HaxPlayer[] = players.map((p) => ({
    id: p.id,
    team: p.team,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: PLAYER_R,
    m: PLAYER_MASS,
    cooldown: 0,
  }));
  kickoffPositions(list);
  return {
    players: list,
    ball: { x: PITCH.w / 2, y: PITCH.h / 2, vx: 0, vy: 0, r: BALL_R, m: BALL_MASS },
    score: { red: 0, blue: 0 },
    celebrating: 0,
    lastScorer: null,
    tick: 0,
  };
}

export function resetKickoff(w: World): void {
  kickoffPositions(w.players);
  w.ball.x = PITCH.w / 2;
  w.ball.y = PITCH.h / 2;
  w.ball.vx = 0;
  w.ball.vy = 0;
}

/** Advance the world one fixed step. Mutates `w` — it is the hot loop. */
export function step(w: World, inputs: Map<string, Input>): void {
  w.tick++;

  if (w.celebrating > 0) {
    w.celebrating--;
    if (w.celebrating === 0) resetKickoff(w);
    return;
  }

  for (const p of w.players) {
    const inp = inputs.get(p.id) ?? NO_INPUT;
    let ax = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let ay = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (ax !== 0 && ay !== 0) {
      // Diagonals must not be faster than the axes.
      const inv = Math.SQRT1_2;
      ax *= inv;
      ay *= inv;
    }
    p.vx = (p.vx + ax * PLAYER_ACCEL) * PLAYER_DAMP;
    p.vy = (p.vy + ay * PLAYER_ACCEL) * PLAYER_DAMP;

    if (p.cooldown > 0) p.cooldown--;

    if (inp.kick && p.cooldown === 0) {
      const dx = w.ball.x - p.x;
      const dy = w.ball.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < p.r + w.ball.r + KICK_RANGE) {
        w.ball.vx += (dx / d) * KICK_POWER;
        w.ball.vy += (dy / d) * KICK_POWER;
        p.cooldown = 14;
      }
    }
  }

  w.ball.vx *= BALL_DAMP;
  w.ball.vy *= BALL_DAMP;

  const speed = Math.hypot(w.ball.vx, w.ball.vy);
  if (speed > MAX_BALL_SPEED) {
    w.ball.vx = (w.ball.vx / speed) * MAX_BALL_SPEED;
    w.ball.vy = (w.ball.vy / speed) * MAX_BALL_SPEED;
  }

  for (const p of w.players) {
    p.x += p.vx;
    p.y += p.vy;
  }
  w.ball.x += w.ball.vx;
  w.ball.y += w.ball.vy;

  for (let i = 0; i < w.players.length; i++) {
    for (let j = i + 1; j < w.players.length; j++) {
      collide(w.players[i], w.players[j]);
    }
    collide(w.players[i], w.ball);
  }

  for (const p of w.players) confinePlayer(p);

  const scored = confineBall(w.ball);
  if (scored !== null) {
    if (scored === 0) w.score.red++;
    else w.score.blue++;
    w.lastScorer = scored;
    w.celebrating = 110;
  }
}

/** Push two overlapping discs apart and exchange momentum along the normal. */
export function collide(a: Disc, b: Disc): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (dist === 0 || dist >= min) return false;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = min - dist;

  // Separate proportionally to the inverse of mass: the light ball moves most.
  const totalInv = 1 / a.m + 1 / b.m;
  a.x -= nx * overlap * (1 / a.m / totalInv);
  a.y -= ny * overlap * (1 / a.m / totalInv);
  b.x += nx * overlap * (1 / b.m / totalInv);
  b.y += ny * overlap * (1 / b.m / totalInv);

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const along = rvx * nx + rvy * ny;
  if (along > 0) return true; // already separating

  const impulse = (-(1 + RESTITUTION) * along) / totalInv;
  a.vx -= (impulse * nx) / a.m;
  a.vy -= (impulse * ny) / a.m;
  b.vx += (impulse * nx) / b.m;
  b.vy += (impulse * ny) / b.m;
  return true;
}

/** Players are held inside the pitch; they cannot stand in the goal mouth. */
export function confinePlayer(p: Disc): void {
  const { left, right, top, bottom } = bounds();
  if (p.x - p.r < left) {
    p.x = left + p.r;
    p.vx = Math.abs(p.vx) * 0.3;
  }
  if (p.x + p.r > right) {
    p.x = right - p.r;
    p.vx = -Math.abs(p.vx) * 0.3;
  }
  if (p.y - p.r < top) {
    p.y = top + p.r;
    p.vy = Math.abs(p.vy) * 0.3;
  }
  if (p.y + p.r > bottom) {
    p.y = bottom - p.r;
    p.vy = -Math.abs(p.vy) * 0.3;
  }
}

/**
 * Bounce the ball off the walls, except through a goal mouth.
 * Returns the scoring team (0 = red, 1 = blue) or null.
 */
export function confineBall(b: Disc): 0 | 1 | null {
  const { left, right, top, bottom, goalTop, goalBottom } = bounds();
  const inMouth = b.y > goalTop && b.y < goalBottom;

  if (b.x - b.r < left) {
    if (inMouth) {
      // Fully across the left line: blue (attacking left) has scored.
      if (b.x + b.r < left) return 1;
    } else {
      b.x = left + b.r;
      b.vx = Math.abs(b.vx) * 0.85;
    }
  }
  if (b.x + b.r > right) {
    if (inMouth) {
      if (b.x - b.r > right) return 0;
    } else {
      b.x = right - b.r;
      b.vx = -Math.abs(b.vx) * 0.85;
    }
  }
  if (b.y - b.r < top) {
    b.y = top + b.r;
    b.vy = Math.abs(b.vy) * 0.85;
  }
  if (b.y + b.r > bottom) {
    b.y = bottom - b.r;
    b.vy = -Math.abs(b.vy) * 0.85;
  }

  // Once past the line, keep the ball from wandering out of the net entirely.
  if (b.x < left - PITCH.goalDepth) {
    b.x = left - PITCH.goalDepth;
    b.vx = 0;
  }
  if (b.x > right + PITCH.goalDepth) {
    b.x = right + PITCH.goalDepth;
    b.vx = 0;
  }
  return null;
}

/* ------------------------------------------------------------ networking -- */

/** What the host broadcasts each network tick. Kept small and flat. */
export interface Snapshot {
  t: number;
  b: [number, number, number, number];
  p: [string, number, number, number, number, number][];
  s: [number, number];
  c: number;
}

export function snapshot(w: World): Snapshot {
  return {
    t: w.tick,
    b: [round(w.ball.x), round(w.ball.y), round(w.ball.vx), round(w.ball.vy)],
    p: w.players.map((p) => [
      p.id,
      round(p.x),
      round(p.y),
      round(p.vx),
      round(p.vy),
      p.team,
    ]) as Snapshot['p'],
    s: [w.score.red, w.score.blue],
    c: w.celebrating,
  };
}

export function applySnapshot(w: World, s: Snapshot): void {
  w.tick = s.t;
  w.ball.x = s.b[0];
  w.ball.y = s.b[1];
  w.ball.vx = s.b[2];
  w.ball.vy = s.b[3];
  w.score.red = s.s[0];
  w.score.blue = s.s[1];
  w.celebrating = s.c;

  const seen = new Set<string>();
  for (const [id, x, y, vx, vy, team] of s.p) {
    seen.add(id);
    let p = w.players.find((q) => q.id === id);
    if (!p) {
      p = { id, team: team as 0 | 1, x, y, vx, vy, r: PLAYER_R, m: PLAYER_MASS, cooldown: 0 };
      w.players.push(p);
    }
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.team = team as 0 | 1;
  }
  w.players = w.players.filter((p) => seen.has(p.id));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
