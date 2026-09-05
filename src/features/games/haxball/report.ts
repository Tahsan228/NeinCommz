import type { UUID } from '../../../lib/types';
import type { Outcome } from '../../../state/economy';

/**
 * Turning a finished match into something the economy can be told about.
 *
 * Pure, because the host reports it exactly once and a mistake here is not
 * something anyone notices by playing: a match that quietly reports nothing
 * looks identical to a match nobody has finished yet.
 */

export interface Seat {
  profile_id: UUID;
  team: number;
}

/**
 * Does this match count?
 *
 * The rule is the same one chess and tic-tac-toe already follow: a computer
 * has no rating to win off and nothing to lose, so a game with one in it is a
 * kickabout rather than a result. Beyond that it takes people on both sides —
 * scoring into an empty net is not a win over anybody.
 */
export function countsForRating(onPitch: Seat[], bots: { red: number; blue: number }): boolean {
  if (bots.red > 0 || bots.blue > 0) return false;
  return onPitch.some((p) => p.team === 0) && onPitch.some((p) => p.team === 1);
}

/**
 * What each player did, for `award_match`.
 *
 * `score` is the goals their side put away, which is what pays the per-goal
 * bonus. Computer players are not in `onPitch` at all: they have no row in the
 * database and no wallet to pay into.
 */
export function matchOutcomes(
  onPitch: Seat[],
  winner: 0 | 1 | null,
  score: { red: number; blue: number },
): Outcome[] {
  return onPitch.map((p) => ({
    profile_id: p.profile_id,
    outcome:
      winner === null ? ('draw' as const) : p.team === winner ? ('win' as const) : ('loss' as const),
    score: p.team === 0 ? score.red : score.blue,
  }));
}
