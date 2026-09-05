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

// Goals are deliberately generous. A narrow mouth turns every match into a
// scramble in front of the net, and players can now stand in the goal, so the
// mouth has to be wide enough for a keeper and a striker at once.
export const PITCH_PRESETS: Record<'small' | 'normal' | 'big', Pitch> = {
  small: { w: 700, h: 380, pad: 30, goalHeight: 170, goalDepth: 40 },
  normal: { w: 840, h: 440, pad: 34, goalHeight: 200, goalDepth: 46 },
  big: { w: 1000, h: 520, pad: 38, goalHeight: 235, goalDepth: 52 },
};

export type PitchSize = keyof typeof PITCH_PRESETS;

/* ------------------------------------------------------------- power-ups - */

export type OrbKind = 'speed' | 'power' | 'control' | 'aim' | 'teleport';

/** Ordered, because a snapshot sends the index rather than the word. */
export const ORB_KINDS: OrbKind[] = ['speed', 'power', 'control', 'aim', 'teleport'];

export const ORB_RARE: OrbKind[] = ['aim', 'teleport'];

export interface Orb {
  id: number;
  x: number;
  y: number;
  kind: OrbKind;
  /** False while taken; counts down to a respawn. */
  active: boolean;
  respawnIn: number;
}

export const ORB_RADIUS = 13;
/** How long a pick-up lasts, in ticks. */
export const BUFF_TICKS = 60 * 10;
const ORB_RESPAWN_TICKS = 60 * 12;
const ORB_COUNT = 4;

/** What each buff does to the rules while it is running. */
export const SPEED_MULTIPLIER = 1.75;
export const POWER_MULTIPLIER = 1.6;
export const CONTROL_CHARGE_MULTIPLIER = 3;

export const PITCH: Pitch = PITCH_PRESETS.normal;

export const PLAYER_R = 15;
export const BALL_R = 13;

/** Three seconds at 60Hz, so everyone can find their player before the whistle. */
export const COUNTDOWN_TICKS = 180;

/**
 * How long the goal sequence runs: a beat on the scorer, the replay, then the
 * fade. Long, because it is meant to be watched rather than sat through.
 */
export const CELEBRATION_TICKS = 60 * 9;

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
  /** Scatter power-up orbs around the pitch. */
  powerUps: boolean;
  /**
   * How long the goal sequence runs. Practice cuts it right down: nobody
   * wants a nine-second film every time they hit the net on their own.
   */
  celebrationTicks: number;
}

