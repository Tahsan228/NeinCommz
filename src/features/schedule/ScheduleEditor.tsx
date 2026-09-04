import { useMemo, useState } from 'react';
import { errText, supabase } from '../../lib/supabase';
import type { BlockKind, ScheduleBlock } from '../../lib/types';
import { DAY_INITIAL, DAY_SHORT, formatMinutes, parseTimeInput, toTimeInput } from '../../lib/time';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { Field } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { KIND_COLOR, findOverlap } from '../status/statusEngine';

const KINDS: { id: BlockKind; label: string }[] = [
  { id: 'class', label: 'Class' },
  { id: 'free', label: 'Free period' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'activity', label: 'Activity' },
  { id: 'other', label: 'Other' },
];

const WEEKDAYS = [1, 2, 3, 4, 5];

interface Draft {
  id?: string;
  label: string;
  kind: BlockKind;
  start: string;
  end: string;
  days: number[];
}

const EMPTY: Draft = { label: '', kind: 'class', start: '08:00', end: '08:50', days: [...WEEKDAYS] };

/**
 * The weekly schedule. This is what makes the status board work, so the editor
 * leans on defaults — a new block starts Monday-to-Friday at the hour after
 * whatever was added last — to keep filling in a whole timetable from being a
 * chore.
 */
export function ScheduleEditor() {
  const { profile, prefs } = useSession();
  const { blocksFor, reloadBlocks } = useDirectory();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const blocks = profile ? blocksFor(profile.id) : [];

  const byDay = useMemo(() => {
    const m = new Map<number, ScheduleBlock[]>();
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      const list = blocks.filter((b) => b.days.includes(d)).sort((a, b) => a.start_min - b.start_min);
      if (list.length) m.set(d, list);
    }
    return m;
  }, [blocks]);

  const startAdd = () => {
    const last = [...blocks].sort((a, b) => b.end_min - a.end_min)[0];
    const start = last ? Math.min(last.end_min + 5, 1380) : 8 * 60;
    setDraft({ ...EMPTY, start: toTimeInput(start), end: toTimeInput(Math.min(start + 50, 1439)) });
    setError('');
  };

  const startEdit = (b: ScheduleBlock) => {
    setDraft({
      id: b.id,
      label: b.label,
      kind: b.kind,
      start: toTimeInput(b.start_min),
      end: toTimeInput(b.end_min),
      days: [...b.days],
    });
    setError('');
  };

  const save = async () => {
    if (!draft || !profile) return;
    const start = parseTimeInput(draft.start);
    const end = parseTimeInput(draft.end);

    if (!draft.label.trim()) return setError('Give it a name.');
    if (start === null || end === null) return setError('Those times are not valid.');
    if (end <= start) return setError('The end time has to come after the start.');
    if (draft.days.length === 0) return setError('Pick at least one day.');

    const clash = findOverlap(blocks, { start_min: start, end_min: end, days: draft.days }, draft.id);
    if (clash) {
      return setError(
        `That overlaps "${clash.label}" (${formatMinutes(clash.start_min, prefs.clock24)}–${formatMinutes(
          clash.end_min,
          prefs.clock24,
        )}).`,
      );
    }

    setBusy(true);
    setError('');
    const row = {
      profile_id: profile.id,
      label: draft.label.trim(),
      kind: draft.kind,
      start_min: start,
      end_min: end,
      days: draft.days,
    };
    const { error: e } = draft.id
      ? await supabase.from('schedule_blocks').update(row).eq('id', draft.id)
      : await supabase.from('schedule_blocks').insert(row);
    setBusy(false);

    if (e) return setError(errText(e));
    await reloadBlocks();
    setDraft(null);
  };

  const remove = async (id: string) => {
    await supabase.from('schedule_blocks').delete().eq('id', id);
    await reloadBlocks();
    if (draft?.id === id) setDraft(null);
  };

  return (
    <div>
      <p style={{ margin: '0 0 14px', color: 'var(--ink-dim)', fontSize: 13, lineHeight: 1.55 }}>
        Blocks marked <b>Free period</b> show you as available on everyone else's board. Anything
        outside a block also reads as free, so you only have to enter what actually ties you up.
      </p>

      {draft ? (
        <div className="group" style={{ padding: 14, marginBottom: 16 }}>
          <Field label="What is it">
            <input
              className="input"
              autoFocus
              placeholder="AP Bio"
              value={draft.label}
              maxLength={40}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </Field>

          <Field label="Kind">
            <select
              className="select"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as BlockKind })}
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="two-col">
            <Field label="Starts">
              <input
                className="input"
                type="time"
                value={draft.start}
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              />
            </Field>
            <Field label="Ends">
              <input
                className="input"
                type="time"
                value={draft.end}
                onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Days">
            <div className="day-picker">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <button
                  key={d}
                  type="button"
                  data-on={draft.days.includes(d)}
                  title={DAY_SHORT[d]}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      days: draft.days.includes(d)
                        ? draft.days.filter((x) => x !== d)
                        : [...draft.days, d].sort(),
                    })
                  }
                >
                  {DAY_INITIAL[d]}
                </button>
              ))}
            </div>
          </Field>

          <p className="err">{error}</p>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {draft.id && (
              <button className="btn btn-danger btn-sm" onClick={() => void remove(draft.id!)}>
                Delete
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="btn btn-sm btn-accent" onClick={() => void save()} disabled={busy}>
              {draft.id ? 'Save changes' : 'Add block'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-accent btn-sm" style={{ marginBottom: 16 }} onClick={startAdd}>
          <Icon name="plus" size={15} />
          Add a block
        </button>
      )}

      {byDay.size === 0 && !draft && (
        <div className="empty">
          No schedule yet. Add your classes and free periods and everyone will see what you're up to
          automatically.
        </div>
      )}

      {[...byDay.entries()].map(([day, list]) => (
        <div className="sched-day" key={day}>
          <h4>{DAY_SHORT[day]}</h4>
          {list.map((b) => (
            <button
              key={`${day}-${b.id}`}
              className="sched-block"
              style={{ ['--k' as string]: KIND_COLOR[b.kind], width: '100%', textAlign: 'left' }}
              onClick={() => startEdit(b)}
            >
              <span className="sched-time">
                {formatMinutes(b.start_min, prefs.clock24)} – {formatMinutes(b.end_min, prefs.clock24)}
              </span>
              <span className="sched-label">{b.label}</span>
              <span className="pill">{KINDS.find((k) => k.id === b.kind)?.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
