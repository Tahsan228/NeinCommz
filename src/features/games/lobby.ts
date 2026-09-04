import { supabase } from '../../lib/supabase';
import type { IconName } from '../../components/Icon';
import type { GameId, GamePlayer, GameSession, UUID } from '../../lib/types';

export interface GameMeta {
  id: GameId;
  name: string;
  icon: IconName;
  blurb: string;
  /** Below `min` a game still starts, but only via "Start anyway". */
  min: number;
  max: number;
  /** The floor below which the game genuinely cannot run. */
  hardMin: number;
  tint: string;
}

export const GAMES: GameMeta[] = [
  {
    id: 'haxball',
    name: 'Haxball',
    icon: 'football',
    blurb: '2v2 top-down football',
    min: 2,
    hardMin: 1,
    max: 8,
    tint: 'rgba(80, 200, 130, 0.22)',
  },
  {
    id: 'tictactoe',
    name: 'Tic-Tac-Toe',
    icon: 'grid',
    blurb: 'Best of whatever',
    min: 2,
    hardMin: 2,
    max: 2,
    tint: 'rgba(100, 182, 255, 0.22)',
  },
  {
    id: 'gartic',
    name: 'Gartic Phone',
    icon: 'palette',
    blurb: 'Draw, guess, ruin it',
    min: 3,
    hardMin: 2,
    max: 10,
    tint: 'rgba(200, 122, 255, 0.22)',
  },
];

export function gameMeta(id: GameId): GameMeta {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}

/** Fresh state for a session, before anyone has done anything. */
function initialState(game: GameId): Record<string, unknown> {
  switch (game) {
    case 'tictactoe':
      return {
        board: ['', '', '', '', '', '', '', '', ''],
        turn: 'X',
        x: null,
        o: null,
        winner: null,
        scores: { X: 0, O: 0, draws: 0 },
      };
    case 'gartic':
      return { phase: 'lobby', round: 0, order: [], seconds: 70, startedAt: null };
    case 'haxball':
      return { score: { red: 0, blue: 0 }, kickoff: true };
  }
}

export async function createSession(game: GameId, hostId: UUID): Promise<GameSession> {
  const meta = gameMeta(game);
  const { data, error } = await supabase
    .from('game_sessions')
    .insert({
      game,
      host_id: hostId,
      status: 'lobby',
      max_players: meta.max,
      state: initialState(game),
    })
    .select()
    .single();
  if (error) throw error;

  await supabase.from('game_players').insert({ session_id: data.id, profile_id: hostId, seat: 0 });
  return data as GameSession;
}

export async function joinSession(sessionId: UUID, profileId: UUID): Promise<void> {
  const { data: existing } = await supabase
    .from('game_players')
    .select('profile_id')
    .eq('session_id', sessionId);
  const seat = existing?.length ?? 0;

  // Two people tapping Join at once would otherwise fight over the same seat;
  // the primary key makes the second one a no-op rather than a duplicate.
  await supabase
    .from('game_players')
    .upsert(
      { session_id: sessionId, profile_id: profileId, seat, team: seat % 2 },
      { onConflict: 'session_id,profile_id', ignoreDuplicates: true },
    );
}

export async function leaveSession(sessionId: UUID, profileId: UUID): Promise<void> {
  await supabase.from('game_players').delete().match({ session_id: sessionId, profile_id: profileId });

  // An empty room is litter. The last person out closes it.
  const { data } = await supabase.from('game_players').select('profile_id').eq('session_id', sessionId);
  if (!data || data.length === 0) {
    await supabase.from('game_sessions').delete().eq('id', sessionId);
  }
}

/**
 * Close a room outright. Only offered to the host — everyone else leaves. The
 * cascade takes the players, invites and any rounds with it, and every open
 * client sees the session row vanish and drops back to the lobby.
 */
export async function cancelSession(sessionId: UUID): Promise<void> {
  await supabase.from('game_sessions').delete().eq('id', sessionId);
}

/** Which of these sessions am I already sitting in? */
export async function mySessions(profileId: UUID): Promise<Set<UUID>> {
  const { data } = await supabase
    .from('game_players')
    .select('session_id')
    .eq('profile_id', profileId);
  return new Set(((data as { session_id: UUID }[]) ?? []).map((r) => r.session_id));
}

export async function invite(sessionId: UUID, fromId: UUID, toId: UUID): Promise<void> {
  await supabase.from('game_invites').insert({ session_id: sessionId, from_id: fromId, to_id: toId });
}

export async function answerInvite(inviteId: UUID, accept: boolean): Promise<void> {
  await supabase
    .from('game_invites')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('id', inviteId);
}

export async function setState(
  sessionId: UUID,
  state: Record<string, unknown>,
  status?: GameSession['status'],
): Promise<void> {
  const patch: Record<string, unknown> = { state, updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  await supabase.from('game_sessions').update(patch).eq('id', sessionId);
}

export async function loadPlayers(sessionId: UUID): Promise<GamePlayer[]> {
  const { data } = await supabase
    .from('game_players')
    .select('*')
    .eq('session_id', sessionId)
    .order('seat');
  return (data as GamePlayer[]) ?? [];
}
