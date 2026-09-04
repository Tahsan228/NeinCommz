import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GamePlayer, GameSession, Profile, UUID } from '../../../lib/types';
import { Avatar } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { setState } from '../lobby';
import { useEconomy } from '../../../state/economy';
import {
  PIECE_VALUE,
  START_FEN,
  colorOf,
  file,
  inCheck,
  kingSquare,
  legalMoves,
  makeMove,
  parseFen,
  positionKey,
  rank,
  result,
  squareName,
  toFen,
  toSan,
  typeOf,
  type Color,
  type Move,
  type PieceType,
} from './rules';
import { DIFFICULTY, advantage, chooseMove, type Difficulty } from './bot';

/** Unicode pieces — always available, and they scale with the board. */
const GLYPH: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

const BOT_ID = 'bot';

interface ChessState {
  phase: 'lobby' | 'play' | 'done';
  fen: string;
  /** Every position seen, for threefold repetition. */
  history: string[];
  /** Moves in algebraic notation, for the sheet beside the board. */
  san: string[];
  white: UUID | null;
  black: UUID | null;
  /** Set when playing the computer. */
  bot: Difficulty | null;
  winner: Color | 'draw' | null;
  reason: string | null;
  /** The move just played, for the slide animation and the highlight. */
  last: { from: number; to: number } | null;
  /** Which game this is within the room, so each one is rated separately. */
  round: number;
}

function readState(s: Record<string, unknown>): ChessState {
  return {
    phase: (s.phase as ChessState['phase']) ?? 'lobby',
    fen: (s.fen as string) ?? START_FEN,
    history: (s.history as string[]) ?? [],
    san: (s.san as string[]) ?? [],
    white: (s.white as UUID | null) ?? null,
    black: (s.black as UUID | null) ?? null,
    bot: (s.bot as Difficulty | null) ?? null,
    winner: (s.winner as ChessState['winner']) ?? null,
    reason: (s.reason as string | null) ?? null,
    last: (s.last as { from: number; to: number } | null) ?? null,
    round: (s.round as number) ?? 1,
  };
}

