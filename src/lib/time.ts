export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Minutes since local midnight for a Date. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** 555 -> "9:15 AM" (or "09:15" when h24). */
export function formatMinutes(min: number, h24 = false): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  if (h24) return `${String(h).padStart(2, '0')}:${mm}`;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${ampm}`;
}

/** "09:15" from an <input type=time> -> 555. Returns null if unparseable. */
export function parseTimeInput(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 555 -> "09:15", the value an <input type=time> wants. */
export function toTimeInput(min: number): string {
  const h = Math.floor(min / 60);
  return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function formatClock(d: Date, h24: boolean, seconds = false): string {
  return d.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hour12: !h24,
  });
}

export function formatStamp(iso: string, h24: boolean): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !h24,
  });
}

/** "Today" / "Yesterday" / "Tuesday, March 4" for the chat day separators. */
export function formatDaySeparator(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return DAY_NAMES[d.getDay()];
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

export function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  );
}

/** "in 12m" / "in 1h 5m" / "now". Used for the "what is next" line. */
export function relativeMinutes(mins: number): string {
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}
