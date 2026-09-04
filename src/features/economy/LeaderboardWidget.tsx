import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { useEconomy, type MatchResult } from '../../state/economy';
import { Avatar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { isRated, rankFor } from './elo';
import { buildRows, since, type Period } from './leaderboard';

const GAMES = [
  { id: 'all', label: 'All' },
  { id: 'haxball', label: 'Haxball' },
  { id: 'chess', label: 'Chess' },
  { id: 'tictactoe', label: 'Tic-tac-toe' },
  { id: 'gartic', label: 'Gartic' },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All time' },
];

/**
 * The standing on the page, rather than behind a button.
 *
 * A compact top five; the full table with every column is a click away. Kept
 * narrow enough to live in the side column without wrapping.
 */
export function LeaderboardWidget({ onExpand }: { onExpand: () => void }) {
  const { profile } = useSession();
  const { profiles, byId } = useDirectory();
  const { stats } = useEconomy();

  const [period, setPeriod] = useState<Period>('week');
  const [game, setGame] = useState('all');
  const [results, setResults] = useState<MatchResult[]>([]);

  useEffect(() => {
    if (period === 'all') {
      setResults([]);
      return;
    }
    const from = since(period)!;
    void supabase
      .from('match_results')
      .select('*')
      .gte('created_at', from.toISOString())
      .order('created_at', { ascending: false })
      .limit(2000)
      .then(({ data }) => setResults((data as MatchResult[]) ?? []));
  }, [period]);

  const rows = useMemo(
    () =>
      buildRows({
        everyone: profiles.map((p) => p.id),
        period,
        game,
        stats,
        results,
      }),
    [profiles, period, game, stats, results],
  );

  const rated = game !== 'all' && isRated(game);
  const top = rows.slice(0, 5);

  return (
    <div className="lbw">
      <div className="lbw-controls">
        <select
          className="select lbw-select"
          value={game}
          onChange={(e) => setGame(e.target.value)}
          aria-label="Game"
        >
          {GAMES.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <select
          className="select lbw-select"
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          aria-label="Period"
        >
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {top.length === 0 ? (
        <div className="empty">Nobody has a profile yet.</div>
      ) : (
        <div className="lbw-rows">
          {top.map((row, i) => {
            const p = byId.get(row.id);
            const rank = rated ? rankFor(row.elo) : null;
            return (
              <div className="lbw-row" key={row.id} data-me={row.id === profile?.id}>
                <span className="lbw-pos" data-top={i < 3 && row.played > 0}>
                  {i + 1}
                </span>
                <Avatar
                  emoji={p?.avatar_emoji ?? '🙂'}
                  url={p?.avatar_url}
                  color={p?.avatar_color ?? '#555'}
                  size={24}
                  name={p?.display_name}
                />
                <span className="lbw-name">{p?.display_name ?? 'Someone'}</span>

                <span className="lbw-value" data-quiet={row.played === 0}>
                  {rated ? (
                    <b style={rank ? { color: rank.color } : undefined}>{row.elo}</b>
                  ) : period === 'all' ? (
                    <b>{row.won}</b>
                  ) : (
                    <b>{row.coins}</b>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <button className="btn btn-sm btn-ghost lbw-more" onClick={onExpand}>
        <Icon name="trophy" size={14} />
        Full table
      </button>
    </div>
  );
}
