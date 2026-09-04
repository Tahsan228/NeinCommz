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

export function kindForStep(stepIndex: number): StepKind {
  if (stepIndex === 0) return 'prompt';
  return stepIndex % 2 === 1 ? 'drawing' : 'guess';
}

/** The game ends once every player has contributed to every chain once. */
export function totalSteps(playerCount: number): number {
  return playerCount;
}

export function isComplete(stepIndex: number, playerCount: number): boolean {
  return stepIndex >= totalSteps(playerCount);
}
