import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import type { Presence, Profile, ScheduleBlock, UUID } from '../lib/types';
import { useSession } from './session';

interface DirectoryApi {
  profiles: Profile[];
  byId: Map<UUID, Profile>;
  blocks: ScheduleBlock[];
  /** Everyone's schedule, keyed by profile. */
  blocksFor: (id: UUID) => ScheduleBlock[];
  presence: Map<UUID, Presence>;
  online: boolean;
  reloadBlocks: () => Promise<void>;
}

const Ctx = createContext<DirectoryApi | null>(null);

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const { session, profile, prefs } = useSession();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [presence, setPresence] = useState<Map<UUID, Presence>>(new Map());
  const [online, setOnline] = useState(true);
  const idleRef = useRef<number>(Date.now());

  const uid = session?.user?.id;

  /* ---------------------------------------------------------- profiles -- */
  useEffect(() => {
    if (!uid) return;
    let alive = true;

    const load = async () => {
      const { data } = await supabase.from('profiles').select('*').order('created_at');
      if (alive && data) setProfiles(data as Profile[]);
    };
    void load();

    const ch = supabase
      .channel('dir:profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void load())
      .subscribe();

    return () => {
      alive = false;
      void supabase.removeChannel(ch);
    };
  }, [uid]);

  /* --------------------------------------------------------- schedules -- */
  const loadBlocks = useMemo(
    () => async () => {
      const { data } = await supabase.from('schedule_blocks').select('*').order('start_min');
      if (data) setBlocks(data as ScheduleBlock[]);
    },
    [],
  );

  useEffect(() => {
    if (!uid) return;
    void loadBlocks();
    const ch = supabase
      .channel('dir:blocks')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schedule_blocks' },
        () => void loadBlocks(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [uid, loadBlocks]);

  /* ---------------------------------------------------------- presence -- */
  // A single shared channel carries who is here. "Away" is decided locally
  // from input idleness and broadcast, rather than inferred by everyone else,
  // so the away timeout is a per-person preference.
  useEffect(() => {
    if (!uid || !profile) return;

    const ch = supabase.channel('roster', { config: { presence: { key: uid } } });

    const recompute = () => {
      const state = ch.presenceState() as Record<string, Array<{ active?: boolean }>>;
      const next = new Map<UUID, Presence>();
      for (const [id, metas] of Object.entries(state)) {
        const anyActive = metas.some((m) => m.active !== false);
        next.set(id, anyActive ? 'online' : 'away');
      }
      setPresence(next);
    };

    ch.on('presence', { event: 'sync' }, recompute)
      .on('presence', { event: 'join' }, recompute)
      .on('presence', { event: 'leave' }, recompute)
      .subscribe((status) => {
        setOnline(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') void ch.track({ active: true, at: Date.now() });
      });

    const markActive = () => {
      idleRef.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'pointermove', 'focus'] as const;
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));

    // Re-publish roughly every 20s so a stale "away" flips back promptly.
    let wasActive = true;
    const tick = window.setInterval(() => {
      const idleMs = Date.now() - idleRef.current;
      const isActive =
        prefs.shareStatus && !document.hidden && idleMs < Math.max(1, prefs.awayAfterMin) * 60_000;
      if (isActive !== wasActive) {
        wasActive = isActive;
        void ch.track({ active: isActive, at: Date.now() });
      }
    }, 5_000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, markActive));
      window.clearInterval(tick);
      void supabase.removeChannel(ch);
    };
  }, [uid, profile?.id, prefs.awayAfterMin, prefs.shareStatus, profile]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const blocksByProfile = useMemo(() => {
    const m = new Map<UUID, ScheduleBlock[]>();
    for (const b of blocks) {
      const list = m.get(b.profile_id);
      if (list) list.push(b);
      else m.set(b.profile_id, [b]);
    }
    return m;
  }, [blocks]);

  const value = useMemo<DirectoryApi>(
    () => ({
      profiles,
      byId,
      blocks,
      blocksFor: (id: UUID) => blocksByProfile.get(id) ?? [],
      presence,
      online,
      reloadBlocks: loadBlocks,
    }),
    [profiles, byId, blocks, blocksByProfile, presence, online, loadBlocks],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDirectory(): DirectoryApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDirectory outside DirectoryProvider');
  return c;
}

/** Presence for one person, defaulting to offline when they are not in the roster. */
export function presenceOf(map: Map<UUID, Presence>, id: UUID): Presence {
  return map.get(id) ?? 'offline';
}