// Deliberately sluggish: the old values crossed the pitch in about two
// seconds, which left no time to position or aim. This is roughly half that.
export const DEFAULT_RULES: Rules = {
  playerAccel: 0.14,
  playerDamping: 0.935,
  ballDamping: 0.99,
  // A bare touch is a real kick but not a shot; the gap to a full wind-up is
  // where the whole power system lives.
  kickMin: 5.5,
  kickMax: 13,
  // Three seconds of dribbling to reach full power. Fast enough to be worth
  // going for, slow enough that you have to actually protect the ball.
  chargeRate: 1 / 180,
  maxBallSpeed: 18,
  scoreLimit: 5,
  timeLimitSec: 300,
  pitchSize: 'normal',
  powerUps: false,
  celebrationTicks: CELEBRATION_TICKS,
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

/** The ceiling a fully-wound shot reaches. The floor is set by kickMin. */
export const POWER_PRESETS: Record<string, number> = {
  Softer: 9,
  Normal: 13,
  Harder: 16,
  Cannon: 18,
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
  /** 0..1 shot power, built by keeping the ball at your feet. */
  charge: number;
  /** True while the kick key is down, which is what lightens the disc. */
  kickHeld: boolean;
  /** Unit vector the next shot would travel along, for the aim guide. */
  aimX: number;
  aimY: number;
  /** Ticks left on each pick-up, and how many teleports are banked. */
  buffs: { speed: number; power: number; control: number; aim: number };
  teleports: number;
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
  /**
   * Who touched the ball last. Cosmetics belong to a person, so the trail and
   * the goal effect follow the ball's owner rather than whoever is watching.
   */
  lastTouch: string | null;
  /**
   * Recent touches, newest last. Enough history to work out an assist, and
   * capped so it cannot grow across a long match.
   */
  touches: Touch[];
  /** Filled in the moment a goal goes in, and read by the replay overlay. */
  goal: GoalInfo | null;
  /** Power-up orbs, empty unless the mode is switched on. */
  orbs: Orb[];
  /**
   * When the ball last came off a wall. The replay slows on whichever came
   * last, a touch or a bounce, so a shot off the boards is slowed at the
   * board rather than back at the player who hit it.
   */
  lastBounceTick: number;
}

export interface Touch {
  id: string;
  team: 0 | 1;
  tick: number;
}

export interface GoalInfo {
  /** Which end it went in: 0 = the left goal, 1 = the right one. */
  side: 0 | 1;
  /** Who put it in — which may be someone who put it in their own net. */
  scorer: string | null;
  /** The team credited with the goal. */
  team: 0 | 1;
  assist: string | null;
  ownGoal: boolean;
  /** The tick the scoring touch happened, so the replay can slow down there. */
  shotTick: number;
  /** Where the ball crossed, for the camera. */
  x: number;
  y: number;
}

/** A touch is only an assist if it was recent enough to have set the goal up. */
const ASSIST_WINDOW_TICKS = 60 * 8;

/**
 * Close to a post, a wall bounce is really a post — and a post is not the
 * moment anyone wants to see slowed down.
 */
const POST_ZONE = 26;

/**
 * Below this you are not dribbling, you are leaning on the ball.
 *
 * Power comes from running with it. Standing on top of a stationary ball and
 * waiting was the cheapest way to a full-power shot in the game, and it made
 * the best play "do nothing for three seconds".
 */
const DRIBBLE_SPEED = 0.45;

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

/**
 * Put everyone somewhere in their own half.
 *
 * Deliberately not a fixed formation: identical kickoffs every time make the
 * restart feel like a reset rather than a fresh start, and the same player
 * always ends up first to the ball.
 */
export function kickoffPositions(
  players: HaxPlayer[],
  pitch: Pitch = PITCH,
  random: () => number = Math.random,
): void {
  const { left, right, top, bottom } = bounds(pitch);
  const cx = pitch.w / 2;

  for (const p of players) {
    // A band in your own half, kept clear of the centre circle and the walls.
    const near = p.team === 0 ? left + 70 : cx + 90;
    const far = p.team === 0 ? cx - 90 : right - 70;
    p.x = near + random() * Math.max(1, far - near);
    p.y = top + 40 + random() * Math.max(1, bottom - top - 80);
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
    buffs: { speed: 0, power: 0, control: 0, aim: 0 },
    teleports: 0,
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
    lastTouch: null,
    touches: [],
    goal: null,
    orbs: rules.powerUps ? spawnOrbs(pitch) : [],
    lastBounceTick: -1,
  };
}

/** A fresh scatter of orbs, weighted so the strong ones are uncommon. */
export function spawnOrbs(pitch: Pitch, random: () => number = Math.random): Orb[] {
  const { left, right, top, bottom } = bounds(pitch);
  return Array.from({ length: ORB_COUNT }, (_, id) => ({
    id,
    x: left + 60 + random() * (right - left - 120),
    y: top + 40 + random() * (bottom - top - 80),
    kind: pickOrbKind(random),
    active: true,
    respawnIn: 0,
  }));
}

export function pickOrbKind(random: () => number = Math.random): OrbKind {
  // Roughly one in six is a rare one, so seeing an aim orb means something.
  return random() < 0.17
    ? ORB_RARE[Math.floor(random() * ORB_RARE.length)]
    : (['speed', 'power', 'control'] as OrbKind[])[Math.floor(random() * 3)];
}

/** Move a taken orb somewhere new and give it a fresh kind. */
function respawnOrb(orb: Orb, pitch: Pitch, random: () => number = Math.random): void {
  const { left, right, top, bottom } = bounds(pitch);
  orb.x = left + 60 + random() * (right - left - 120);
  orb.y = top + 40 + random() * (bottom - top - 80);
  orb.kind = pickOrbKind(random);
  orb.active = true;
  orb.respawnIn = 0;
}

/** Collect orbs and run down the clocks on everything already held. */
function stepOrbs(w: World, random: () => number = Math.random): void {
  for (const p of w.players) {
    for (const key of ['speed', 'power', 'control', 'aim'] as const) {
      if (p.buffs[key] > 0) p.buffs[key]--;
    }
  }

  for (const orb of w.orbs) {
    if (!orb.active) {
      if (--orb.respawnIn <= 0) respawnOrb(orb, w.pitch, random);
      continue;
    }

    for (const p of w.players) {
      if (Math.hypot(p.x - orb.x, p.y - orb.y) > p.r + ORB_RADIUS) continue;

      if (orb.kind === 'teleport') p.teleports = Math.min(3, p.teleports + 1);
      else p.buffs[orb.kind] = BUFF_TICKS;

      orb.active = false;
      orb.respawnIn = ORB_RESPAWN_TICKS;
      break;
    }
  }
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
    if (w.celebrating === 0) {
      resetKickoff(w);
      w.goal = null;
      // Restart behind a countdown, the same as the opening whistle, so
      // nobody is caught still watching the replay when play resumes.
      if (!w.finished) w.countdown = COUNTDOWN_TICKS;
    }
    checkEnd(w);
    return;
  }

  const r = w.rules;

  if (w.orbs.length) stepOrbs(w);

  for (const p of w.players) {
    const inp = inputs.get(p.id) ?? NO_INPUT;
    let ax = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let ay = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (ax !== 0 && ay !== 0) {
      // Diagonals must not be faster than the axes.
      ax *= Math.SQRT1_2;
      ay *= Math.SQRT1_2;
    }
    const accel = r.playerAccel * (p.buffs.speed > 0 ? SPEED_MULTIPLIER : 1);
    p.vx = (p.vx + ax * accel) * r.playerDamping;
    p.vy = (p.vy + ay * accel) * r.playerDamping;

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

    // Power comes from running with the ball, not from standing on it.
    // Losing the ball drops everything; stopping simply stops the clock, so
    // holding what you have while you look up is fine.
    const rate = r.chargeRate * (p.buffs.control > 0 ? CONTROL_CHARGE_MULTIPLIER : 1);
    const dribbling = Math.hypot(p.vx, p.vy) > DRIBBLE_SPEED;
    if (!inReach) p.charge = 0;
    else if (dribbling) p.charge = Math.min(MAX_CHARGE, p.charge + rate);

    // The key is intent, and it fires the moment there is something to hit —
    // so you can run at a loose ball with it held and strike on contact.
    p.kickHeld = inp.kick;

    if (inp.kick && inReach && p.cooldown === 0) {
      let dirX = p.aimX;
      let dirY = p.aimY;

      // An aim orb straightens the shot towards the goal mouth rather than
      // wherever you happened to be standing.
      if (p.buffs.aim > 0) {
        const { left, right } = bounds(w.pitch);
        const tx = p.team === 0 ? right : left;
        const ty = w.pitch.h / 2;
        const len = Math.hypot(tx - w.ball.x, ty - w.ball.y) || 1;
        dirX = (tx - w.ball.x) / len;
        dirY = (ty - w.ball.y) / len;
      }

      const power =
        (r.kickMin + p.charge * (r.kickMax - r.kickMin)) *
        (p.buffs.power > 0 ? POWER_MULTIPLIER : 1);

      w.ball.vx += dirX * power;
      w.ball.vy += dirY * power;
      p.charge = 0;
      p.cooldown = KICK_COOLDOWN;
      noteTouch(w, p);
    } else if (inp.kick && !inReach && p.teleports > 0 && p.cooldown === 0) {
      // A banked teleport is spent by reaching for a ball you cannot reach.
      const len = Math.hypot(w.ball.x - p.x, w.ball.y - p.y) || 1;
      p.x = w.ball.x - ((w.ball.x - p.x) / len) * (p.r + w.ball.r + 4);
      p.y = w.ball.y - ((w.ball.y - p.y) / len) * (p.r + w.ball.r + 4);
      p.vx = 0;
      p.vy = 0;
      p.teleports--;
      p.cooldown = KICK_COOLDOWN * 3;
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
    // A bump counts as a touch too, not only a deliberate kick.
    if (collide(w.players[i], w.ball)) noteTouch(w, w.players[i]);
  }

  for (const p of w.players) confinePlayer(p, w.pitch);

  // A reflection is a bounce: compare the sign of the velocity either side of
  // the walls check rather than teaching confineBall to report on itself.
  const beforeVx = w.ball.vx;
  const beforeVy = w.ball.vy;

  const scored = confineBall(w.ball, w.pitch);

  const { goalTop, goalBottom } = bounds(w.pitch);
  const nearPost =
    Math.abs(w.ball.y - goalTop) < POST_ZONE || Math.abs(w.ball.y - goalBottom) < POST_ZONE;

  const flippedX = beforeVx !== 0 && Math.sign(w.ball.vx) !== Math.sign(beforeVx);
  const flippedY = beforeVy !== 0 && Math.sign(w.ball.vy) !== Math.sign(beforeVy);

  // A side-wall bounce right beside the mouth is the post, and clipping the
  // post is not the moment the replay should linger on.
  if (flippedY || (flippedX && !nearPost)) w.lastBounceTick = w.tick;

  if (scored !== null) {
    if (scored === 0) w.score.red++;
    else w.score.blue++;
    w.lastScorer = scored;
    w.celebrating = w.rules.celebrationTicks ?? CELEBRATION_TICKS;
    w.goal = describeGoal(w, scored);
  }

  checkEnd(w);
}

/** Remember a touch, collapsing a run of touches by the same player. */
function noteTouch(w: World, p: HaxPlayer): void {
  w.lastTouch = p.id;
  const last = w.touches[w.touches.length - 1];
  if (last && last.id === p.id) {
    last.tick = w.tick;
    return;
  }
  w.touches.push({ id: p.id, team: p.team, tick: w.tick });
  if (w.touches.length > 12) w.touches.shift();
}

/**
 * Work out who gets the credit.
 *
 * The scorer is whoever touched it last. The assist is the touch before that
 * by a different player on the same side — and only if it was recent, because
 * a pass two minutes ago did not set this up. Putting it into your own net
 * credits the other team and nobody gets an assist for it.
 */
export function describeGoal(w: World, team: 0 | 1): GoalInfo {
  const touches = w.touches;
  const last = touches[touches.length - 1] ?? null;
  const ownGoal = last ? last.team !== team : false;

  let assist: string | null = null;
  if (last && !ownGoal) {
    for (let i = touches.length - 2; i >= 0; i--) {
      const t = touches[i];
      if (t.id === last.id) continue;
      if (t.team === last.team && w.tick - t.tick <= ASSIST_WINDOW_TICKS) assist = t.id;
      break;
    }
  }

  return {
    // Red attacks right, so a goal for red went in at the right-hand end.
    side: team === 0 ? 1 : 0,
    scorer: last?.id ?? null,
    team,
    assist,
    ownGoal,
    // Whichever happened last: the strike, or the wall it came off. A bounce
    // shot should be slowed at the board, not back where it was struck.
    shotTick: Math.max(last?.tick ?? w.tick, w.lastBounceTick),
    x: w.ball.x,
    y: w.ball.y,
  };
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

/**
 * Hold a player inside the pitch — except that they may stand in the goal.
 *
 * Being able to sit between the posts is what makes a keeper possible, and
 * chasing the ball into the net is half the fun. The side wall therefore moves
 * back to the netting whenever a player is between the posts, and once they
 * are inside a goal the posts become their ceiling and floor.
 */
export function confinePlayer(p: Disc, pitch: Pitch = PITCH): void {
  const { left, right, top, bottom, goalTop, goalBottom } = bounds(pitch);

  const betweenPosts = p.y > goalTop && p.y < goalBottom;
  const leftLimit = betweenPosts ? left - pitch.goalDepth : left;
  const rightLimit = betweenPosts ? right + pitch.goalDepth : right;

  if (p.x - p.r < leftLimit) {
    p.x = leftLimit + p.r;
    p.vx = Math.abs(p.vx) * 0.3;
  }
  if (p.x + p.r > rightLimit) {
    p.x = rightLimit - p.r;
    p.vx = -Math.abs(p.vx) * 0.3;
  }

  // Inside a goal, the posts are the walls rather than the touchlines.
  const inGoal = p.x < left || p.x > right;
  const yTop = inGoal ? goalTop : top;
  const yBottom = inGoal ? goalBottom : bottom;

  if (p.y - p.r < yTop) {
    p.y = yTop + p.r;
    p.vy = Math.abs(p.vy) * 0.3;
  }
  if (p.y + p.r > yBottom) {
    p.y = yBottom - p.r;
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
  /** id, x, y, vx, vy, team, charge, aimX, aimY, kickHeld, speed, power, control, aim, teleports */
  p: [
    string, number, number, number, number, number, number, number, number, number,
    number, number, number, number, number,
  ][];
  /** orbs: id, x, y, kind index, active */
  o: [number, number, number, number, number][];
  s: [number, number];
  c: number;
  /** countdown ticks remaining */
  k: number;
  /** last player to touch the ball, so cosmetics follow its owner */
  lt: string | null;
  /** the goal being celebrated, if any */
  g: GoalInfo | null;
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
      p.kickHeld ? 1 : 0,
      p.buffs.speed,
      p.buffs.power,
      p.buffs.control,
      p.buffs.aim,
      p.teleports,
    ]) as Snapshot['p'],
    o: w.orbs.map((o) => [
      o.id,
      round(o.x),
      round(o.y),
      ORB_KINDS.indexOf(o.kind),
      o.active ? 1 : 0,
    ]) as Snapshot['o'],
    s: [w.score.red, w.score.blue],
    c: w.celebrating,
    k: w.countdown,
    lt: w.lastTouch,
    g: w.goal,
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
  w.lastTouch = s.lt ?? null;
  w.goal = s.g ?? null;
  w.finished = s.f === 1;
  w.winner = s.w === -1 ? null : (s.w as 0 | 1);

  const seen = new Set<string>();
  // Orbs are small and few, so they are simply replaced wholesale.
  w.orbs = (s.o ?? []).map(([id, x, y, kind, active]) => ({
    id,
    x,
    y,
    kind: ORB_KINDS[kind] ?? 'speed',
    active: active === 1,
    respawnIn: 0,
  }));

  for (const [
    id, x, y, vx, vy, team, charge, aimX, aimY, held,
    speed, power, control, aim, teleports,
  ] of s.p) {
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
        buffs: { speed: 0, power: 0, control: 0, aim: 0 },
        teleports: 0,
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
    p.kickHeld = held === 1;
    p.buffs = { speed, power, control, aim };
    p.teleports = teleports;
  }
  w.players = w.players.filter((p) => seen.has(p.id));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
