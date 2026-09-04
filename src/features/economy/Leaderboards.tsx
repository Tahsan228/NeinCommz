import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { UUID } from '../../lib/types';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { useEconomy, type MatchResult } from '../../state/economy';
import { Avatar, Modal, Spinner } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { isRated, rankFor } from './elo';

type Period = 'today' | 'week' | 'month' | 'all';
type GameId = 'all' | 'haxball' | 'tictactoe' | 'gartic' | 'chess';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

const GAMES: { id: GameId; label: string; icon: IconName }[] = [
  { id: 'all', label: 'Everything', icon: 'sparkle' },
  { id: 'haxball', label: 'Haxball', icon: 'football' },
  { id: 'chess', label: 'Chess', icon: 'grid' },
  { id: 'tictactoe', label: 'Tic-Tac-Toe', icon: 'grid' },
  { id: 'gartic', label: 'Gartic', icon: 'palette' },
];

/** Start of the window, or null for all time. */
function since(period: Period): Date | null {
  const d = new Date();
  if (period === 'today') {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'week') {
    // Monday as the start of the week; Sunday counts as the end of one.
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'month') {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return null;
}

interface Row {
  id: UUID;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  score: number;
  coins: number;
  eloDelta: number;
  elo: number;
  streak: number;
}

export function Leaderboards({ onClose }: { onClose: () => void }) {
  const { profile } = useSession();
  const { byId, profiles } = useDirectory();
  const { stats, statFor } = useEconomy();

  const [period, setPeriod] = useState<Period>('week');
  const [game, setGame] = useState<GameId>('all');
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Aggregate stats carry no dates, so anything narrower than "all time" has
  // to be rebuilt from the per-match rows.
  useEffect(() => {
    if (period === 'all') {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const from = since(period)!;
    void supabase
      .from('match_results')
      .select('*')
      .gte('created_at', from.toISOString())
      .order('created_at', { ascending: false })
      .limit(2000)
      .then(({ data }) => {
        setResults((data as MatchResult[]) ?? []);
        setLoading(false);
      });
  }, [period]);

  const rows = useMemo<Row[]>(() => {
    const map = new Map<UUID, Row>();
    const blank = (id: UUID): Row => ({
      id,
      played: 0,
      won: 0,
      lost: 0,
      drawn: 0,
      score: 0,
      coins: 0,
      eloDelta: 0,
      elo: 0,
      streak: 0,
    });

    if (period === 'all') {
      for (const s of stats) {
        if (game !== 'all' && s.game !== game) continue;
        const row = map.get(s.profile_id) ?? blank(s.profile_id);
        row.played += s.played;
        row.won += s.won;
        row.lost += s.lost;
        row.drawn += s.drawn;
        row.score += s.score_for;
        row.streak = Math.max(row.streak, s.best_streak);
        // Across several games an average rating is the only honest summary.
        row.elo = game === 'all' ? Math.max(row.elo, s.elo) : s.elo;
        map.set(s.profile_id, row);
      }
    } else {
      for (const r of results ?? []) {
        if (game !== 'all' && r.game !== game) continue;
        const row = map.get(r.profile_id) ?? blank(r.profile_id);
        row.played++;
        if (r.outcome === 'win') row.won++;
        else if (r.outcome === 'loss') row.lost++;
        else row.drawn++;
        row.score += r.score;
        row.coins += r.coins;
        row.eloDelta += r.elo_delta;
        map.set(r.profile_id, row);
      }
      for (const row of map.values()) {
        const s = game === 'all' ? null : statFor(row.id, game);
        row.elo = s?.elo ?? 0;
      }
    }

    return [...map.values()].sort((a, b) => {
      // Within a window, who actually won things; all-time, who is rated best.
      if (period === 'all' && game !== 'all' && isRated(game)) return b.elo - a.elo;
      if (b.won !== a.won) return b.won - a.won;
      if (b.played !== a.played) return b.played - a.played;
      return b.score - a.score;
    });
  }, [period, game, stats, results, statFor]);

  const ratedColumn = game !== 'all' && isRated(game);

  return (
    <Modal
      title="Leaderboards"
      onClose={onClose}
      wide
    >
      <div className="settings-nav" style={{ margin: '-18px -18px 12px' }}>
        {GAMES.map((g) => (
          <button
            key={g.id}
            className="settings-tab"
            data-on={game === g.id}
            onClick={() => setGame(g.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
          >
            <Icon name={g.icon} size={15} />
            {g.label}
          </button>
        ))}
      </div>

      <div className="seg">
        {PERIODS.map((p) => (
          <button key={p.id} data-on={period === p.id} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="centered" style={{ height: 160 }}>
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          Nothing recorded {period === 'all' ? 'yet' : 'in that window'}.
          <br />
          Play a game and it will show up here.
        </div>
      ) : (
        <div className="lb">
          <div className="lb-head">
            <span>#</span>
            <span>Player</span>
            <span>{ratedColumn ? 'Rating' : 'W/L/D'}</span>
            <span>{period === 'all' ? 'Played' : 'Coins'}</span>
          </div>

          {rows.map((row, i) => {
            const p = byId.get(row.id);
            const rank = ratedColumn ? rankFor(row.elo) : null;
            const winPct = row.played ? Math.round((row.won / row.played) * 100) : 0;

            return (
              <div className="lb-row" key={row.id} data-me={row.id === profile?.id}>
                <span className="lb-pos" data-top={i < 3}>
                  {i + 1}
                </span>

                <span className="lb-who">
                  <Avatar
                    emoji={p?.avatar_emoji ?? '🙂'}
                    url={p?.avatar_url}
                    color={p?.avatar_color ?? '#555'}
                    size={28}
                    name={p?.display_name}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span className="lb-name">{p?.display_name ?? 'Someone'}</span>
                    <span className="lb-sub">
                      {row.won}W · {row.lost}L · {row.drawn}D · {winPct}%
                    </span>
                  </span>
                </span>

                <span>
                  {ratedColumn ? (
                    <span className="lb-elo">
                      <b>{row.elo}</b>
                      {rank && <span style={{ color: rank.color }}>{rank.name}</span>}
                      {period !== 'all' && row.eloDelta !== 0 && (
                        <span className={row.eloDelta > 0 ? 'delta-up' : 'delta-down'}>
                          {row.eloDelta > 0 ? '+' : ''}
                          {row.eloDelta}
                        </span>
                      )}
                    </span>
                  ) : (
                    <b>
                      {row.won}/{row.lost}/{row.drawn}
                    </b>
                  )}
                </span>

                <span>
                  <b>{period === 'all' ? row.played : row.coins.toLocaleString()}</b>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {game === 'gartic' && (
        <p className="row-sub" style={{ marginTop: 12 }}>
          Gartic has no winner to speak of, so it pays coins and counts games
          rather than moving a rating.
        </p>
      )}

      {profiles.length > 0 && rows.length < profiles.length && period === 'all' && (
        <p className="row-sub" style={{ marginTop: 12 }}>
          Only people who have finished a game appear here.
        </p>
      )}
    </Modal>
  );
}
