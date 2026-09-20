import { describe, expect, it } from 'vitest';
import { IDLE_CLOSE_MS, hostAction, isStale } from '../src/features/games/hostWatch';
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

describe('when nobody is around at all', () => {
  it('lets a passer-by clear away a room whose whole roster has gone', () => {
    // The last person out is precisely the person no longer there to tidy,
    // so requiring the sweeper to be in the room left empties in the lobby.
    const action = hostAction({
      session: room,
      players: seats('host', 'ann'),
      presence: online('cass'),
      me: 'cass',
      online: ['cass'],
    });
    expect(action.kind).toBe('close');
  });

  it('picks exactly one sweeper, however many people are watching', () => {
    const watchers = ['cass', 'dev', 'eli'];
    const actions = watchers.map((me) =>
      hostAction({
        session: room,
        players: seats('host'),
        presence: online(...watchers),
        me,
        online: watchers,
      }),
    );
    expect(actions.filter((a) => a.kind === 'close')).toHaveLength(1);
  });

  it('prefers somebody still in the room to a bystander', () => {
    // Host gone, ann gone, ben still connected but not in the room.
    const players = seats('host', 'ann');
    const presence = online('ben');
    expect(
      hostAction({ session: room, players, presence, me: 'ann', online: ['ben'] }).kind,
    ).toBe('none');
    expect(
      hostAction({ session: room, players, presence, me: 'ben', online: ['ben'] }).kind,
    ).toBe('close');
  });
});

describe('when a room has gone quiet', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');

  it('closes one that has not been touched for a quarter of an hour', () => {
    const action = hostAction({
      session: { ...room, updated_at: new Date(now - IDLE_CLOSE_MS - 1000).toISOString() },
      players: seats('host', 'ann'),
      presence: online('host', 'ann'),
      me: 'ann',
      online: ['host', 'ann'],
      now,
    });
    expect(action.kind).toBe('close');
  });

  it('leaves a room alone while somebody is still touching it', () => {
    const action = hostAction({
      session: { ...room, updated_at: new Date(now - 60_000).toISOString() },
      players: seats('host', 'ann'),
      presence: online('host', 'ann'),
      me: 'ann',
      online: ['host', 'ann'],
      now,
    });
    expect(action.kind).toBe('none');
  });

  it('treats a room with no timestamp as fresh rather than as ancient', () => {
    expect(isStale(null, now)).toBe(false);
    expect(isStale('not a date', now)).toBe(false);
    expect(isStale(new Date(now - IDLE_CLOSE_MS - 1).toISOString(), now)).toBe(true);
  });
});

describe('before presence has settled', () => {
  it('does nothing at all', () => {
    // A page that has just loaded sees a roster it is not in yet, and every
    // room in the lobby looks abandoned. Deleting them all would be a poor
    // way to start a session.
    const action = hostAction({
      session: room,
      players: seats('host', 'ann'),
      presence: online('host', 'ann'),
      me: 'newcomer',
      online: ['newcomer'],
    });
    expect(action.kind).toBe('none');
  });
});
