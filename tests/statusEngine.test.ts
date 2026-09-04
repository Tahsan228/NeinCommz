import { describe, expect, it } from 'vitest';
import {
  blocksAt,
  findOverlap,
  ICON_PREFIX,
  nextBlock,
  resolveStatus,
} from '../src/features/status/statusEngine';
import type { ScheduleBlock } from '../src/lib/types';

function block(partial: Partial<ScheduleBlock> & { start_min: number; end_min: number }): ScheduleBlock {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    profile_id: 'p1',
    label: partial.label ?? 'Block',
    kind: partial.kind ?? 'class',
    emoji: partial.emoji ?? null,
    days: partial.days ?? [1, 2, 3, 4, 5],
    created_at: '2026-01-01T00:00:00Z',
    ...partial,
  } as ScheduleBlock;
}

/** A Wednesday. */
const wed = (h: number, m = 0) => new Date(2026, 8, 2, h, m, 0);

const noOverride = { status_text: null, status_emoji: null, status_expires_at: null };

describe('blocksAt', () => {
  const blocks = [
    block({ label: 'Bio', start_min: 8 * 60, end_min: 8 * 60 + 50 }),
    block({ label: 'Lunch', kind: 'lunch', start_min: 12 * 60, end_min: 12 * 60 + 40 }),
  ];

  it('finds the block covering the minute', () => {
    expect(blocksAt(blocks, 3, 8 * 60 + 20).map((b) => b.label)).toEqual(['Bio']);
  });

  it('treats the end minute as already over', () => {
    expect(blocksAt(blocks, 3, 8 * 60 + 50)).toEqual([]);
  });

  it('ignores blocks that do not run on that weekday', () => {
    expect(blocksAt(blocks, 0, 8 * 60 + 20)).toEqual([]);
  });
});

describe('nextBlock', () => {
  const blocks = [
    block({ label: 'Bio', start_min: 480, end_min: 530 }),
    block({ label: 'Lunch', start_min: 720, end_min: 760 }),
  ];

  it('returns the soonest block still ahead', () => {
    expect(nextBlock(blocks, 3, 600)?.label).toBe('Lunch');
  });

  it('returns null once the day is done', () => {
    expect(nextBlock(blocks, 3, 800)).toBeNull();
  });
});

describe('resolveStatus', () => {
  const schedule = [
    block({ label: 'AP Bio', start_min: 8 * 60, end_min: 8 * 60 + 50 }),
    block({ label: 'Free Period', kind: 'free', start_min: 9 * 60, end_min: 9 * 60 + 50 }),
    block({ label: 'Lunch', kind: 'lunch', start_min: 12 * 60, end_min: 12 * 60 + 40 }),
  ];

  it('shows the current class', () => {
    const s = resolveStatus(noOverride, schedule, 'online', wed(8, 20));
    expect(s.text).toBe('AP Bio');
    expect(s.free).toBe(false);
    expect(s.source).toBe('schedule');
  });

  it('marks free periods as reachable', () => {
    const s = resolveStatus(noOverride, schedule, 'online', wed(9, 10));
    expect(s.text).toBe('Free Period');
    expect(s.free).toBe(true);
  });

  it('falls back to Free outside every block', () => {
    const s = resolveStatus(noOverride, schedule, 'online', wed(16, 0));
    expect(s.text).toBe('Free');
    expect(s.source).toBe('idle');
  });

  it('tells you what is coming up next', () => {
    expect(resolveStatus(noOverride, schedule, 'online', wed(8, 48)).next).toBe(
      '→ Free Period in 12m',
    );
  });

  it('reports offline over the timetable, since a closed tab is not "in AP Bio"', () => {
    const s = resolveStatus(noOverride, schedule, 'offline', wed(8, 20));
    expect(s.text).toBe('Offline');
    expect(s.source).toBe('presence');
  });

  it('lets a live override beat both presence and the schedule', () => {
    const s = resolveStatus(
      {
        status_text: 'At practice',
        status_emoji: '⚡',
        status_expires_at: new Date(wed(8, 20).getTime() + 60_000).toISOString(),
      },
      schedule,
      'offline',
      wed(8, 20),
    );
    expect(s.text).toBe('At practice');
    expect(s.source).toBe('override');
  });

  it('ignores an override that has expired', () => {
    const s = resolveStatus(
      {
        status_text: 'At practice',
        status_emoji: '⚡',
        status_expires_at: new Date(wed(8, 20).getTime() - 60_000).toISOString(),
      },
      schedule,
      'online',
      wed(8, 20),
    );
    expect(s.text).toBe('AP Bio');
  });

  it('keeps an override with no expiry', () => {
    const s = resolveStatus(
      { status_text: 'Phone taken', status_emoji: '📵', status_expires_at: null },
      schedule,
      'online',
      wed(8, 20),
    );
    expect(s.text).toBe('Phone taken');
  });

  it('says Free on a weekend, when no block runs', () => {
    const sat = new Date(2026, 8, 5, 9, 10);
    expect(resolveStatus(noOverride, schedule, 'online', sat).text).toBe('Free');
  });
});

describe('status glyphs', () => {
  const schedule = [
    block({ label: 'AP Bio', kind: 'class', start_min: 8 * 60, end_min: 8 * 60 + 50 }),
  ];

  it('picks an icon from the block kind', () => {
    const s = resolveStatus(noOverride, schedule, 'online', wed(8, 20));
    expect(s.icon).toBe('book');
    expect(s.emoji).toBeNull();
  });

  it('unwraps an icon token stored on a preset override', () => {
    const s = resolveStatus(
      { status_text: 'Heads down', status_emoji: `${ICON_PREFIX}headphones`, status_expires_at: null },
      schedule,
      'online',
      wed(8, 20),
    );
    expect(s.icon).toBe('headphones');
    expect(s.emoji).toBeNull();
  });

  it('keeps a real emoji when someone typed their own status', () => {
    const s = resolveStatus(
      { status_text: 'skiing', status_emoji: '🎿', status_expires_at: null },
      schedule,
      'online',
      wed(8, 20),
    );
    expect(s.emoji).toBe('🎿');
    expect(s.icon).toBe('message');
  });

  it('falls back to a neutral icon for a custom status with no glyph', () => {
    const s = resolveStatus(
      { status_text: 'busy', status_emoji: null, status_expires_at: null },
      schedule,
      'online',
      wed(8, 20),
    );
    expect(s.icon).toBe('message');
    expect(s.emoji).toBeNull();
  });
});

describe('findOverlap', () => {
  const existing = [block({ id: 'a', label: 'Bio', start_min: 480, end_min: 530, days: [1, 3] })];

  it('catches a clash on a shared day', () => {
    expect(findOverlap(existing, { start_min: 500, end_min: 560, days: [3] })?.label).toBe('Bio');
  });

  it('allows the same times on a different day', () => {
    expect(findOverlap(existing, { start_min: 500, end_min: 560, days: [2] })).toBeNull();
  });

  it('allows a block that starts exactly when the other ends', () => {
    expect(findOverlap(existing, { start_min: 530, end_min: 580, days: [3] })).toBeNull();
  });

  it('does not flag a block against itself while editing', () => {
    expect(findOverlap(existing, { start_min: 480, end_min: 530, days: [1, 3] }, 'a')).toBeNull();
  });
});
