import { describe, expect, it } from 'vitest';
import {
  formatMinutes,
  minutesOfDay,
  parseTimeInput,
  relativeMinutes,
  sameDay,
  toTimeInput,
} from '../src/lib/time';

describe('formatMinutes', () => {
  it('formats 12-hour times with the right meridiem', () => {
    expect(formatMinutes(555)).toBe('9:15 AM');
    expect(formatMinutes(13 * 60 + 5)).toBe('1:05 PM');
  });

  it('calls midnight and noon 12, not 0', () => {
    expect(formatMinutes(0)).toBe('12:00 AM');
    expect(formatMinutes(720)).toBe('12:00 PM');
  });

  it('formats 24-hour times zero-padded', () => {
    expect(formatMinutes(555, true)).toBe('09:15');
    expect(formatMinutes(0, true)).toBe('00:00');
  });
});

describe('parseTimeInput', () => {
  it('reads what an <input type=time> produces', () => {
    expect(parseTimeInput('09:15')).toBe(555);
    expect(parseTimeInput('23:59')).toBe(1439);
  });

  it('rejects nonsense', () => {
    expect(parseTimeInput('25:00')).toBeNull();
    expect(parseTimeInput('09:70')).toBeNull();
    expect(parseTimeInput('nope')).toBeNull();
    expect(parseTimeInput('')).toBeNull();
  });

  it('round-trips with toTimeInput', () => {
    for (const m of [0, 1, 555, 720, 1439]) {
      expect(parseTimeInput(toTimeInput(m))).toBe(m);
    }
  });
});

describe('relativeMinutes', () => {
  it('reads naturally at each scale', () => {
    expect(relativeMinutes(0)).toBe('now');
    expect(relativeMinutes(-5)).toBe('now');
    expect(relativeMinutes(12)).toBe('in 12m');
    expect(relativeMinutes(60)).toBe('in 1h');
    expect(relativeMinutes(65)).toBe('in 1h 5m');
  });
});

describe('minutesOfDay', () => {
  it('counts from local midnight', () => {
    expect(minutesOfDay(new Date(2026, 8, 2, 9, 15))).toBe(555);
    expect(minutesOfDay(new Date(2026, 8, 2, 0, 0))).toBe(0);
  });
});

describe('sameDay', () => {
  it('separates calendar days, not 24-hour windows', () => {
    expect(sameDay('2026-09-02T01:00:00', '2026-09-02T23:00:00')).toBe(true);
    expect(sameDay('2026-09-02T23:00:00', '2026-09-03T01:00:00')).toBe(false);
  });
});
