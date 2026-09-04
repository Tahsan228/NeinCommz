import type { UUID } from '../../../lib/types';

/**
 * Single-elimination bracket.
 *
 * Kept pure and separate from React so the seeding, byes and advancement can
 * be tested directly — a bracket that quietly pairs the wrong people is the
 * kind of bug nobody notices until someone is wrongly knocked out.
 */

export interface Match {
  a: UUID | null;
  b: UUID | null;
  winner: UUID | null;
}

export interface Bracket {
  /** rounds[0] is the first round; the last round holds the single final. */
  rounds: Match[][];
  round: number;
  match: number;
}

/** Round names counting back from the final. */
export function roundName(bracket: Bracket, round: number): string {
  const fromEnd = bracket.rounds.length - 1 - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-final';
  if (fromEnd === 2) return 'Quarter-final';
  return `Round ${round + 1}`;
}

/**
 * Build an empty bracket for these players, padded with byes up to a power of
 * two. A player drawn against a bye advances without playing.
 */
export function buildBracket(ids: UUID[]): Bracket {
  const count = Math.max(2, ids.length);
  const size = 2 ** Math.ceil(Math.log2(count));

  const seeds: (UUID | null)[] = [...ids];
  while (seeds.length < size) seeds.push(null);

  const rounds: Match[][] = [];
  const first: Match[] = [];
  for (let i = 0; i < size; i += 2) {
    first.push({ a: seeds[i], b: seeds[i + 1], winner: null });
  }
  rounds.push(first);

  let width = first.length;
  while (width > 1) {
    width = width / 2;
    rounds.push(Array.from({ length: width }, () => ({ a: null, b: null, winner: null })));
  }

  return settleByes({ rounds, round: 0, match: 0 });
}

function clone(b: Bracket): Bracket {
  return {
    rounds: b.rounds.map((r) => r.map((m) => ({ ...m }))),
    round: b.round,
    match: b.match,
  };
}

function promote(b: Bracket, round: number, index: number, winner: UUID): void {
  const nextRound = b.rounds[round + 1];
  if (!nextRound) return;
  const slot = nextRound[Math.floor(index / 2)];
  if (index % 2 === 0) slot.a = winner;
  else slot.b = winner;
}

/**
 * Resolve every match that needs no game, then park the cursor on the first
 * match two real people have to play.
 *
 * The subtlety: an empty slot means "bye" only once nothing can still fill it.
 * A semi-final holding one name and one blank is usually just waiting on the
 * other quarter-final — treating that as a bye hands someone the tournament
 * before their opponent has even played. So a match is only settled once both
 * of its feeder matches are themselves decided (or dead, which is how a fully
 * empty pairing in the padding propagates).
 */
export function settleByes(bracket: Bracket): Bracket {
  const b = clone(bracket);
  const dead: boolean[][] = b.rounds.map((r) => r.map(() => false));

  for (let r = 0; r < b.rounds.length; r++) {
    for (let i = 0; i < b.rounds[r].length; i++) {
      const m = b.rounds[r][i];

      if (m.winner) {
        promote(b, r, i, m.winner);
        continue;
      }

      // Round zero is seeded directly, so its slots are final by construction.
      const feedersSettled =
        r === 0 ||
        ((b.rounds[r - 1][2 * i].winner !== null || dead[r - 1][2 * i]) &&
          (b.rounds[r - 1][2 * i + 1].winner !== null || dead[r - 1][2 * i + 1]));

      if (!feedersSettled) continue;

      if (!m.a && !m.b) {
        dead[r][i] = true;
      } else if (m.a && !m.b) {
        m.winner = m.a;
        promote(b, r, i, m.winner);
      } else if (!m.a && m.b) {
        m.winner = m.b;
        promote(b, r, i, m.winner);
      }
      // Two real players: leave it to be played.
    }
  }

  const next = findNext(b);
  b.round = next?.round ?? b.rounds.length - 1;
  b.match = next?.match ?? 0;
  return b;
}

/** The first match with two real players and no result yet. */
export function findNext(b: Bracket): { round: number; match: number } | null {
  for (let r = 0; r < b.rounds.length; r++) {
    for (let i = 0; i < b.rounds[r].length; i++) {
      const m = b.rounds[r][i];
      if (!m.winner && m.a && m.b) return { round: r, match: i };
    }
  }
  return null;
}

/** Record a result and move the cursor on. Draws leave the match unplayed. */
export function recordResult(bracket: Bracket, winner: UUID | null): Bracket {
  if (!winner) return bracket; // a draw is replayed, not resolved

  const b = clone(bracket);
  const m = b.rounds[b.round]?.[b.match];
  if (!m || m.winner) return b;

  m.winner = winner;
  promote(b, b.round, b.match, winner);
  return settleByes(b);
}

/** The tournament champion, once the final has been played. */
export function champion(b: Bracket): UUID | null {
  const final = b.rounds[b.rounds.length - 1]?.[0];
  return final?.winner ?? null;
}

export function isComplete(b: Bracket): boolean {
  return champion(b) !== null;
}
