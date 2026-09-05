import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { GamePlayer, GameSession, Profile, UUID } from '../../../lib/types';
import { Avatar } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { setState, setTeam } from '../lobby';
import { BOT_PREFIX, BOT_SKILL, botInputs, botName, isBot, type BotSkill } from './bot';
import { clampFocus, envelope } from './camera';
import { useEconomy } from '../../../state/economy';
import {
  celebrationText,
  paintBall,
  paintGoalEffect,
  paintTrail,
  type TrailPoint,
} from '../../economy/cosmetics';
import {
  BALL_R,
  CELEBRATION_TICKS,
  DEFAULT_RULES,
  ORB_RADIUS,
  resetKickoff,
  NO_INPUT,
  PITCH_PRESETS,
  PLAYER_R,
  POWER_PRESETS,
  SPEED_PRESETS,
  applySnapshot,
  canKick,
  bounds,
  createWorld,
  secondsRemaining,
  snapshot,
  step,
  type Input,
  type PitchSize,
  type Rules,
  type GoalInfo,
  type Pitch,
  type Snapshot,
  type World,
} from './physics';

const TEAM_COLOR = ['#e0574f', '#4a9de0'];

const BUFF_COLOR: Record<string, string> = {
  speed: '#4fd695',
  power: '#f0b429',
  control: '#4a9de0',
  aim: '#c07aff',
  teleport: '#ff6bd6',
};

const BUFF_LABEL: Record<string, string> = {
  speed: 'Speed',
  power: 'Power',
  control: 'Control',
  aim: 'Aim',
  teleport: 'Teleport',
};

/** How each power-up reads on the pitch. Rare ones get a white rim. */
const ORB_LOOK: Record<string, { color: string; letter: string; rare: boolean; label: string }> = {
  speed: { color: '#4fd695', letter: 'S', rare: false, label: 'Speed' },
  power: { color: '#f0b429', letter: 'P', rare: false, label: 'Shot power' },
  control: { color: '#4a9de0', letter: 'C', rare: false, label: 'Control' },
  aim: { color: '#c07aff', letter: 'A', rare: true, label: 'Aim' },
  teleport: { color: '#ff6bd6', letter: 'T', rare: true, label: 'Teleport' },
};
const TEAM_NAME = ['Red', 'Blue'];
const TICK_MS = 1000 / 60;
const BROADCAST_EVERY = 2; // every other tick -> ~30 snapshots/second

export const SPECTATOR = 2;

interface Series {
  bestOf: number;
  wins: { red: number; blue: number };
  match: number;
}

interface HaxState {
  phase: 'lobby' | 'playing' | 'result';
  rules: Rules;
  teamSize: number;
  /** Extra computer players, by team. */
  bots: { red: number; blue: number };
  botSkill: BotSkill;
  series: Series;
  lastResult: { red: number; blue: number; winner: number } | null;
  startedAt: string | null;
  /** Knocking a ball about on your own: no clock, no score, no rating. */
  practice: boolean;
}

function readState(s: Record<string, unknown>): HaxState {
  return {
    phase: (s.phase as HaxState['phase']) ?? 'lobby',
    rules: { ...DEFAULT_RULES, ...((s.rules as Partial<Rules>) ?? {}) },
    teamSize: (s.teamSize as number) ?? 2,
    bots: (s.bots as { red: number; blue: number }) ?? { red: 0, blue: 0 },
    botSkill: (s.botSkill as BotSkill) ?? 'medium',
    series: (s.series as Series) ?? { bestOf: 1, wins: { red: 0, blue: 0 }, match: 1 },
    lastResult: (s.lastResult as HaxState['lastResult']) ?? null,
    startedAt: (s.startedAt as string | null) ?? null,
    practice: (s.practice as boolean) ?? false,
  };
}

