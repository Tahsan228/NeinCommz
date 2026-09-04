/**
 * A small deterministic 2D world: discs on a pitch, elastic collisions, and a
 * ball you charge up and release. Kept free of React and of the network so it
 * can be stepped identically on the host and reasoned about in tests.
 *
 * This is a simplified take on Haxball rather than a clone: same shape of game,
 * considerably simpler collision resolution.
 */

export interface Pitch {
  w: number;
  h: number;
  /** Playing area inset from the canvas edge. */
  pad: number;
  goalHeight: number;
  goalDepth: number;
}

export const PITCH_PRESETS: Record<'small' | 'normal' | 'big', Pitch> = {
  small: { w: 700, h: 380, pad: 30, goalHeight: 130, goalDepth: 24 },
  normal: { w: 840, h: 440, pad: 34, goalHeight: 150, goalDepth: 26 },
  big: { w: 1000, h: 520, pad: 38, goalHeight: 175, goalDepth: 30 },
};

export type PitchSize = keyof typeof PITCH_PRESETS;

export const PITCH: Pitch = PITCH_PRESETS.normal;

export const PLAYER_R = 15;
export const BALL_R = 9;

const PLAYER_MASS = 1;
const BALL_MASS = 0.55;
const RESTITUTION = 0.62;

/**
 * Everything a host can tune before kickoff. Bundled into the world so the
 * simulation reads its own settings rather than module constants, which is
 * what makes per-room configuration possible at all.
 */
export interface Rules {
  /** Acceleration per tick. Top speed works out near accel * damp / (1 - damp). */
  playerAccel: number;
  playerDamping: number;
  ballDamping: number;
  /** Impulse from a tap with no charge. */
  kickMin: number;
  /** Impulse from a fully charged shot. */
  kickMax: number;
  /** Charge gained per tick while the kick key is held. */
  chargeRate: number;
  maxBallSpeed: number;
  /** Goals needed to win. 0 means play forever. */
  scoreLimit: number;
  /** Match length in seconds. 0 means no clock. */
  timeLimitSec: number;
  pitchSize: PitchSize;
}

// Deliberately sluggish: the old values crossed the pitch in about two
// seconds, which left no time to position or aim. This is roughly half that.
export const DEFAULT_RULES: Rules = {
  playerAccel: 0.14,
  playerDamping: 0.935,
  ballDamping: 0.99,
  kickMin: 1.6,
  kickMax: 6,
  chargeRate: 0.022,
  maxBallSpeed: 18,
  scoreLimit: 5,
  timeLimitSec: 300,
  pitchSize: 'normal',
};

/**
 * What was previously labelled "Snail" is the pace the game actually wants, so
 * the labels shifted rather than the physics: Normal is the old Snail, with
 * room on both sides of it.
 */
export const SPEED_PRESETS: Record<string, number> = {
  Slower: 0.09,
  Slow: 0.115,
  Normal: 0.14,
  Faster: 0.19,
  Fastest: 0.26,
};

/** Likewise: the old "Gentle" is the sensible default. */
export const POWER_PRESETS: Record<string, number> = {
  Softer: 4,
  Normal: 6,
  Harder: 9.5,
  Cannon: 13,
};

export const KICK_RANGE = 8;
const KICK_COOLDOWN = 12;
/** Ticks of full-charge hold before it stops building. */
export const MAX_CHARGE = 1;

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
  /** Frames of kick cooldown remaining, so a held key cannot machine-gun. */
  cooldown: number;
  /** 0..1 shot power, built while the kick key is held. */
  charge: number;
  kickHeld: boolean;
  /** Unit vector the next shot would travel along, for the aim guide. */
  aimX: number;
  aimY: number;
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
  rules: Rules;
  pitch: Pitch;
  /** Set once a score or time limit is reached; the host stops stepping. */
  finished: boolean;
  /** Winner of the match, or null for a draw. Only meaningful once finished. */
  winner: 0 | 1 | null;
  /** Frames of pre-kickoff countdown left. Nothing moves while this runs. */
  countdown: number;
}

/** Three seconds at 60Hz, so everyone can find their player before the whistle. */
export const COUNTDOWN_TICKS = 180;

