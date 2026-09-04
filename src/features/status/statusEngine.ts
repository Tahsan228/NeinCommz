import type { Presence, Profile, ScheduleBlock } from '../../lib/types';
import type { IconName } from '../../components/Icon';
import { minutesOfDay, relativeMinutes } from '../../lib/time';

/**
 * Preset statuses store an icon name rather than an emoji, tagged with this
 * prefix so the column can still hold a genuine emoji when someone types their
 * own. Anything without the prefix is treated as literal text.
 */
export const ICON_PREFIX = 'icon:';

export interface ResolvedStatus {
  /** What to show as the headline, e.g. "AP Bio" or "Free Period". */
  text: string;
  /** Chrome uses icons; `emoji` is only set when the person picked one. */
  icon: IconName;
  emoji: string | null;
  /** True when this person is reachable right now — drives the green styling. */
  free: boolean;
  presence: Presence;
  /** "→ Lunch in 12m", or null when nothing is coming up today. */
  next: string | null;
  /** Which rule produced `text`, so the UI (and tests) can tell them apart. */
  source: 'override' | 'presence' | 'schedule' | 'idle';
}

const KIND_ICON: Record<string, IconName> = {
  class: 'book',
  free: 'check',
  lunch: 'lunch',
  activity: 'zap',
  other: 'pin',
};

export const KIND_COLOR: Record<string, string> = {
  class: '#6aa9ff',
  free: '#4fd695',
  lunch: '#f0b429',
  activity: '#c07aff',
  other: '#8a8a96',
};

/** Blocks covering `now` on `weekday`, earliest first. */
export function blocksAt(blocks: ScheduleBlock[], weekday: number, minute: number): ScheduleBlock[] {
  return blocks
    .filter((b) => b.days.includes(weekday) && minute >= b.start_min && minute < b.end_min)
    .sort((a, b) => a.start_min - b.start_min);
}

/** The next block starting strictly after `minute` today, if any. */
export function nextBlock(
  blocks: ScheduleBlock[],
  weekday: number,
  minute: number,
): ScheduleBlock | null {
  const upcoming = blocks
    .filter((b) => b.days.includes(weekday) && b.start_min > minute)
    .sort((a, b) => a.start_min - b.start_min);
  return upcoming[0] ?? null;
}

/**
 * Resolve what someone is up to right now.
 *
 * Priority, highest first:
 *   1. a manual override they set, until it expires
 *   2. presence, when they are away or fully offline
 *   3. whichever schedule block covers this minute
 *   4. nothing scheduled -> "Online"
 *
 * Only a block someone marked as a free period counts as free. An empty slot
 * means the timetable says nothing, not that they are available.
 *
 * Presence deliberately sits above the schedule: a timetable saying "AP Bio"
 * is not useful information about someone whose browser has been shut for an
 * hour. A manual override still beats presence, because "at practice, back at
 * 6" is a deliberate statement and should survive going offline.
 */
export function resolveStatus(
  profile: Pick<Profile, 'status_text' | 'status_emoji' | 'status_expires_at'>,
  blocks: ScheduleBlock[],
  presence: Presence,
  now: Date = new Date(),
): ResolvedStatus {
  const weekday = now.getDay();
  const minute = minutesOfDay(now);

  const upcoming = nextBlock(blocks, weekday, minute);
  const next = upcoming
    ? `→ ${upcoming.label} ${relativeMinutes(upcoming.start_min - minute)}`
    : null;

  const overrideLive =
    !!profile.status_text &&
    (!profile.status_expires_at || new Date(profile.status_expires_at).getTime() > now.getTime());

  if (overrideLive) {
    const tag = profile.status_emoji ?? '';
    const isIcon = tag.startsWith(ICON_PREFIX);
    return {
      text: profile.status_text as string,
      icon: isIcon ? (tag.slice(ICON_PREFIX.length) as IconName) : 'message',
      emoji: !isIcon && tag ? tag : null,
      free: false,
      presence,
      next,
      source: 'override',
    };
  }

  if (presence === 'offline') {
    return { text: 'Offline', icon: 'phoneOff', emoji: null, free: false, presence, next, source: 'presence' };
  }
  if (presence === 'away') {
    return { text: 'Away', icon: 'moon', emoji: null, free: false, presence, next, source: 'presence' };
  }

  const current = blocksAt(blocks, weekday, minute)[0];
  if (current) {
    return {
      text: current.label,
      icon: KIND_ICON[current.kind] ?? 'pin',
      emoji: current.emoji || null,
      free: current.kind === 'free',
      presence,
      next,
      source: 'schedule',
    };
  }

  // Having nothing scheduled is not the same as being free. Somebody who
  // never filled in a timetable would otherwise show as available around the
  // clock, which is worse than saying nothing — so an empty slot reports only
  // that they are here. `free` is reserved for a block they marked as free.
  return { text: 'Online', icon: 'circle', emoji: null, free: false, presence, next, source: 'idle' };
}

/** Reject a block that would sit on top of one already on the same weekday. */
export function findOverlap(
  blocks: ScheduleBlock[],
  candidate: { start_min: number; end_min: number; days: number[] },
  ignoreId?: string,
): ScheduleBlock | null {
  for (const b of blocks) {
    if (b.id === ignoreId) continue;
    if (!b.days.some((d) => candidate.days.includes(d))) continue;
    if (candidate.start_min < b.end_min && b.start_min < candidate.end_min) return b;
  }
  return null;
}
