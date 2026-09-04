import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { MAIN_ROOM, type Room, type RoomMember, type UUID } from '../lib/types';
import { useSession } from './session';

interface RoomsApi {
  rooms: Room[];
  membersOf: (roomId: UUID) => UUID[];
  activeId: UUID;
  setActiveId: (id: UUID) => void;
  active: Room | null;
  createGroup: (name: string, memberIds: UUID[]) => Promise<UUID | null>;
  openDm: (otherId: UUID) => Promise<UUID | null>;
  addMember: (roomId: UUID, profileId: UUID) => Promise<void>;
  removeMember: (roomId: UUID, profileId: UUID) => Promise<void>;
  updateRoom: (roomId: UUID, patch: Partial<Room>) => Promise<void>;
  leaveRoom: (roomId: UUID) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<RoomsApi | null>(null);

export function RoomsProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  const me = profile?.id;

  const [rooms, setRooms] = useState<Room[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [activeId, setActiveId] = useState<UUID>(MAIN_ROOM);

  const reload = useCallback(async () => {
    if (!me) return;
    // Row-level security already limits both of these to rooms this person
    // belongs to, so there is nothing to filter client-side.
    const [{ data: r }, { data: m }] = await Promise.all([
      supabase.from('rooms').select('*').order('created_at'),
      supabase.from('room_members').select('*'),
    ]);
    setRooms((r as Room[]) ?? []);
    setMembers((m as RoomMember[]) ?? []);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    void reload();
    const ch = supabase
      .channel('rooms:index')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members' }, () =>
        void reload(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [me, reload]);

  const byRoom = useMemo(() => {
    const map = new Map<UUID, UUID[]>();
    for (const m of members) {
      const list = map.get(m.room_id);
      if (list) list.push(m.profile_id);
      else map.set(m.room_id, [m.profile_id]);
    }
    return map;
  }, [members]);

  // If the active room disappears — you were removed, or it was deleted —
  // fall back to Main rather than staring at an empty thread.
  useEffect(() => {
    if (rooms.length && !rooms.some((r) => r.id === activeId)) setActiveId(MAIN_ROOM);
  }, [rooms, activeId]);

  const createGroup = useCallback(
    async (name: string, memberIds: UUID[]) => {
      if (!me) return null;
      const { data, error } = await supabase
        .from('rooms')
        .insert({ name: name.trim() || 'New group', kind: 'group', created_by: me })
        .select()
        .single();
      if (error || !data) return null;

      const room = data as Room;
      const everyone = Array.from(new Set([me, ...memberIds]));
      await supabase
        .from('room_members')
        .insert(everyone.map((profile_id) => ({ room_id: room.id, profile_id })));

      await reload();
      setActiveId(room.id);
      return room.id;
    },
    [me, reload],
  );

  const openDm = useCallback(
    async (otherId: UUID) => {
      if (!me || otherId === me) return null;

      // A DM already exists if some two-person dm room holds exactly us.
      const existing = rooms.find((r) => {
        if (r.kind !== 'dm') return false;
        const ids = byRoom.get(r.id) ?? [];
        return ids.length === 2 && ids.includes(me) && ids.includes(otherId);
      });
      if (existing) {
        setActiveId(existing.id);
        return existing.id;
      }

      const { data, error } = await supabase
        .from('rooms')
        .insert({ name: 'Direct message', kind: 'dm', created_by: me })
        .select()
        .single();
      if (error || !data) return null;

      const room = data as Room;
      await supabase.from('room_members').insert([
        { room_id: room.id, profile_id: me },
        { room_id: room.id, profile_id: otherId },
      ]);

      await reload();
      setActiveId(room.id);
      return room.id;
    },
    [me, rooms, byRoom, reload],
  );

  const addMember = useCallback(
    async (roomId: UUID, profileId: UUID) => {
      await supabase.from('room_members').upsert(
        { room_id: roomId, profile_id: profileId },
        { onConflict: 'room_id,profile_id', ignoreDuplicates: true },
      );
      await reload();
    },
    [reload],
  );

  const removeMember = useCallback(
    async (roomId: UUID, profileId: UUID) => {
      // Main is the room everyone shares; nobody gets pushed out of it.
      if (roomId === MAIN_ROOM) return;
      await supabase.from('room_members').delete().match({ room_id: roomId, profile_id: profileId });
      await reload();
    },
    [reload],
  );

  const updateRoom = useCallback(
    async (roomId: UUID, patch: Partial<Room>) => {
      await supabase.from('rooms').update(patch).eq('id', roomId);
      await reload();
    },
    [reload],
  );

  const leaveRoom = useCallback(
    async (roomId: UUID) => {
      if (!me || roomId === MAIN_ROOM) return;
      await supabase.from('room_members').delete().match({ room_id: roomId, profile_id: me });
      setActiveId(MAIN_ROOM);
      await reload();
    },
    [me, reload],
  );

  const value = useMemo<RoomsApi>(
    () => ({
      rooms,
      membersOf: (id: UUID) => byRoom.get(id) ?? [],
      activeId,
      setActiveId,
      active: rooms.find((r) => r.id === activeId) ?? null,
      createGroup,
      openDm,
      addMember,
      removeMember,
      updateRoom,
      leaveRoom,
      reload,
    }),
    [rooms, byRoom, activeId, createGroup, openDm, addMember, removeMember, updateRoom, leaveRoom, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRooms(): RoomsApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRooms outside RoomsProvider');
  return c;
}

/**
 * What to call a room, and what to show beside it.
 *
 * A direct message has no name of its own — it is simply "the conversation
 * with that person" — so it borrows the other person's name and picture.
 */
export function describeRoom(
  room: Room,
  memberIds: UUID[],
  me: UUID | undefined,
  nameOf: (id: UUID) => string,
  avatarOf: (id: UUID) => { emoji: string; url: string | null; color: string },
): { title: string; emoji: string; url: string | null; color: string; subtitle: string } {
  if (room.kind === 'dm') {
    const other = memberIds.find((id) => id !== me) ?? me ?? '';
    const av = avatarOf(other);
    return { title: nameOf(other), ...av, subtitle: 'Direct message' };
  }

  return {
    title: room.name,
    emoji: room.icon_emoji || '💬',
    url: room.icon_url,
    color: '#4a9de0',
    subtitle: `${memberIds.length} ${memberIds.length === 1 ? 'member' : 'members'}`,
  };
}
