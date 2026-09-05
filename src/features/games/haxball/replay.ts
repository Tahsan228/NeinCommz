import type { Snapshot } from './physics';

/**
 * How the goal replay is played back.
 *
 * Expressed in world ticks rather than in tape frames, which is the point of
 * this module. A tape frame is not a unit of time: the host records one entry
 * per tick, but a watching client only hears from the host every other tick,
 * so the same "200 frames" is 3.3 seconds of football on one screen and 6.6
 * seconds on another. Pacing by frame index therefore ran the replay at
 * roughly double speed for everyone who was not hosting.
 *
 * Three phases, in the order a broadcast would cut them:
 *
 *   run-up    life speed, so the move that built the goal reads normally
 *   crawl     the strike itself, and this one is never negotiable
 *   release   the ball finishing its travel into the net
 *
 * The crawl is sized first and the run-up absorbs whatever is left. Doing it
 * the other way round — deciding how much footage to show and then finding a
 * speed for it — is what made slow motion quietly disappear on any goal where
 * the ball was in the air a while: the maths kept handing speed back until the
 * whole replay was running at life speed with no crawl left in it.
 */

/** Physics ticks per second. */
const TICK_HZ = 60;

/** The crawl. Below 1 is slower than life. */
export const SLOW_SPEED = 0.3;

/** The run-up plays at life speed. It is context, not the point. */
export const RUN_UP_SPEED = 1;

/** The ball completing its journey, once the strike has been dwelt on. */
export const RELEASE_SPEED = 0.6;

/** How far before the strike the crawl begins. */
export const SLOW_LEAD_TICKS = 30;

/** And how far past it, before the release takes over. */
export const SLOW_TAIL_TICKS = 45;

export interface ReplayPlan {
  /** First tick shown. */
  fromTick: number;
  /** Where life speed gives way to the crawl. */
  slowFromTick: number;
  /** Where the crawl gives way to the release. */
  slowToTick: number;
  /** Last tick shown — the ball crossing the line. */
  toTick: number;
  /** Share of the replay's running time spent on the run-up, 0..1. */
  runUpShare: number;
  /** Share spent on the crawl. */
  slowShare: number;
}

/**
 * Choose the window of play to show, and how to divide the time between the
 * three phases.
 *
 * `seconds` is how long the replay has on screen. Nothing here is ever allowed
 * to exceed life speed: when the footage will not fit, the answer is to show
 * less of it, never to run it faster.
 */
export function planReplay(clip: Snapshot[], shotTick: number, seconds: number): ReplayPlan {
  const first = clip[0]?.t ?? 0;
  const toTick = clip[clip.length - 1]?.t ?? first;

  let slowFromTick = Math.min(toTick, Math.max(first, shotTick - SLOW_LEAD_TICKS));
  const slowToTick = Math.min(toTick, Math.max(slowFromTick, shotTick + SLOW_TAIL_TICKS));

  let slowFootage = (slowToTick - slowFromTick) / TICK_HZ;
  const releaseFootage = (toTick - slowToTick) / TICK_HZ;

  let slowWall = slowFootage / SLOW_SPEED;
  let releaseWall = releaseFootage / RELEASE_SPEED;

  if (slowWall + releaseWall > seconds) {
    // Give the release its speed back first, up to life speed but no further —
    // the ball travelling is the least interesting part of the three.
    releaseWall = Math.max(releaseFootage, Math.min(releaseWall, seconds - slowWall));

    if (slowWall + releaseWall > seconds) {
      // Still over, so the crawl has to give as well. It may slow down to life
      // speed and no further.
      slowWall = Math.max(slowFootage, seconds - releaseWall);

      if (slowWall + releaseWall > seconds) {
        // Everything is at life speed and it still does not fit, so there is
        // simply more football here than there is replay to show it in. Start
        // later and show less.
        slowWall = Math.max(0, seconds - releaseWall);
        slowFootage = slowWall * RUN_UP_SPEED;
        slowFromTick = slowToTick - slowFootage * TICK_HZ;
      }
    }
  }

  const runUpWall = Math.max(0, seconds - slowWall - releaseWall);
  // Never further back than the tape actually goes. Reaching that limit makes
  // the run-up play slower than life, never faster.
  const fromTick = Math.max(first, slowFromTick - runUpWall * RUN_UP_SPEED * TICK_HZ);

  return {
    fromTick,
    slowFromTick,
    slowToTick,
    toTick,
    runUpShare: seconds > 0 ? runUpWall / seconds : 0,
    slowShare: seconds > 0 ? slowWall / seconds : 0,
  };
}

/** Which tick of the clip belongs on screen at `progress` (0..1) of the replay. */
export function tickAt(progress: number, plan: ReplayPlan): number {
  const p = Math.min(1, Math.max(0, progress));
  const { fromTick, slowFromTick, slowToTick, toTick, runUpShare, slowShare } = plan;

  if (p < runUpShare) return fromTick + (p / runUpShare) * (slowFromTick - fromTick);

  const slowEnd = runUpShare + slowShare;
  if (p < slowEnd) {
    return slowShare > 0
      ? slowFromTick + ((p - runUpShare) / slowShare) * (slowToTick - slowFromTick)
      : slowToTick;
  }

  const releaseShare = 1 - slowEnd;
  return releaseShare > 0
    ? slowToTick + ((p - slowEnd) / releaseShare) * (toTick - slowToTick)
    : toTick;
}

/**
 * The two tape frames a tick falls between, and how far between them it is.
 *
 * Blending rather than snapping is what keeps the crawl smooth: at 0.3x a
 * frame is held for three screen frames, and stepping between them whole is
 * visible as judder.
 */
export function sampleAt(clip: Snapshot[], tick: number): { i: number; k: number } {
  if (clip.length < 2) return { i: 0, k: 0 };

  let i = clip.length - 2;
  for (let j = 0; j < clip.length - 1; j++) {
    if (clip[j + 1].t > tick) {
      i = j;
      break;
    }
  }
  i = Math.min(clip.length - 2, Math.max(0, i));

  const span = clip[i + 1].t - clip[i].t;
  const k = span > 0 ? (tick - clip[i].t) / span : 0;
  return { i, k: Math.min(1, Math.max(0, k)) };
}

/** True while the replay is in its crawl, so the screen can say so. */
export function inSlowMotion(progress: number, plan: ReplayPlan): boolean {
  return (
    plan.slowShare > 0 &&
    progress >= plan.runUpShare &&
    progress < plan.runUpShare + plan.slowShare
  );
}
