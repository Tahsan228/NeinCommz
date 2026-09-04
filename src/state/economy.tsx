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
import type { UUID } from '../lib/types';
import { useSession } from './session';

export interface ShopItem {
  id: string;
  name: string;
  kind: 'trail' | 'goalfx' | 'celebration' | 'ball';
  price: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  is_default: boolean;
  blurb: string | null;
}

export interface GameStats {
  profile_id: UUID;
  game: string;
  elo: number;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  score_for: number;
  streak: number;
  best_streak: number;
}

export interface MatchResult {
  id: string;
  session_id: UUID;
  profile_id: UUID;
  game: string;
  outcome: 'win' | 'loss' | 'draw';
  elo_delta: number;
  coins: number;
  score: number;
  created_at: string;
}

export interface Outcome {
  profile_id: UUID;
  outcome: 'win' | 'loss' | 'draw';
  score?: number;
}

interface EconomyApi {
  items: ShopItem[];
  owned: Set<string>;
  stats: GameStats[];
  statFor: (profileId: UUID, game: string) => GameStats | null;
  equipped: Record<string, string>;
  equippedOf: (profileId: UUID) => Record<string, string>;
  buy: (itemId: string) => Promise<string | null>;
  equip: (kind: string, itemId: string) => Promise<void>;
  /** Report a finished match. Safe to call twice: the database ignores repeats. */
  award: (sessionId: UUID, outcomes: Outcome[]) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<EconomyApi | null>(null);

export function EconomyProvider({ children }: { children: ReactNode }) {
  const { session, profile, refreshProfile } = useSession();
  const me = profile?.id;

  const [items, setItems] = useState<ShopItem[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<GameStats[]>([]);
  const [equippedAll, setEquippedAll] = useState<Map<UUID, Record<string, string>>>(new Map());

  const reload = useCallback(async () => {
    if (!session) return;
    const [{ data: shop }, { data: inv }, { data: gs }, { data: eq }] = await Promise.all([
      supabase.from('shop_items').select('*').order('kind').order('price'),
      supabase.from('inventory').select('item_id').eq('profile_id', me ?? ''),
      supabase.from('game_stats').select('*'),
      supabase.from('profiles').select('id, equipped'),
    ]);

    setItems((shop as ShopItem[]) ?? []);
    setOwned(new Set(((inv as { item_id: string }[]) ?? []).map((r) => r.item_id)));
    setStats((gs as GameStats[]) ?? []);
    setEquippedAll(
      new Map(
        ((eq as { id: UUID; equipped: Record<string, string> }[]) ?? []).map((r) => [
          r.id,
          r.equipped ?? {},
        ]),
      ),
    );
  }, [session, me]);

  useEffect(() => {
    if (!session) return;
    void reload();
    const ch = supabase
      .channel('economy')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_stats' }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => void reload())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [session, reload]);

  const statIndex = useMemo(() => {
    const m = new Map<string, GameStats>();
    for (const s of stats) m.set(`${s.profile_id}:${s.game}`, s);
    return m;
  }, [stats]);

  const buy = useCallback(
    async (itemId: string) => {
      const { error } = await supabase.rpc('purchase', { p_item: itemId });
      if (error) return error.message.includes('not enough') ? 'Not enough coins.' : error.message;
      await Promise.all([reload(), refreshProfile()]);
      return null;
    },
    [reload, refreshProfile],
  );

  const equip = useCallback(
    async (kind: string, itemId: string) => {
      await supabase.rpc('equip_item', { p_kind: kind, p_item: itemId });
      await Promise.all([reload(), refreshProfile()]);
    },
    [reload, refreshProfile],
  );

  const award = useCallback(
    async (sessionId: UUID, outcomes: Outcome[]) => {
      if (!outcomes.length) return;
      // The database is the authority here — it recomputes ratings itself and
      // refuses to pay out the same session twice.
      await supabase.rpc('award_match', {
        p_session: sessionId,
        p_outcomes: outcomes.map((o) => ({ ...o, score: o.score ?? 0 })),
      });
      await Promise.all([reload(), refreshProfile()]);
    },
    [reload, refreshProfile],
  );

  const value = useMemo<EconomyApi>(
    () => ({
      items,
      owned,
      stats,
      statFor: (pid, game) => statIndex.get(`${pid}:${game}`) ?? null,
      equipped: (profile?.equipped as Record<string, string>) ?? {},
      equippedOf: (pid) => equippedAll.get(pid) ?? {},
      buy,
      equip,
      award,
      reload,
    }),
    [items, owned, stats, statIndex, profile?.equipped, equippedAll, buy, equip, award, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEconomy(): EconomyApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useEconomy outside EconomyProvider');
  return c;
}
