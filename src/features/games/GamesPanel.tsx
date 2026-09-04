import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { GameId, GameInvite, GameSession, Profile, UUID } from '../../lib/types';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { useToasts } from '../../state/toasts';
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
import { hostAction } from './hostWatch';

export function GamesPanel() {
  const { profile } = useSession();
  const { byId, presence } = useDirectory();
  const { push } = useToasts();

  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [counts, setCounts] = useState<Map<UUID, number>>(new Map());
  const [joined, setJoined] = useState<Set<UUID>>(new Set());
  const [openId, setOpenId] = useState<UUID | null>(null);
  const [error, setError] = useState('');

  const me = profile?.id;

  // The invite listener needs the newest sessions and profiles without being
  // torn down and rebuilt whenever either changes — resubscribing re-runs the
  // "catch up on pending invites" fetch and toasts everything a second time.
  const sessionsRef = useRef<GameSession[]>([]);
  const profilesRef = useRef<Map<UUID, Profile>>(new Map());
  const seenInvites = useRef<Set<UUID>>(new Set());
  sessionsRef.current = sessions;
  profilesRef.current = byId;

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('game_sessions')
      .select('*')
      .in('status', ['lobby', 'active'])
      .order('created_at', { ascending: false });

    if (e) {
      setError(e.message);
      return;
    }
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

    const show = async (inv: GameInvite) => {
      // One toast per invite, however many times we hear about it.
      if (seenInvites.current.has(inv.id)) return;
      seenInvites.current.add(inv.id);

      const from = profilesRef.current.get(inv.from_id)?.display_name ?? 'Someone';

      // The invite can beat the session insert down the wire, so fall back to
      // asking for the room directly rather than guessing which game it is.
      let game = sessionsRef.current.find((s) => s.id === inv.session_id)?.game;
      if (!game) {
        const { data } = await supabase
          .from('game_sessions')
          .select('game')
          .eq('id', inv.session_id)
          .maybeSingle();
        game = (data as { game: GameId } | null)?.game;
      }
      if (!game) return; // room already closed; nothing to join

      const meta = gameMeta(game);
      push({
        icon: meta.icon,
        title: `${from} wants to play ${meta.name}`,
        sub: 'Hit join to hop in.',
        ms: 25_000,
        action: {
          label: 'Join',
          run: () => {
            void (async () => {
              await answerInvite(inv.id, true);
              await joinSession(inv.session_id, me);
              setOpenId(inv.session_id);
            })();
          },
        },
      });
    };

    // Catch up on anything sent while this tab was closed, but only recent
    // ones — an hour-old invite is not worth a notification.
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    void supabase
      .from('game_invites')
      .select('*')
      .eq('to_id', me)
      .eq('status', 'pending')
      .gte('created_at', since)
      .then(({ data }) => (data as GameInvite[] | null)?.forEach((inv) => void show(inv)));

    const ch = supabase
      .channel(`invites:${me}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_invites', filter: `to_id=eq.${me}` },
        (payload) => void show(payload.new as GameInvite),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [me, push]);

  /* -------------------------------------------------- the host walked off -- */
  // A host who closes the tab leaves a room nobody can start. Give it to
  // whoever has been in it longest, or clear it away if they all left.
  useEffect(() => {
    if (!me || sessions.length === 0) return;

    const check = async () => {
      const { data } = await supabase
        .from('game_players')
        .select('session_id, profile_id, seat')
        .in('session_id', sessions.map((s) => s.id));

      const rows = (data as { session_id: UUID; profile_id: UUID; seat: number }[]) ?? [];

      for (const session of sessions) {
        const players = rows.filter((r) => r.session_id === session.id);
        const action = hostAction({
          session,
          players,
          presence,
          me,
        });

        if (action.kind === 'promote') {
          await supabase
            .from('game_sessions')
            .update({ host_id: action.to })
            .eq('id', session.id)
            // Only rewrite it if nobody beat us to it.
            .eq('host_id', session.host_id);
          push({
            icon: 'users',
            title: 'You are running this room now',
            sub: `${byId.get(session.host_id)?.display_name ?? 'The host'} left.`,
          });
        } else if (action.kind === 'close') {
          await supabase.from('game_sessions').delete().eq('id', session.id);
        }
      }
    };

    // Presence takes a few seconds to settle after a tab closes, so this runs
    // on a slow timer rather than the instant somebody drops.
    const id = window.setInterval(() => void check(), 6000);
    return () => window.clearInterval(id);
  }, [me, sessions, presence, byId, push]);

  /* ------------------------------------------------------------ actions -- */
  const startGame = async (game: GameId) => {
    if (!me) return;
    setError('');
    try {
      // Reopen your own room rather than piling up empties for the same game.
      const mine = sessions.find((s) => s.game === game && s.host_id === me && s.status !== 'done');
      if (mine) {
        await joinSession(mine.id, me);
        setOpenId(mine.id);
        return;
      }
      const s = await createSession(game, me);
      await load();
      setOpenId(s.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that room.');
    }
  };

  const join = async (s: GameSession) => {
    if (!me) return;
    setError('');
    try {
      await joinSession(s.id, me);
      setOpenId(s.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
    }
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

      {error && <p className="err" style={{ padding: '0 18px' }}>{error}</p>}

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
                <button className="btn btn-sm" title="Leave this room" onClick={() => void leave(s.id)}>
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
