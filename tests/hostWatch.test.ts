import { describe, expect, it } from 'vitest';
import { hostAction } from '../src/features/games/hostWatch';
import type { Presence, UUID } from '../src/lib/types';

const room = { id: 'room', host_id: 'host' };

const seats = (...ids: string[]) => ids.map((profile_id, seat) => ({ profile_id, seat }));

const online = (...ids: string[]): Map<UUID, Presence> =>
  new Map(ids.map((id) => [id, 'online' as Presence]));

describe('when the host is still here', () => {
  it('does nothing at all', () => {
    const action = hostAction({
      session: room,
      players: seats('host', 'ann'),
      presence: online('host', 'ann'),
      me: 'ann',
    });
    expect(action.kind).toBe('none');
  });

  it('does nothing while the host is merely away', () => {
    const action = hostAction({
      session: room,
      players: seats('host', 'ann'),
      presence: new Map<UUID, Presence>([['host', 'away'], ['ann', 'online']]),
      me: 'ann',
    });
    expect(action.kind).toBe('none');
  });
});

describe('when the host has gone', () => {
  it('hands the room to whoever has been in it longest', () => {
    const action = hostAction({
      session: room,
      players: seats('host', 'ann', 'ben'),
      presence: online('ann', 'ben'),
      me: 'ann',
    });
    expect(action).toEqual({ kind: 'promote', to: 'ann' });
  });

  it('tells everybody else to sit still, so two people cannot both take it', () => {
    const players = seats('host', 'ann', 'ben');
    const presence = online('ann', 'ben');

    // Every client runs the same check; only one of them may act.
    const actors = ['ann', 'ben'].map((me) => hostAction({ session: room, players, presence, me }));
    expect(actors.filter((a) => a.kind === 'promote')).toHaveLength(1);
  });

  it('skips an heir who has also left', () => {
    const action = hostAction({
      session: room,
      players: seats('host', 'ann', 'ben'),
      presence: online('ben'),
      me: 'ben',
    });
    expect(action).toEqual({ kind: 'promote', to: 'ben' });
  });

  it('closes a room nobody is left in', () => {
    const action = hostAction({
      session: room,
      players: seats('host', 'ann'),
      presence: online(),
      me: 'ann',
    });
    expect(action.kind).toBe('close');
  });

  it('will not let a passer-by close a room they were never in', () => {
    const action = hostAction({
      session: room,
      players: seats('host'),
      presence: online('bystander'),
      me: 'bystander',
    });
    expect(action.kind).toBe('none');
  });

  it('treats an unknown player as gone rather than as present', () => {
    // Presence carries only who is connected; absence is the default.
    const action = hostAction({
      session: room,
      players: seats('host', 'ann'),
      presence: new Map(),
      me: 'ann',
    });
    expect(action.kind).toBe('close');
  });
});