/** Matches needed to take the series. */
function needed(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * Host-authoritative Haxball.
 *
 * One player (the session host) runs the simulation and broadcasts snapshots;
 * everyone else sends key state and draws whatever arrives. Snapshots ride
 * Supabase Realtime broadcast rather than the database — thirty writes a
 * second is not what Postgres is for.
 *
 * Expect this to feel fine for messing about and clearly not to feel like the
 * real thing: every input takes a round trip through Supabase before it shows
 * up, so there is visible input lag that no amount of interpolation hides.
 */
export function HaxballGame({
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
  const isHost = session.host_id === me;
  const { award, equippedOf } = useEconomy();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const inputsRef = useRef<Map<string, Input>>(new Map());
  const myInputRef = useRef<Input>({ ...NO_INPUT });
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const reportedRef = useRef<number>(-1);
  const scoreRef = useRef({ red: 0, blue: 0 });
  /** Recent ball positions, so a trail has something to draw along. */
  const trailRef = useRef<TrailPoint[]>([]);
  /** Frame the current celebration started on, for effect timing. */
  const celebrateFromRef = useRef(0);
  /** Rolling record of the last few seconds, for the goal replay. */
  const tapeRef = useRef<Snapshot[]>([]);
  /** The clip frozen at the moment a goal went in. */
  const clipRef = useRef<Snapshot[]>([]);
  /** A throwaway world used only to draw the replay back. */
  const replayWorldRef = useRef<World | null>(null);

  const [score, setScore] = useState({ red: 0, blue: 0 });
  const [clock, setClock] = useState(0);
  const [myCharge, setMyCharge] = useState(0);
  const [myBuffs, setMyBuffs] = useState<{ kind: string; left: number }[]>([]);
  const [ready, setReady] = useState(false);

  const pitch = PITCH_PRESETS[state.rules.pitchSize] ?? PITCH_PRESETS.normal;

  const teamOf = (id: UUID) => players.find((p) => p.profile_id === id)?.team ?? SPECTATOR;
  const onPitch = players.filter((p) => p.team === 0 || p.team === 1);
  const spectators = players.filter((p) => p.team !== 0 && p.team !== 1);
  const iAmPlaying = teamOf(me) !== SPECTATOR;

  // Computer players are not rows in the database — they exist only in the
  // session state — so they are spliced into the line-up here.
  const lineUp = useMemo(() => {
    const list = onPitch.map((p) => ({ id: p.profile_id, team: p.team as 0 | 1 }));
    for (let i = 0; i < state.bots.red; i++) list.push({ id: `${BOT_PREFIX}r${i + 1}`, team: 0 });
    for (let i = 0; i < state.bots.blue; i++) list.push({ id: `${BOT_PREFIX}b${i + 1}`, team: 1 });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(onPitch.map((p) => [p.profile_id, p.team])), state.bots.red, state.bots.blue]);

  const rosterKey = lineUp
    .map((p) => `${p.id}:${p.team}`)
    .sort()
    .join('|');

  const syncScore = (next: { red: number; blue: number }) => {
    if (next.red === scoreRef.current.red && next.blue === scoreRef.current.blue) return;
    scoreRef.current = { ...next };
    setScore({ ...next });
  };

  /* ------------------------------------------------------------- world -- */
  // Rebuilt for each match, and only when the line-up or the rules actually
  // change — not on every roster object React hands us.
  useEffect(() => {
    if (state.phase !== 'playing') {
      worldRef.current = null;
      setReady(false);
      return;
    }
    worldRef.current = createWorld(lineUp, state.rules);
    // A second world of the same shape, so a replay can be drawn without
    // disturbing the live one.
    replayWorldRef.current = createWorld(lineUp, state.rules);
    tapeRef.current = [];
    clipRef.current = [];
    scoreRef.current = { red: 0, blue: 0 };
    setScore({ red: 0, blue: 0 });
    reportedRef.current = -1;
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.series.match, rosterKey, JSON.stringify(state.rules)]);

  /* --------------------------------------------------------- networking -- */
  useEffect(() => {
    const ch = supabase.channel(`hax:${session.id}`, {
      config: { broadcast: { self: false, ack: false } },
    });

    ch.on('broadcast', { event: 'input' }, ({ payload }) => {
      if (!isHost) return;
      const { id, input } = payload as { id: string; input: Input };
      inputsRef.current.set(id, input);
    });

    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (isHost) return;
      const w = worldRef.current;
      if (!w) return;
      applySnapshot(w, payload as Snapshot);
      syncScore(w.score);
    });

    ch.subscribe();
    channelRef.current = ch;

    return () => {
      void supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [session.id, isHost]);

  /* --------------------------------------------------------------- input - */
  useEffect(() => {
    if (state.phase !== 'playing' || !iAmPlaying) return;

    const KEYS: Record<string, keyof Input> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
      W: 'up', S: 'down', A: 'left', D: 'right',
      ' ': 'kick', x: 'kick', X: 'kick',
    };

    const set = (e: KeyboardEvent, down: boolean) => {
      const key = KEYS[e.key];
      if (!key) return;
      e.preventDefault();
      if (myInputRef.current[key] === down) return;
      myInputRef.current = { ...myInputRef.current, [key]: down };

      if (isHost) {
        inputsRef.current.set(me, myInputRef.current);
      } else {
        void channelRef.current?.send({
          type: 'broadcast',
          event: 'input',
          payload: { id: me, input: myInputRef.current },
        });
      }
    };

    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      // Release everything, or a key held while leaving sticks down forever.
      myInputRef.current = { ...NO_INPUT };
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [state.phase, iAmPlaying, isHost, me]);

  /* -------------------------------------------------------- host loop --- */
  useEffect(() => {
    if (!isHost || !ready || state.phase !== 'playing') return;
    let frame = 0;
    const id = window.setInterval(() => {
      const w = worldRef.current;
      if (!w) return;

      // Bots are decided fresh each tick and merged over the human inputs.
      const inputs = new Map(inputsRef.current);
      if (state.bots.red || state.bots.blue) {
        for (const [id, input] of botInputs(w, state.botSkill)) inputs.set(id, input);
      }

      step(w, inputs);
      frame++;
      if (frame % BROADCAST_EVERY === 0) {
        void channelRef.current?.send({ type: 'broadcast', event: 'state', payload: snapshot(w) });
      }
      syncScore(w.score);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [isHost, ready, state.phase, state.bots.red, state.bots.blue, state.botSkill]);

  /* -------------------------------------------- host reports the result -- */
  useEffect(() => {
    if (!isHost || state.phase !== 'playing' || state.practice) return;
    const id = window.setInterval(() => {
      const w = worldRef.current;
      if (!w || !w.finished) return;
      if (reportedRef.current === state.series.match) return;
      reportedRef.current = state.series.match;

      const wins = { ...state.series.wins };
      if (w.winner === 0) wins.red++;
      else if (w.winner === 1) wins.blue++;

      void setState(
        session.id,
        {
          ...state,
          phase: 'result',
          lastResult: { red: w.score.red, blue: w.score.blue, winner: w.winner ?? -1 },
          series: { ...state.series, wins },
        },
        'active',
      );

      // Rate the match. Everyone on the pitch is scored against the other
      // side; goals they were part of pay the per-score bonus. Only the host
      // reports, and the database refuses a second report for this session.
      // Bots have no rating and no wallet, so only the people are reported.
      void award(
        session.id,
        onPitch.map((p) => ({
          profile_id: p.profile_id,
          outcome:
            w.winner === null
              ? ('draw' as const)
              : p.team === w.winner
                ? ('win' as const)
                : ('loss' as const),
          score: p.team === 0 ? w.score.red : w.score.blue,
        })),
        state.series.match,
      );
    }, 400);
    return () => window.clearInterval(id);
  }, [isHost, state, session.id, onPitch, award]);

  /* --------------------------------------------------- clock + my charge - */
  useEffect(() => {
    if (state.phase !== 'playing') return;
    const id = window.setInterval(() => {
      const w = worldRef.current;
      if (!w) return;
      setClock(secondsRemaining(w));
      const mine = w.players.find((p) => p.id === me);
      setMyCharge(mine?.charge ?? 0);

      if (mine) {
        const carried: { kind: string; left: number }[] = [];
        for (const kind of ['speed', 'power', 'control', 'aim'] as const) {
          if (mine.buffs[kind] > 0) carried.push({ kind, left: Math.ceil(mine.buffs[kind] / 60) });
        }
        if (mine.teleports > 0) carried.push({ kind: 'teleport', left: mine.teleports });
        setMyBuffs(carried);
      } else {
        setMyBuffs([]);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [state.phase, me]);

  /* ------------------------------------------------------------ render -- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || state.phase !== 'playing') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = worldRef.current;
      if (!w) return;

      // Record the run of play. Everyone keeps their own tape from what they
      // are already drawing, so a replay costs nothing on the wire.
      //
      // Only when the world has actually moved on: this loop runs at 60fps but
      // a watching client only hears from the host 30 times a second, so
      // recording every frame filled the tape with duplicate ticks. The replay
      // then covered half the time it claimed to and stuttered through pairs
      // of identical frames.
      if (w.celebrating === 0 && w.countdown === 0 && !w.finished) {
        const tape = tapeRef.current;
        if (tape.length === 0 || tape[tape.length - 1].t !== w.tick) {
          tape.push(snapshot(w));
          if (tape.length > 360) tape.shift();
        }
      }

      // Freeze the tape the instant a goal goes in.
      if (w.celebrating > 0 && clipRef.current.length === 0 && tapeRef.current.length > 12) {
        // Size the clip to the time it will be given, or it plays at whatever
        // ratio happens to fall out. A fixed four seconds squeezed into a
        // practice celebration ran at roughly five times speed.
        const window = Math.round((REPLAY_END - MOMENT_END) * w.celebrating);
        // Slow motion stretches part of the timeline, so a little less footage
        // than the window comes out at about real speed overall.
        const frames = Math.max(40, Math.round(window * 0.72));
        clipRef.current = tapeRef.current.slice(-frames);
      } else if (w.celebrating === 0) {
        clipRef.current = [];
        if (w.countdown === 0) tapeRef.current = tapeRef.current.slice(-360);
      }

      // Ball history for the trail. Kept here rather than in the world so it
      // never has to survive a network round trip.
      if (w.countdown === 0 && w.celebrating === 0) {
        const trail = trailRef.current;
        trail.push({ x: w.ball.x, y: w.ball.y, age: 1 });
        if (trail.length > 20) trail.shift();
        trail.forEach((pt, i) => (pt.age = (i + 1) / trail.length));
      } else {
        trailRef.current = [];
      }

      if (w.celebrating > 0 && celebrateFromRef.current === 0) {
        celebrateFromRef.current = w.celebrating;
      } else if (w.celebrating === 0) {
        celebrateFromRef.current = 0;
      }

      const cosmetics = {
        trail: trailRef.current,
        equippedOf,
        celebrateTotal: celebrateFromRef.current,
      };

      // A goal is a short film rather than a banner: hold on the scorer, run
      // the replay, then fade out into the restart.
      if (w.celebrating > 0) {
        drawGoalSequence(ctx, w, me, profiles, cosmetics, {
          clip: clipRef.current,
          replayWorld: replayWorldRef.current,
          total: celebrateFromRef.current || CELEBRATION_TICKS,
        });
        return;
      }

      drawPitch(ctx, w, me, profiles, cosmetics);

      // Play restarts behind its own countdown, so dim the pitch under it.
      if (w.countdown > 0) {
        ctx.fillStyle = 'rgba(6, 8, 12, 0.35)';
        ctx.fillRect(0, 0, w.pitch.w, w.pitch.h);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [state.phase, me, profiles, equippedOf]);

  /* ============================================================ lobby === */
  if (state.phase === 'lobby') {
    return (
      <HaxLobby
        session={session}
        state={state}
        players={players}
        profiles={profiles}
        me={me}
        isHost={isHost}
      />
    );
  }

  /* =========================================================== result === */
  if (state.phase === 'result') {
    const target = needed(state.series.bestOf);
    const seriesOver =
      state.series.wins.red >= target || state.series.wins.blue >= target;
    const seriesWinner = state.series.wins.red > state.series.wins.blue ? 0 : 1;

    return (
      <>
        <div style={{ textAlign: 'center' }}>
          <div className="label" style={{ padding: 0 }}>
            Match {state.series.match} of best of {state.series.bestOf}
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, margin: '10px 0' }}>
            <span style={{ color: TEAM_COLOR[0] }}>{state.lastResult?.red ?? 0}</span>
            <span style={{ color: 'var(--ink-faint)', fontSize: 24 }}> – </span>
            <span style={{ color: TEAM_COLOR[1] }}>{state.lastResult?.blue ?? 0}</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>
            {state.lastResult?.winner === -1
              ? 'Draw'
              : `${TEAM_NAME[state.lastResult?.winner ?? 0]} takes the match`}
          </div>
        </div>

        <div className="group" style={{ padding: 14, minWidth: 260 }}>
          <div className="label" style={{ padding: '0 0 8px' }}>Series</div>
          <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 26, fontWeight: 700 }}>
            <span style={{ color: TEAM_COLOR[0] }}>{state.series.wins.red}</span>
            <span style={{ color: 'var(--ink-faint)', fontSize: 16, alignSelf: 'center' }}>
              first to {target}
            </span>
            <span style={{ color: TEAM_COLOR[1] }}>{state.series.wins.blue}</span>
          </div>
        </div>

        {seriesOver ? (
          <>
            <div className="turn-banner" data-you="true">
              🏆 {TEAM_NAME[seriesWinner]} wins the series
            </div>
            {isHost && (
              <button
                className="btn"
                onClick={() =>
                  void setState(
                    session.id,
                    {
                      ...state,
                      phase: 'lobby',
                      series: { ...state.series, wins: { red: 0, blue: 0 }, match: 1 },
                      lastResult: null,
                    },
                    'lobby',
                  )
                }
              >
                <Icon name="undo" size={15} />
                Back to the lobby
              </button>
            )}
          </>
        ) : isHost ? (
          <button
            className="btn btn-accent"
            onClick={() =>
              void setState(
                session.id,
                {
                  ...state,
                  phase: 'playing',
                  series: { ...state.series, match: state.series.match + 1 },
                  startedAt: new Date().toISOString(),
                },
                'active',
              )
            }
          >
            <Icon name="play" size={15} />
            Next match
          </button>
        ) : (
          <div className="row-sub">Waiting for the host to start the next match…</div>
        )}
      </>
    );
  }

  /* ========================================================== playing === */
  const target = needed(state.series.bestOf);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <TeamScore team={0} score={score.red} series={state.series.wins.red} />
        <div style={{ textAlign: 'center', minWidth: 90 }}>
          <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 18, fontWeight: 600 }}>
            {clock === Infinity ? '∞' : formatClock(clock)}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', letterSpacing: '0.06em' }}>
            {state.series.bestOf > 1
              ? `MATCH ${state.series.match} · FIRST TO ${target}`
              : `FIRST TO ${state.rules.scoreLimit || '∞'}`}
          </div>
        </div>
        <TeamScore team={1} score={score.blue} series={state.series.wins.blue} />
      </div>

      <div className="canvas-frame">
        <canvas ref={canvasRef} width={pitch.w} height={pitch.h} />
      </div>

      {state.practice && (
        <div className="practice-bar">
          <span className="pill">Practice</span>
          <span className="row-sub" style={{ margin: 0 }}>
            No clock, no score, nothing rated. Have a go at the power system.
          </span>
          <button
            className="btn btn-sm"
            onClick={() => {
              const w = worldRef.current;
              if (!w) return;
              // Straight back to a kickoff, without the whistle and the wait.
              resetKickoff(w);
              w.celebrating = 0;
              w.countdown = 0;
            }}
          >
            <Icon name="undo" size={14} />
            Reset ball
          </button>
        </div>
      )}

      {myBuffs.length > 0 && (
        <div className="buff-row">
          {myBuffs.map((b) => (
            <span key={b.kind} className="buff" style={{ ['--buff' as string]: BUFF_COLOR[b.kind] }}>
              {BUFF_LABEL[b.kind]}
              <b>{b.kind === 'teleport' ? `×${b.left}` : `${b.left}s`}</b>
            </span>
          ))}
        </div>
      )}

      {iAmPlaying ? (
        <div style={{ width: 'min(420px, 90%)' }}>
          <div className="label" style={{ padding: '0 0 5px', textAlign: 'center' }}>
            Shot power — hold {'␣'} space, release to shoot
          </div>
          <div className="timer-bar" style={{ width: '100%', height: 10 }}>
            <div
              className="timer-fill"
              style={{
                width: `${Math.round(myCharge * 100)}%`,
                transition: 'width 60ms linear',
                background:
                  myCharge > 0.85
                    ? 'linear-gradient(90deg,#f0b429,#e0574f)'
                    : 'var(--accent-fill)',
              }}
            />
          </div>
        </div>
      ) : (
        <div className="row-sub">You're spectating. Pick a team in the lobby to play.</div>
      )}

      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', textAlign: 'center', lineHeight: 1.6 }}>
        <b>WASD</b> or arrows to move · hold <b>Space</b> to charge, release to kick
        <br />
        {isHost
          ? 'You are hosting — if you leave, the match ends.'
          : `${profiles.get(session.host_id)?.display_name ?? 'The host'} is running this match.`}
      </div>

      {spectators.length > 0 && (
        <div className="row-sub">
          Watching: {spectators.map((p) => profiles.get(p.profile_id)?.display_name ?? '?').join(', ')}
        </div>
      )}
    </>
  );
}

function TeamScore({ team, score, series }: { team: 0 | 1; score: number; series: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, color: TEAM_COLOR[team] }}>
        {score}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, letterSpacing: '0.06em' }}>
        {TEAM_NAME[team].toUpperCase()}
        {series > 0 && ` · ${series} won`}
      </div>
    </div>
  );
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ============================================================== lobby ==== */

