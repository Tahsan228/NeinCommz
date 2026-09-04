/**
 * Elo ratings and coin payouts.
 *
 * Pure, so the maths can be tested directly — a rating system that quietly
 * drifts is impossible to notice by playing, and impossible to undo once
 * everyone's numbers are wrong.
 *
 * The database applies these same rules in award_match(); this copy exists so
 * the client can show "+18" next to a result without waiting for a round trip,
 * and so the behaviour is pinned by tests.
 */

export type Outcome = 'win' | 'loss' | 'draw';

export const STARTING_ELO = 1000;

/** Provisional players move faster, established ones settle down. */
export function kFactor(played: number, elo: number): number {
  if (played < 10) return 40;
  if (elo >= 1600) return 16;
  return 24;
}

/** Probability `elo` beats `opponentElo`, by the standard logistic curve. */
export function expectedScore(elo: number, opponentElo: number): number {
  return 1 / (1 + 10 ** ((opponentElo - elo) / 400));
}

function scoreOf(outcome: Outcome): number {
  return outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
}

/**
 * The rating change for one player against one effective opponent.
 *
 * Team games pass the average rating of the other side, which is the usual way
 * to fold a team into a single number.
 */
export function eloDelta(
  elo: number,
  opponentElo: number,
  outcome: Outcome,
  played = 0,
): number {
  const k = kFactor(played, elo);
  const delta = k * (scoreOf(outcome) - expectedScore(elo, opponentElo));
  // Round away from zero so a narrow win is never worth exactly nothing.
  const rounded = delta > 0 ? Math.ceil(delta) : Math.floor(delta);
  if (outcome === 'win' && rounded < 1) return 1;
  if (outcome === 'loss' && rounded > -1) return -1;
  return rounded;
}

/** Ratings never fall below this, so a bad run is not permanent. */
export const ELO_FLOOR = 100;

export function applyDelta(elo: number, delta: number): number {
  return Math.max(ELO_FLOOR, elo + delta);
}

/* ------------------------------------------------------------------ coins - */

export const COINS = {
  win: 60,
  draw: 30,
  loss: 15,
  /** Per goal in Haxball, per game won in a tic-tac-toe series. */
  perScore: 10,
  /** Finishing a Gartic game, which has no winner to speak of. */
  participation: 40,
};

export function coinsFor(outcome: Outcome, score = 0): number {
  return COINS[outcome] + Math.max(0, score) * COINS.perScore;
}

/* ------------------------------------------------------------------ ranks - */

export interface Rank {
  name: string;
  min: number;
  color: string;
}

/** Bands shown next to a rating, so the number means something at a glance. */
export const RANKS: Rank[] = [
  { name: 'Bronze', min: 0, color: '#b08050' },
  { name: 'Silver', min: 950, color: '#a8b0bc' },
  { name: 'Gold', min: 1100, color: '#e6b422' },
  { name: 'Platinum', min: 1250, color: '#3fb6a8' },
  { name: 'Diamond', min: 1400, color: '#64b6ff' },
  { name: 'Champion', min: 1600, color: '#c07aff' },
];

export function rankFor(elo: number): Rank {
  let best = RANKS[0];
  for (const r of RANKS) if (elo >= r.min) best = r;
  return best;
}

/** How far through the current band, 0..1. Full at the top band. */
export function rankProgress(elo: number): number {
  const i = RANKS.findIndex((r) => r === rankFor(elo));
  const next = RANKS[i + 1];
  if (!next) return 1;
  const floor = RANKS[i].min;
  return Math.min(1, Math.max(0, (elo - floor) / (next.min - floor)));
}

/** Which games are rated. Gartic has no winner, so it earns coins instead. */
export const RATED_GAMES = new Set(['tictactoe', 'haxball', 'chess']);

export function isRated(game: string): boolean {
  return RATED_GAMES.has(game);
}
