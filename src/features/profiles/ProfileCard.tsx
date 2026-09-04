import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { UUID } from '../../lib/types';
import { useSession } from '../../state/session';
import { presenceOf, useDirectory } from '../../state/directory';
import { useRooms } from '../../state/rooms';
import { useEconomy } from '../../state/economy';
import { isRated, rankFor } from '../economy/elo';
import { Avatar, Modal } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { resolveStatus } from '../status/statusEngine';
import { StatusGlyph } from '../status/QuickStatus';
import { DAY_SHORT, formatMinutes } from '../../lib/time';

/** Who someone is: their status now, what they have on today, and their bio. */
export function ProfileCard({ id, onClose }: { id: UUID; onClose: () => void }) {
  const { profile: me, prefs } = useSession();
  const { byId, blocksFor, presence } = useDirectory();
  const { openDm } = useRooms();
  const { statFor } = useEconomy();

  const [messageCount, setMessageCount] = useState<number | null>(null);
  const person = byId.get(id);

  useEffect(() => {
    // A cheap, honest stat until the full leaderboards land.
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', id)
      .then(({ count }) => setMessageCount(count ?? 0));
  }, [id]);

  if (!person) return null;

  const now = new Date();
  const status = resolveStatus(person, blocksFor(id), presenceOf(presence, id), now);
  const today = blocksFor(id)
    .filter((b) => b.days.includes(now.getDay()))
    .sort((a, b) => a.start_min - b.start_min);

  const isMe = id === me?.id;

  return (
    <Modal
      title="Profile"
      onClose={onClose}
      footer={
        isMe ? (
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button
              className="btn btn-accent"
              onClick={() => {
                void openDm(id);
                onClose();
              }}
            >
              <Icon name="message" size={15} />
              Message
            </button>
          </>
        )
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 18 }}>
        <div className="dot-wrap">
          <Avatar
            emoji={person.avatar_emoji}
            url={person.avatar_url}
            color={person.avatar_color}
            size={72}
            name={person.display_name}
          />
          <span className="dot" data-p={status.presence} style={{ width: 18, height: 18 }} />
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {person.display_name}
          </div>
          <div className="status-now" data-free={status.free} style={{ marginTop: 5 }}>
            <StatusGlyph status={status} size={15} />
            <span>{status.text}</span>
          </div>
          {status.next && <div className="status-next">{status.next}</div>}
        </div>
      </div>

      {person.bio ? (
        <div className="group" style={{ padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{person.bio}</div>
        </div>
      ) : (
        <p className="row-sub" style={{ marginBottom: 16 }}>
          {isMe ? 'Add a bio in Settings → Profile.' : 'No bio yet.'}
        </p>
      )}

      <div className="label">Today · {DAY_SHORT[now.getDay()]}</div>
      <div className="group" style={{ marginBottom: 16 }}>
        {today.length === 0 && <div className="empty">Nothing scheduled today.</div>}
        {today.map((b) => (
          <div className="row" key={b.id} style={{ minHeight: 42 }}>
            <span className="sched-time">
              {formatMinutes(b.start_min, prefs.clock24)} – {formatMinutes(b.end_min, prefs.clock24)}
            </span>
            <div className="row-main">
              <div className="row-title" style={{ fontSize: 13 }}>{b.label}</div>
            </div>
            {b.kind === 'free' && <span className="pill pill-live">free</span>}
          </div>
        ))}
      </div>

      <div className="label">Ratings</div>
      <div className="group" style={{ marginBottom: 16 }}>
        {(['haxball', 'chess', 'tictactoe', 'gartic'] as const).map((g) => {
          const st = statFor(id, g);
          const rank = st && isRated(g) ? rankFor(st.elo) : null;
          return (
            <div className="row" key={g} style={{ minHeight: 46 }}>
              <div className="row-main">
                <div className="row-title" style={{ fontSize: 13, textTransform: 'capitalize' }}>
                  {g === 'tictactoe' ? 'Tic-Tac-Toe' : g}
                </div>
                {st && (
                  <div className="row-sub">
                    {st.won}W · {st.lost}L · {st.drawn}D
                    {st.best_streak > 1 && ` · best streak ${st.best_streak}`}
                  </div>
                )}
              </div>
              {!st ? (
                <span className="row-sub">Not played</span>
              ) : rank ? (
                <span className="lb-elo">
                  <b>{st.elo}</b>
                  <span style={{ color: rank.color }}>{rank.name}</span>
                </span>
              ) : (
                <b>{st.played} played</b>
              )}
            </div>
          );
        })}
      </div>

      <div className="label">Stats</div>
      <div className="group">
        <div className="row" style={{ minHeight: 46 }}>
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 13 }}>Coins</div>
          </div>
          <span className="coin-pill">
            <Icon name="circle" size={12} />
            {(person.coins ?? 0).toLocaleString()}
          </span>
        </div>
        <div className="row" style={{ minHeight: 46 }}>
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 13 }}>Messages sent</div>
          </div>
          <b>{messageCount ?? '…'}</b>
        </div>
        <div className="row" style={{ minHeight: 46 }}>
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 13 }}>Here since</div>
          </div>
          <b>{new Date(person.created_at).toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
        </div>
      </div>
    </Modal>
  );
}
