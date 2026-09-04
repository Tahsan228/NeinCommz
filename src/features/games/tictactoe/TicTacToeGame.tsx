import { useMemo, useRef, useState } from 'react';
import { errText, supabase } from '../../../lib/supabase';
import type { GamePlayer, GameSession, Profile, UUID } from '../../../lib/types';
import { Avatar } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { setState } from '../lobby';
import { useEconomy } from '../../../state/economy';
import { emptyBoard, winningLine, type Board, type Mark } from './rules';
import {
  buildBracket,
  champion,
  recordResult,
  roundName,
  type Bracket,
} from './tournament';

type Mode = 'series' | 'knockout';

interface TttState {
  board: Board;
  turn: Mark;
  x: UUID | null;
  o: UUID | null;
  winner: Mark | 'draw' | null;
  mode: Mode;
  bestOf: number;
  /**
   * Wins keyed by PROFILE ID, never by mark. The marks swap between games, so
   * an X/O tally hands the next person to play X the previous player's wins —
   * which is exactly the bug this replaced.
   */
  wins: Record<UUID, number>;
  draws: number;
  game: number;
  bracket: Bracket | null;
}

function readState(s: Record<string, unknown>): TttState {
  return {
    board: (s.board as Board) ?? emptyBoard(),
    turn: (s.turn as Mark) ?? 'X',
    x: (s.x as UUID | null) ?? null,
    o: (s.o as UUID | null) ?? null,
    winner: (s.winner as TttState['winner']) ?? null,
    mode: (s.mode as Mode) ?? 'series',
    bestOf: (s.bestOf as number) ?? 3,
    wins: (s.wins as Record<UUID, number>) ?? {},
    draws: (s.draws as number) ?? 0,
    game: (s.game as number) ?? 1,
    bracket: (s.bracket as Bracket | null) ?? null,
  };
}

const needed = (bestOf: number) => Math.floor(bestOf / 2) + 1;

