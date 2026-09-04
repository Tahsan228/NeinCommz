import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression test for the bug that made every game unopenable.
 *
 * `useGameRoom` starts with `session === null`, and the overlay closes itself
 * whenever the session is null — so before this hook reported a loading state,
 * the overlay slammed shut on its very first render, before the fetch had even
 * come back. `loading` is what lets a caller tell "not fetched yet" apart from
 * "this room is gone".
 */

let resolveSession: (v: unknown) => void;
let resolvePlayers: (v: unknown) => void;

vi.mock('../src/lib/supabase', () => {
  const chain = (settle: Promise<unknown>) => {
    const o: Record<string, unknown> = {};
    o.select = () => o;
    o.eq = () => o;
    o.order = () => settle;
    o.maybeSingle = () => settle;
    return o;
  };

  const channel = () => {
    const ch: Record<string, unknown> = {};
    ch.on = () => ch;
    ch.subscribe = () => ch;
    return ch;
  };

  return {
    supabase: {
      from: (table: string) =>
        chain(
          table === 'game_sessions'
            ? new Promise((r) => (resolveSession = r))
            : new Promise((r) => (resolvePlayers = r)),
        ),
      channel,
      removeChannel: () => Promise.resolve('ok'),
    },
  };
});

const { useGameRoom } = await import('../src/features/games/room');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useGameRoom', () => {
  it('reports loading before the first fetch settles, so callers do not treat a null session as a closed room', async () => {
    const { result } = renderHook(() => useGameRoom('room-1'));

    // The exact state that used to slam the overlay shut on mount.
    expect(result.current.loading).toBe(true);
    expect(result.current.session).toBeNull();

    resolveSession({ data: { id: 'room-1', game: 'tictactoe', status: 'lobby' } });
    resolvePlayers({ data: [{ session_id: 'room-1', profile_id: 'p1', seat: 0, team: 0 }] });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toMatchObject({ id: 'room-1', game: 'tictactoe' });
    expect(result.current.players).toHaveLength(1);
  });

  it('settles to a null session when the room genuinely does not exist', async () => {
    const { result } = renderHook(() => useGameRoom('room-gone'));

    resolveSession({ data: null });
    resolvePlayers({ data: [] });

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Only now is null meaningful — and only now should a caller close.
    expect(result.current.session).toBeNull();
    expect(result.current.players).toEqual([]);
  });
});
