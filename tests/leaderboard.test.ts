import { describe, expect, it } from 'vitest';
import { buildRows, since } from '../src/features/economy/leaderboard';
import { STARTING_ELO } from '../src/features/economy/elo';
import type { GameStats, MatchResult } from '../src/state/economy';

const EVERYONE = ['ann', 'ben', 'cat'];

function stat(over: Partial<GameStats> & { profile_id: string; game: string }): GameStats {
  return {
    elo: STARTING_ELO,
    played: 0,
    won: 0,
    lost: 0,
    drawn: 0,
    score_for: 0,
    streak: 0,
    best_streak: 0,
    ...over,
  };
}

function match(over: Partial<MatchResult> & { profile_id: string }): MatchResult {
  return {
    id: Math.random().toString(36).slice(2),
    session_id: 's1',
    game: 'haxball',
    outcome: 'win',
    elo_delta: 0,
    coins: 0,
    score: 0,
    created_at: new Date().toISOString(),
    ...over,
  };
}

describe('everybody appears', () => {
  it('lists every profile even when nothing has been played', () => {
    const rows = buildRows({
      everyone: EVERYONE,
      period: 'all',
      game: 'all',
      stats: [],
      results: [],
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.played === 0 && r.won === 0)).toBe(true);
  });

  it('still lists people who have not played once others have', () => {
    const rows = buildRows({
      everyone: EVERYONE,
      period: 'all',
      game: 'haxball',
      stats: [stat({ profile_id: 'ann', game: 'haxball', played: 4, won: 3, elo: 1120 })],
      results: [],
    });
    expect(rows.map((r) => r.id)).toContain('ben');
    expect(rows.find((r) => r.id === 'ben')?.played).toBe(0);
  });

  it('lists everybody in a window with nothing in it', () => {
    const rows = buildRows({
      everyone: EVERYONE,
      period: 'week',
      game: 'all',
      stats: [],
      results: [],
    });
    expect(rows).toHaveLength(3);
  });

  it('keeps someone who played but is not in the profile list', () => {
    // A profile deleted mid-season should not make its results vanish.
    const rows = buildRows({
      everyone: ['ann'],
      period: 'week',
      game: 'all',
      stats: [],
      results: [match({ profile_id: 'ghost', outcome: 'win' })],
    });
    expect(rows.map((r) => r.id)).toContain('ghost');
  });
});

describe('ordering', () => {
  it('puts people who have played above people who have not', () => {
    const rows = buildRows({
      everyone: EVERYONE,
      period: 'all',
      game: 'haxball',
      // Ben has played and lost; the others have a notional starting rating.
      stats: [stat({ profile_id: 'ben', game: 'haxball', played: 3, lost: 3, elo: 880 })],
      results: [],
    });
    expect(rows[0].id).toBe('ben');
  });

  it('ranks by rating for a rated game, all time', () => {
    const rows = buildRows({
      everyone: EVERYONE,
      period: 'all',
      game: 'chess',
      stats: [
        stat({ profile_id: 'ann', game: 'chess', played: 5, won: 2, elo: 1050 }),
        stat({ profile_id: 'ben', game: 'chess', played: 5, won: 2, elo: 1240 }),
      ],
      results: [],
    });
    expect(rows[0].id).toBe('ben');
  });

  it('ranks by wins inside a window', () => {
    const rows = buildRows({
      everyone: EVERYONE,
      period: 'week',
      game: 'all',
      stats: [],
      results: [
        match({ profile_id: 'ann', outcome: 'win' }),
        match({ profile_id: 'ann', outcome: 'win' }),
        match({ profile_id: 'ben', outcome: 'win' }),
      ],
    });
    expect(rows[0].id).toBe('ann');
    expect(rows[0].won).toBe(2);
  });

  it('is stable rather than arbitrary when everyone is level', () => {
    const first = buildRows({ everyone: EVERYONE, period: 'all', game: 'all', stats: [], results: [] });
    const again = buildRows({ everyone: [...EVERYONE].reverse(), period: 'all', game: 'all', stats: [], results: [] });
    expect(first.map((r) => r.id)).toEqual(again.map((r) => r.id));
  });
});

describe('ratings shown for the unplayed', () => {
  it('shows the starting rating rather than zero in a rated game', () => {
    const rows = buildRows({
      everyone: EVERYONE,
      period: 'all',
      game: 'chess',
      stats: [],
      results: [],
    });
    expect(rows.every((r) => r.elo === STARTING_ELO)).toBe(true);
  });

  it('leaves an unrated game without a rating to show', () => {
    const rows = buildRows({
      everyone: EVERYONE,
      period: 'all',
      game: 'gartic',
      stats: [],
      results: [],
    });
    expect(rows.every((r) => r.elo === 0)).toBe(true);
  });
});

describe('windows', () => {
  it('starts today at midnight', () => {
    const d = since('today', new Date(2026, 8, 4, 15, 30));
    expect(d?.getHours()).toBe(0);
    expect(d?.getDate()).toBe(4);
  });

  it('starts the week on Monday', () => {
    // 2026-09-04 is a Friday.
    const d = since('week', new Date(2026, 8, 4, 15, 30));
    expect(d?.getDay()).toBe(1);
    expect(d?.getDate()).toBe(31); // Monday 31 August
  });

  it('treats Sunday as the end of the week, not the start', () => {
    // 2026-09-06 is a Sunday; its week began on Monday the 31st.
    const d = since('week', new Date(2026, 8, 6, 12, 0));
    expect(d?.getDay()).toBe(1);
    expect(d?.getDate()).toBe(31);
  });

  it('starts the month on the first', () => {
    expect(since('month', new Date(2026, 8, 20))?.getDate()).toBe(1);
  });

  it('has no start for all time', () => {
    expect(since('all')).toBeNull();
  });
});

describe('totals', () => {
  it('adds up coins and rating movement inside a window', () => {
    const rows = buildRows({
      everyone: ['ann'],
      period: 'week',
      game: 'all',
      stats: [],
      results: [
        match({ profile_id: 'ann', outcome: 'win', coins: 60, elo_delta: 12, score: 2 }),
        match({ profile_id: 'ann', outcome: 'loss', coins: 15, elo_delta: -9 }),
      ],
    });
    expect(rows[0]).toMatchObject({ played: 2, won: 1, lost: 1, coins: 75, eloDelta: 3, score: 2 });
  });

  it('only counts the game being looked at', () => {
    const rows = buildRows({
      everyone: ['ann'],
      period: 'week',
      game: 'chess',
      stats: [],
      results: [
        match({ profile_id: 'ann', game: 'chess', outcome: 'win' }),
        match({ profile_id: 'ann', game: 'haxball', outcome: 'win' }),
      ],
    });
    expect(rows[0].played).toBe(1);
  });
});
