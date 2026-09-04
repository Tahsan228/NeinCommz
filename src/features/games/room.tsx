import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { GamePlayer, GameSession, UUID } from '../../lib/types';
import { useDirectory } from '../../state/directory';
import { Avatar } from '../../components/ui';

export interface Room {
  session: GameSession | null;
  players: GamePlayer[];
  /**
   * True until the first fetch settles. Without this, `session === null` is
   * ambiguous — it means both "still loading" and "this room is gone" — and a
   * caller that closes on null will close itself the instant it mounts.
   */
  loading: boolean;
}

/** Live session + roster for one room. Shared by the overlay and each game. */
export function useGameRoom(sessionId: UUID): Room {
  const [session, setSession] = useState<GameSession | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from('game_sessions').select('*').eq('id', sessionId).maybeSingle(),
      supabase.from('game_players').select('*').eq('session_id', sessionId).order('seat'),
    ]);
    setSession((s as GameSession) ?? null);
    setPlayers((p as GamePlayer[]) ?? []);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    setLoading(true);
    void load();

    const ch = supabase
      .channel(`room:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') setSession(null);
          else setSession(payload.new as GameSession);
          setLoading(false);
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

  return { session, players, loading };
}

export function RosterChip({ id, team }: { id: UUID; team?: number }) {
  const { byId } = useDirectory();
  const p = byId.get(id);
  return (
    <div
      className="roster-chip"
      style={
        team !== undefined
          ? { borderColor: team === 0 ? 'rgba(224,87,79,0.5)' : 'rgba(74,157,224,0.5)' }
          : undefined
      }
    >
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
