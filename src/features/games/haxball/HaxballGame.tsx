import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { GamePlayer, GameSession, Profile, UUID } from '../../../lib/types';
import { Avatar } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { setState, setTeam } from '../lobby';
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
  DEFAULT_RULES,
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
  type Snapshot,
  type World,
} from './physics';

const TEAM_COLOR = ['#e0574f', '#4a9de0'];
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
  series: Series;
  lastResult: { red: number; blue: number; winner: number } | null;
  startedAt: string | null;
}

function readState(s: Record<string, unknown>): HaxState {
  return {
    phase: (s.phase as HaxState['phase']) ?? 'lobby',
    rules: { ...DEFAULT_RULES, ...((s.rules as Partial<Rules>) ?? {}) },
    teamSize: (s.teamSize as number) ?? 2,
    series: (s.series as Series) ?? { bestOf: 1, wins: { red: 0, blue: 0 }, match: 1 },
    lastResult: (s.lastResult as HaxState['lastResult']) ?? null,
    startedAt: (s.startedAt as string | null) ?? null,
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

  const [score, setScore] = useState({ red: 0, blue: 0 });
  const [clock, setClock] = useState(0);
  const [myCharge, setMyCharge] = useState(0);
  const [ready, setReady] = useState(false);

  const pitch = PITCH_PRESETS[state.rules.pitchSize] ?? PITCH_PRESETS.normal;

  const teamOf = (id: UUID) => players.find((p) => p.profile_id === id)?.team ?? SPECTATOR;
  const onPitch = players.filter((p) => p.team === 0 || p.team === 1);
  const spectators = players.filter((p) => p.team !== 0 && p.team !== 1);
  const iAmPlaying = teamOf(me) !== SPECTATOR;

  const rosterKey = onPitch
    .map((p) => `${p.profile_id}:${p.team}`)
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
    worldRef.current = createWorld(
      onPitch.map((p) => ({ id: p.profile_id, team: p.team as 0 | 1 })),
      state.rules,
    );
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
      step(w, inputsRef.current);
      frame++;
      if (frame % BROADCAST_EVERY === 0) {
        void channelRef.current?.send({ type: 'broadcast', event: 'state', payload: snapshot(w) });
      }
      syncScore(w.score);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [isHost, ready, state.phase]);

  /* -------------------------------------------- host reports the result -- */
  useEffect(() => {
    if (!isHost || state.phase !== 'playing') return;
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
      setMyCharge(w.players.find((p) => p.id === me)?.charge ?? 0);
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

      drawPitch(ctx, w, me, profiles, {
        trail: trailRef.current,
        equippedOf,
        celebrateTotal: celebrateFromRef.current,
      });
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
      { ...state, phase: 'playing', startedAt: new Date().toISOString() },
      'active',
    );

  const canStart = red.length >= 1 && blue.length >= 1;

  const Column = ({ team, list }: { team: number; list: GamePlayer[] }) => (
    <div className="group" style={{ padding: 12, minWidth: 168, flex: 1 }}>
      <div
        className="label"
        style={{ padding: '0 0 8px', color: team < 2 ? TEAM_COLOR[team] : undefined }}
      >
        {team < 2 ? TEAM_NAME[team] : 'Spectators'}
        {team < 2 && ` ${list.length}/${state.teamSize}`}
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
          {canStart ? 'Both teams have someone — ready when the host is.' : 'Each team needs at least one player.'}
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
                  <option value="0.012">Slow (~1.4s)</option>
                  <option value="0.022">Normal (~0.8s)</option>
                  <option value="0.04">Fast (~0.4s)</option>
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

          <button className="btn btn-accent" disabled={!canStart} onClick={start}>
            <Icon name="play" size={15} />
            {canStart ? 'Start match' : 'Need a player on each team'}
          </button>
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
  const mine = w.players.find((q) => q.id === me);
  if (mine && mine.charge > 0.01 && canKick(mine, w.ball)) {
    const reach = 44 + mine.charge * 190;
    ctx.save();
    ctx.setLineDash([6, 7]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + mine.charge * 0.55})`;
    ctx.beginPath();
    ctx.moveTo(w.ball.x, w.ball.y);
    ctx.lineTo(w.ball.x + mine.aimX * reach, w.ball.y + mine.aimY * reach);
    ctx.stroke();
    ctx.setLineDash([]);

    // A small arrowhead so the direction reads at a glance.
    const tipX = w.ball.x + mine.aimX * reach;
    const tipY = w.ball.y + mine.aimY * reach;
    const ang = Math.atan2(mine.aimY, mine.aimX);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(ang - 0.4) * 11, tipY - Math.sin(ang - 0.4) * 11);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(ang + 0.4) * 11, tipY - Math.sin(ang + 0.4) * 11);
    ctx.stroke();
    ctx.restore();
  }

  // Players.
  for (const pl of w.players) {
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, PLAYER_R, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(pl.x - 4, pl.y - 5, 2, pl.x, pl.y, PLAYER_R);
    g.addColorStop(0, lighten(TEAM_COLOR[pl.team]));
    g.addColorStop(1, TEAM_COLOR[pl.team]);
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

    const name = profiles.get(pl.id)?.display_name;
    if (name) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(name, pl.x, pl.y - PLAYER_R - 9);
    }
  }

  // Ball, with a soft shadow so it reads as being above the pitch. Its design
  // belongs to whoever touched it last, the same rule as the trail.
  ctx.beginPath();
  ctx.ellipse(w.ball.x + 2, w.ball.y + 4, BALL_R, BALL_R * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();

  const owner = w.lastTouch ? profiles.get(w.lastTouch) : undefined;
  paintBall(
    cosmetics && w.lastTouch ? cosmetics.equippedOf(w.lastTouch).ball : undefined,
    ctx,
    w.ball.x,
    w.ball.y,
    BALL_R,
    owner?.accent_color ?? '#e0574f',
    w.tick,
  );

  if (w.countdown > 0) {
    const secondsLeft = Math.ceil(w.countdown / 60);
    // Pulse each digit as it lands, so the count reads even at a glance.
    const within = 1 - ((w.countdown % 60) / 60);
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

  if (w.celebrating > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(0, 0, p.w, p.h);

    const scorer = w.lastTouch ? profiles.get(w.lastTouch) : undefined;
    const worn = cosmetics && w.lastTouch ? cosmetics.equippedOf(w.lastTouch) : {};
    const total = cosmetics?.celebrateTotal || 1;
    // Effects run forwards, but `celebrating` counts down.
    const t = 1 - w.celebrating / total;

    if (cosmetics) {
      paintGoalEffect(worn.goalfx, ctx, p.w, p.h, t, scorer?.accent_color ?? '#e0574f');
    }

    ctx.font = '700 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = w.lastScorer === 0 ? TEAM_COLOR[0] : TEAM_COLOR[1];
    ctx.fillText('GOAL', midX, midY);

    const shout = celebrationText(worn.celebration);
    if (shout) {
      ctx.font = '700 24px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(shout, midX, midY + 38);
    }

    if (scorer) {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(scorer.display_name, midX, midY + 64);
    }
  }
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 60);
  const g = Math.min(255, ((n >> 8) & 255) + 60);
  const b = Math.min(255, (n & 255) + 60);
  return `rgb(${r},${g},${b})`;
}
