import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { DrawOp, GamePlayer, GameSession, GarticRound, Profile, UUID } from '../../../lib/types';
import { Avatar } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { setState } from '../lobby';
import { useEconomy } from '../../../state/economy';
import {
  chainForAuthor,
  isComplete,
  kindForStep,
  secondsFor,
  totalSteps,
  type FirstStep,
} from './rounds';
import { DrawCanvas, StrokeReplay, type DrawCanvasHandle } from './DrawCanvas';

interface Settings {
  writeSeconds: number;
  drawSeconds: number;
  /** 0 means one step per player. */
  rounds: number;
  firstStep: FirstStep;
}

interface GarticState {
  phase: 'lobby' | 'play' | 'album';
  step: number;
  order: UUID[];
  settings: Settings;
  startedAt: string | null;
  albumIndex: number;
}

const DEFAULT_SETTINGS: Settings = {
  writeSeconds: 50,
  drawSeconds: 90,
  rounds: 0,
  firstStep: 'prompt',
};

function readState(s: Record<string, unknown>): GarticState {
  return {
    phase: (s.phase as GarticState['phase']) ?? 'lobby',
    step: (s.step as number) ?? 0,
    order: (s.order as UUID[]) ?? [],
    settings: { ...DEFAULT_SETTINGS, ...((s.settings as Partial<Settings>) ?? {}) },
    startedAt: (s.startedAt as string | null) ?? null,
    albumIndex: (s.albumIndex as number) ?? 0,
  };
}

