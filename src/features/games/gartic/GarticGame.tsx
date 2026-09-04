import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { GamePlayer, GameSession, GarticRound, Profile, UUID } from '../../../lib/types';
import { Avatar } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { setState } from '../lobby';
import { chainForAuthor, isComplete, kindForStep, totalSteps } from './rounds';
import { DrawCanvas, StrokeReplay, type DrawCanvasHandle } from './DrawCanvas';

interface GarticState {
  phase: 'lobby' | 'play' | 'album';
  step: number;
  order: UUID[];
  seconds: number;
  startedAt: string | null;
}

function readState(s: Record<string, unknown>): GarticState {
  return {
    phase: (s.phase as GarticState['phase']) ?? 'lobby',
    step: (s.step as number) ?? 0,
    order: (s.order as UUID[]) ?? [],
    seconds: (s.seconds as number) ?? 70,
    startedAt: (s.startedAt as string | null) ?? null,
  };
}

export function GarticGame({
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
  const [rounds, setRounds] = useState<GarticRound[]>([]);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [remaining, setRemaining] = useState(state.seconds);
  const canvasRef = useRef<DrawCanvasHandle>(null);
  /** The step we have already pushed forward, so we never advance one twice. */
  const advancedFrom = useRef(-1);

  const isHost = session.host_id === me;
  const order = state.order.length ? state.order : players.map((p) => p.profile_id);
  const n = order.length;

  /* ------------------------------------------------------------ rounds -- */
  const loadRounds = useCallback(async () => {
    const { data } = await supabase
      .from('gartic_rounds')
      .select('*')
      .eq('session_id', session.id)
      .order('chain_index')
      .order('step_index');
    setRounds((data as GarticRound[]) ?? []);
  }, [session.id]);

  useEffect(() => {
    void loadRounds();
    const ch = supabase
      .channel(`gartic:${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'gartic_rounds',
          filter: `session_id=eq.${session.id}`,
        },
        () => void loadRounds(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [session.id, loadRounds]);

  /* ---------------------------------------------------- my current task -- */
  const myChain = state.phase === 'play' ? chainForAuthor(me, state.step, order) : -1;
  const kind = kindForStep(state.step);
  const source = useMemo(
    () => rounds.find((r) => r.chain_index === myChain && r.step_index === state.step - 1) ?? null,
    [rounds, myChain, state.step],
  );

  const doneThisStep = useMemo(
    () => rounds.filter((r) => r.step_index === state.step).length,
    [rounds, state.step],
  );

  useEffect(() => {
    setSubmitted(rounds.some((r) => r.step_index === state.step && r.author_id === me));
  }, [rounds, state.step, me]);

  useEffect(() => {
    setText('');
  }, [state.step]);

  /* ------------------------------------------------------------- timer -- */
  useEffect(() => {
    if (state.phase !== 'play' || !state.startedAt) return;
    const tick = () => {
      const elapsed = (Date.now() - new Date(state.startedAt!).getTime()) / 1000;
      setRemaining(Math.max(0, Math.round(state.seconds - elapsed)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [state.phase, state.startedAt, state.seconds, state.step]);

  /* ------------------------------------------------- host advances step -- */
  // Only the host writes the step forward, so N clients noticing "everyone is
  // done" at once cannot race each other into skipping a round.
  useEffect(() => {
    if (!isHost || state.phase !== 'play') return;

    // setState is async and the new step only comes back over realtime, so
    // without this latch the effect re-fires on the same step and skips a
    // round — or several.
    if (advancedFrom.current === state.step) return;

    const everyoneDone = doneThisStep >= n;
    const timeUp = remaining <= 0 && state.startedAt !== null;
    if (!everyoneDone && !timeUp) return;

    advancedFrom.current = state.step;
    const nextStep = state.step + 1;
    void setState(
      session.id,
      isComplete(nextStep, n)
        ? { ...state, phase: 'album', step: nextStep }
        : { ...state, step: nextStep, startedAt: new Date().toISOString() },
      isComplete(nextStep, n) ? 'done' : 'active',
    );
  }, [isHost, doneThisStep, n, remaining, state, session.id]);

  /* ------------------------------------------------------------ actions -- */
  const start = async () => {
    const ids = players.map((p) => p.profile_id);
    await setState(
      session.id,
      { phase: 'play', step: 0, order: ids, seconds: 70, startedAt: new Date().toISOString() },
      'active',
    );
  };

  const submit = async () => {
    if (myChain < 0 || submitted) return;
    const row = {
      session_id: session.id,
      chain_index: myChain,
      step_index: state.step,
      author_id: me,
      kind,
      text_content: kind === 'drawing' ? null : text.trim() || '(nothing)',
      strokes: kind === 'drawing' ? canvasRef.current?.getStrokes() ?? [] : null,
    };
    setSubmitted(true);
    const { error } = await supabase.from('gartic_rounds').insert(row);
    if (error) setSubmitted(false);
    else await loadRounds();
  };

  const nameOf = (id: UUID) => profiles.get(id)?.display_name ?? 'Someone';

  /* ------------------------------------------------------------- lobby -- */
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
                  size={24}
                  name={pr?.display_name}
                />
                {pr?.display_name ?? 'Someone'}
              </div>
            );
          })}
        </div>
        <div className="empty" style={{ maxWidth: 440 }}>
          Everyone writes a prompt, then you take turns drawing what the last person wrote and
          guessing what the last person drew. Best with 3 or more.
        </div>
        {isHost ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {players.length >= 3 ? (
              <button className="btn btn-accent" onClick={() => void start()}>
                <Icon name="play" size={15} />
                Start
              </button>
            ) : players.length >= 2 ? (
              <>
                {/* Two people still works — the chains are just short. Waiting
                    for a third is a recommendation, not a rule. */}
                <button className="btn btn-accent" onClick={() => void start()}>
                  <Icon name="play" size={15} />
                  Start anyway with {players.length}
                </button>
                <span className="row-sub" style={{ alignSelf: 'center' }}>
                  It plays better with 3+.
                </span>
              </>
            ) : (
              <span className="row-sub">Two people minimum — invite someone.</span>
            )}
          </div>
        ) : (
          <div className="row-sub">Waiting for {nameOf(session.host_id)} to start…</div>
        )}
      </>
    );
  }

  /* ------------------------------------------------------------- album -- */
  if (state.phase === 'album') {
    return (
      <div style={{ width: 'min(560px, 100%)' }}>
        <h3 style={{ textAlign: 'center', marginTop: 0 }}>The damage</h3>
        {Array.from({ length: n }, (_, chain) => (
          <div key={chain} style={{ marginBottom: 30 }}>
            <div className="label">{nameOf(order[chain])}'s chain</div>
            {rounds
              .filter((r) => r.chain_index === chain)
              .sort((a, b) => a.step_index - b.step_index)
              .map((r) => (
                <div className="album-item" key={r.id}>
                  <div className="row-sub" style={{ marginBottom: 8 }}>
                    {nameOf(r.author_id)} {r.kind === 'drawing' ? 'drew' : 'wrote'}
                  </div>
                  {r.kind === 'drawing' ? (
                    <StrokeReplay strokes={r.strokes ?? []} width={480} />
                  ) : (
                    <div style={{ fontSize: 17, fontWeight: 500 }}>{r.text_content}</div>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
    );
  }

  /* -------------------------------------------------------------- play -- */
  const pct = (remaining / state.seconds) * 100;

  return (
    <>
      <div style={{ textAlign: 'center' }}>
        <div className="label" style={{ padding: 0 }}>
          Round {state.step + 1} of {totalSteps(n)} · {doneThisStep}/{n} in
        </div>
        <div style={{ fontSize: 20, fontWeight: 650, marginTop: 4 }}>
          {kind === 'prompt'
            ? 'Write something for someone else to draw'
            : kind === 'drawing'
              ? 'Draw this'
              : 'What is this?'}
        </div>
      </div>

      <div className="timer-bar">
        <div className="timer-fill" style={{ width: `${pct}%` }} />
      </div>

      {submitted ? (
        <div className="empty" style={{ maxWidth: 380 }}>
          Locked in. Waiting on{' '}
          {order
            .filter((id) => !rounds.some((r) => r.step_index === state.step && r.author_id === id))
            .map(nameOf)
            .join(', ') || 'the next round'}
          …
        </div>
      ) : kind === 'drawing' ? (
        <>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              padding: '10px 18px',
              borderRadius: 12,
              background: 'var(--sunken)',
              boxShadow: 'var(--inset)',
            }}
          >
            {source?.text_content ?? '…'}
          </div>
          <DrawCanvas ref={canvasRef} />
          <button className="btn btn-accent" onClick={() => void submit()}>
            Done drawing
          </button>
        </>
      ) : (
        <>
          {kind === 'guess' && source?.strokes && (
            <StrokeReplay strokes={source.strokes} width={440} />
          )}
          <input
            className="input"
            style={{ width: 'min(440px, 90vw)', fontSize: 16 }}
            autoFocus
            maxLength={90}
            placeholder={kind === 'prompt' ? 'A cat running a bank heist' : 'Your best guess'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
          <button className="btn btn-accent" disabled={!text.trim()} onClick={() => void submit()}>
            Submit
          </button>
        </>
      )}

      <div className="roster">
        {order.map((id) => {
          const done = rounds.some((r) => r.step_index === state.step && r.author_id === id);
          const pr = profiles.get(id);
          return (
            <div className="roster-chip" key={id} style={{ opacity: done ? 1 : 0.45 }}>
              <Avatar
                emoji={pr?.avatar_emoji ?? '🙂'}
                url={pr?.avatar_url}
                color={pr?.avatar_color ?? '#555'}
                size={22}
                name={pr?.display_name}
              />
              {pr?.display_name ?? 'Someone'}
              {done && ' ✓'}
            </div>
          );
        })}
      </div>
    </>
  );
}
