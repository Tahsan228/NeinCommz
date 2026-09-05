import { describe, expect, it } from 'vitest';
import { countsForRating, matchOutcomes } from '../src/features/games/haxball/report';

const NO_BOTS = { red: 0, blue: 0 };
const TWO_SIDES = [
  { profile_id: 'ann', team: 0 },
  { profile_id: 'ben', team: 1 },
];

describe('which Haxball matches are rated', () => {
  it('rates a match between people', () => {
    expect(countsForRating(TWO_SIDES, NO_BOTS)).toBe(true);
  });

  it('does not rate a match with a computer in it', () => {
    // The same rule chess and tic-tac-toe already follow.
    expect(countsForRating(TWO_SIDES, { red: 0, blue: 1 })).toBe(false);
    expect(countsForRating(TWO_SIDES, { red: 2, blue: 0 })).toBe(false);
  });

  it('needs somebody on both sides', () => {
    expect(countsForRating([{ profile_id: 'ann', team: 0 }], NO_BOTS)).toBe(false);
    expect(
      countsForRating(
        [
          { profile_id: 'ann', team: 0 },
          { profile_id: 'ben', team: 0 },
        ],
        NO_BOTS,
      ),
    ).toBe(false);
  });

  it('rates a full four-a-side', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ profile_id: `p${i}`, team: i % 2 }));
    expect(countsForRating(eight, NO_BOTS)).toBe(true);
  });
});

describe('what gets reported', () => {
  it('splits a win and a loss and pays each side its own goals', () => {
    const out = matchOutcomes(TWO_SIDES, 0, { red: 3, blue: 1 });
    expect(out).toEqual([
      { profile_id: 'ann', outcome: 'win', score: 3 },
      { profile_id: 'ben', outcome: 'loss', score: 1 },
    ]);
  });

  it('calls a level game a draw for everyone', () => {
    const out = matchOutcomes(TWO_SIDES, null, { red: 2, blue: 2 });
    expect(out.every((o) => o.outcome === 'draw')).toBe(true);
  });

  it('gives every player on the winning side the win', () => {
    const four = [
      { profile_id: 'a', team: 0 },
      { profile_id: 'b', team: 0 },
      { profile_id: 'c', team: 1 },
      { profile_id: 'd', team: 1 },
    ];
    const out = matchOutcomes(four, 1, { red: 0, blue: 5 });
    expect(out.filter((o) => o.outcome === 'win').map((o) => o.profile_id)).toEqual(['c', 'd']);
    expect(out.filter((o) => o.outcome === 'win').every((o) => o.score === 5)).toBe(true);
  });

  it('reports nobody when nobody was on the pitch', () => {
    expect(matchOutcomes([], 0, { red: 1, blue: 0 })).toEqual([]);
  });
});
