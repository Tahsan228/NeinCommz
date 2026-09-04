import {
  NO_INPUT,
  bounds,
  canKick,
  type Input,
  type World,
} from './physics';

/**
 * Haxball bots.
 *
 * Deliberately simple: chase, defend, and shoot roughly at the goal. They are
 * here so two people can have a 2v2 rather than to be a challenge, and they
 * behave like enthusiastic beginners — which is the right level for filling a
 * seat in a game nobody is taking seriously.
 *
 * Pure: given a world it returns inputs, so the behaviour can be tested
 * without a browser and the host can simply feed the results into the loop.
 */

export type BotSkill = 'easy' | 'medium' | 'hard';

export const BOT_SKILL: Record<BotSkill, { label: string; reaction: number; accuracy: number }> = {
  // `reaction` is how much of the ball's motion they fail to anticipate;
  // `accuracy` is how straight they aim.
  easy: { label: 'Clumsy', reaction: 0, accuracy: 0.55 },
  medium: { label: 'Decent', reaction: 8, accuracy: 0.8 },
  hard: { label: 'Sharp', reaction: 16, accuracy: 0.95 },
};

export const BOT_PREFIX = 'bot:';

export function isBot(id: string): boolean {
  return id.startsWith(BOT_PREFIX);
}

export function botName(id: string): string {
  return 'Bot ' + id.slice(BOT_PREFIX.length);
}

/** Push an analogue direction into the four-key input the world expects. */
function toInput(dx: number, dy: number, kick: boolean): Input {
  const dead = 0.22;
  return {
    left: dx < -dead,
    right: dx > dead,
    up: dy < -dead,
    down: dy > dead,
    kick,
  };
}

/**
 * Where this bot should be standing when it is not chasing.
 *
 * Spread out along their own half so a team of bots does not pile onto one
 * spot, which is what makes them look like a swarm rather than a team.
 */
function homeSpot(w: World, index: number, team: 0 | 1): { x: number; y: number } {
  const { left, right, top, bottom } = bounds(w.pitch);
  const depth = 0.22 + (index % 3) * 0.11;
  const x = team === 0 ? left + (right - left) * depth : right - (right - left) * depth;
  const lane = index % 2 === 0 ? 0.34 : 0.66;
  return { x, y: top + (bottom - top) * lane };
}

/**
 * Decide one bot's input for this tick.
 *
 * `index` spreads teammates out; `random` is injected so tests are stable.
 */
export function botInput(
  w: World,
  id: string,
  index: number,
  skill: BotSkill = 'medium',
  random: () => number = Math.random,
): Input {
  const me = w.players.find((p) => p.id === id);
  if (!me || w.countdown > 0 || w.celebrating > 0 || w.finished) return { ...NO_INPUT };

  const cfg = BOT_SKILL[skill];
  const { left, right } = bounds(w.pitch);

  // Aim where the ball is going, not where it is — the whole difference
  // between a bot that looks alive and one that always arrives late.
  const ballX = w.ball.x + w.ball.vx * cfg.reaction;
  const ballY = w.ball.y + w.ball.vy * cfg.reaction;

  const ownGoalX = me.team === 0 ? left : right;
  const theirGoalX = me.team === 0 ? right : left;
  const theirGoalY = w.pitch.h / 2;

  // Whoever on this team is closest chases; the rest hold position. Without
  // this every bot converges on the ball and they shove each other off it.
  const mates = w.players.filter((p) => p.team === me.team);
  const closest = mates.reduce((best, p) =>
    Math.hypot(w.ball.x - p.x, w.ball.y - p.y) < Math.hypot(w.ball.x - best.x, w.ball.y - best.y)
      ? p
      : best,
  );
  const chasing = closest.id === me.id;

  // If the ball is behind us, get goal-side of it before doing anything else.
  const ballIsBehind =
    me.team === 0 ? w.ball.x < me.x - 20 : w.ball.x > me.x + 20;

  let targetX: number;
  let targetY: number;

  if (chasing) {
    if (ballIsBehind) {
      // Loop back towards our own goal rather than pushing the ball into it.
      targetX = ballX + (me.team === 0 ? -50 : 50);
      targetY = ballY + (me.y < w.pitch.h / 2 ? -40 : 40);
    } else {
      // Line up behind the ball so a kick sends it towards their goal.
      const dx = theirGoalX - ballX;
      const dy = theirGoalY - ballY;
      const len = Math.hypot(dx, dy) || 1;
      targetX = ballX - (dx / len) * (me.r + w.ball.r);
      targetY = ballY - (dy / len) * (me.r + w.ball.r);
    }
  } else {
    const home = homeSpot(w, index, me.team);
    // Drift towards the ball's side of the pitch without abandoning the post.
    targetX = home.x + (ballX - home.x) * 0.25;
    targetY = home.y + (ballY - home.y) * 0.45;
    // Never let the ball get behind the whole team unmarked.
    if (Math.abs(w.ball.x - ownGoalX) < 160) {
      targetX = (targetX + ownGoalX) / 2;
      targetY = (targetY + w.ball.y) / 2;
    }
  }

  // Never aim at a spot inside a goal; the netting is not a useful place to
  // stand, and a bot that walks in there looks lost.
  targetX = Math.min(right - me.r, Math.max(left + me.r, targetX));

  let dx = targetX - me.x;
  let dy = targetY - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  dx /= dist;
  dy /= dist;

  // A little wobble, so they do not move like a machine and so two bots on the
  // same errand do not overlap exactly.
  const wobble = (1 - cfg.accuracy) * 0.6;
  dx += (random() - 0.5) * wobble;
  dy += (random() - 0.5) * wobble;

  // Kick when in range and roughly facing the right way. Charging is held
  // across ticks by the world itself, so returning kick:true builds power.
  let kick = false;
  if (canKick(me, w.ball)) {
    const towardsGoal = (theirGoalX - me.x) * me.aimX > 0;
    // A shot travels along player -> ball, so standing goal-side of the ball
    // and kicking puts it in your own net. Never do that, whatever else the
    // situation suggests — it is the one mistake that reads as broken rather
    // than as a bot playing badly.
    const intoOwnNet = (ownGoalX - me.x) * me.aimX > 0;
    const closeIn = Math.abs(me.x - theirGoalX) < (right - left) * 0.42;
    // Near goal, shoot at once; further out, wind up a clearance instead.
    kick = !intoOwnNet && (towardsGoal || !closeIn);
    if (random() > cfg.accuracy) kick = false; // occasionally fluff it
  }

  return toInput(dx, dy, kick);
}

/** Inputs for every bot on the pitch, ready to merge into the host's map. */
export function botInputs(
  w: World,
  skill: BotSkill = 'medium',
  random: () => number = Math.random,
): Map<string, Input> {
  const out = new Map<string, Input>();
  let index = 0;
  for (const p of w.players) {
    if (!isBot(p.id)) continue;
    out.set(p.id, botInput(w, p.id, index++, skill, random));
  }
  return out;
}
