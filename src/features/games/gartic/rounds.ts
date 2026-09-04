import type { UUID } from '../../../lib/types';

export type StepKind = 'prompt' | 'drawing' | 'guess';

/**
 * Gartic Phone's shape: with N players there are N chains, one started by each
 * person, and N steps. Chain c at step s is handled by the player s seats
 * further round the circle, which guarantees nobody ever sees their own chain
 * twice and everybody works on exactly one thing per step.
 */
export function authorFor(chainIndex: number, stepIndex: number, order: UUID[]): UUID {
  return order[(chainIndex + stepIndex) % order.length];
}

/** Which chain a given player is holding at this step. */
export function chainForAuthor(author: UUID, stepIndex: number, order: UUID[]): number {
  const seat = order.indexOf(author);
  if (seat === -1) return -1;
  const n = order.length;
  return ((seat - stepIndex) % n + n) % n;
}

export type FirstStep = 'prompt' | 'drawing';

/**
 * Whether this step is written or drawn.
 *
 * Starting on a drawing ("draw anything") is the other way people play, so the
 * alternation has to key off where the chain began rather than assuming a
 * prompt at step zero.
 */
export function kindForStep(stepIndex: number, firstStep: FirstStep = 'prompt'): StepKind {
  if (firstStep === 'drawing') return stepIndex % 2 === 0 ? 'drawing' : 'guess';
  if (stepIndex === 0) return 'prompt';
  return stepIndex % 2 === 1 ? 'drawing' : 'guess';
}

/**
 * How long a game runs. Left to itself that is one step per player, which is
 * what makes every chain pass through everybody exactly once — but a host can
 * pin it shorter or longer.
 */
export function totalSteps(playerCount: number, rounds = 0): number {
  return rounds > 0 ? rounds : playerCount;
}

export function isComplete(stepIndex: number, playerCount: number, rounds = 0): boolean {
  return stepIndex >= totalSteps(playerCount, rounds);
}

/** Seconds allowed for a step of this kind. */
export function secondsFor(
  kind: StepKind,
  settings: { writeSeconds: number; drawSeconds: number },
): number {
  return kind === 'drawing' ? settings.drawSeconds : settings.writeSeconds;
}