export function ChessGame({
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
  const state = useMemo(() => readState(session.state), [session.state]);
  const { award } = useEconomy();

  const pos = useMemo(() => parseFen(state.fen), [state.fen]);
  const [selected, setSelected] = useState<number | null>(null);
  const [promoting, setPromoting] = useState<Move[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const awardedRef = useRef(false);
  const botTimer = useRef<number | null>(null);

  const isHost = session.host_id === me;
  const ids = players.map((p) => p.profile_id);

  const myColor: Color | null =
    state.white === me ? 'w' : state.black === me ? 'b' : null;
  const myTurn = myColor === pos.turn && !state.winner && state.phase === 'play';

  const nameOf = (id: UUID | null) =>
    id === BOT_ID
      ? `Computer (${DIFFICULTY[state.bot ?? 'medium'].label})`
      : id
        ? profiles.get(id)?.display_name ?? '—'
        : '—';

  const moves = useMemo(
    () => (selected === null ? [] : legalMoves(pos, selected)),
    [pos, selected],
  );
  const targets = useMemo(() => new Set(moves.map((m) => m.to)), [moves]);

  const outcome = useMemo(() => result(pos, state.history), [pos, state.history]);
  const checkedKing = inCheck(pos) ? kingSquare(pos.board, pos.turn) : -1;

  /* ------------------------------------------------------------ playing -- */
  const commit = useCallback(
    async (move: Move) => {
      const after = makeMove(pos, move);
      const san = toSan(pos, move);
      const history = [...state.history, positionKey(after)];
      const verdict = result(after, history);

      await setState(
        session.id,
        {
          ...state,
          fen: toFen(after),
          history,
          san: [...state.san, san],
          last: { from: move.from, to: move.to },
          winner: verdict.over ? (verdict.kind === 'checkmate' ? verdict.winner : 'draw') : null,
          reason: verdict.over ? verdict.kind : null,
          phase: verdict.over ? 'done' : 'play',
        },
        verdict.over ? 'done' : 'active',
      );
    },
    [pos, state, session.id],
  );

  const tap = (sq: number) => {
    if (!myTurn) return;
    const piece = pos.board[sq];

    if (selected !== null) {
      const options = moves.filter((m) => m.to === sq);
      if (options.length > 1) {
        // A promotion: same from/to, four possible pieces.
        setPromoting(options);
        setSelected(null);
        return;
      }
      if (options.length === 1) {
        void commit(options[0]);
        setSelected(null);
        return;
      }
    }

    setSelected(colorOf(piece) === pos.turn ? sq : null);
  };

  /* ---------------------------------------------------------------- bot -- */
  useEffect(() => {
    if (!state.bot || state.phase !== 'play' || state.winner) return;
    // Whoever created the room drives the computer, so it moves exactly once.
    if (!isHost) return;
    const botColor: Color = state.white === BOT_ID ? 'w' : 'b';
    if (pos.turn !== botColor) return;

    setThinking(true);
    // A beat of delay, so it does not answer before you have let go of the mouse.
    botTimer.current = window.setTimeout(() => {
      const move = chooseMove(pos, state.bot ?? 'medium');
      setThinking(false);
      if (move) void commit(move);
    }, 420);

    return () => {
      if (botTimer.current) window.clearTimeout(botTimer.current);
      setThinking(false);
    };
  }, [state.bot, state.phase, state.winner, state.white, pos, isHost, commit]);

  /* -------------------------------------------------------------- award -- */
  useEffect(() => {
    if (!isHost || !state.winner || awardedRef.current) return;
    // A game against the computer is practice; it does not touch anyone's rating.
    if (state.bot) return;
    if (!state.white || !state.black) return;
    awardedRef.current = true;

    void award(
      session.id,
      state.winner === 'draw'
        ? [
            { profile_id: state.white, outcome: 'draw', score: 0 },
            { profile_id: state.black, outcome: 'draw', score: 0 },
          ]
        : [
            {
              profile_id: state.winner === 'w' ? state.white : state.black,
              outcome: 'win',
              score: 1,
            },
            {
              profile_id: state.winner === 'w' ? state.black : state.white,
              outcome: 'loss',
              score: 0,
            },
          ],
      state.round,
    );
  }, [isHost, state.winner, state.bot, state.white, state.black, state.round, session.id, award]);

  /* ------------------------------------------------------------- starts -- */
  const startVersus = async () => {
    if (ids.length < 2) return;
    await setState(
      session.id,
      {
        phase: 'play',
        fen: START_FEN,
        history: [positionKey(parseFen(START_FEN))],
        san: [],
        white: ids[0],
        black: ids[1],
        bot: null,
        winner: null,
        reason: null,
        last: null,
        round: state.round + 1,
      },
      'active',
    );
  };

  const startBot = async (difficulty: Difficulty, asWhite: boolean) => {
    await setState(
      session.id,
      {
        phase: 'play',
        fen: START_FEN,
        history: [positionKey(parseFen(START_FEN))],
        san: [],
        white: asWhite ? me : BOT_ID,
        black: asWhite ? BOT_ID : me,
        bot: difficulty,
        winner: null,
        reason: null,
        last: null,
        round: state.round + 1,
      },
      'active',
    );
  };

  const backToLobby = () => {
    awardedRef.current = false;
    // Keep the round counter: a fresh game in the same room has to report a
    // round nobody has been paid for yet.
    void setState(session.id, { ...readState({}), phase: 'lobby', round: state.round }, 'lobby');
  };

  const resign = () => {
    if (!myColor) return;
    void setState(
      session.id,
      {
        ...state,
        winner: myColor === 'w' ? 'b' : 'w',
        reason: 'resignation',
        phase: 'done',
      },
      'done',
    );
  };

  /* ============================================================ lobby === */
  if (state.phase === 'lobby' || session.status === 'lobby') {
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

        {!isHost ? (
          <div className="row-sub">Waiting for {nameOf(session.host_id)} to start…</div>
        ) : (
          <div className="group" style={{ padding: 16, width: 'min(440px, 100%)' }}>
            <div className="label" style={{ padding: '0 0 10px' }}>Play someone</div>
            <button
              className="btn btn-accent"
              style={{ width: '100%' }}
              disabled={ids.length < 2}
              onClick={() => void startVersus()}
            >
              <Icon name="play" size={15} />
              {ids.length < 2
                ? 'Waiting for an opponent'
                : `${nameOf(ids[0])} v ${nameOf(ids[1])}`}
            </button>

            <div className="label" style={{ padding: '18px 0 10px' }}>Play the computer</div>
            <p className="row-sub" style={{ margin: '0 0 10px' }}>
              On your own, or to practise. Games against the computer do not
              affect your rating.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                <div key={d} style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => void startBot(d, true)}
                  >
                    {DIFFICULTY[d].label} · as White
                  </button>
                  <button
                    className="btn btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => void startBot(d, false)}
                  >
                    as Black
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  /* ============================================================= play === */
  // The board is always drawn from the side you are playing.
  const flipped = myColor === 'b' || (myColor === null && state.white === BOT_ID);
  const order = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i));

  // Offset in squares from where the moving piece started, so CSS can slide it
  // in from there. Flipping the board flips the direction of travel too.
  const slideFrom = (sq: number): { dx: number; dy: number } | null => {
    if (!state.last || state.last.to !== sq) return null;
    const dir = flipped ? -1 : 1;
    return {
      dx: (file(state.last.from) - file(state.last.to)) * dir,
      dy: (rank(state.last.from) - rank(state.last.to)) * dir,
    };
  };

  const lead = advantage(pos.board);
  const taken = capturedList(pos.board);

  return (
    <div className="chess-stage">
      <div className="chess-side">
        <PlayerBar
          id={flipped ? state.white : state.black}
          name={nameOf(flipped ? state.white : state.black)}
          profiles={profiles}
          color={flipped ? 'w' : 'b'}
          toMove={pos.turn === (flipped ? 'w' : 'b') && !state.winner}
          captured={taken[flipped ? 'b' : 'w']}
          lead={flipped ? lead : -lead}
        />

        <div className="chess-board" data-check={checkedKing >= 0}>
          {order.map((sq) => {
            const piece = pos.board[sq];
            const dark = (file(sq) + rank(sq)) % 2 === 1;
            const slide = slideFrom(sq);
            const wasLast = state.last?.from === sq || state.last?.to === sq;
            return (
              <button
                key={sq}
                className="chess-square"
                data-dark={dark}
                data-sel={sq === selected}
                data-target={targets.has(sq)}
                data-capture={targets.has(sq) && Boolean(piece)}
                data-check={sq === checkedKing}
                data-last={wasLast}
                onClick={() => tap(sq)}
                aria-label={squareName(sq) + (piece ? ` ${piece}` : ' empty')}
              >
                {piece && (
                  <span
                    className="chess-piece-wrap"
                    // Keyed on the move so React remounts it and the animation
                    // replays; without that a piece moved twice would sit still
                    // the second time.
                    key={`${state.san.length}-${sq}`}
                    data-slide={slide ? 'true' : undefined}
                    style={
                      slide
                        ? ({
                            ['--dx' as string]: `${slide.dx * 100}%`,
                            ['--dy' as string]: `${slide.dy * 100}%`,
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    <span className="chess-piece" data-color={piece[0]}>
                      {GLYPH[piece]}
                    </span>
                  </span>
                )}
                {file(sq) === (flipped ? 7 : 0) && (
                  <span className="chess-rank">{8 - rank(sq)}</span>
                )}
                {rank(sq) === (flipped ? 0 : 7) && (
                  <span className="chess-file">{'abcdefgh'[file(sq)]}</span>
                )}
              </button>
            );
          })}
        </div>

        <PlayerBar
          id={flipped ? state.black : state.white}
          name={nameOf(flipped ? state.black : state.white)}
          profiles={profiles}
          color={flipped ? 'b' : 'w'}
          toMove={pos.turn === (flipped ? 'b' : 'w') && !state.winner}
          captured={taken[flipped ? 'w' : 'b']}
          lead={flipped ? -lead : lead}
        />
      </div>

      <div className="chess-panel">
        <div className="turn-banner" data-you={myTurn}>
          {state.winner
            ? state.winner === 'draw'
              ? `Draw — ${state.reason}`
              : `${state.winner === 'w' ? 'White' : 'Black'} wins by ${state.reason}`
            : thinking
              ? 'Thinking…'
              : myTurn
                ? inCheck(pos)
                  ? 'Your move — you are in check'
                  : 'Your move'
                : myColor
                  ? `${nameOf(pos.turn === 'w' ? state.white : state.black)} to move`
                  : 'Spectating'}
        </div>

        <div className="label" style={{ padding: '12px 0 6px' }}>Moves</div>
        <div className="chess-moves">
          {state.san.length === 0 && <div className="row-sub">No moves yet.</div>}
          {pairUp(state.san).map(([w, b], i) => (
            <div className="chess-move-row" key={i}>
              <span className="chess-move-no">{i + 1}.</span>
              <span>{w}</span>
              <span>{b ?? ''}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {!state.winner && myColor && (
            <button className="btn btn-sm btn-danger" onClick={resign}>
              <Icon name="ban" size={14} />
              Resign
            </button>
          )}
          {state.winner && isHost && (
            <button className="btn btn-sm btn-accent" onClick={backToLobby}>
              <Icon name="undo" size={14} />
              New game
            </button>
          )}
        </div>

        {outcome.over && !state.winner && (
          <p className="row-sub" style={{ marginTop: 10 }}>
            This position is already {outcome.kind}.
          </p>
        )}
      </div>

      {promoting && (
        <div className="scrim" onMouseDown={() => setPromoting(null)}>
          <div className="modal" style={{ width: 'auto', padding: 18 }}>
            <div className="label" style={{ padding: '0 0 10px' }}>Promote to</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['q', 'r', 'b', 'n'] as PieceType[]).map((t) => (
                <button
                  key={t}
                  className="btn btn-icon"
                  style={{ width: 56, height: 56, fontSize: 34 }}
                  onClick={() => {
                    const move = promoting.find((m) => m.promotion === t);
                    setPromoting(null);
                    if (move) void commit(move);
                  }}
                >
                  {GLYPH[(myColor ?? 'w') + t]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- pieces -- */

function PlayerBar({
  id,
  name,
  profiles,
  color,
  toMove,
  captured,
  lead,
}: {
  id: UUID | null;
  name: string;
  profiles: Map<UUID, Profile>;
  color: Color;
  toMove: boolean;
  captured: string[];
  lead: number;
}) {
  const p = id && id !== BOT_ID ? profiles.get(id) : undefined;
  return (
    <div className="chess-player" data-turn={toMove}>
      {id === BOT_ID ? (
        <span className="chess-bot-avatar">
          <Icon name="grid" size={16} />
        </span>
      ) : (
        <Avatar
          emoji={p?.avatar_emoji ?? '🙂'}
          url={p?.avatar_url}
          color={p?.avatar_color ?? '#555'}
          size={28}
          name={p?.display_name}
        />
      )}
      <span className="chess-player-name">{name}</span>
      <span className="chess-taken">
        {captured.map((c, i) => (
          <span key={i}>{GLYPH[c]}</span>
        ))}
      </span>
      {lead > 0 && <span className="chess-lead">+{lead}</span>}
      <span className="chess-color-dot" data-color={color} />
    </div>
  );
}

/** Which pieces each side has lost, compared with a full starting set. */
function capturedList(board: string[]): { w: string[]; b: string[] } {
  const start: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  const out = { w: [] as string[], b: [] as string[] };

  for (const color of ['w', 'b'] as Color[]) {
    for (const type of Object.keys(start) as PieceType[]) {
      const alive = board.filter((sq) => sq === color + type).length;
      for (let i = 0; i < start[type] - alive; i++) out[color].push(color + type);
    }
    out[color].sort((a, b) => PIECE_VALUE[typeOf(b)!] - PIECE_VALUE[typeOf(a)!]);
  }
  return out;
}

function pairUp(san: string[]): [string, string | undefined][] {
  const rows: [string, string | undefined][] = [];
  for (let i = 0; i < san.length; i += 2) rows.push([san[i], san[i + 1]]);
  return rows;
}
