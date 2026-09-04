import { useMemo, useState } from 'react';
import { errText, supabase } from '../../../lib/supabase';
import type { GamePlayer, GameSession, Profile, UUID } from '../../../lib/types';
import { setState } from '../lobby';
import { emptyBoard, winningLine, type Board, type Mark } from './rules';

interface TttState {
  board: Board;
  turn: Mark;
  x: UUID | null;
  o: UUID | null;
  winner: Mark | 'draw' | null;
  scores: { X: number; O: number; draws: number };
}

function readState(s: Record<string, unknown>): TttState {
  return {
    board: (s.board as Board) ?? emptyBoard(),
    turn: (s.turn as Mark) ?? 'X',
    x: (s.x as UUID | null) ?? null,
    o: (s.o as UUID | null) ?? null,
    winner: (s.winner as TttState['winner']) ?? null,
    scores: (s.scores as TttState['scores']) ?? { X: 0, O: 0, draws: 0 },
  };
}

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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const state = useMemo(() => readState(session.state), [session.state]);

  const seats = players.slice(0, 2).map((p) => p.profile_id);
  const assigned = state.x && state.o;
  const myMark: Mark = state.x === me ? 'X' : state.o === me ? 'O' : '';
  const myTurn = assigned && myMark !== '' && state.turn === myMark && !state.winner;
  const line = winningLine(state.board);

  const start = async () => {
    if (seats.length < 2) return;
    await setState(
      session.id,
      {
        board: emptyBoard(),
        turn: 'X',
        x: seats[0],
        o: seats[1],
        winner: null,
        scores: state.scores,
      },
      'active',
    );
  };

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

  const rematch = async () => {
    const scores = { ...state.scores };
    if (state.winner === 'draw') scores.draws++;
    else if (state.winner === 'X') scores.X++;
    else if (state.winner === 'O') scores.O++;

    await setState(
      session.id,
      {
        board: emptyBoard(),
        // Loser starts, which is the convention everyone expects.
        turn: state.winner === 'X' ? 'O' : 'X',
        x: state.o,
        o: state.x,
        winner: null,
        scores,
      },
      'active',
    );
  };

  const nameOf = (id: UUID | null) => (id ? profiles.get(id)?.display_name ?? '—' : '—');

  if (!assigned || session.status === 'lobby') {
    return (
      <>
        <div className="empty" style={{ maxWidth: 420 }}>
          {seats.length < 2
            ? 'Waiting for a second player. Invite someone from the list on the right.'
            : `${nameOf(seats[0])} vs ${nameOf(seats[1])} — ready when you are.`}
        </div>
        <button className="btn btn-accent" disabled={seats.length < 2} onClick={() => void start()}>
          Start game
        </button>
        {seats.length < 2 && (
          <div className="row-sub">
            Tic-tac-toe needs exactly two players, so there is nothing to start yet.
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--ink-dim)' }}>
        <span>
          <b style={{ color: '#64b6ff' }}>X</b> {nameOf(state.x)} · {state.scores.X}
        </span>
        <span>draws {state.scores.draws}</span>
        <span>
          <b style={{ color: '#ff7a6e' }}>O</b> {nameOf(state.o)} · {state.scores.O}
        </span>
      </div>

      <div className="turn-banner" data-you={myTurn}>
        {state.winner === 'draw'
          ? "Draw. Nobody's proud."
          : state.winner
            ? `${nameOf(state.winner === 'X' ? state.x : state.o)} wins`
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
        <button className="btn btn-accent" onClick={() => void rematch()}>
          Rematch
        </button>
      )}
    </>
  );
}