/**
 * Is the ball close enough for this player to strike it?
 *
 * The aim guide keys off exactly this, so charging up while the ball is on the
 * other side of the pitch no longer draws a line to nowhere.
 */
export function canKick(p: { x: number; y: number; r: number }, ball: Disc): boolean {
  return Math.hypot(ball.x - p.x, ball.y - p.y) < p.r + ball.r + KICK_RANGE;
}

export function bounds(pitch: Pitch = PITCH) {
  const left = pitch.pad;
  const right = pitch.w - pitch.pad;
  const top = pitch.pad;
  const bottom = pitch.h - pitch.pad;
  const goalTop = (pitch.h - pitch.goalHeight) / 2;
  const goalBottom = goalTop + pitch.goalHeight;
  return { left, right, top, bottom, goalTop, goalBottom };
}

export function secondsElapsed(w: World): number {
  return w.tick / 60;
}

export function secondsRemaining(w: World): number {
  if (!w.rules.timeLimitSec) return Infinity;
  return Math.max(0, w.rules.timeLimitSec - secondsElapsed(w));
}

export function kickoffPositions(players: HaxPlayer[], pitch: Pitch = PITCH): void {
  const cx = pitch.w / 2;
  const cy = pitch.h / 2;
  const perTeam = [0, 0];
  for (const p of players) {
    const i = perTeam[p.team]++;
    const dir = p.team === 0 ? -1 : 1;
    p.x = cx + dir * (110 + i * 58);
    p.y = cy + (i % 2 === 0 ? -1 : 1) * Math.floor(i / 2 + 0.5) * 70;
    p.vx = 0;
    p.vy = 0;
    p.charge = 0;
    p.kickHeld = false;
  }
}

export function createWorld(
  players: { id: string; team: 0 | 1 }[],
  rules: Rules = DEFAULT_RULES,
): World {
  const pitch = PITCH_PRESETS[rules.pitchSize] ?? PITCH;
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
    charge: 0,
    kickHeld: false,
    aimX: 1,
    aimY: 0,
  }));
  kickoffPositions(list, pitch);
  return {
    players: list,
    ball: { x: pitch.w / 2, y: pitch.h / 2, vx: 0, vy: 0, r: BALL_R, m: BALL_MASS },
    score: { red: 0, blue: 0 },
    celebrating: 0,
    lastScorer: null,
    tick: 0,
    rules,
    pitch,
    finished: false,
    winner: null,
    countdown: COUNTDOWN_TICKS,
  };
}

export function resetKickoff(w: World): void {
  kickoffPositions(w.players, w.pitch);
  w.ball.x = w.pitch.w / 2;
  w.ball.y = w.pitch.h / 2;
  w.ball.vx = 0;
  w.ball.vy = 0;
}

function checkEnd(w: World): void {
  const { scoreLimit, timeLimitSec } = w.rules;
  if (scoreLimit > 0 && (w.score.red >= scoreLimit || w.score.blue >= scoreLimit)) {
    w.finished = true;
  } else if (timeLimitSec > 0 && secondsElapsed(w) >= timeLimitSec) {
    w.finished = true;
  }
  if (w.finished) {
    w.winner = w.score.red === w.score.blue ? null : w.score.red > w.score.blue ? 0 : 1;
  }
}

