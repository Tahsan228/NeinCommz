import { useEffect, useMemo, useState } from 'react';
import type { UUID } from '../../lib/types';
import { useSession } from '../../state/session';
import { presenceOf, useDirectory } from '../../state/directory';
import { Avatar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { resolveStatus } from './statusEngine';
import { StatusGlyph } from './QuickStatus';
import { ProfileCard } from '../profiles/ProfileCard';

export function StatusBoard() {
  const { profile } = useSession();
  const { profiles, blocksFor, presence } = useDirectory();

  // One shared clock so every card recomputes together, on the minute.
  const [now, setNow] = useState(() => new Date());
  const [viewing, setViewing] = useState<UUID | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    return profiles
      .map((p) => ({
        profile: p,
        status: resolveStatus(p, blocksFor(p.id), presenceOf(presence, p.id), now),
      }))
      .sort((a, b) => {
        // Reachable people first: that is the whole reason to look at this list.
        const rank = (x: typeof a) =>
          x.status.presence === 'offline' ? 2 : x.status.free ? 0 : 1;
        const d = rank(a) - rank(b);
        return d !== 0 ? d : a.profile.display_name.localeCompare(b.profile.display_name);
      });
  }, [profiles, blocksFor, presence, now]);

  return (
    <div className="column-scroll status-list">
      {rows.length === 0 && <div className="empty">Nobody has a profile yet.</div>}

      {rows.map(({ profile: p, status }) => (
        <button
          className="status-card status-card-btn"
          key={p.id}
          onClick={() => setViewing(p.id)}
          title={`About ${p.display_name}`}
        >
          <div className="dot-wrap">
            <Avatar
              emoji={p.avatar_emoji}
              url={p.avatar_url}
              color={p.avatar_color}
              size={36}
              name={p.display_name}
            />
            <span className="dot" data-p={status.presence} />
          </div>

          <div className="status-body">
            <div className="status-name">
              {p.display_name}
              {p.id === profile?.id && <span className="pill">you</span>}
              {status.source === 'override' && (
                <Icon name="pin" size={12} style={{ color: 'var(--ink-faint)', flex: 'none' }} />
              )}
            </div>

            <div className="status-now" data-free={status.free}>
              <StatusGlyph status={status} size={14} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {status.text}
              </span>
            </div>

            {status.next && <div className="status-next">{status.next}</div>}
          </div>
        </button>
      ))}

      {viewing && <ProfileCard id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
