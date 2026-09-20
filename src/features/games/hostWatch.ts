import type { GamePlayer, GameSession, Presence, UUID } from '../../lib/types';

/**
 * What to do about a room whose host has gone, or that nobody is in any more.
 *
 * Pure, so the decision can be tested without a network: a handover that fires
 * twice hands the room to two different people, one that never fires strands
 * everyone in a room nobody can start, and a room nobody tidies up sits in the
 * lobby for ever telling people a match is live.
 */

export type HostAction =
  | { kind: 'none' }
  | { kind: 'promote'; to: UUID }
  | { kind: 'close' };

/**
 * How long a room may go untouched before it is swept up.
 *
 * Rooms are touched by every state change and by a heartbeat from anyone with
 * the room open, so "untouched" really does mean nobody is looking at it. A
 * closed tab stops the heartbeat; presence catches most of those within
 * seconds, and this catches the rest — a tab closed while the browser was
 * offline, a client that never reported leaving, a room whose whole roster
 * went at once.
 */
export const IDLE_CLOSE_MS = 15 * 60_000;

export interface HostWatchInput {
  session: Pick<GameSession, 'id' | 'host_id'> & { updated_at?: string | null };
  players: Pick<GamePlayer, 'profile_id' | 'seat'>[];
  presence: Map<UUID, Presence>;
  /** Whoever is asking. Only one client should act, and this decides which. */
  me: UUID;
  /**
   * Everyone connected right now, so a room whose own roster has all gone
   * still has somebody to tidy it up.
   */
  online?: UUID[];
  /** Injected so "how stale is this" can be tested without waiting. */
  now?: number;
}

/**
 * Decide what this client should do, if anything.
 *
 * Every client runs this against the same facts, so it has to pick a single
 * actor or they will all write at once.
 */
export function hostAction({
  session,
  players,
  presence,
  me,
  online = [],
  now = Date.now(),
}: HostWatchInput): HostAction {
  const alive = (id: UUID) => (presence.get(id) ?? 'offline') !== 'offline';

  // Presence arrives a moment after the page does, and an empty roster makes
  // every room in the lobby look abandoned. Until this client can see itself
  // in it, the map is not evidence of anything.
  if (presence.size > 0 && !alive(me)) return { kind: 'none' };

  // Seat order is join order, so this is "whoever has been here longest".
  const survivors = [...players]
    .filter((p) => p.profile_id !== session.host_id)
    .filter((p) => alive(p.profile_id))
    .sort((a, b) => a.seat - b.seat);

  const anybodyLeft = alive(session.host_id) || survivors.length > 0;

  // An empty room is litter, and so is one everybody has walked away from.
  // Either way it should not still be advertising itself in the lobby.
  if (!anybodyLeft || isStale(session.updated_at, now)) {
    return sweeper(players, online, me) ? { kind: 'close' } : { kind: 'none' };
  }

  if (alive(session.host_id)) return { kind: 'none' };

  const heir = survivors[0];
  // Only the heir writes; everyone else waits for the change to arrive.
  if (heir.profile_id !== me) return { kind: 'none' };
  return { kind: 'promote', to: heir.profile_id };
}

/** Has nothing happened in this room for long enough to call it abandoned? */
export function isStale(updatedAt: string | null | undefined, now: number): boolean {
  if (!updatedAt) return false;
  const at = Date.parse(updatedAt);
  return Number.isFinite(at) && now - at > IDLE_CLOSE_MS;
}

/**
 * Whether this client is the one that does the tidying.
 *
 * Somebody still in the room does it if there is anybody; otherwise the
 * lowest-sorting person online, so a room whose whole roster has gone still
 * gets cleared away — and exactly once, however many people are watching the
 * lobby.
 */
function sweeper(
  players: Pick<GamePlayer, 'profile_id'>[],
  online: UUID[],
  me: UUID,
): boolean {
  const inside = players
    .map((p) => p.profile_id)
    .filter((id) => online.includes(id))
    .sort();
  if (inside.length > 0) return inside[0] === me;

  // Nobody from the room is connected, so whoever is around does it. Keeping
  // "still in it" as a requirement is what let empty rooms pile up: the last
  // person out is precisely the person no longer there to tidy.
  if (players.some((p) => p.profile_id === me)) return true;
  const sorted = [...online].sort();
  return sorted.length > 0 ? sorted[0] === me : false;
}
