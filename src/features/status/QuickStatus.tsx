import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../state/session';
import { presenceOf, useDirectory } from '../../state/directory';
import { Icon, type IconName } from '../../components/Icon';
import { ICON_PREFIX, resolveStatus, type ResolvedStatus } from './statusEngine';

interface Preset {
  label: string;
  icon: IconName;
  minutes: number;
}

const PRESETS: Preset[] = [
  { label: 'Free right now', icon: 'check', minutes: 60 },
  { label: 'Heads down', icon: 'headphones', minutes: 90 },
  { label: 'At practice', icon: 'zap', minutes: 120 },
  { label: 'Phone taken', icon: 'phoneOff', minutes: 240 },
  { label: 'Be right back', icon: 'clock', minutes: 20 },
];

const DURATIONS = [
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: 'Rest of the day', minutes: 480 },
  { label: 'Until I change it', minutes: 0 },
];

/** Renders a status as an icon, or the person's own emoji if they typed one. */
export function StatusGlyph({ status, size = 15 }: { status: ResolvedStatus; size?: number }) {
  if (status.emoji) return <span style={{ fontSize: size, lineHeight: 1 }}>{status.emoji}</span>;
  return <Icon name={status.icon} size={size} />;
}

/**
 * The top-bar status control. Setting "at practice" was previously buried in
 * the board on the far side of the screen; it belongs one click away, because
 * it is the thing people change most often and always in a hurry.
 */
export function QuickStatus() {
  const { profile, saveProfile } = useSession();
  const { blocksFor, presence } = useDirectory();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [now, setNow] = useState(() => new Date());
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!profile) return null;

  const status = resolveStatus(
    profile,
    blocksFor(profile.id),
    presenceOf(presence, profile.id),
    now,
  );
  const hasOverride = status.source === 'override';

  const apply = async (text: string | null, tag: string | null, mins: number) => {
    setOpen(false);
    setCustom('');
    await saveProfile({
      status_text: text,
      status_emoji: tag,
      status_expires_at: text && mins > 0 ? new Date(Date.now() + mins * 60_000).toISOString() : null,
    });
  };

  return (
    <div style={{ position: 'relative' }} ref={boxRef}>
      <button
        className="status-btn"
        data-custom={hasOverride}
        onClick={() => setOpen((v) => !v)}
        title="Set a temporary status"
      >
        <StatusGlyph status={status} size={15} />
        <span>{status.text}</span>
        <Icon name="chevronDown" size={13} style={{ opacity: 0.6, flex: 'none' }} />
      </button>

      {open && (
        <div className="popover">
          <div className="label" style={{ padding: '2px 6px 6px' }}>Set status</div>

          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="popover-item"
              data-on={hasOverride && profile.status_text === p.label}
              onClick={() => void apply(p.label, ICON_PREFIX + p.icon, minutes)}
            >
              <Icon name={p.icon} size={16} />
              {p.label}
            </button>
          ))}

          <div className="popover-sep" />

          <form
            style={{ display: 'flex', gap: 6, padding: '0 4px' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) void apply(custom.trim(), null, minutes);
            }}
          >
            <input
              className="input"
              style={{ fontSize: 13, padding: '8px 10px' }}
              placeholder="Something else…"
              maxLength={40}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button className="btn btn-accent btn-sm" disabled={!custom.trim()} aria-label="Set status">
              <Icon name="check" size={15} />
            </button>
          </form>

          <label style={{ display: 'block', padding: '10px 4px 4px' }}>
            <span
              style={{
                display: 'block',
                fontSize: 11,
                color: 'var(--ink-label)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Clears after
            </span>
            <select
              className="select"
              style={{ fontSize: 13, padding: '8px 30px 8px 10px' }}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {DURATIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          {hasOverride && (
            <>
              <div className="popover-sep" />
              <button className="popover-item" onClick={() => void apply(null, null, 0)}>
                <Icon name="calendar" size={16} />
                Back to my schedule
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