export function TicTacToeGame({
  session,
  players,
  profiles,
  me,
}: {
  session: GameSession;
  players: GamePlayer[];
  profiles: Map<UUID, Profile>;
  me: UUID;
}) {
  const { award } = useEconomy();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const state = useMemo(() => readState(session.state), [session.state]);
  // Stops two clients both advancing the same finished game.
  const advancedGame = useRef(-1);

  const ids = players.map((p) => p.profile_id);
  const assigned = Boolean(state.x && state.o);
  const myMark: Mark = state.x === me ? 'X' : state.o === me ? 'O' : '';
  const myTurn = assigned && myMark !== '' && state.turn === myMark && !state.winner;
  const line = winningLine(state.board);
  const isHost = session.host_id === me;

  const nameOf = (id: UUID | null) => (id ? profiles.get(id)?.display_name ?? '—' : '—');
  const winnerId = state.winner === 'X' ? state.x : state.winner === 'O' ? state.o : null;

  /* ------------------------------------------------------------- start -- */
  const startSeries = async (bestOf: number) => {
    if (ids.length < 2) return;
    await setState(
      session.id,
      {
        board: emptyBoard(),
        turn: 'X',
        x: ids[0],
        o: ids[1],
        winner: null,
        mode: 'series',
        bestOf,
        wins: {},
        draws: 0,
        game: 1,
        bracket: null,
      },
      'active',
    );
  };

  const startKnockout = async () => {
    if (ids.length < 2) return;
    const bracket = buildBracket(ids);
    const m = bracket.rounds[bracket.round][bracket.match];
    await setState(
      session.id,
      {
        board: emptyBoard(),
        turn: 'X',
        x: m.a,
        o: m.b,
        winner: null,
        mode: 'knockout',
        bestOf: 1,
        wins: {},
        draws: 0,
        game: 1,
        bracket,
      },
      'active',
    );
  };

  /* -------------------------------------------------------------- play -- */
  const play = async (cell: number) => {
    if (!myTurn || state.board[cell] !== '' || busy) return;
    setBusy(true);
    setError('');
    // The database applies the move, so a doctored board pushed from a console
    // is rejected rather than believed.
    const { error: e } = await supabase.rpc('ttt_move', { p_session: session.id, p_cell: cell });
    if (e) setError(errText(e));
    setBusy(false);
  };

  /* ------------------------------------------------------------ advance -- */
  const nextGame = async () => {
    if (!state.winner || advancedGame.current === state.game) return;
    advancedGame.current = state.game;

    const wins = { ...state.wins };
    let draws = state.draws;
    if (state.winner === 'draw') draws++;
    else if (winnerId) wins[winnerId] = (wins[winnerId] ?? 0) + 1;

    // Rate the game that just finished. Only the host reports it, and the
    // database ignores a repeat for the same session anyway.
    if (isHost && state.x && state.o) {
      const loserId = winnerId === state.x ? state.o : state.x;
      void award(
        session.id,
        winnerId
          ? [
              { profile_id: winnerId, outcome: 'win', score: 1 },
              { profile_id: loserId, outcome: 'loss', score: 0 },
            ]
          : [
              { profile_id: state.x, outcome: 'draw', score: 0 },
              { profile_id: state.o, outcome: 'draw', score: 0 },
            ],
      );
    }

    if (state.mode === 'knockout' && state.bracket) {
      // A draw is replayed rather than resolved, so nobody goes out on one.
      const bracket = recordResult(state.bracket, winnerId);
      const done = champion(bracket) !== null;
      const m = bracket.rounds[bracket.round]?.[bracket.match];

      await setState(
        session.id,
        {
          ...state,
          board: emptyBoard(),
          turn: 'X',
          x: done ? state.x : m?.a ?? null,
          o: done ? state.o : m?.b ?? null,
          winner: null,
          wins,
          draws,
          game: state.game + 1,
          bracket,
        },
        done ? 'done' : 'active',
      );
      return;
    }

    // Series: swap who goes first, and the loser takes X next game.
    await setState(
      session.id,
      {
        ...state,
        board: emptyBoard(),
        turn: 'X',
        x: state.o,
        o: state.x,
        winner: null,
        wins,
        draws,
        game: state.game + 1,
      },
      'active',
    );
  };

  const backToLobby = () =>
    void setState(
      session.id,
      { ...state, x: null, o: null, board: emptyBoard(), winner: null, bracket: null },
      'lobby',
    );

  /* ============================================================ lobby === */
  if (!assigned || session.status === 'lobby') {
    return (
      <>
        <div className="roster">
          {players.map((p) => {
            const pr = profiles.get(p.profile_id);
            return (
              <div className="roster-chip" key={p.profile_id}>
                <Avatar
                  emoji={pr?.avatar_emoji ?? '🙂'}
                  url={pr?.avatar_url}
                  color={pr?.avatar_color ?? '#555'}
                  size={22}
                  name={pr?.display_name}
                />
                {pr?.display_name ?? 'Someone'}
              </div>
            );
          })}
        </div>

        {ids.length < 2 ? (
          <div className="empty" style={{ maxWidth: 420 }}>
            Waiting for a second player — invite someone from the button up top.
          </div>
        ) : isHost ? (
          <div className="group" style={{ padding: 16, width: 'min(420px, 100%)' }}>
            <div className="label" style={{ padding: '0 0 10px' }}>How do you want to play?</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[3, 5, 7].map((n) => (
                <button key={n} className="btn" onClick={() => void startSeries(n)}>
                  <Icon name="play" size={15} />
                  Best of {n} — {nameOf(ids[0])} v {nameOf(ids[1])}
                </button>
              ))}

              <button
                className="btn btn-accent"
                disabled={ids.length < 3}
                onClick={() => void startKnockout()}
              >
                <Icon name="sparkle" size={15} />
                {ids.length < 3
                  ? 'Knockout needs 3+ players'
                  : `Knockout tournament — ${ids.length} players`}
              </button>
            </div>

            <p className="row-sub" style={{ marginTop: 12 }}>
              A knockout draws a bracket, pairs everyone up and advances the winners. Draws are
              replayed, so nobody goes out on one.
            </p>
          </div>
        ) : (
          <div className="row-sub">Waiting for {nameOf(session.host_id)} to pick a format…</div>
        )}
      </>
    );
  }

  /* ========================================================== knockout === */
  const champ = state.bracket ? champion(state.bracket) : null;

  if (champ) {
    return (
      <>
        <div style={{ fontSize: 46 }}>🏆</div>
        <div className="turn-banner" data-you={champ === me}>
          {champ === me ? 'You win the tournament' : `${nameOf(champ)} wins the tournament`}
        </div>
        {state.bracket && <BracketView bracket={state.bracket} nameOf={nameOf} />}
        {isHost && (
          <button className="btn" onClick={backToLobby}>
            <Icon name="undo" size={15} />
            Back to the lobby
          </button>
        )}
      </>
    );
  }

  /* ============================================================ series === */
  const target = needed(state.bestOf);
  const xWins = state.x ? state.wins[state.x] ?? 0 : 0;
  const oWins = state.o ? state.wins[state.o] ?? 0 : 0;
  const seriesWinner =
    state.mode === 'series'
      ? Object.entries(state.wins).find(([, n]) => n >= target)?.[0] ?? null
      : null;

  if (seriesWinner && !state.winner) {
    return (
      <>
        <div style={{ fontSize: 46 }}>🏆</div>
        <div className="turn-banner" data-you={seriesWinner === me}>
          {seriesWinner === me
            ? `You win the series ${state.wins[seriesWinner]}–${xWins + oWins - state.wins[seriesWinner]}`
            : `${nameOf(seriesWinner)} wins the series`}
        </div>
        {isHost && (
          <button className="btn" onClick={backToLobby}>
            <Icon name="undo" size={15} />
            Back to the lobby
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 26, fontSize: 13, color: 'var(--ink-dim)', alignItems: 'center' }}>
        <span>
          <b style={{ color: '#64b6ff' }}>X</b> {nameOf(state.x)} · <b>{xWins}</b>
        </span>
        <span style={{ fontSize: 11, letterSpacing: '0.06em' }}>
          {state.mode === 'knockout' && state.bracket
            ? roundName(state.bracket, state.bracket.round).toUpperCase()
            : `BEST OF ${state.bestOf} · FIRST TO ${target}`}
        </span>
        <span>
          <b style={{ color: '#ff7a6e' }}>O</b> {nameOf(state.o)} · <b>{oWins}</b>
        </span>
      </div>

      <div className="turn-banner" data-you={myTurn}>
        {state.winner === 'draw'
          ? state.mode === 'knockout'
            ? 'Draw — replaying this match'
            : "Draw. Nobody's proud."
          : state.winner
            ? `${nameOf(winnerId)} wins`
            : myTurn
              ? 'Your move'
              : myMark
                ? `${nameOf(state.turn === 'X' ? state.x : state.o)}'s move`
                : 'Spectating'}
      </div>

      <div className="ttt-board">
        {state.board.map((mark, i) => (
          <button
            key={i}
            className="ttt-cell"
            data-mark={mark}
            data-filled={mark !== ''}
            disabled={!myTurn || mark !== ''}
            onClick={() => void play(i)}
            style={
              line?.includes(i)
                ? { boxShadow: 'inset 0 0 0 2px var(--accent), var(--lift-2)' }
                : undefined
            }
            aria-label={`Cell ${i + 1}${mark ? `, ${mark}` : ', empty'}`}
          >
            {mark}
          </button>
        ))}
      </div>

      {error && <p className="err">{error}</p>}

      {state.winner && (
        <button className="btn btn-accent" onClick={() => void nextGame()}>
          <Icon name="play" size={15} />
          {state.mode === 'knockout'
            ? state.winner === 'draw'
              ? 'Replay'
              : 'Next match'
            : 'Next game'}
        </button>
      )}

      {state.mode === 'knockout' && state.bracket && (
        <BracketView bracket={state.bracket} nameOf={nameOf} />
      )}
    </>
  );
}

function BracketView({
  bracket,
  nameOf,
}: {
  bracket: Bracket;
  nameOf: (id: UUID | null) => string;
}) {
  return (
    <div style={{ display: 'flex', gap: 14, overflowX: 'auto', maxWidth: '100%', padding: '4px 2px' }}>
      {bracket.rounds.map((round, r) => (
        <div key={r} style={{ minWidth: 150 }}>
          <div className="label" style={{ padding: '0 0 6px' }}>{roundName(bracket, r)}</div>
          {round.map((m, i) => {
            const live = r === bracket.round && i === bracket.match;
            return (
              <div
                key={i}
                className="group"
                style={{
                  padding: '7px 10px',
                  marginBottom: 6,
                  fontSize: 12,
                  borderColor: live ? 'var(--accent)' : undefined,
                }}
              >
                {[m.a, m.b].map((side, k) => (
                  <div
                    key={k}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '2px 0',
                      opacity: m.winner && m.winner !== side ? 0.4 : 1,
                      fontWeight: m.winner === side ? 650 : 400,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {side ? nameOf(side) : '—'}
                    </span>
                    {m.winner === side && <Icon name="check" size={13} />}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