function HaxLobby({
  session,
  state,
  players,
  profiles,
  me,
  isHost,
}: {
  session: GameSession;
  state: HaxState;
  players: GamePlayer[];
  profiles: Map<UUID, Profile>;
  me: UUID;
  isHost: boolean;
}) {
  const [saving, setSaving] = useState(false);

  const red = players.filter((p) => p.team === 0);
  const blue = players.filter((p) => p.team === 1);
  const specs = players.filter((p) => p.team !== 0 && p.team !== 1);

  const patchRules = (patch: Partial<Rules>) =>
    void setState(session.id, { ...state, rules: { ...state.rules, ...patch } }, 'lobby');

  const pick = async (team: number) => {
    setSaving(true);
    await setTeam(session.id, me, team);
    setSaving(false);
  };

  const start = () =>
    void setState(
      session.id,
      { ...state, phase: 'playing', practice: false, startedAt: new Date().toISOString() },
      'active',
    );

  /**
   * An empty pitch and a ball. No clock, no score limit, and a goal resets
   * almost immediately instead of playing the full film.
   */
  const startPractice = async () => {
    await setTeam(session.id, me, 0);
    await setState(
      session.id,
      {
        ...state,
        phase: 'playing',
        practice: true,
        bots: { red: 0, blue: 0 },
        rules: {
          ...state.rules,
          scoreLimit: 0,
          timeLimitSec: 0,
          celebrationTicks: 180,
        },
        startedAt: new Date().toISOString(),
      },
      'active',
    );
  };

  const canStart =
    red.length + state.bots.red >= 1 && blue.length + state.bots.blue >= 1;

  const setBots = (side: 'red' | 'blue', n: number) =>
    void setState(
      session.id,
      { ...state, bots: { ...state.bots, [side]: Math.max(0, Math.min(4, n)) } },
      'lobby',
    );

  const Column = ({ team, list }: { team: number; list: GamePlayer[] }) => (
    <div className="group" style={{ padding: 12, minWidth: 168, flex: 1 }}>
      <div
        className="label"
        style={{ padding: '0 0 8px', color: team < 2 ? TEAM_COLOR[team] : undefined }}
      >
        {team < 2 ? TEAM_NAME[team] : 'Spectators'}
        {team < 2 && ` ${list.length}/${state.teamSize}`}
        {team === 0 && state.bots.red > 0 && ` +${state.bots.red} bot`}
        {team === 1 && state.bots.blue > 0 && ` +${state.bots.blue} bot`}
      </div>
      {list.map((p) => {
        const pr = profiles.get(p.profile_id);
        return (
          <div
            key={p.profile_id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13 }}
          >
            <Avatar
              emoji={pr?.avatar_emoji ?? '🙂'}
              url={pr?.avatar_url}
              color={pr?.avatar_color ?? '#555'}
              size={22}
              name={pr?.display_name}
            />
            {pr?.display_name ?? 'Someone'}
            {p.profile_id === session.host_id && <span className="pill">host</span>}
          </div>
        );
      })}
      {list.length === 0 && <div className="row-sub">Empty</div>}
      <button
        className="btn btn-sm"
        style={{ width: '100%', marginTop: 8 }}
        disabled={saving || (team < 2 && list.length >= state.teamSize)}
        onClick={() => void pick(team)}
      >
        {team < 2 && list.length >= state.teamSize ? 'Full' : 'Join'}
      </button>
    </div>
  );

  return (
    <>
      <div style={{ textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 4px' }}>Pick your side</h3>
        <div className="row-sub">
          {canStart
        ? 'Both sides have someone — ready when the host is.'
        : 'Each side needs at least one player, or a bot to stand in.'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', width: 'min(680px, 100%)' }}>
        <Column team={0} list={red} />
        <Column team={1} list={blue} />
        <Column team={SPECTATOR} list={specs} />
      </div>

      {isHost ? (
        <>
          <div className="group" style={{ padding: 14, width: 'min(560px, 100%)' }}>
            <div className="label" style={{ padding: '0 0 10px' }}>Match settings</div>

            <div className="two-col">
              <Setting label="Team size">
                <select
                  className="select"
                  value={state.teamSize}
                  onChange={(e) =>
                    void setState(session.id, { ...state, teamSize: Number(e.target.value) }, 'lobby')
                  }
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} v {n}</option>
                  ))}
                </select>
              </Setting>

              <Setting label="Pitch">
                <select
                  className="select"
                  value={state.rules.pitchSize}
                  onChange={(e) => patchRules({ pitchSize: e.target.value as PitchSize })}
                >
                  <option value="small">Small</option>
                  <option value="normal">Normal</option>
                  <option value="big">Big</option>
                </select>
              </Setting>

              <Setting label="Player speed">
                <select
                  className="select"
                  value={String(state.rules.playerAccel)}
                  onChange={(e) => patchRules({ playerAccel: Number(e.target.value) })}
                >
                  {Object.entries(SPEED_PRESETS).map(([name, v]) => (
                    <option key={name} value={v}>{name}</option>
                  ))}
                </select>
              </Setting>

              <Setting label="Max shot power">
                <select
                  className="select"
                  value={String(state.rules.kickMax)}
                  onChange={(e) => patchRules({ kickMax: Number(e.target.value) })}
                >
                  {Object.entries(POWER_PRESETS).map(([name, v]) => (
                    <option key={name} value={v}>{name}</option>
                  ))}
                </select>
              </Setting>

              <Setting label="Charge speed">
                <select
                  className="select"
                  value={String(state.rules.chargeRate)}
                  onChange={(e) => patchRules({ chargeRate: Number(e.target.value) })}
                >
                  <option value="0.0037">Slow — 4.5s to full</option>
                  <option value="0.00556">Normal — 3s to full</option>
                  <option value="0.0111">Fast — 1.5s to full</option>
                </select>
              </Setting>

              <Setting label="Ball drag">
                <select
                  className="select"
                  value={String(state.rules.ballDamping)}
                  onChange={(e) => patchRules({ ballDamping: Number(e.target.value) })}
                >
                  <option value="0.975">Heavy</option>
                  <option value="0.99">Normal</option>
                  <option value="0.997">Icy</option>
                </select>
              </Setting>

              <Setting label="Goals to win">
                <select
                  className="select"
                  value={String(state.rules.scoreLimit)}
                  onChange={(e) => patchRules({ scoreLimit: Number(e.target.value) })}
                >
                  {[3, 5, 7, 10].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  <option value="0">No limit</option>
                </select>
              </Setting>

              <Setting label="Match length">
                <select
                  className="select"
                  value={String(state.rules.timeLimitSec)}
                  onChange={(e) => patchRules({ timeLimitSec: Number(e.target.value) })}
                >
                  <option value="120">2 minutes</option>
                  <option value="300">5 minutes</option>
                  <option value="600">10 minutes</option>
                  <option value="0">No clock</option>
                </select>
              </Setting>
            </div>

            <Setting label="Power-up orbs">
              <select
                className="select"
                value={state.rules.powerUps ? 'on' : 'off'}
                onChange={(e) => patchRules({ powerUps: e.target.value === 'on' })}
              >
                <option value="off">Off — a plain match</option>
                <option value="on">On — orbs around the pitch</option>
              </select>
            </Setting>
            <p className="row-sub" style={{ margin: '-4px 0 10px' }}>
              Speed, shot power and control turn up often; aim and teleport are
              rare. Run over one to take it — a teleport is banked until you
              reach for a ball too far away.
            </p>

            <div className="label" style={{ padding: '14px 0 10px' }}>Computer players</div>
            <p className="row-sub" style={{ margin: '0 0 10px' }}>
              Fill out a side when there are not enough of you. Bots have no
              rating and earn nobody anything — they are there to make up the
              numbers.
            </p>
            <div className="two-col">
              <Setting label="Red bots">
                <select
                  className="select"
                  value={state.bots.red}
                  onChange={(e) => setBots('red', Number(e.target.value))}
                >
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Setting>
              <Setting label="Blue bots">
                <select
                  className="select"
                  value={state.bots.blue}
                  onChange={(e) => setBots('blue', Number(e.target.value))}
                >
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Setting>
              <Setting label="Bot skill">
                <select
                  className="select"
                  value={state.botSkill}
                  onChange={(e) =>
                    void setState(
                      session.id,
                      { ...state, botSkill: e.target.value as BotSkill },
                      'lobby',
                    )
                  }
                >
                  {(Object.keys(BOT_SKILL) as BotSkill[]).map((s) => (
                    <option key={s} value={s}>{BOT_SKILL[s].label}</option>
                  ))}
                </select>
              </Setting>
            </div>

            <div className="label" style={{ padding: '14px 0 10px' }}>Tournament</div>
            <Setting label="Series length">
              <select
                className="select"
                value={String(state.series.bestOf)}
                onChange={(e) =>
                  void setState(
                    session.id,
                    { ...state, series: { ...state.series, bestOf: Number(e.target.value) } },
                    'lobby',
                  )
                }
              >
                <option value="1">Single match</option>
                <option value="3">Best of 3</option>
                <option value="5">Best of 5</option>
                <option value="7">Best of 7</option>
              </select>
            </Setting>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn btn-accent" disabled={!canStart} onClick={start}>
              <Icon name="play" size={15} />
              {canStart ? 'Start match' : 'Need a player on each team'}
            </button>

            <button className="btn" onClick={() => void startPractice()}>
              <Icon name="football" size={15} />
              Practice on your own
            </button>
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

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span
        style={{
          display: 'block',
          fontSize: 11.5,
          fontWeight: 550,
          color: 'var(--ink-dim)',
          marginBottom: 5,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

/* ============================================================ drawing ==== */

interface Cosmetics {
  trail: TrailPoint[];
  equippedOf: (id: UUID) => Record<string, string>;
  /** How many celebration frames there were in total, for effect progress. */
  celebrateTotal: number;
}

function drawPitch(
  ctx: CanvasRenderingContext2D,
  w: World,
  me: UUID,
  profiles: Map<UUID, Profile>,
  cosmetics?: Cosmetics,
): void {
  const p = w.pitch;
  const { left, right, top, bottom, goalTop, goalBottom } = bounds(p);
  const midX = p.w / 2;
  const midY = p.h / 2;

  // Grass, with mown stripes running down the pitch.
  ctx.fillStyle = '#1b3a25';
  ctx.fillRect(0, 0, p.w, p.h);
  const stripes = 10;
  const stripeW = (right - left) / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#1f4229' : '#1b3a25';
    ctx.fillRect(left + i * stripeW, top, stripeW, bottom - top);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);

  ctx.strokeRect(left, top, right - left, bottom - top);

  ctx.beginPath();
  ctx.moveTo(midX, top);
  ctx.lineTo(midX, bottom);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(midX, midY, Math.min(72, (bottom - top) / 5), 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(midX, midY, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();

  // Penalty and six-yard boxes at each end.
  const boxD = Math.min(86, (right - left) / 6);
  const boxH = p.goalHeight + 90;
  const smallD = boxD / 2.4;
  const smallH = p.goalHeight + 26;
  for (const side of [0, 1]) {
    const x = side === 0 ? left : right - boxD;
    ctx.strokeRect(x, midY - boxH / 2, boxD, boxH);
    const sx = side === 0 ? left : right - smallD;
    ctx.strokeRect(sx, midY - smallH / 2, smallD, smallH);
  }

  // Corner arcs.
  for (const [cx, cy, a0] of [
    [left, top, 0],
    [right, top, Math.PI / 2],
    [right, bottom, Math.PI],
    [left, bottom, -Math.PI / 2],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, 12, a0, a0 + Math.PI / 2);
    ctx.stroke();
  }

  // Goals: netting behind a coloured frame.
  for (const side of [0, 1]) {
    const x = side === 0 ? left : right;
    const dir = side === 0 ? -1 : 1;
    const depth = p.goalDepth;

    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.min(x, x + dir * depth), goalTop, depth, goalBottom - goalTop);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    for (let i = -depth; i < depth * 2; i += 6) {
      ctx.beginPath();
      ctx.moveTo(x + dir * i, goalTop);
      ctx.lineTo(x + dir * (i + depth), goalBottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + dir * (i + depth), goalTop);
      ctx.lineTo(x + dir * i, goalBottom);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = TEAM_COLOR[side];
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, goalTop);
    ctx.lineTo(x + dir * depth, goalTop);
    ctx.lineTo(x + dir * depth, goalBottom);
    ctx.lineTo(x, goalBottom);
    ctx.stroke();
  }

  // The ball's trail belongs to whoever touched it last, not to whoever is
  // watching, so both the style and the colour come from that player.
  if (cosmetics && w.lastTouch && w.celebrating === 0 && w.countdown === 0) {
    const owner = profiles.get(w.lastTouch);
    paintTrail(
      cosmetics.equippedOf(w.lastTouch).trail,
      ctx,
      cosmetics.trail,
      owner?.accent_color ?? '#e0574f',
      w.tick,
    );
  }

  // The aim guide is drawn only while the local player is charging AND the
  // ball is within reach. Holding the key across the pitch used to draw a line
  // to a ball nobody could hit.
  // A fixed run of dots. It says where the ball will go, and nothing else —
  // the power meter already says how hard, so a guide that grows with charge
  // was saying the same thing twice and making the pitch look busy.
  const mine = w.players.find((q) => q.id === me);
  if (mine && mine.charge > 0.01 && canKick(mine, w.ball)) {
    const dots = 7;
    const gap = 22;
    ctx.save();
    for (let i = 1; i <= dots; i++) {
      const fade = 1 - (i - 1) / dots;
      ctx.beginPath();
      ctx.arc(w.ball.x + mine.aimX * i * gap, w.ball.y + mine.aimY * i * gap, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${(0.25 + mine.charge * 0.5) * fade})`;
      ctx.fill();
    }
    ctx.restore();
  }

  // Power-up orbs, under the players so nobody is hidden behind one.
  for (const orb of w.orbs) {
    if (!orb.active) continue;
    const look = ORB_LOOK[orb.kind];
    const bob = Math.sin(w.tick / 18 + orb.id) * 3;

    ctx.save();
    ctx.translate(orb.x, orb.y + bob);
    ctx.rotate(w.tick / 40 + orb.id);

    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, ORB_RADIUS + 8);
    glow.addColorStop(0, look.color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = glow;
    ctx.fillRect(-ORB_RADIUS - 8, -ORB_RADIUS - 8, (ORB_RADIUS + 8) * 2, (ORB_RADIUS + 8) * 2);
    ctx.globalAlpha = 1;

    // A diamond, so the rare ones read differently from the ball at a glance.
    ctx.beginPath();
    ctx.moveTo(0, -ORB_RADIUS);
    ctx.lineTo(ORB_RADIUS, 0);
    ctx.lineTo(0, ORB_RADIUS);
    ctx.lineTo(-ORB_RADIUS, 0);
    ctx.closePath();
    ctx.fillStyle = look.color;
    ctx.fill();
    ctx.lineWidth = look.rare ? 2.5 : 1.5;
    ctx.strokeStyle = look.rare ? '#ffffff' : 'rgba(0,0,0,0.45)';
    ctx.stroke();
    ctx.restore();

    ctx.font = '800 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(look.letter, orb.x, orb.y + bob + 4);
  }

  // Players.
  for (const pl of w.players) {
    const name = isBot(pl.id) ? botName(pl.id) : profiles.get(pl.id)?.display_name;
    const base = TEAM_COLOR[pl.team];

    ctx.beginPath();
    ctx.arc(pl.x, pl.y, PLAYER_R, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(pl.x - 4, pl.y - 5, 2, pl.x, pl.y, PLAYER_R);
    // Holding the kick key pales the disc, which is how you read intent from
    // across the pitch without any text.
    g.addColorStop(0, lighten(base, pl.kickHeld ? 130 : 60));
    g.addColorStop(1, pl.kickHeld ? lighten(base, 80) : base);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = pl.id === me ? 3 : 2;
    ctx.strokeStyle = pl.id === me ? '#ffffff' : 'rgba(0,0,0,0.45)';
    ctx.stroke();

    // Charge ring: fills clockwise as the shot builds.
    if (pl.charge > 0.01) {
      ctx.beginPath();
      ctx.arc(pl.x, pl.y, PLAYER_R + 5, -Math.PI / 2, -Math.PI / 2 + pl.charge * Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = pl.charge > 0.85 ? '#f0b429' : 'rgba(255,255,255,0.85)';
      ctx.stroke();
    }

    // Initials inside the disc, so a crowded box is still readable when the
    // names above everyone overlap.
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pl.kickHeld ? 'rgba(30,20,20,0.85)' : 'rgba(255,255,255,0.92)';
    ctx.fillText(initials(name), pl.x, pl.y + 0.5);
    ctx.textBaseline = 'alphabetic';

    if (name) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(name, pl.x, pl.y - PLAYER_R - 9);
    }

    // What they are carrying, as small pips under the disc.
    const carried: string[] = [];
    if (pl.buffs.speed > 0) carried.push('speed');
    if (pl.buffs.power > 0) carried.push('power');
    if (pl.buffs.control > 0) carried.push('control');
    if (pl.buffs.aim > 0) carried.push('aim');
    for (let i = 0; i < pl.teleports; i++) carried.push('teleport');

    carried.forEach((kind, i) => {
      const look = ORB_LOOK[kind as keyof typeof ORB_LOOK];
      const spread = (i - (carried.length - 1) / 2) * 11;
      ctx.beginPath();
      ctx.arc(pl.x + spread, pl.y + PLAYER_R + 8, 4, 0, Math.PI * 2);
      ctx.fillStyle = look.color;
      ctx.fill();
    });
  }

  // Ball, with a soft shadow so it reads as being above the pitch. Its design
  // belongs to whoever touched it last, the same rule as the trail.
  ctx.beginPath();
  ctx.ellipse(w.ball.x + 2, w.ball.y + 4, BALL_R, BALL_R * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();

  // The ball wears YOUR design, not the last toucher's. A ball that changes
  // appearance every time possession turns over is disorienting to follow.
  paintBall(
    cosmetics ? cosmetics.equippedOf(me).ball : undefined,
    ctx,
    w.ball.x,
    w.ball.y,
    BALL_R,
    profiles.get(me)?.accent_color ?? '#e0574f',
    w.tick,
  );

  if (w.countdown > 0) {
    // Snapshots arrive at 30Hz, so counting straight off the tick stutters.
    // Smooth it against the wall clock between updates instead.
    const smooth = smoothCountdown(w.countdown);
    const secondsLeft = Math.ceil(smooth / 60);
    const within = 1 - ((smooth % 60) / 60);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, p.w, p.h);

    ctx.save();
    ctx.translate(midX, midY);
    ctx.scale(1 + (1 - within) * 0.35, 1 + (1 - within) * 0.35);
    ctx.globalAlpha = 0.35 + within * 0.65;
    ctx.font = '700 86px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(secondsLeft > 0 ? String(secondsLeft) : 'GO', 0, 30);
    ctx.restore();

    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('Get to your side', midX, midY + 76);
  }

}

/* ======================================================= goal sequence ==== */

/**
 * The three acts, as fractions of the celebration, and how much they overlap.
 *
 * The overlap is the whole trick: each act is drawn over the one before it
 * with a rising alpha, so the picture never cuts and never dips to black. The
 * only darkening anywhere in the game belongs to the countdown.
 */
const MOMENT_END = 0.34;
const REPLAY_END = 0.88;
const CROSSFADE = 0.05;

interface Tape {
  clip: Snapshot[];
  replayWorld: World | null;
  total: number;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

/** Whoever this is, said the way a commentator would. */
function nameFor(id: string | null, profiles: Map<UUID, Profile>): string {
  if (!id) return 'Somebody';
  if (isBot(id)) return botName(id);
  return profiles.get(id)?.display_name ?? 'Somebody';
}

/**
 * Where in the clip to be at this point of the replay.
 *
 * Deliberately not linear: normal speed up to the shot, a crawl through the
 * strike, then a release. A replay at one speed shows you everything except
 * the bit you wanted to see.
 */
function replayFrame(progress: number, length: number, shotIndex: number): number {
  const last = length - 1;
  if (last <= 0) return 0;

  const slowFrom = Math.max(0, shotIndex - 22);
  const slowTo = Math.min(last, shotIndex + 16);

  if (progress < 0.5) return (progress / 0.5) * slowFrom;
  if (progress < 0.82) return slowFrom + ((progress - 0.5) / 0.32) * (slowTo - slowFrom);
  return slowTo + ((progress - 0.82) / 0.18) * (last - slowTo);
}

/**
 * Run `draw` with a point of the pitch pinned to a point of the screen.
 *
 * Anchoring rather than always centring is what lets the scorer sit on the
 * right while the caption occupies the left.
 */
function withCamera(
  ctx: CanvasRenderingContext2D,
  pitch: Pitch,
  focus: { x: number; y: number } | null,
  zoom: number,
  anchorX: number,
  anchorY: number,
  draw: () => void,
): void {
  ctx.save();
  if (focus) {
    // Pulled back onto the pitch first: the grass is painted in world space,
    // so any part of the screen looking past the touchline would simply keep
    // the previous frame and smear the goal across it.
    const safe = clampFocus(pitch, focus, zoom, anchorX, anchorY);
    ctx.translate(anchorX, anchorY);
    ctx.scale(Math.max(1, zoom), Math.max(1, zoom));
    ctx.translate(-safe.x, -safe.y);
  }
  draw();
  ctx.restore();
}

/** The bars that say "stop playing and watch this". */
function letterbox(ctx: CanvasRenderingContext2D, w: World, amount: number): void {
  const bar = w.pitch.h * 0.12 * easeOut(amount);
  if (bar <= 0.5) return;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, w.pitch.w, bar);
  ctx.fillRect(0, w.pitch.h - bar, w.pitch.w, bar);
}

/** Lerp a snapshot pair, so slow motion stays smooth instead of stepping. */
function blendInto(w: World, a: Snapshot, b: Snapshot, k: number): void {
  applySnapshot(w, a);
  const mix = (from: number, to: number) => from + (to - from) * k;

  w.ball.x = mix(a.b[0], b.b[0]);
  w.ball.y = mix(a.b[1], b.b[1]);

  for (const player of w.players) {
    const from = a.p.find((q) => q[0] === player.id);
    const to = b.p.find((q) => q[0] === player.id);
    if (!from || !to) continue;
    player.x = mix(from[1], to[1]);
    player.y = mix(from[2], to[2]);
    player.charge = mix(from[6], to[6]);
  }
}

/** Where the net is, which is where a goal effect should come from. */
function goalMouth(w: World, side: 0 | 1): { x: number; y: number } {
  const { left, right } = bounds(w.pitch);
  return { x: side === 0 ? left : right, y: w.pitch.h / 2 };
}

/** The caption down the left: GOAL, who scored, who set it up. */
function goalCard(
  ctx: CanvasRenderingContext2D,
  w: World,
  goal: GoalInfo | null,
  scorerId: string | null,
  profiles: Map<UUID, Profile>,
  rise: number,
): void {
  if (rise <= 0) return;
  const p = w.pitch;
  const x = 26;
  const slide = (1 - rise) * 26;

  ctx.save();
  ctx.globalAlpha *= Math.min(1, rise);
  ctx.textAlign = 'left';

  ctx.font = '800 54px system-ui, sans-serif';
  ctx.fillStyle = goal ? TEAM_COLOR[goal.team] : '#ffffff';
  ctx.fillText('GOAL', x - slide, p.h * 0.45);

  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(nameFor(scorerId, profiles), x - slide, p.h * 0.45 + 32);

  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  if (goal?.ownGoal) {
    ctx.fillText('own goal', x - slide, p.h * 0.45 + 54);
  } else if (goal?.assist) {
    ctx.fillText(`assist  ${nameFor(goal.assist, profiles)}`, x - slide, p.h * 0.45 + 54);
  } else {
    ctx.fillText('unassisted', x - slide, p.h * 0.45 + 54);
  }
  ctx.restore();
}

function drawGoalSequence(
  ctx: CanvasRenderingContext2D,
  w: World,
  me: UUID,
  profiles: Map<UUID, Profile>,
  cosmetics: Cosmetics,
  tape: Tape,
): void {
  const p = w.pitch;
  const t = 1 - w.celebrating / tape.total;
  const goal = w.goal;

  const scorerId = goal?.scorer ?? w.lastTouch;
  const scorer = w.players.find((q) => q.id === scorerId);
  const focus = scorer ?? (goal ? { x: goal.x, y: goal.y } : null);
  const net = goalMouth(w, goal?.side ?? 1);

  const aMoment = envelope(t, 0, MOMENT_END, CROSSFADE);
  const aReplay = envelope(t, MOMENT_END, REPLAY_END, CROSSFADE);
  const aRestart = envelope(t, REPLAY_END, 1, CROSSFADE);

  /* ------------------------------------------------ 1. hold on the scorer */
  if (aMoment > 0) {
    const local = Math.min(1, t / MOMENT_END);
    const zoom = 1 + 1.1 * easeOut(local / 0.4);
    // The player is pinned to the right so the caption has the left third.
    const anchorX = p.w * (0.5 + 0.18 * easeOut(local / 0.4));

    ctx.globalAlpha = aMoment;
    withCamera(ctx, p, focus, zoom, anchorX, p.h / 2, () => {
      drawPitch(ctx, w, me, profiles, { ...cosmetics, celebrateTotal: 0 });

      if (scorer) {
        const pulse = 1 + Math.sin(local * 14) * 0.08;
        ctx.beginPath();
        ctx.arc(scorer.x, scorer.y, (PLAYER_R + 12) * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = TEAM_COLOR[scorer.team];
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }

      // An own goal gets no fireworks and no catchphrase — it is announced
      // and left alone.
      if (scorerId && !goal?.ownGoal) {
        paintGoalEffect(
          cosmetics.equippedOf(scorerId).goalfx,
          ctx,
          p.w,
          p.h,
          Math.min(1, local / 0.75),
          profiles.get(scorerId)?.accent_color ?? TEAM_COLOR[goal?.team ?? 0],
          net.x,
          net.y,
        );
      }

      // The celebration pops out of the scorer on a little tail.
      const shout = scorerId ? celebrationText(cosmetics.equippedOf(scorerId).celebration) : '';
      if (shout && scorer && !goal?.ownGoal) {
        const pop = easeOut((local - 0.12) / 0.26);
        if (pop > 0) {
          ctx.save();
          ctx.translate(scorer.x, scorer.y - PLAYER_R - 18);
          ctx.scale(pop, pop);
          ctx.font = '800 15px system-ui, sans-serif';
          ctx.textAlign = 'center';
          const width = ctx.measureText(shout).width + 20;

          ctx.beginPath();
          ctx.roundRect(-width / 2, -17, width, 24, 12);
          ctx.fillStyle = TEAM_COLOR[scorer.team];
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-5, 6);
          ctx.lineTo(0, 13);
          ctx.lineTo(5, 6);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.fillText(shout, 0, 0);
          ctx.restore();
        }
      }
    });

    letterbox(ctx, w, local / 0.3);
    goalCard(ctx, w, goal, scorerId, profiles, easeOut((local - 0.1) / 0.3));
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------------------- 2. the replay */
  if (aReplay > 0 && tape.clip.length > 1 && tape.replayWorld) {
    const local = Math.min(1, Math.max(0, (t - MOMENT_END) / (REPLAY_END - MOMENT_END)));
    const clip = tape.clip;

    let shotIndex = clip.length - 1;
    if (goal) {
      const found = clip.findIndex((f) => f.t >= goal.shotTick);
      if (found >= 0) shotIndex = found;
    }

    // A float index, blended between neighbours — stepping whole frames at a
    // third of speed is what made the slow motion judder.
    const exact = replayFrame(local, clip.length, shotIndex);
    const i = Math.min(clip.length - 2, Math.max(0, Math.floor(exact)));
    const rw = tape.replayWorld;
    blendInto(rw, clip[i], clip[i + 1], Math.min(1, Math.max(0, exact - i)));
    rw.celebrating = 0;
    rw.countdown = 0;
    rw.goal = null;

    ctx.globalAlpha = aReplay;
    withCamera(ctx, p, { x: rw.ball.x, y: rw.ball.y }, 1.5, p.w / 2, p.h / 2, () => {
      drawPitch(ctx, rw, me, profiles, {
        trail: [],
        equippedOf: cosmetics.equippedOf,
        celebrateTotal: 0,
      });
    });

    letterbox(ctx, w, 1);
    drawReplayBadge(ctx, p.w, local);

    const bar = p.h * 0.12;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(nameFor(scorerId, profiles), 18, p.h - bar * 0.42);

    if (goal?.assist) {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(`assist ${nameFor(goal.assist, profiles)}`, 18, p.h - bar * 0.42 + 17);
    }

    ctx.textAlign = 'right';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillStyle = TEAM_COLOR[0];
    ctx.fillText(String(w.score.red), p.w - 46, p.h - bar * 0.42);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('–', p.w - 32, p.h - bar * 0.42);
    ctx.fillStyle = TEAM_COLOR[1];
    ctx.fillText(String(w.score.blue), p.w - 16, p.h - bar * 0.42);
    ctx.restore();

    if (local > 0.5 && local < 0.82) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('SLOW MOTION', p.w / 2, bar * 0.62);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------- 3. back to a live wide shot */
  if (aRestart > 0) {
    const local = Math.min(1, Math.max(0, (t - REPLAY_END) / (1 - REPLAY_END)));
    ctx.globalAlpha = aRestart;
    drawPitch(ctx, w, me, profiles, { ...cosmetics, celebrateTotal: 0 });
    letterbox(ctx, w, 1 - local);
    ctx.globalAlpha = 1;
  }
}

/** The corner marker and progress bar that say "this is not live". */
function drawReplayBadge(ctx: CanvasRenderingContext2D, width: number, progress: number): void {
  ctx.save();

  ctx.fillStyle = 'rgba(10, 10, 14, 0.72)';
  ctx.beginPath();
  ctx.roundRect(16, 14, 132, 30, 8);
  ctx.fill();

  // A blinking dot, the way a recording light behaves.
  const on = Math.floor(progress * 12) % 2 === 0;
  ctx.beginPath();
  ctx.arc(34, 29, 5, 0, Math.PI * 2);
  ctx.fillStyle = on ? '#e0574f' : 'rgba(224, 87, 79, 0.35)';
  ctx.fill();

  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('REPLAY', 48, 34);

  // How far through the clip we are.
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(16, 48, width - 32, 3);
  ctx.fillStyle = '#e0574f';
  ctx.fillRect(16, 48, (width - 32) * progress, 3);

  ctx.restore();
}

function lighten(hex: string, by = 60): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + by);
  const g = Math.min(255, ((n >> 8) & 255) + by);
  const b = Math.min(255, (n & 255) + by);
  return `rgb(${r},${g},${b})`;
}

/** Up to two letters from a name, for the middle of a player disc. */
function initials(name: string | undefined): string {
  if (!name) return '?';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * A countdown that ticks evenly however often the number arrives.
 *
 * The host counts at 60Hz but broadcasts at 30, so a client reading the raw
 * value redraws the same number twice then jumps two. Interpolating against
 * the wall clock between updates removes the stutter without pretending to
 * know anything the host has not said.
 */
let lastCountdown = { value: -1, at: 0 };

function smoothCountdown(ticks: number): number {
  const now = performance.now();
  if (ticks !== lastCountdown.value) {
    lastCountdown = { value: ticks, at: now };
    return ticks;
  }
  // 60 ticks a second, and never run past the value we were last told.
  const elapsed = ((now - lastCountdown.at) / 1000) * 60;
  return Math.max(0, ticks - Math.min(elapsed, 2));
}
