import type { UUID } from '../../lib/types';
import type { GameStats, MatchResult } from '../../state/economy';
import { STARTING_ELO, isRated } from './elo';

/**
 * Turning stats and match rows into a table.
 *
 * Pure, so the ordering and the "everybody appears" rule can be tested — a
 * leaderboard that silently drops people is very hard to notice by looking at
 * it, because a missing row looks exactly like a row that was never earned.
 */

export type Period = 'today' | 'week' | 'month' | 'all';

export interface Row {
  id: UUID;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  score: number;
  coins: number;
  eloDelta: number;
  elo: number;
  streak: number;
}

/** Start of the window, or null for all time. */
export function since(period: Period, now: Date = new Date()): Date | null {
  const d = new Date(now);
  if (period === 'today') {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'week') {
    // Monday starts the week; Sunday belongs to the week that is ending.
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'month') {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return null;
}

function blank(id: UUID): Row {
  return {
    id,
    played: 0,
    won: 0,
    lost: 0,
    drawn: 0,
    score: 0,
    coins: 0,
    eloDelta: 0,
    elo: 0,
    streak: 0,
  };
}

export interface BuildInput {
  /** Everyone with a profile — they all get a row, even at nothing. */
  everyone: UUID[];
  period: Period;
  game: string;
  stats: GameStats[];
  /** Per-match rows, already filtered to the window. Ignored for all time. */
  results: MatchResult[];
}

/**
 * Build the table.
 *
 * Everyone appears, whether or not they have played. An empty board that says
 * "nothing recorded" tells you less than a board of zeroes, which at least
 * shows who is here and makes the first result feel like it moved something.
 */
export function buildRows({ everyone, period, game, stats, results }: BuildInput): Row[] {
  const map = new Map<UUID, Row>(everyone.map((id) => [id, blank(id)]));
  const rowFor = (id: UUID): Row => {
    const existing = map.get(id);
    if (existing) return existing;
    const made = blank(id);
    map.set(id, made);
    return made;
  };

  if (period === 'all') {
    for (const s of stats) {
      if (game !== 'all' && s.game !== game) continue;
      const row = rowFor(s.profile_id);
      row.played += s.played;
      row.won += s.won;
      row.lost += s.lost;
      row.drawn += s.drawn;
      row.score += s.score_for;
      row.streak = Math.max(row.streak, s.best_streak);
      // One game shows that rating; across all of them, the best one they hold.
      row.elo = game === 'all' ? Math.max(row.elo, s.elo) : s.elo;
    }
  } else {
    for (const r of results) {
      if (game !== 'all' && r.game !== game) continue;
      const row = rowFor(r.profile_id);
      row.played++;
      if (r.outcome === 'win') row.won++;
      else if (r.outcome === 'loss') row.lost++;
      else row.drawn++;
      row.score += r.score;
      row.coins += r.coins;
      row.eloDelta += r.elo_delta;
    }
    // Ratings themselves are not windowed; show where they stand now.
    for (const row of map.values()) {
      if (game === 'all') {
        row.elo = Math.max(
          0,
          ...stats.filter((s) => s.profile_id === row.id).map((s) => s.elo),
        );
      } else {
        row.elo = stats.find((s) => s.profile_id === row.id && s.game === game)?.elo ?? 0;
      }
    }
  }

  // Someone who has never played a rated game still has a rating: the one
  // everybody starts on. Showing 0 there would be a lie.
  if (game !== 'all' && isRated(game)) {
    for (const row of map.values()) if (row.elo === 0) row.elo = STARTING_ELO;
  }

  return [...map.values()].sort((a, b) => {
    // People who have played always outrank people who have not, whatever
    // their notional starting rating says.
    if ((a.played === 0) !== (b.played === 0)) return a.played === 0 ? 1 : -1;
    if (period === 'all' && game !== 'all' && isRated(game) && b.elo !== a.elo) {
      return b.elo - a.elo;
    }
    if (b.won !== a.won) return b.won - a.won;
    if (b.played !== a.played) return b.played - a.played;
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });
}
