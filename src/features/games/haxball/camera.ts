import type { Pitch } from './physics';

/**
 * Keeping the camera on the pitch.
 *
 * The pitch is painted in world coordinates, so anything the camera shows
 * beyond the touchline is simply never painted that frame and keeps whatever
 * was there before. The goal is drawn just outside the line, so a camera that
 * drifted past the edge smeared it across the gap — the "stretched goal" in
 * the replay.
 *
 * Rather than filling the surround (which would mean deciding what a stadium
 * looks like), the camera is not allowed off the grass in the first place.
 */

export interface Focus {
  x: number;
  y: number;
}

/**
 * The screen transform is `screen = anchor + (world - focus) * zoom`, so the
 * visible world runs from `focus - anchor/zoom` to `focus + (size - anchor)/zoom`.
 * Both ends have to stay inside the pitch.
 */
export function clampFocus(
  pitch: Pitch,
  focus: Focus,
  zoom: number,
  anchorX: number,
  anchorY: number,
): Focus {
  const z = Math.max(1, zoom);

  const clampAxis = (value: number, size: number, anchor: number): number => {
    const min = anchor / z;
    const max = size - (size - anchor) / z;
    // At zoom 1 the two meet exactly at the anchor: the camera cannot move at
    // all without showing something that is not there.
    if (min >= max) return (min + max) / 2;
    return Math.min(max, Math.max(min, value));
  };

  return {
    x: clampAxis(focus.x, pitch.w, anchorX),
    y: clampAxis(focus.y, pitch.h, anchorY),
  };
}

/**
 * How much of each act is showing.
 *
 * Acts overlap by `fade` so one dissolves into the next. The first act starts
 * solid and the last ends solid — fading in from nothing at the very start
 * would flash whatever the canvas happened to be holding.
 */
export function envelope(t: number, from: number, to: number, fade: number): number {
  if (t <= from - fade || t >= to + fade) return 0;
  const rising = from <= 0 ? 1 : (t - (from - fade)) / (fade * 2);
  const falling = to >= 1 ? 1 : (to + fade - t) / (fade * 2);
  return Math.max(0, Math.min(1, Math.min(rising, falling)));
}
