import { describe, expect, it } from 'vitest';
import { clampFocus, envelope } from '../src/features/games/haxball/camera';
import { PITCH_PRESETS } from '../src/features/games/haxball/physics';

const pitch = PITCH_PRESETS.normal;

/** What the camera actually shows, given a focus and an anchor. */
function visible(focus: { x: number; y: number }, zoom: number, ax: number, ay: number) {
  const safe = clampFocus(pitch, focus, zoom, ax, ay);
  const z = Math.max(1, zoom);
  return {
    left: safe.x - ax / z,
    right: safe.x + (pitch.w - ax) / z,
    top: safe.y - ay / z,
    bottom: safe.y + (pitch.h - ay) / z,
  };
}

describe('the camera stays on the pitch', () => {
  const centreX = pitch.w / 2;
  const centreY = pitch.h / 2;

  it('leaves a comfortable middle shot alone', () => {
    const safe = clampFocus(pitch, { x: centreX, y: centreY }, 1.5, centreX, centreY);
    expect(safe.x).toBeCloseTo(centreX, 5);
    expect(safe.y).toBeCloseTo(centreY, 5);
  });

  it('will not look past the left touchline', () => {
    // The ball right on the goal line is exactly the case that smeared the
    // goal across the uncovered strip.
    const view = visible({ x: 5, y: centreY }, 1.5, centreX, centreY);
    expect(view.left).toBeGreaterThanOrEqual(-0.001);
  });

  it('will not look past the right touchline', () => {
    const view = visible({ x: pitch.w - 5, y: centreY }, 1.5, centreX, centreY);
    expect(view.right).toBeLessThanOrEqual(pitch.w + 0.001);
  });

  it('will not look past the top or bottom', () => {
    const high = visible({ x: centreX, y: 2 }, 1.6, centreX, centreY);
    expect(high.top).toBeGreaterThanOrEqual(-0.001);

    const low = visible({ x: centreX, y: pitch.h - 2 }, 1.6, centreX, centreY);
    expect(low.bottom).toBeLessThanOrEqual(pitch.h + 0.001);
  });

  it('holds even with the subject pinned off-centre', () => {
    // The goal card sits on the left, so the scorer is anchored to the right.
    const anchor = pitch.w * 0.68;
    for (const x of [0, 40, centreX, pitch.w - 40, pitch.w]) {
      const view = visible({ x, y: centreY }, 2.1, anchor, centreY);
      expect(view.left).toBeGreaterThanOrEqual(-0.001);
      expect(view.right).toBeLessThanOrEqual(pitch.w + 0.001);
    }
  });

  it('never shows anything off the pitch at any corner or zoom', () => {
    for (const zoom of [1, 1.2, 1.5, 2, 2.4]) {
      for (const x of [0, pitch.w]) {
        for (const y of [0, pitch.h]) {
          const view = visible({ x, y }, zoom, centreX, centreY);
          expect(view.left).toBeGreaterThanOrEqual(-0.001);
          expect(view.right).toBeLessThanOrEqual(pitch.w + 0.001);
          expect(view.top).toBeGreaterThanOrEqual(-0.001);
          expect(view.bottom).toBeLessThanOrEqual(pitch.h + 0.001);
        }
      }
    }
  });

  it('pins the camera still at zoom 1, where it cannot move at all', () => {
    const safe = clampFocus(pitch, { x: 20, y: 20 }, 1, centreX, centreY);
    expect(safe.x).toBeCloseTo(centreX, 5);
    expect(safe.y).toBeCloseTo(centreY, 5);
  });

  it('treats a zoom below 1 as 1 rather than showing the void', () => {
    const view = visible({ x: centreX, y: centreY }, 0.5, centreX, centreY);
    expect(view.left).toBeCloseTo(0, 5);
    expect(view.right).toBeCloseTo(pitch.w, 5);
  });
});

describe('act crossfades', () => {
  const FADE = 0.05;

  it('starts the first act solid rather than fading up from nothing', () => {
    // Fading in at t=0 would flash whatever the canvas was already holding.
    expect(envelope(0, 0, 0.34, FADE)).toBe(1);
  });

  it('ends the last act solid', () => {
    expect(envelope(1, 0.88, 1, FADE)).toBe(1);
  });

  it('is fully on through the middle of an act', () => {
    expect(envelope(0.6, 0.34, 0.88, FADE)).toBe(1);
  });

  it('hands over rather than leaving a gap', () => {
    // At the boundary both acts are half on, so together they cover the frame.
    const outgoing = envelope(0.34, 0, 0.34, FADE);
    const incoming = envelope(0.34, 0.34, 0.88, FADE);
    expect(outgoing).toBeCloseTo(0.5, 2);
    expect(incoming).toBeCloseTo(0.5, 2);
    expect(outgoing + incoming).toBeCloseTo(1, 2);
  });

  it('is off well outside its window', () => {
    expect(envelope(0.9, 0, 0.34, FADE)).toBe(0);
    expect(envelope(0.1, 0.88, 1, FADE)).toBe(0);
  });
});
