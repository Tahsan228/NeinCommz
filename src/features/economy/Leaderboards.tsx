import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { useEconomy, type MatchResult } from '../../state/economy';
import { Avatar, Modal, Spinner } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { isRated, rankFor } from './elo';
import { buildRows, since, type Period } from './leaderboard';

type GameId = 'all' | 'haxball' | 'tictactoe' | 'gartic' | 'chess';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

const GAMES: { id: GameId; label: string; icon: IconName }[] = [
  { id: 'all', label: 'Everything', icon: 'trophy' },
  { id: 'haxball', label: 'Haxball', icon: 'football' },
  { id: 'chess', label: 'Chess', icon: 'chess' },
  { id: 'tictactoe', label: 'Tic-Tac-Toe', icon: 'grid' },
  { id: 'gartic', label: 'Gartic', icon: 'palette' },
];

export function Leaderboards({ onClose }: { onClose: () => void }) {
  const { profile } = useSession();
  const { byId, profiles } = useDirectory();
  const { stats } = useEconomy();

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

  const rows = useMemo(
    () =>
      buildRows({
        // Everyone gets a row, played or not — a board of zeroes says more
        // than an empty panel, and shows who is actually here.
        everyone: profiles.map((p) => p.id),
        period,
        game,
        stats,
        results: results ?? [],
      }),
    [profiles, period, game, stats, results],
  );

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
        <div className="empty">Nobody has a profile yet.</div>
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
              <div
                className="lb-row"
                key={row.id}
                data-me={row.id === profile?.id}
                data-quiet={row.played === 0}
              >
                <span className="lb-pos" data-top={i < 3 && row.played > 0}>
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
                      {row.played === 0
                        ? 'Has not played yet'
                        : `${row.won}W · ${row.lost}L · ${row.drawn}D · ${winPct}%`}
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

      {rows.every((r) => r.played === 0) && (
        <p className="row-sub" style={{ marginTop: 12 }}>
          Nothing played {period === 'all' ? 'yet' : 'in this window'}. Everyone starts level.
        </p>
      )}
    </Modal>
  );
}
