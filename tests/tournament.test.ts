import { describe, expect, it } from 'vitest';
import {
  buildBracket,
  champion,
  findNext,
  isComplete as bracketComplete,
  recordResult,
  roundName,
} from '../src/features/games/tictactoe/tournament';
import {
  isComplete,
  kindForStep,
  secondsFor,
  totalSteps,
} from '../src/features/games/gartic/rounds';

const field = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('knockout bracket', () => {
  it('pairs a full field into first-round matches', () => {
    const b = buildBracket(field(4));
    expect(b.rounds).toHaveLength(2); // semis, then the final
    expect(b.rounds[0]).toHaveLength(2);
    expect(b.rounds[0][0]).toMatchObject({ a: 'p1', b: 'p2' });
    expect(b.rounds[0][1]).toMatchObject({ a: 'p3', b: 'p4' });
  });

  it('gives an odd player a bye instead of a phantom opponent', () => {
    const b = buildBracket(field(3));
    // Padded to four, so p3 walks into the next round unopposed.
    expect(b.rounds[0][1].winner).toBe('p3');
    // The cursor skips the bye and lands on the match that must be played.
    expect(b.rounds[b.round][b.match]).toMatchObject({ a: 'p1', b: 'p2' });
  });

  it('promotes winners into the correct next-round slot', () => {
    let b = buildBracket(field(4));
    b = recordResult(b, 'p1');
    expect(b.rounds[1][0].a).toBe('p1');
    b = recordResult(b, 'p4');
    expect(b.rounds[1][0].b).toBe('p4');
    expect(findNext(b)).toEqual({ round: 1, match: 0 });
  });

  it('crowns a champion only once the final is played', () => {
    let b = buildBracket(field(4));
    expect(champion(b)).toBeNull();
    b = recordResult(b, 'p1');
    b = recordResult(b, 'p3');
    expect(bracketComplete(b)).toBe(false);
    b = recordResult(b, 'p3');
    expect(champion(b)).toBe('p3');
    expect(bracketComplete(b)).toBe(true);
  });

  it('replays a drawn match rather than knocking someone out on it', () => {
    const b = buildBracket(field(4));
    const after = recordResult(b, null);
    expect(after.rounds[0][0].winner).toBeNull();
    expect(after.round).toBe(0);
    expect(after.match).toBe(0);
  });

  it('names rounds counting back from the final', () => {
    const b = buildBracket(field(8));
    expect(roundName(b, 2)).toBe('Final');
    expect(roundName(b, 1)).toBe('Semi-final');
    expect(roundName(b, 0)).toBe('Quarter-final');
  });

  it('handles a lone pair', () => {
    const b = buildBracket(field(2));
    expect(b.rounds).toHaveLength(1);
    expect(champion(recordResult(b, 'p2'))).toBe('p2');
  });

  it('carries a five-player field through to one winner', () => {
    let b = buildBracket(field(5));
    // Three byes, so only p1 v p2 is contested in the opening round.
    let guard = 0;
    while (!bracketComplete(b) && guard++ < 20) {
      const m = b.rounds[b.round][b.match];
      b = recordResult(b, m.a);
    }
    expect(bracketComplete(b)).toBe(true);
    expect(champion(b)).toBeTruthy();
  });
});

describe('gartic settings', () => {
  it('alternates from a drawing when the game starts on one', () => {
    expect(kindForStep(0, 'drawing')).toBe('drawing');
    expect(kindForStep(1, 'drawing')).toBe('guess');
    expect(kindForStep(2, 'drawing')).toBe('drawing');
  });

  it('still starts on a prompt by default', () => {
    expect(kindForStep(0)).toBe('prompt');
    expect(kindForStep(1)).toBe('drawing');
  });

  it('lets a host pin the number of rounds', () => {
    expect(totalSteps(6)).toBe(6);
    expect(totalSteps(6, 3)).toBe(3);
    expect(isComplete(3, 6, 3)).toBe(true);
    expect(isComplete(2, 6, 3)).toBe(false);
  });

  it('gives drawing steps the drawing clock', () => {
    const settings = { writeSeconds: 40, drawSeconds: 90 };
    expect(secondsFor('drawing', settings)).toBe(90);
    expect(secondsFor('prompt', settings)).toBe(40);
    expect(secondsFor('guess', settings)).toBe(40);
  });
});