/** Seconds since this step began, straight from the clock. */
function elapsedSince(startedAt: string | null): number {
  if (!startedAt) return 0;
  return (Date.now() - new Date(startedAt).getTime()) / 1000;
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
  const { award } = useEconomy();
  const [rounds, setRounds] = useState<GarticRound[]>([]);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const canvasRef = useRef<DrawCanvasHandle>(null);

  const isHost = session.host_id === me;
  const order = state.order.length ? state.order : players.map((p) => p.profile_id);
  const n = order.length;
  const steps = totalSteps(n, state.settings.rounds);

  const myChain = state.phase === 'play' ? chainForAuthor(me, state.step, order) : -1;
  const kind = kindForStep(state.step, state.settings.firstStep);
  const limit = secondsFor(kind, state.settings);

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

  /* ------------------------------------------------------------ submit -- */
  const submittedRef = useRef(false);
  submittedRef.current = submitted;

  const submit = useCallback(
    async (auto = false) => {
      if (myChain < 0 || submittedRef.current) return;
      setSubmitted(true);

      const ops: DrawOp[] = kind === 'drawing' ? canvasRef.current?.getOps() ?? [] : [];
      const body = text.trim();

      const { error } = await supabase.from('gartic_rounds').insert({
        session_id: session.id,
        chain_index: myChain,
        step_index: state.step,
        author_id: me,
        kind,
        text_content: kind === 'drawing' ? null : body || (auto ? '(ran out of time)' : '(nothing)'),
        strokes: kind === 'drawing' ? ops : null,
      });

      if (error) setSubmitted(false);
      else await loadRounds();
    },
    [myChain, kind, text, session.id, state.step, me, loadRounds],
  );

  /* ------------------------------------------------------------- timer -- */
  // Read from the clock rather than counting down in state. The old version
  // kept `remaining` in state, so at the moment a step changed it still held
  // the previous step's zero — which read as "time is up" and shoved the game
  // into the next step, and the next, and the next, in one frame. That is the
  // instant-snap where the drawing prompt never appeared.
  useEffect(() => {
    if (state.phase !== 'play') return;

    const tick = () => {
      const left = Math.max(0, Math.round(limit - elapsedSince(state.startedAt)));
      setRemaining(left);

      // Everyone auto-submits when their own clock runs out, so a chain never
      // ends up with a hole where the next person's prompt should be.
      if (left <= 0 && !submittedRef.current && myChain >= 0) void submit(true);
    };

    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [state.phase, state.startedAt, state.step, limit, myChain, submit]);

  /* ------------------------------------------------- host advances step -- */
  const advancedFrom = useRef(-1);

  useEffect(() => {
    if (!isHost || state.phase !== 'play') return;

    const check = () => {
      if (advancedFrom.current === state.step) return;

      const everyoneDone = doneThisStep >= n;
      // Grace period so a late auto-submit still lands before we move on.
      const timeUp = state.startedAt !== null && elapsedSince(state.startedAt) >= limit + 3;
      if (!everyoneDone && !timeUp) return;

      advancedFrom.current = state.step;
      const nextStep = state.step + 1;
      const done = isComplete(nextStep, n, state.settings.rounds);

      void setState(
        session.id,
        done
          ? { ...state, phase: 'album', step: nextStep, albumIndex: 0 }
          : { ...state, step: nextStep, startedAt: new Date().toISOString() },
        done ? 'done' : 'active',
      );

      // Gartic has no winner, so everyone who saw it through is paid the same.
      if (done) {
        void award(
          session.id,
          order.map((id) => ({ profile_id: id, outcome: 'draw' as const, score: 1 })),
        );
      }
    };

    check();
    const id = window.setInterval(check, 500);
    return () => window.clearInterval(id);
  }, [isHost, state, doneThisStep, n, limit, session.id, order, award]);

  const nameOf = (id: UUID) => profiles.get(id)?.display_name ?? 'Someone';

  /* ============================================================ lobby === */
  if (state.phase === 'lobby' || session.status === 'lobby') {
    return (
      <GarticLobby
        session={session}
        state={state}
        players={players}
        profiles={profiles}
        isHost={isHost}
      />
    );
  }

  /* ============================================================ album === */
  if (state.phase === 'album') {
    return (
      <Album
        session={session}
        state={state}
        rounds={rounds}
        order={order}
        steps={steps}
        isHost={isHost}
        profiles={profiles}
      />
    );
  }

  /* ============================================================= play === */
  const pct = limit > 0 ? (remaining / limit) * 100 : 0;
  const waitingOn = order.filter(
    (id) => !rounds.some((r) => r.step_index === state.step && r.author_id === id),
  );

  return (
    <>
      <div style={{ textAlign: 'center' }}>
        <div className="label" style={{ padding: 0 }}>
          Round {state.step + 1} of {steps} · {doneThisStep}/{n} in
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
        <div
          className="timer-fill"
          style={{
            width: `${pct}%`,
            background: remaining <= 10 ? 'linear-gradient(90deg,#f0b429,#e0574f)' : undefined,
          }}
        />
      </div>
      <div style={{ fontSize: 12, color: remaining <= 10 ? '#f0b429' : 'var(--ink-faint)' }}>
        {remaining}s left
      </div>

      {submitted ? (
        <div className="empty" style={{ maxWidth: 420 }}>
          Locked in.
          <br />
          {waitingOn.length > 0
            ? `Waiting on ${waitingOn.map(nameOf).join(', ')}…`
            : 'Everyone is done — next round coming up.'}
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
              maxWidth: 520,
              textAlign: 'center',
            }}
          >
            {state.step === 0
              ? 'Draw anything you like'
              : source
                ? source.text_content
                : 'Waiting for the prompt…'}
          </div>
          <DrawCanvas ref={canvasRef} />
          <button className="btn btn-accent" onClick={() => void submit()}>
            <Icon name="check" size={15} />
            Done drawing
          </button>
        </>
      ) : (
        <>
          {kind === 'guess' &&
            (source?.strokes ? (
              <StrokeReplay ops={source.strokes} width={460} />
            ) : (
              <div className="empty">Waiting for the drawing…</div>
            ))}
          <input
            className="input"
            style={{ width: 'min(460px, 90vw)', fontSize: 16 }}
            autoFocus
            maxLength={90}
            placeholder={kind === 'prompt' ? 'A cat running a bank heist' : 'Your best guess'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
          <button className="btn btn-accent" disabled={!text.trim()} onClick={() => void submit()}>
            <Icon name="check" size={15} />
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
              {done && <Icon name="check" size={13} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================================================== lobby ==== */

function GarticLobby({
  session,
  state,
  players,
  profiles,
  isHost,
}: {
  session: GameSession;
  state: GarticState;
  players: GamePlayer[];
  profiles: Map<UUID, Profile>;
  isHost: boolean;
}) {
  const patch = (p: Partial<Settings>) =>
    void setState(session.id, { ...state, settings: { ...state.settings, ...p } }, 'lobby');

  const start = () =>
    void setState(
      session.id,
      {
        ...state,
        phase: 'play',
        step: 0,
        order: players.map((p) => p.profile_id),
        startedAt: new Date().toISOString(),
        albumIndex: 0,
      },
      'active',
    );

  const Select = ({
    label,
    value,
    onChange,
    options,
  }: {
    label: string;
    value: string | number;
    onChange: (v: string) => void;
    options: { value: string | number; label: string }[];
  }) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-dim)', marginBottom: 5 }}>
        {label}
      </span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

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

      <div className="empty" style={{ maxWidth: 460 }}>
        Everyone writes a prompt, then you take turns drawing what the last person wrote and guessing
        what the last person drew. Best with 3 or more.
      </div>

      {isHost ? (
        <>
          <div className="group" style={{ padding: 14, width: 'min(520px, 100%)' }}>
            <div className="label" style={{ padding: '0 0 10px' }}>Game settings</div>
            <div className="two-col">
              <Select
                label="Writing time"
                value={state.settings.writeSeconds}
                onChange={(v) => patch({ writeSeconds: Number(v) })}
                options={[20, 35, 50, 80, 120].map((n) => ({ value: n, label: `${n} seconds` }))}
              />
              <Select
                label="Drawing time"
                value={state.settings.drawSeconds}
                onChange={(v) => patch({ drawSeconds: Number(v) })}
                options={[30, 60, 90, 150, 240].map((n) => ({ value: n, label: `${n} seconds` }))}
              />
              <Select
                label="Rounds"
                value={state.settings.rounds}
                onChange={(v) => patch({ rounds: Number(v) })}
                options={[
                  { value: 0, label: 'One per player' },
                  ...[3, 4, 5, 6, 8, 10].map((n) => ({ value: n, label: `${n} rounds` })),
                ]}
              />
              <Select
                label="Start with"
                value={state.settings.firstStep}
                onChange={(v) => patch({ firstStep: v as FirstStep })}
                options={[
                  { value: 'prompt', label: 'A written prompt' },
                  { value: 'drawing', label: 'Draw anything' },
                ]}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {players.length >= 3 ? (
              <button className="btn btn-accent" onClick={start}>
                <Icon name="play" size={15} />
                Start
              </button>
            ) : players.length >= 2 ? (
              <>
                <button className="btn btn-accent" onClick={start}>
                  <Icon name="play" size={15} />
                  Start anyway with {players.length}
                </button>
                <span className="row-sub" style={{ alignSelf: 'center' }}>It plays better with 3+.</span>
              </>
            ) : (
              <span className="row-sub">Two people minimum — invite someone.</span>
            )}
          </div>
        </>
      ) : (
        <div className="row-sub">
          Waiting for {profiles.get(session.host_id)?.display_name ?? 'the host'} to start…
        </div>
      )}
    </>
  );
}

/* ============================================================== album ==== */

function Album({
  session,
  state,
  rounds,
  order,
  steps,
  isHost,
  profiles,
}: {
  session: GameSession;
  state: GarticState;
  rounds: GarticRound[];
  order: UUID[];
  steps: number;
  isHost: boolean;
  profiles: Map<UUID, Profile>;
}) {
  const [auto, setAuto] = useState(false);

  // Flattened so the reveal walks chain by chain, step by step — the same
  // order the game was actually played in.
  const items = useMemo(() => {
    const out: { chain: number; round: GarticRound }[] = [];
    for (let c = 0; c < order.length; c++) {
      const chain = rounds
        .filter((r) => r.chain_index === c)
        .sort((a, b) => a.step_index - b.step_index);
      for (const r of chain) out.push({ chain: c, round: r });
    }
    return out;
  }, [rounds, order.length]);

  const index = Math.min(state.albumIndex, Math.max(0, items.length - 1));
  const atEnd = index >= items.length - 1;

  const move = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(items.length - 1, to));
      if (next === state.albumIndex) return;
      void setState(session.id, { ...state, albumIndex: next }, 'done');
    },
    [items.length, session.id, state],
  );

  // The host drives the reveal so everyone is looking at the same picture at
  // the same time, which is most of the fun.
  useEffect(() => {
    if (!auto || !isHost || atEnd) return;
    const id = window.setTimeout(() => move(index + 1), 3400);
    return () => window.clearTimeout(id);
  }, [auto, isHost, atEnd, index, move]);

  const nameOf = (id: UUID) => profiles.get(id)?.display_name ?? 'Someone';

  if (items.length === 0) {
    return <div className="empty">Nothing was drawn. Somehow.</div>;
  }

  const current = items[index];
  const startsChain = index === 0 || items[index - 1].chain !== current.chain;
  const pr = profiles.get(current.round.author_id);

  return (
    <div className="album-stage">
      <div style={{ textAlign: 'center' }}>
        <div className="label" style={{ padding: 0 }}>
          {nameOf(order[current.chain])}'s chain · step {current.round.step_index + 1} of {steps}
        </div>
        {startsChain && (
          <div style={{ fontSize: 19, fontWeight: 650, marginTop: 6 }}>
            It started with {nameOf(order[current.chain])}…
          </div>
        )}
      </div>

      <div className="album-card" key={current.round.id}>
        <div className="album-byline">
          <Avatar
            emoji={pr?.avatar_emoji ?? '🙂'}
            url={pr?.avatar_url}
            color={pr?.avatar_color ?? '#555'}
            size={22}
            name={pr?.display_name}
          />
          <b>{nameOf(current.round.author_id)}</b>
          {current.round.kind === 'drawing'
            ? 'drew'
            : current.round.kind === 'prompt'
              ? 'wrote'
              : 'guessed'}
        </div>

        {current.round.kind === 'drawing' ? (
          <StrokeReplay ops={current.round.strokes ?? []} width={480} />
        ) : (
          <div className="album-text">{current.round.text_content}</div>
        )}
      </div>

      <div className="album-dots">
        {items.map((it, i) => (
          <span key={it.round.id} className="album-dot" data-on={i <= index} />
        ))}
      </div>

      {isHost ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-sm" disabled={index === 0} onClick={() => move(index - 1)}>
            <Icon name="undo" size={15} />
            Back
          </button>
          <button className="btn btn-sm" onClick={() => setAuto((a) => !a)}>
            <Icon name={auto ? 'ban' : 'play'} size={15} />
            {auto ? 'Stop autoplay' : 'Autoplay'}
          </button>
          <button className="btn btn-sm btn-accent" disabled={atEnd} onClick={() => move(index + 1)}>
            {atEnd ? "That's everything" : 'Next'}
            <Icon name="reply" size={15} style={{ transform: 'scaleX(-1)' }} />
          </button>
        </div>
      ) : (
        <div className="row-sub">
          {nameOf(session.host_id)} is turning the pages
          {atEnd ? ' — that was the last one.' : '…'}
        </div>
      )}
    </div>
  );
}
