import { useEffect, useState } from 'react';
import type { UUID } from '../../lib/types';
import { useSession } from '../../state/session';
import { presenceOf, useDirectory } from '../../state/directory';
import { Avatar, Spinner } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { cancelSession, gameMeta, invite, leaveSession } from './lobby';
import { RosterChip, useGameRoom } from './room';
import { TicTacToeGame } from './tictactoe/TicTacToeGame';
import { GarticGame } from './gartic/GarticGame';
import { HaxballGame } from './haxball/HaxballGame';

export function GameOverlay({ sessionId, onClose }: { sessionId: UUID; onClose: () => void }) {
  const { profile } = useSession();
  const { byId, profiles, presence } = useDirectory();
  const { session, players, loading } = useGameRoom(sessionId);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [invited, setInvited] = useState<Set<UUID>>(new Set());
  const [confirmCancel, setConfirmCancel] = useState(false);

  // The room can be closed out from under you — the host cancels it, or the
  // last person leaves. Wait for the first fetch to settle before acting on a
  // null session, though: until then null only means "not loaded yet", and
  // closing on it slams the overlay shut the instant it opens.
  useEffect(() => {
    if (!loading && session === null) onClose();
  }, [loading, session, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Arrow keys drive Haxball, so only Escape gets through here.
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!profile) return null;

  if (loading || !session) {
    return (
      <div className="game-overlay">
        <div className="game-stage">
          <Spinner />
        </div>
      </div>
    );
  }

  const meta = gameMeta(session.game);
  const me = profile.id;
  const inRoom = players.some((p) => p.profile_id === me);

  const isHost = session.host_id === me;

  const leave = async () => {
    await leaveSession(sessionId, me);
    onClose();
  };

  // Closing the room ends it for everyone, so it asks once rather than firing
  // off a click that cannot be undone.
  const cancel = async () => {
    await cancelSession(sessionId);
    onClose();
  };

  const sendInvite = async (to: UUID) => {
    setInvited((s) => new Set(s).add(to));
    await invite(sessionId, me, to);
  };

  return (
    <div className="game-overlay">
      <div className="game-bar">
        <div className="lobby-icon">
          <Icon name={meta.icon} size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <h2>{meta.name}</h2>
          <div className="row-sub">
            {byId.get(session.host_id)?.display_name ?? 'Someone'}'s room · {players.length}/
            {meta.max}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setInvitesOpen((v) => !v)}>
            <Icon name="userPlus" size={15} />
            Invite
          </button>
          {invitesOpen && (
            <div
              className="gif-pop"
              style={{ bottom: 'auto', top: 'calc(100% + 10px)', right: 0, left: 'auto', width: 260 }}
            >
              <div className="label" style={{ padding: '0 0 8px' }}>
                Ask someone in
              </div>
              {profiles
                .filter((p) => p.id !== me && !players.some((pl) => pl.profile_id === p.id))
                .map((p) => (
                  <div className="lobby-row" key={p.id} style={{ padding: '8px 0' }}>
                    <Avatar
                      emoji={p.avatar_emoji}
                      url={p.avatar_url}
                      color={p.avatar_color}
                      size={26}
                      name={p.display_name}
                    />
                    <div style={{ flex: 1, fontSize: 13 }}>{p.display_name}</div>
                    <button
                      className="btn btn-sm"
                      disabled={invited.has(p.id) || presenceOf(presence, p.id) === 'offline'}
                      onClick={() => void sendInvite(p.id)}
                    >
                      {invited.has(p.id)
                        ? 'Asked'
                        : presenceOf(presence, p.id) === 'offline'
                          ? 'Offline'
                          : 'Ask'}
                    </button>
                  </div>
                ))}
              {profiles.length <= players.length && (
                <div className="empty" style={{ padding: 12 }}>
                  Everyone's already in.
                </div>
              )}
            </div>
          )}
        </div>

        {isHost &&
          (confirmCancel ? (
            <>
              <span style={{ fontSize: 12.5, color: 'var(--ink-dim)' }}>End for everyone?</span>
              <button className="btn btn-sm btn-danger" onClick={() => void cancel()}>
                Yes, close it
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmCancel(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm btn-danger"
              onClick={() => setConfirmCancel(true)}
              title="Close this room for everyone"
            >
              <Icon name="ban" size={15} />
              Cancel room
            </button>
          ))}

        <button className="btn btn-sm" onClick={() => void leave()} title="Leave, keep the room open">
          <Icon name="logout" size={15} />
          Leave
        </button>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Back to chat">
          <Icon name="x" size={17} />
        </button>
      </div>

      <div className="game-stage">
        {!inRoom ? (
          <div className="empty">You left this room.</div>
        ) : session.game === 'tictactoe' ? (
          <TicTacToeGame session={session} players={players} profiles={byId} me={me} />
        ) : session.game === 'gartic' ? (
          <GarticGame session={session} players={players} profiles={byId} me={me} />
        ) : (
          <HaxballGame session={session} players={players} profiles={byId} me={me} />
        )}

        {session.game !== 'gartic' && (
          <div className="roster">
            {players.map((p) => (
              <RosterChip key={p.profile_id} id={p.profile_id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
