import { describe, expect, it } from 'vitest';
import {
  COINS,
  ELO_FLOOR,
  STARTING_ELO,
  applyDelta,
  coinsFor,
  eloDelta,
  expectedScore,
  isRated,
  kFactor,
  rankFor,
  rankProgress,
} from '../src/features/economy/elo';

describe('expectedScore', () => {
  it('is even money between equal ratings', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 6);
  });

  it('favours the higher rating', () => {
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.9);
    expect(expectedScore(1000, 1400)).toBeLessThan(0.1);
  });

  it('is symmetric — the two expectations sum to one', () => {
    for (const [a, b] of [[1000, 1000], [1200, 900], [1550, 1480]]) {
      expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 6);
    }
  });
});

describe('kFactor', () => {
  it('moves new players fastest', () => {
    expect(kFactor(0, 1000)).toBe(40);
    expect(kFactor(9, 1000)).toBe(40);
  });

  it('settles once someone has a record', () => {
    expect(kFactor(10, 1000)).toBe(24);
  });

  it('settles further at the top, where ratings should be stable', () => {
    expect(kFactor(200, 1600)).toBe(16);
    expect(kFactor(200, 1599)).toBe(24);
  });
});

describe('eloDelta', () => {
  it('gains on a win and loses on a defeat', () => {
    expect(eloDelta(1000, 1000, 'win', 20)).toBeGreaterThan(0);
    expect(eloDelta(1000, 1000, 'loss', 20)).toBeLessThan(0);
  });

  it('splits an even draw to roughly nothing', () => {
    expect(Math.abs(eloDelta(1000, 1000, 'draw', 20))).toBeLessThanOrEqual(1);
  });

  it('pays more for beating someone better', () => {
    const upset = eloDelta(1000, 1400, 'win', 20);
    const expected = eloDelta(1000, 900, 'win', 20);
    expect(upset).toBeGreaterThan(expected);
  });

  it('punishes losing to someone worse', () => {
    const bad = eloDelta(1400, 1000, 'loss', 20);
    const forgivable = eloDelta(1000, 1400, 'loss', 20);
    expect(bad).toBeLessThan(forgivable);
  });

  it('never awards a win of zero, however lopsided', () => {
    // Beating someone 900 points below you is worth almost nothing, but a win
    // that moves the number not at all reads as a bug to whoever won.
    expect(eloDelta(1900, 1000, 'win', 500)).toBeGreaterThanOrEqual(1);
    expect(eloDelta(1000, 1900, 'loss', 500)).toBeLessThanOrEqual(-1);
  });

  it('moves a provisional player further than an established one', () => {
    expect(eloDelta(1000, 1000, 'win', 0)).toBeGreaterThan(eloDelta(1000, 1000, 'win', 50));
  });

  it('gains and losses roughly mirror between two equal players', () => {
    const win = eloDelta(1000, 1000, 'win', 20);
    const loss = eloDelta(1000, 1000, 'loss', 20);
    expect(Math.abs(win + loss)).toBeLessThanOrEqual(1);
  });
});

describe('applyDelta', () => {
  it('adds the change', () => {
    expect(applyDelta(1000, 18)).toBe(1018);
  });

  it('never drops below the floor, so a bad run is not permanent', () => {
    expect(applyDelta(ELO_FLOOR, -40)).toBe(ELO_FLOOR);
    expect(applyDelta(120, -100)).toBe(ELO_FLOOR);
  });
});

describe('coins', () => {
  it('pays a win more than a draw, and a draw more than a loss', () => {
    expect(coinsFor('win')).toBeGreaterThan(coinsFor('draw'));
    expect(coinsFor('draw')).toBeGreaterThan(coinsFor('loss'));
  });

  it('still pays something for losing, so playing is never a waste', () => {
    expect(coinsFor('loss')).toBeGreaterThan(0);
  });

  it('adds a bonus per goal', () => {
    expect(coinsFor('win', 3)).toBe(COINS.win + 3 * COINS.perScore);
  });

  it('ignores a negative score rather than charging for it', () => {
    expect(coinsFor('win', -5)).toBe(COINS.win);
  });
});

describe('ranks', () => {
  it('starts everyone in a sensible band', () => {
    expect(rankFor(STARTING_ELO).name).toBe('Silver');
  });

  it('climbs through the bands', () => {
    expect(rankFor(0).name).toBe('Bronze');
    expect(rankFor(1150).name).toBe('Gold');
    expect(rankFor(1700).name).toBe('Champion');
  });

  it('reports progress within a band', () => {
    expect(rankProgress(950)).toBeCloseTo(0, 5);
    expect(rankProgress(1025)).toBeCloseTo(0.5, 1);
    // The top band has nothing above it to progress towards.
    expect(rankProgress(2000)).toBe(1);
  });
});

describe('which games are rated', () => {
  it('rates the competitive ones', () => {
    expect(isRated('tictactoe')).toBe(true);
    expect(isRated('haxball')).toBe(true);
    expect(isRated('chess')).toBe(true);
  });

  it('leaves Gartic unrated, since it has no winner', () => {
    expect(isRated('gartic')).toBe(false);
  });
});