/** Advance the world one fixed step. Mutates `w` — it is the hot loop. */
export function step(w: World, inputs: Map<string, Input>): void {
  if (w.finished) return;

  // The countdown freezes play but still advances, so the clock only starts
  // when the match actually does.
  if (w.countdown > 0) {
    w.countdown--;
    return;
  }

  w.tick++;

  if (w.celebrating > 0) {
    w.celebrating--;
    if (w.celebrating === 0) resetKickoff(w);
    checkEnd(w);
    return;
  }

  const r = w.rules;

  for (const p of w.players) {
    const inp = inputs.get(p.id) ?? NO_INPUT;
    let ax = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let ay = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (ax !== 0 && ay !== 0) {
      // Diagonals must not be faster than the axes.
      ax *= Math.SQRT1_2;
      ay *= Math.SQRT1_2;
    }
    p.vx = (p.vx + ax * r.playerAccel) * r.playerDamping;
    p.vy = (p.vy + ay * r.playerAccel) * r.playerDamping;

    if (p.cooldown > 0) p.cooldown--;

    // A shot travels along player -> ball, so that is also what the aim guide
    // has to draw. Keep the last direction when the ball is exactly on top.
    const dx = w.ball.x - p.x;
    const dy = w.ball.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.001) {
      p.aimX = dx / d;
      p.aimY = dy / d;
    }

    const inReach = d > 0 && d < p.r + w.ball.r + KICK_RANGE;

    if (inp.kick) {
      // Power only builds while the ball is actually within reach, so holding
      // the key across the pitch neither charges nor draws an aim guide.
      p.kickHeld = true;
      p.charge = inReach ? Math.min(MAX_CHARGE, p.charge + r.chargeRate) : 0;
    } else if (p.kickHeld) {
      p.kickHeld = false;
      const power = r.kickMin + p.charge * (r.kickMax - r.kickMin);
      p.charge = 0;
      if (p.cooldown === 0 && inReach) {
        w.ball.vx += p.aimX * power;
        w.ball.vy += p.aimY * power;
        p.cooldown = KICK_COOLDOWN;
      }
    }
  }

  w.ball.vx *= r.ballDamping;
  w.ball.vy *= r.ballDamping;

  const speed = Math.hypot(w.ball.vx, w.ball.vy);
  if (speed > r.maxBallSpeed) {
    w.ball.vx = (w.ball.vx / speed) * r.maxBallSpeed;
    w.ball.vy = (w.ball.vy / speed) * r.maxBallSpeed;
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

  for (const p of w.players) confinePlayer(p, w.pitch);

  const scored = confineBall(w.ball, w.pitch);
  if (scored !== null) {
    if (scored === 0) w.score.red++;
    else w.score.blue++;
    w.lastScorer = scored;
    w.celebrating = 110;
  }

  checkEnd(w);
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
export function confinePlayer(p: Disc, pitch: Pitch = PITCH): void {
  const { left, right, top, bottom } = bounds(pitch);
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
export function confineBall(b: Disc, pitch: Pitch = PITCH): 0 | 1 | null {
  const { left, right, top, bottom, goalTop, goalBottom } = bounds(pitch);
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
  if (b.x < left - pitch.goalDepth) {
    b.x = left - pitch.goalDepth;
    b.vx = 0;
  }
  if (b.x > right + pitch.goalDepth) {
    b.x = right + pitch.goalDepth;
    b.vx = 0;
  }
  return null;
}

/* ------------------------------------------------------------ networking -- */

/** What the host broadcasts each network tick. Kept small and flat. */
export interface Snapshot {
  t: number;
  b: [number, number, number, number];
  /** id, x, y, vx, vy, team, charge, aimX, aimY */
  p: [string, number, number, number, number, number, number, number, number][];
  s: [number, number];
  c: number;
  /** countdown ticks remaining */
  k: number;
  /** finished flag + winner, so clients can show the result without guessing */
  f: 0 | 1;
  w: number;
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
      round(p.charge),
      round(p.aimX),
      round(p.aimY),
    ]) as Snapshot['p'],
    s: [w.score.red, w.score.blue],
    c: w.celebrating,
    k: w.countdown,
    f: w.finished ? 1 : 0,
    w: w.winner === null ? -1 : w.winner,
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
  w.countdown = s.k ?? 0;
  w.finished = s.f === 1;
  w.winner = s.w === -1 ? null : (s.w as 0 | 1);

  const seen = new Set<string>();
  for (const [id, x, y, vx, vy, team, charge, aimX, aimY] of s.p) {
    seen.add(id);
    let p = w.players.find((q) => q.id === id);
    if (!p) {
      p = {
        id,
        team: team as 0 | 1,
        x,
        y,
        vx,
        vy,
        r: PLAYER_R,
        m: PLAYER_MASS,
        cooldown: 0,
        charge: 0,
        kickHeld: false,
        aimX: 1,
        aimY: 0,
      };
      w.players.push(p);
    }
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.team = team as 0 | 1;
    p.charge = charge;
    p.aimX = aimX;
    p.aimY = aimY;
  }
  w.players = w.players.filter((p) => seen.has(p.id));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
