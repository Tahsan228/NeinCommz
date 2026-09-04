import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { GameId, GameInvite, GamePlayer, GameSession, UUID } from '../../lib/types';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { useToasts } from '../../state/toasts';
import { Avatar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import {
  GAMES,
  answerInvite,
  cancelSession,
  createSession,
  gameMeta,
  joinSession,
  leaveSession,
  mySessions,
} from './lobby';
import { GameOverlay } from './GameOverlay';

export function GamesPanel() {
  const { profile } = useSession();
  const { byId } = useDirectory();
  const { push } = useToasts();

  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [counts, setCounts] = useState<Map<UUID, number>>(new Map());
  const [joined, setJoined] = useState<Set<UUID>>(new Set());
  const [openId, setOpenId] = useState<UUID | null>(null);

  const me = profile?.id;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('game_sessions')
      .select('*')
      .in('status', ['lobby', 'active'])
      .order('created_at', { ascending: false });
    const list = (data as GameSession[]) ?? [];
    setSessions(list);
    if (me) setJoined(await mySessions(me));

    if (list.length) {
      const { data: players } = await supabase
        .from('game_players')
        .select('session_id')
        .in('session_id', list.map((s) => s.id));
      const m = new Map<UUID, number>();
      for (const p of (players as { session_id: UUID }[]) ?? []) {
        m.set(p.session_id, (m.get(p.session_id) ?? 0) + 1);
      }
      setCounts(m);
    } else {
      setCounts(new Map());
    }
  }, [me]);

  useEffect(() => {
    if (!me) return;
    void load();
    const ch = supabase
      .channel('games:index')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players' }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [me, load]);

  /* ----------------------------------------------------------- invites -- */
  useEffect(() => {
    if (!me) return;

    const show = (inv: GameInvite) => {
      const from = byId.get(inv.from_id)?.display_name ?? 'Someone';
      const meta = gameMeta((sessions.find((s) => s.id === inv.session_id)?.game ?? 'tictactoe') as GameId);
      push({
        icon: meta.icon,
        title: `${from} wants to play ${meta.name}`,
        sub: 'Invite expires when the room closes.',
        ms: 20_000,
        action: {
          label: 'Join',
          run: () => {
            void answerInvite(inv.id, true);
            void joinSession(inv.session_id, me).then(() => setOpenId(inv.session_id));
          },
        },
      });
    };

    // Anything already waiting from before this tab opened.
    void supabase
      .from('game_invites')
      .select('*')
      .eq('to_id', me)
      .eq('status', 'pending')
      .then(({ data }) => (data as GameInvite[] | null)?.forEach(show));

    const ch = supabase
      .channel(`invites:${me}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_invites', filter: `to_id=eq.${me}` },
        (payload) => show(payload.new as GameInvite),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [me, byId, push, sessions]);

  const startGame = async (game: GameId) => {
    if (!me) return;
    // Rejoin rather than pile up empty rooms for the same game.
    const mine = sessions.find((s) => s.game === game && s.host_id === me && s.status !== 'done');
    if (mine) return setOpenId(mine.id);
    const s = await createSession(game, me);
    setOpenId(s.id);
  };

  const join = async (s: GameSession) => {
    if (!me) return;
    await joinSession(s.id, me);
    setOpenId(s.id);
  };

  const leave = async (id: UUID) => {
    if (!me) return;
    await leaveSession(id, me);
    if (openId === id) setOpenId(null);
    await load();
  };

  if (!profile) return null;

  return (
    <>
      <div className="game-grid">
        {GAMES.map((g) => (
          <button
            key={g.id}
            className="game-card"
            style={{ ['--tint' as string]: g.tint }}
            onClick={() => void startGame(g.id)}
          >
            <div className="game-icon">
              <Icon name={g.icon} size={28} strokeWidth={1.6} />
            </div>
            <div className="game-name">{g.name}</div>
            <div className="game-desc">{g.blurb}</div>
          </button>
        ))}
      </div>

      <div className="label" style={{ padding: '4px 18px 8px' }}>
        Rooms open now
      </div>

      <div className="column-scroll" style={{ paddingBottom: 8 }}>
        {sessions.length === 0 && (
          <div className="empty">Nothing running. Pick a game above and invite someone.</div>
        )}

        {sessions.map((s) => {
          const meta = gameMeta(s.game);
          const host = byId.get(s.host_id);
          const count = counts.get(s.id) ?? 0;
          const inRoom = joined.has(s.id);
          const isHost = s.host_id === me;
          return (
            <div className="lobby-row" key={s.id}>
              <div className="lobby-icon">
                <Icon name={meta.icon} size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.name}</div>
                <div className="row-sub">
                  {host?.display_name ?? 'Someone'}'s room · {count}/{meta.max}
                </div>
              </div>
              <span className={`pill ${s.status === 'active' ? 'pill-live' : ''}`}>
                {s.status === 'active' ? 'Live' : 'Waiting'}
              </span>

              {isHost && (
                <button
                  className="btn btn-sm btn-danger"
                  title="Close this room for everyone"
                  onClick={() => void cancelSession(s.id)}
                >
                  <Icon name="ban" size={14} />
                </button>
              )}
              {inRoom && !isHost && (
                <button
                  className="btn btn-sm"
                  title="Leave this room"
                  onClick={() => void leave(s.id)}
                >
                  <Icon name="logout" size={14} />
                </button>
              )}
              <button
                className="btn btn-sm btn-accent"
                disabled={!inRoom && count >= meta.max}
                onClick={() => void join(s)}
              >
                {inRoom ? 'Open' : count >= meta.max ? 'Full' : 'Join'}
              </button>
            </div>
          );
        })}
      </div>

      {openId && <GameOverlay sessionId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** Live session + roster for one room. Shared by the overlay and each game. */
export function useGameRoom(sessionId: UUID) {
  const [session, setSession] = useState<GameSession | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);

  const load = useCallback(async () => {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from('game_sessions').select('*').eq('id', sessionId).maybeSingle(),
      supabase.from('game_players').select('*').eq('session_id', sessionId).order('seat'),
    ]);
    setSession((s as GameSession) ?? null);
    setPlayers((p as GamePlayer[]) ?? []);
  }, [sessionId]);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`room:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') setSession(null);
          else setSession(payload.new as GameSession);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_players', filter: `session_id=eq.${sessionId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [sessionId, load]);

  return { session, players };
}

export function RosterChip({ id }: { id: UUID }) {
  const { byId } = useDirectory();
  const p = byId.get(id);
  return (
    <div className="roster-chip">
      <Avatar
        emoji={p?.avatar_emoji ?? '🙂'}
        url={p?.avatar_url}
        color={p?.avatar_color ?? '#555'}
        size={24}
        name={p?.display_name}
      />
      {p?.display_name ?? 'Someone'}
    </div>
  );
}
