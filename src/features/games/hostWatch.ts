import type { GamePlayer, GameSession, Presence, UUID } from '../../lib/types';

/**
 * What to do about a room whose host has gone.
 *
 * Pure, so the decision can be tested without a network: a handover that fires
 * twice hands the room to two different people, and one that never fires
 * strands everyone in a room nobody can start.
 */

export type HostAction =
  | { kind: 'none' }
  | { kind: 'promote'; to: UUID }
  | { kind: 'close' };

export interface HostWatchInput {
  session: Pick<GameSession, 'id' | 'host_id'>;
  players: Pick<GamePlayer, 'profile_id' | 'seat'>[];
  presence: Map<UUID, Presence>;
  /** Whoever is asking. Only one client should act, and this decides which. */
  me: UUID;
}

/**
 * Decide what this client should do, if anything.
 *
 * Every client runs this against the same facts, so it has to pick a single
 * actor or they will all write at once: the longest-standing player still
 * online does the work, and everybody else does nothing.
 */
export function hostAction({ session, players, presence, me }: HostWatchInput): HostAction {
  const hostPresence = presence.get(session.host_id) ?? 'offline';
  if (hostPresence !== 'offline') return { kind: 'none' };

  // Seat order is join order, so this is "whoever has been here longest".
  const survivors = [...players]
    .filter((p) => p.profile_id !== session.host_id)
    .filter((p) => (presence.get(p.profile_id) ?? 'offline') !== 'offline')
    .sort((a, b) => a.seat - b.seat);

  if (survivors.length === 0) {
    // Nobody is left to inherit it, so the room is litter. Only somebody
    // actually in it does the tidying.
    const stillIn = players.some((p) => p.profile_id === me);
    return stillIn ? { kind: 'close' } : { kind: 'none' };
  }

  const heir = survivors[0];
  // Only the heir writes; everyone else waits for the change to arrive.
  if (heir.profile_id !== me) return { kind: 'none' };
  return { kind: 'promote', to: heir.profile_id };
}
