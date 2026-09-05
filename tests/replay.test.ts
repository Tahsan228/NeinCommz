import { describe, expect, it } from 'vitest';
import {
  MAX_SLOW_SHARE,
  SLOW_SPEED,
  inSlowMotion,
  planReplay,
  sampleAt,
  tickAt,
} from '../src/features/games/haxball/replay';
import type { Snapshot } from '../src/features/games/haxball/physics';

/**
 * The replay is paced in world ticks, and these tests exist because the unit
 * it used to be paced in — tape frames — is not a unit of time. The host
 * records one frame per tick; everyone watching records one per two. The same
 * clip therefore has to come out at the same speed from either tape, or the
 * replay runs at double speed for everyone who is not hosting.
 */

/** A tape covering `ticks` ticks, one entry every `every` ticks. */
function tape(ticks: number, every: number, from = 0): Snapshot[] {
  const out: Snapshot[] = [];
  for (let t = from; t <= from + ticks; t += every) {
    out.push({ t, b: [t, 0, 0, 0], p: [], s: [0, 0], c: 0, k: 0, f: 0, w: -1 } as unknown as Snapshot);
  }
  return out;
}

/** Ticks of football shown per second of screen time, across a stretch. */
function speed(from: number, to: number, plan: ReturnType<typeof planReplay>, seconds: number) {
  const footage = tickAt(to, plan) - tickAt(from, plan);
  const wall = (to - from) * seconds;
  return footage / 60 / wall;
}

const SECONDS = 4.86; // what a nine-second celebration gives the replay

describe('replay pacing', () => {
  it('shows the run-up at about life speed', () => {
    const clip = tape(480, 1);
    const plan = planReplay(clip, 460, SECONDS);
    expect(speed(0, plan.runUpShare * 0.9, plan, SECONDS)).toBeCloseTo(1, 1);
  });

  it('crawls through the strike', () => {
    const clip = tape(480, 1);
    const plan = planReplay(clip, 460, SECONDS);
    const s = speed(plan.runUpShare + 0.01, 1, plan, SECONDS);
    expect(s).toBeLessThan(0.5);
    expect(s).toBeGreaterThan(0);
  });

  it('never runs faster than real time', () => {
    const clip = tape(480, 1);
    const plan = planReplay(clip, 460, SECONDS);
    for (let p = 0; p < 0.99; p += 0.02) {
      expect(speed(p, p + 0.01, plan, SECONDS)).toBeLessThanOrEqual(1.05);
    }
  });

  it('paces a watching client the same as the host', () => {
    // The whole bug: identical football, one tape at every tick and one at
    // every other tick. Frame-index pacing ran the second at double speed.
    const host = planReplay(tape(480, 1), 460, SECONDS);
    const client = planReplay(tape(480, 2), 460, SECONDS);

    for (let p = 0; p <= 1; p += 0.1) {
      expect(tickAt(p, client)).toBeCloseTo(tickAt(p, host), 0);
    }
  });

  it('covers the shot itself in the slow half', () => {
    const clip = tape(480, 1);
    const shot = 440;
    const plan = planReplay(clip, shot, SECONDS);
    expect(plan.slowFromTick).toBeLessThanOrEqual(shot);
    expect(plan.toTick).toBeGreaterThanOrEqual(shot);
    expect(inSlowMotion(plan.runUpShare + 0.01, plan)).toBe(true);
    expect(inSlowMotion(plan.runUpShare - 0.01, plan)).toBe(false);
  });

  it('ends on the ball crossing the line', () => {
    const clip = tape(480, 1);
    const plan = planReplay(clip, 460, SECONDS);
    expect(tickAt(1, plan)).toBe(clip[clip.length - 1].t);
  });

  it('starts within the footage it actually has', () => {
    const clip = tape(480, 1, 1200);
    const plan = planReplay(clip, 1650, SECONDS);
    expect(plan.fromTick).toBeGreaterThanOrEqual(clip[0].t);
    expect(tickAt(0, plan)).toBeGreaterThanOrEqual(clip[0].t);
  });

  it('cuts the footage to fit a short celebration rather than speeding up', () => {
    // A practice game can cut the goal sequence to a second and a half. That
    // used to squeeze a full clip into it at roughly five times speed.
    const clip = tape(480, 1);
    const short = planReplay(clip, 460, 0.8);
    for (let p = 0; p < 0.99; p += 0.05) {
      expect(speed(p, p + 0.01, short, 0.8)).toBeLessThanOrEqual(1.05);
    }
  });

  it('gives the run-up back its time when the ball was in the air a long while', () => {
    // A shot from distance can outlast the whole replay at a flat 0.3x, so
    // past a point the crawl gives speed back instead of eating the run-up.
    const clip = tape(600, 1);
    const plan = planReplay(clip, 480, SECONDS); // two seconds of flight
    expect(plan.runUpShare).toBeGreaterThan(0);
    expect(plan.runUpShare).toBeCloseTo(1 - MAX_SLOW_SHARE, 5);
    expect(speed(plan.runUpShare + 0.02, 0.98, plan, SECONDS)).toBeLessThan(1);
  });

  it('falls back to life speed rather than cramming an unshowable clip in', () => {
    // Longer in the air than the replay is on screen: nothing can be slowed,
    // so it plays live rather than fast.
    const clip = tape(600, 1);
    const plan = planReplay(clip, 300, SECONDS); // five seconds of flight
    for (let p = 0; p < 0.99; p += 0.05) {
      expect(speed(p, p + 0.01, plan, SECONDS)).toBeLessThanOrEqual(1.05);
    }
  });

  it('keeps the crawl at the speed it advertises when there is room', () => {
    const clip = tape(480, 1);
    const plan = planReplay(clip, 460, SECONDS);
    expect(speed(plan.runUpShare + 0.02, 0.98, plan, SECONDS)).toBeCloseTo(SLOW_SPEED, 1);
  });
});

describe('sampling the tape', () => {
  it('lands between the two frames either side of a tick', () => {
    const clip = tape(100, 2);
    const { i, k } = sampleAt(clip, 51);
    expect(clip[i].t).toBe(50);
    expect(clip[i + 1].t).toBe(52);
    expect(k).toBeCloseTo(0.5, 5);
  });

  it('sits exactly on a frame when the tick is one', () => {
    const clip = tape(100, 2);
    const { i, k } = sampleAt(clip, 50);
    expect(clip[i].t).toBe(50);
    expect(k).toBe(0);
  });

  it('never runs off either end', () => {
    const clip = tape(100, 2);
    expect(sampleAt(clip, -50).i).toBe(0);
    const late = sampleAt(clip, 9999);
    expect(late.i).toBe(clip.length - 2);
    expect(late.k).toBe(1);
  });

  it('copes with a clip too short to blend', () => {
    expect(sampleAt([], 10)).toEqual({ i: 0, k: 0 });
    expect(sampleAt(tape(0, 1), 10)).toEqual({ i: 0, k: 0 });
  });
});
