import type { Snapshot } from './physics';

/**
 * How the goal replay is played back.
 *
 * The whole thing is expressed in world ticks rather than in tape frames,
 * which is the point of this module. A tape frame is not a unit of time: the
 * host records one entry per tick, but a watching client only hears from the
 * host every other tick, so the same "200 frames" is 3.3 seconds of football
 * on one screen and 6.6 seconds on another. Pacing the replay by frame index
 * therefore ran it at roughly double speed for everyone who was not hosting,
 * which is exactly the "insanely fast" replay.
 *
 * Working in ticks makes the playback speed mean something: a stretch of
 * replay that covers N ticks in N/60 seconds of screen time is real speed,
 * whatever the tape density happens to be.
 */

/** Physics ticks per second. */
const TICK_HZ = 60;

/** How long a replay lingers, as a multiple of real time. Below 1 = slower. */
export const SLOW_SPEED = 0.3;

/** The run-up plays at life speed. It is context, not the point. */
export const RUN_UP_SPEED = 1;

/** How far before the strike the crawl begins. */
export const SLOW_LEAD_TICKS = 30;

/**
 * The most of the replay the crawl may eat.
 *
 * A shot from the halfway line can spend two seconds in the air; at a flat
 * 0.3x that alone would outlast the whole replay and the run-up would be cut
 * to nothing. Past this share the crawl gives back speed instead of time.
 */
export const MAX_SLOW_SHARE = 0.78;

export interface ReplayPlan {
  /** First tick shown. */
  fromTick: number;
  /** Where life speed gives way to the crawl. */
  slowFromTick: number;
  /** Last tick shown — the ball crossing the line. */
  toTick: number;
  /** Share of the replay's running time spent on the run-up, 0..1. */
  runUpShare: number;
}

/**
 * Choose the window of play to show and how to divide the time between the
 * run-up and the crawl.
 *
 * `seconds` is how long the replay has on screen. The crawl is sized first,
 * because the strike is the reason anyone is watching; whatever time is left
 * decides how far back the run-up reaches. That ordering is what stops a long
 * clip being crammed into a short slot — the footage is cut to fit the time
 * rather than the speed being raised to fit the footage.
 */
export function planReplay(clip: Snapshot[], shotTick: number, seconds: number): ReplayPlan {
  const first = clip[0]?.t ?? 0;
  const toTick = clip[clip.length - 1]?.t ?? first;

  // The crawl starts a moment before the strike, and never earlier than the
  // slot could show at life speed — there is no point lining up more football
  // than there is time for, because the only way to fit it would be to run it
  // fast, which is the thing being fixed.
  const slowFromTick = Math.min(
    toTick,
    Math.max(first, toTick - seconds * TICK_HZ, shotTick - SLOW_LEAD_TICKS),
  );

  const slowFootage = (toTick - slowFromTick) / TICK_HZ;

  let slowWall = slowFootage / SLOW_SPEED;
  // A shot from distance can spend two seconds in the air; at a flat 0.3x that
  // alone outlasts the replay, so past a share of it the crawl gives speed
  // back rather than eating the whole run-up.
  slowWall = Math.min(slowWall, seconds * MAX_SLOW_SHARE);
  // That cap is a ceiling on time, not a licence to speed up: whatever else
  // happens the crawl gets at least as long as the footage would take live.
  slowWall = Math.min(seconds, Math.max(slowWall, slowFootage / RUN_UP_SPEED));

  const runUpWall = Math.max(0, seconds - slowWall);
  // Never further back than the tape actually goes. Reaching that limit makes
  // the run-up play slower than life, never faster.
  const fromTick = Math.max(first, slowFromTick - runUpWall * RUN_UP_SPEED * TICK_HZ);

  return {
    fromTick,
    slowFromTick,
    toTick,
    runUpShare: seconds > 0 ? runUpWall / seconds : 0,
  };
}

/** Which tick of the clip belongs on screen at `progress` (0..1) of the replay. */
export function tickAt(progress: number, plan: ReplayPlan): number {
  const p = Math.min(1, Math.max(0, progress));
  const { fromTick, slowFromTick, toTick, runUpShare } = plan;

  if (runUpShare <= 0) return slowFromTick + p * (toTick - slowFromTick);
  if (p < runUpShare) return fromTick + (p / runUpShare) * (slowFromTick - fromTick);
  if (runUpShare >= 1) return slowFromTick;

  return slowFromTick + ((p - runUpShare) / (1 - runUpShare)) * (toTick - slowFromTick);
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

  // The tape is in tick order, so a walk from the end is enough — clips are a
  // few hundred entries and this runs once a frame.
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
  return progress >= plan.runUpShare && plan.runUpShare < 1;
}
