import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { GamePlayer, GameSession, Profile, UUID } from '../../../lib/types';
import { Avatar } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { setState, setTeam } from '../lobby';
import { BOT_PREFIX, BOT_SKILL, botInputs, botName, isBot, type BotSkill } from './bot';
import { clampFocus, envelope } from './camera';
import { inSlowMotion, planReplay, sampleAt, tickAt } from './replay';
import { countsForRating, matchOutcomes } from './report';
import { useEconomy } from '../../../state/economy';
import {
  celebrationText,
  paintBall,
  paintGoalEffect,
  paintTrail,
  withAlpha,
  type TrailPoint,
} from '../../economy/cosmetics';
import { paintBanner } from '../../economy/banners';
import { MODES, modeById, modeOf } from './modes';
import { flagCodeOf, paintFlagDisc } from '../../economy/flags';
import {
  BALL_R,
  CELEBRATION_TICKS,
  CHARGE_PRESETS,
  DEFAULT_RULES,
  EFFECT_KINDS,
  EVENTS,
  FULL_POWER,
  ORB_RADIUS,
  POST_R,
  PRACTICE_CELEBRATION_TICKS,
  SURROUND,
  WEATHER,
  WEATHER_KINDS,
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
  posts,
  secondsRemaining,
  snapshot,
  step,
  type Input,
  type PitchSize,
  type Rules,
  type GoalInfo,
  type Pitch,
  type Snapshot,
  type Weather,
  type World,
} from './physics';

const TEAM_COLOR = ['#e0574f', '#4a9de0'];

const BUFF_COLOR: Record<string, string> = {
  speed: '#4fd695',
  power: '#f0b429',
  control: '#4a9de0',
  aim: '#c07aff',
  teleport: '#ff6bd6',
  slow: '#9aa0aa',
  reverse: '#ff7a6e',
  butter: '#d9b06a',
  blind: '#7a6bff',
};

const BUFF_LABEL: Record<string, string> = {
  speed: 'Speed',
  power: 'Power',
  control: 'Control',
  aim: 'Aim',
  teleport: 'Teleport',
  slow: 'Leaden',
  reverse: 'Reversed',
  butter: 'Butterfingers',
  blind: 'Blinded',
};

/** How each power-up reads on the pitch. Rare ones get a white rim. */
const ORB_LOOK: Record<string, { color: string; letter: string; rare: boolean; label: string }> = {
  speed: { color: '#4fd695', letter: 'S', rare: false, label: 'Speed' },
  power: { color: '#f0b429', letter: 'P', rare: false, label: 'Shot power' },
  control: { color: '#4a9de0', letter: 'C', rare: false, label: 'Control' },
  aim: { color: '#c07aff', letter: 'A', rare: true, label: 'Aim' },
  teleport: { color: '#ff6bd6', letter: 'T', rare: true, label: 'Teleport' },
  // Curses share the shape so they cannot be told apart at a glance from the
  // far side of the pitch — that gamble is the point of switching them on.
  slow: { color: '#9aa0aa', letter: '!', rare: false, label: 'Leaden legs' },
  reverse: { color: '#ff7a6e', letter: '!', rare: false, label: 'Reversed controls' },
  butter: { color: '#d9b06a', letter: '!', rare: false, label: 'Butterfingers' },
  blind: { color: '#7a6bff', letter: '!', rare: false, label: 'Blinded' },
};
const TEAM_NAME = ['Red', 'Blue'];
const TICK_MS = 1000 / 60;
const BROADCAST_EVERY = 2; // every other tick -> ~30 snapshots/second

/** How far back the replay tape reaches. Eight seconds is more than a replay
 *  ever shows, which leaves the run-up room to start wherever it needs to. */
const TAPE_TICKS = 60 * 8;

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

/**
 * The rules a match is actually played under.
 *
 * How long the goal sequence runs is not one of them, and never was — it is a
 * constant that depends on nothing but whether this is a practice. It lives in
 * `Rules` only because the simulation reads its settings from one object.
 */
export function effectiveRules(state: HaxState): Rules {
  if (!state.practice) return state.rules;
  return {
    ...state.rules,
    scoreLimit: 0,
    timeLimitSec: 0,
    celebrationTicks: PRACTICE_CELEBRATION_TICKS,
  };
}

/**
 * Read a room's saved state.
 *
 * Note what happens to `celebrationTicks`: whatever is stored is thrown away.
 *
 * Practice used to write its overrides straight into the room's saved rules,
 * so starting a knockabout left `celebrationTicks: 180` sitting in that room's
 * row for ever. Deriving the practice values instead stopped *new* rooms being
 * spoiled, but it did nothing whatsoever for the rooms already carrying it --
 * and a stored rule wins over a default, so those rooms kept playing a
 * three-second goal sequence with a two-second replay squeezed into it. Which
 * is exactly the report, twice over, after two fixes that could not have
 * touched it.
 *
 * A setting no host can change has no business surviving in storage, so it
 * does not: it is overwritten on the way in, and the poison in any existing
 * room row is simply never read.
 */
export function readState(s: Record<string, unknown>): HaxState {
  return {
    phase: (s.phase as HaxState['phase']) ?? 'lobby',
    rules: {
      ...DEFAULT_RULES,
      ...((s.rules as Partial<Rules>) ?? {}),
      celebrationTicks: CELEBRATION_TICKS,
    },
    teamSize: (s.teamSize as number) ?? 2,
    bots: (s.bots as { red: number; blue: number }) ?? { red: 0, blue: 0 },
    botSkill: (s.botSkill as BotSkill) ?? 'medium',
    series: (s.series as Series) ?? { bestOf: 1, wins: { red: 0, blue: 0 }, match: 1 },
    lastResult: (s.lastResult as HaxState['lastResult']) ?? null,
    startedAt: (s.startedAt as string | null) ?? null,
    practice: (s.practice as boolean) ?? false,
  };
}

/** Whether the buff strip actually needs redrawing. */
function sameBuffs(
  a: { kind: string; left: number }[],
  b: { kind: string; left: number }[],
): boolean {
  return a.length === b.length && a.every((x, i) => x.kind === b[i].kind && x.left === b[i].left);
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

  /** Rolling record of the last few seconds, for the goal replay. */
  const tapeRef = useRef<Snapshot[]>([]);
  /** The clip frozen at the moment a goal went in. */
  const clipRef = useRef<Snapshot[]>([]);
  /** A throwaway world used only to draw the replay back. */
  const replayWorldRef = useRef<World | null>(null);
  /** Where the replay camera has got to, so it can lag behind the ball. */
  const replayCamRef = useRef({ x: 0, y: 0 });
  /**
   * The roster the current match is being played with.
   *
   * Frozen at kickoff on purpose. The world used to be rebuilt whenever the
   * line-up changed, so somebody walking into the room mid-match restarted it
   * for everyone — which is exactly what it looked like.
   */
  const lineUpRef = useRef<{ id: string; team: 0 | 1 }[]>([]);

  const [score, setScore] = useState({ red: 0, blue: 0 });
  const [clock, setClock] = useState(0);
  const [myCharge, setMyCharge] = useState(0);
  const [myBuffs, setMyBuffs] = useState<{ kind: string; left: number }[]>([]);
  const [ready, setReady] = useState(false);

  const rules = useMemo(() => effectiveRules(state), [state]);
  const pitch = PITCH_PRESETS[rules.pitchSize] ?? PITCH_PRESETS.normal;

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

  // Read rather than depended on: the world is built from whoever was on the
  // pitch when the whistle went, and pays no attention to the roster after.
  lineUpRef.current = lineUp;

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
    worldRef.current = createWorld(lineUpRef.current, rules);
    // A second world of the same shape, so a replay can be drawn without
    // disturbing the live one.
    replayWorldRef.current = createWorld(lineUpRef.current, rules);
    tapeRef.current = [];
    clipRef.current = [];
    scoreRef.current = { red: 0, blue: 0 };
    setScore({ red: 0, blue: 0 });
    reportedRef.current = -1;
    setReady(true);
    // Deliberately *not* keyed on the roster: see `lineUpRef`. A new match, a
    // new round of the series or a rule change rebuilds the world; somebody
    // arriving or leaving mid-match does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.series.match, JSON.stringify(rules)]);

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

  /**
   * Put my input on the wire — or straight into the map, if I am the host.
   *
   * Shared, because the keyboard is no longer the only thing that produces
   * one: the touch controls below feed the same function, so a phone and a
   * keyboard are indistinguishable by the time the simulation sees them.
   */
  const sendInput = useCallback(
    (next: Input) => {
      const prev = myInputRef.current;
      if (
        prev.up === next.up &&
        prev.down === next.down &&
        prev.left === next.left &&
        prev.right === next.right &&
        prev.kick === next.kick
      ) {
        return;
      }
      myInputRef.current = next;

      if (isHost) {
        inputsRef.current.set(me, next);
      } else {
        void channelRef.current?.send({
          type: 'broadcast',
          event: 'input',
          payload: { id: me, input: next },
        });
      }
    },
    [isHost, me],
  );

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
      sendInput({ ...myInputRef.current, [key]: down });
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
  }, [state.phase, iAmPlaying, sendInput]);

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
  // Everything the reporter needs, kept somewhere it can be read without being
  // depended on. This is the whole reason the fix below works: `state` and
  // `onPitch` are rebuilt on every render, so an effect that lists them tears
  // its interval down and starts a new one every time anything re-renders.
  // The charge meter re-renders ten times a second, so a 400ms interval never
  // survived long enough to fire once -- the host never reported a result, the
  // game never left the pitch, and no Haxball match has ever paid a rating.
  const liveRef = useRef({ state, onPitch, award });
  liveRef.current = { state, onPitch, award };

  useEffect(() => {
    if (!isHost || state.phase !== 'playing' || state.practice) return;
    const id = window.setInterval(() => {
      const w = worldRef.current;
      if (!w || !w.finished) return;
      // Let the goal that won it finish playing first. The result screen
      // cutting in over the celebration is how the winning goal ended up being
      // the one goal of the match nobody got to watch.
      if (w.celebrating > 0) return;

      const { state: live, onPitch: seats, award: pay } = liveRef.current;
      if (reportedRef.current === live.series.match) return;
      reportedRef.current = live.series.match;

      const wins = { ...live.series.wins };
      if (w.winner === 0) wins.red++;
      else if (w.winner === 1) wins.blue++;

      void setState(
        session.id,
        {
          ...live,
          phase: 'result',
          lastResult: { red: w.score.red, blue: w.score.blue, winner: w.winner ?? -1 },
          series: { ...live.series, wins },
        },
        'active',
      ).catch(() => {
        // A dropped write would otherwise strand the match on the pitch for
        // good, since the marker above says it has already been dealt with.
        reportedRef.current = -1;
      });

      // Rate the match. Everyone on the pitch is scored against the other
      // side; goals they were part of pay the per-score bonus. Only the host
      // reports, and the database refuses a second report for this round.
      if (countsForRating(seats, live.bots)) {
        void pay(session.id, matchOutcomes(seats, w.winner, w.score), live.series.match);
      }
    }, 400);
    return () => window.clearInterval(id);
  }, [isHost, state.phase, state.practice, session.id]);

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
        for (const kind of EFFECT_KINDS) {
          if (mine.buffs[kind] > 0) carried.push({ kind, left: Math.ceil(mine.buffs[kind] / 60) });
        }
        if (mine.teleports > 0) carried.push({ kind: 'teleport', left: mine.teleports });
        // A fresh array is never equal to the last one, so setting it
        // unconditionally re-rendered the whole game ten times a second for
        // the entire match, whether or not anything had changed.
        setMyBuffs((prev) => (sameBuffs(prev, carried) ? prev : carried));
      } else {
        setMyBuffs((prev) => (prev.length === 0 ? prev : []));
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
          // Trimmed by how far back it reaches rather than by how many entries
          // it holds. A watching client only records every other tick, so a
          // fixed entry count is a different length of football on every
          // screen -- and that is what the replay was being paced against.
          const oldest = w.tick - TAPE_TICKS;
          while (tape.length > 1 && tape[0].t < oldest) tape.shift();
        }
      }

      // Freeze the tape the instant a goal goes in. The whole of it: how much
      // is actually shown, and how fast, is worked out in planReplay from the
      // time the replay has been given, not guessed at here.
      if (w.celebrating > 0 && clipRef.current.length === 0 && tapeRef.current.length > 12) {
        clipRef.current = tapeRef.current.slice();
      } else if (w.celebrating === 0) {
        clipRef.current = [];
        replayCamRef.current = { x: 0, y: 0 };
        // Play restarts from behind a countdown, so anything on the tape from
        // before it belongs to a different passage of play. Left there, a
        // quick goal's run-up reaches back over the restart and opens the
        // replay with everybody teleporting to the centre circle.
        if (w.countdown > 0 && tapeRef.current.length) tapeRef.current = [];
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

      const cosmetics = { trail: trailRef.current, equippedOf };

      // A goal is a short film rather than a banner: hold on the scorer, run
      // the replay, then fade out into the restart.
      if (w.celebrating > 0) {
        drawGoalSequence(ctx, w, me, profiles, cosmetics, {
          clip: clipRef.current,
          replayWorld: replayWorldRef.current,
          // The length the rules say, not the first value this screen
          // happened to observe. A watching client hears about a goal a few
          // ticks late — and a backgrounded tab, whose animation frames are
          // paused, hears about it a long way in — so measuring the sequence
          // from what it first saw squeezed the whole thing into whatever was
          // left, which is a celebration playing fast for no visible reason.
          total: w.rules.celebrationTicks || CELEBRATION_TICKS,
          camera: replayCamRef.current,
        });
        return;
      }

      // A full-power strike, a quake or a meteor moves the camera rather than
      // the pitch, so everything on screen agrees about being shaken. Only
      // during live play: the goal sequence has letterbox bars pinned to the
      // edges of the canvas, and shifting those leaves a strip of the last
      // frame showing down one side.
      //
      // Scaled as well as shifted, and by enough to cover the shift, because
      // the pitch is painted from the origin — nudge it without growing it
      // and the far edge stops being painted at all.
      const shake = shakeAmount(w);
      ctx.save();
      if (shake > 0) {
        const grow = 1 + shake / w.pitch.w + shake / w.pitch.h;
        ctx.translate(w.pitch.w / 2, w.pitch.h / 2);
        ctx.scale(grow, grow);
        ctx.translate(-w.pitch.w / 2, -w.pitch.h / 2);
        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      }

      drawPitch(ctx, w, me, profiles, cosmetics);

      // Play restarts behind its own countdown, so dim the pitch under it.
      if (w.countdown > 0) {
        ctx.fillStyle = 'rgba(6, 8, 12, 0.35)';
        ctx.fillRect(0, 0, w.pitch.w, w.pitch.h);
      }
      ctx.restore();
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
          {!countsForRating(onPitch, state.bots) && (
            <div className="row-sub" style={{ marginTop: 6 }}>
              {state.bots.red + state.bots.blue > 0
                ? 'Computer players on the pitch, so this one is not rated.'
                : 'Both sides need a person on them for this to be rated.'}
            </div>
          )}
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
              : `FIRST TO ${rules.scoreLimit || '∞'}`}
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
            No clock, no score, nothing rated, and a short celebration. The
            room's own settings are untouched.
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
            {myCharge >= FULL_POWER ? 'Full power — let go!' : 'Shot power — keep the ball to build it'}
          </div>
          <div className="timer-bar" style={{ width: '100%', height: 10 }}>
            <div
              className="timer-fill"
              data-full={myCharge >= FULL_POWER}
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

      {iAmPlaying && <TouchControls onInput={sendInput} current={myInputRef} />}

      <div
        className="hax-hints"
        style={{ fontSize: 12.5, color: 'var(--ink-faint)', textAlign: 'center', lineHeight: 1.6, maxWidth: 560 }}
      >
        <b>WASD</b> or arrows to move · <b>Space</b> kicks, and the longer the ball
        stays at your feet the harder it goes
        <br />
        The meter fills whenever the ball is yours — standing still is fine.
        Run into the net if you want; the ball is the only thing that has to
        stay on the pitch.
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

/**
 * A thumbstick and a kick pad, for playing on a phone.
 *
 * The stick reports the same four booleans the arrow keys do rather than an
 * analogue direction, so nothing downstream has to know it exists — and a
 * touch player is neither advantaged nor held back by the control they chose.
 * Hidden on anything with a fine pointer; see `.touch-controls` in the CSS.
 */
function TouchControls({
  onInput,
  current,
}: {
  onInput: (next: Input) => void;
  current: React.MutableRefObject<Input>;
}) {
  const stickRef = useRef<HTMLDivElement>(null);
  const [nub, setNub] = useState({ x: 0, y: 0 });
  const [kicking, setKicking] = useState(false);

  /** Where the thumb is relative to the middle, as a direction plus the nub. */
  const aim = (e: React.PointerEvent) => {
    const box = stickRef.current?.getBoundingClientRect();
    if (!box) return;

    const radius = box.width / 2;
    let dx = e.clientX - (box.left + radius);
    let dy = e.clientY - (box.top + radius);
    const dist = Math.hypot(dx, dy);
    if (dist > radius) {
      dx = (dx / dist) * radius;
      dy = (dy / dist) * radius;
    }
    setNub({ x: dx, y: dy });

    // A generous dead zone: a thumb resting on the stick should not walk.
    const dead = radius * 0.22;
    onInput({
      ...current.current,
      left: dx < -dead,
      right: dx > dead,
      up: dy < -dead,
      down: dy > dead,
    });
  };

  const release = () => {
    setNub({ x: 0, y: 0 });
    onInput({ ...current.current, up: false, down: false, left: false, right: false });
  };

  const kick = (down: boolean) => {
    setKicking(down);
    onInput({ ...current.current, kick: down });
  };

  return (
    <div className="touch-controls">
      <div
        ref={stickRef}
        className="touch-stick"
        role="application"
        aria-label="Move"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          aim(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) aim(e);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div
          className="touch-nub"
          style={{ transform: `translate(${nub.x}px, ${nub.y}px)` }}
        />
      </div>

      <button
        className="touch-kick"
        type="button"
        data-down={kicking}
        aria-label="Kick"
        onPointerDown={(e) => {
          e.preventDefault();
          kick(true);
        }}
        onPointerUp={() => kick(false)}
        onPointerCancel={() => kick(false)}
        onPointerLeave={() => kick(false)}
      >
        Kick
      </button>
    </div>
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

  /** Swap in a whole mode. Everything it does not mention is left alone. */
  const pickMode = (id: string) => patchRules(modeById(id).rules);

  /**
   * An empty pitch and a ball. No clock, no score limit, and a goal resets
   * almost immediately instead of playing the full film.
   */
  const startPractice = async () => {
    await setTeam(session.id, me, 0);
    // The rules are left exactly as the host set them: `effectiveRules` makes
    // the practice-only changes at the point the world is built, so a knockabout
    // cannot quietly leave the room on a two-second goal sequence.
    await setState(
      session.id,
      {
        ...state,
        phase: 'playing',
        practice: true,
        bots: { red: 0, blue: 0 },
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
            <div className="label" style={{ padding: '0 0 10px' }}>How you want to play</div>
            <div className="mode-grid">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className="mode-card"
                  data-on={modeOf(state.rules) === mode.id}
                  onClick={() => pickMode(mode.id)}
                >
                  <b>{mode.name}</b>
                  <span>{mode.blurb}</span>
                </button>
              ))}
            </div>
            <p className="row-sub" style={{ margin: '8px 0 14px' }}>
              {modeOf(state.rules) === 'custom'
                ? 'Custom — you have changed something by hand. Pick a mode above to start over.'
                : 'A mode is only a shortcut for the settings below; change any of them and it becomes custom.'}
            </p>

            <div className="label" style={{ padding: '4px 0 10px' }}>Match settings</div>

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
                {/* The options come from the same table the default does, so a
                    room on the default no longer shows the first option — it
                    used to say Slow on every fresh room. */}
                <select
                  className="select"
                  value={String(state.rules.chargeRate)}
                  onChange={(e) => patchRules({ chargeRate: Number(e.target.value) })}
                >
                  {Object.entries(CHARGE_PRESETS).map(([name, v]) => (
                    <option key={name} value={v}>
                      {name} — {(1 / v / 60).toFixed(1)}s to full
                    </option>
                  ))}
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

            <div className="two-col">
              <Setting label="Weather">
                <select
                  className="select"
                  value={state.rules.weather}
                  onChange={(e) => patchRules({ weather: e.target.value as Weather })}
                >
                  {WEATHER_KINDS.map((k) => (
                    <option key={k} value={k}>{WEATHER[k].label}</option>
                  ))}
                </select>
              </Setting>

              <Setting label="Catastrophes">
                <select
                  className="select"
                  value={state.rules.events ? 'on' : 'off'}
                  onChange={(e) => patchRules({ events: e.target.value === 'on' })}
                >
                  <option value="off">Off — nothing goes wrong</option>
                  <option value="on">On — something every 15s or so</option>
                </select>
              </Setting>

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

              <Setting label="Curses in the mix">
                <select
                  className="select"
                  value={state.rules.curses ? 'on' : 'off'}
                  disabled={!state.rules.powerUps}
                  onChange={(e) => patchRules({ curses: e.target.value === 'on' })}
                >
                  <option value="off">Off — every orb is a present</option>
                  <option value="on">On — about one in four bites</option>
                </select>
              </Setting>
            </div>

            <p className="row-sub" style={{ margin: '-4px 0 10px' }}>
              {WEATHER[state.rules.weather]?.blurb} Orbs: speed, shot power and
              control turn up often; aim and teleport are rare. With curses on,
              some of them leave you leaden, reversed, butter-fingered or
              half-blind instead.
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
}

/**
 * One live frame of the match.
 *
 * Exported for the sake of a smoke test rather than for reuse: this is the
 * only code in the game that can throw on a combination of weather, event and
 * cosmetic nobody happened to try, and a canvas that throws mid-frame stops
 * the render loop dead for whoever hit it.
 */
export function drawPitch(
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

  // The ground the stadium is built on, then the grass on top of it. The
  // surround is real space now: goals stand in it, players can run round the
  // back of the net, and the boards live along its edge.
  drawStadium(ctx, w);

  ctx.fillStyle = '#1b3a25';
  ctx.fillRect(left, top, right - left, bottom - top);
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

  // Goals: netting behind a coloured frame, and the mouth left open so a
  // player can run straight into it.
  for (const side of [0, 1]) {
    const x = side === 0 ? left : right;
    const dir = side === 0 ? -1 : 1;
    const depth = p.goalDepth;

    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.min(x, x + dir * depth), goalTop, depth, goalBottom - goalTop);
    ctx.clip();
    ctx.fillStyle = 'rgba(8, 12, 16, 0.5)';
    ctx.fillRect(Math.min(x, x + dir * depth), goalTop, depth, goalBottom - goalTop);
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

    // Only the back and the sides of the net are a line; the front is the
    // mouth, and drawing a line across it was half of what made the goal
    // look like a box you could not go into.
    ctx.strokeStyle = TEAM_COLOR[side];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, goalTop);
    ctx.lineTo(x + dir * depth, goalTop);
    ctx.lineTo(x + dir * depth, goalBottom);
    ctx.lineTo(x, goalBottom);
    ctx.stroke();
  }

  // The posts themselves, which the ball genuinely bounces off — they are
  // discs in the simulation, so they are drawn as discs here.
  for (const post of posts(p)) {
    ctx.beginPath();
    ctx.arc(post.x, post.y + 2, POST_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    const g = ctx.createRadialGradient(
      post.x - POST_R * 0.4,
      post.y - POST_R * 0.4,
      1,
      post.x,
      post.y,
      POST_R,
    );
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#b9bfc8');
    ctx.beginPath();
    ctx.arc(post.x, post.y, POST_R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
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

    // A country goes on the player, because a player is the one thing on the
    // pitch that stays the same person all match. Worn on the ball it changed
    // hands with possession and told you nothing about anybody.
    const wearing = cosmetics ? paintFlagDisc(ctx, pl.x, pl.y, PLAYER_R, flagCodeOf(cosmetics.equippedOf(pl.id).flag ?? '')) : false;

    ctx.beginPath();
    ctx.arc(pl.x, pl.y, PLAYER_R, 0, Math.PI * 2);

    if (wearing) {
      // The flag is the fill, so intent has to be shown some other way: a
      // wash of the team colour that lifts when the kick key goes down.
      ctx.fillStyle = withAlpha(base, pl.kickHeld ? 0.08 : 0.28);
      ctx.fill();
      if (pl.kickHeld) {
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fill();
      }
    } else {
      const g = ctx.createRadialGradient(pl.x - 4, pl.y - 5, 2, pl.x, pl.y, PLAYER_R);
      // Holding the kick key pales the disc, which is how you read intent from
      // across the pitch without any text.
      g.addColorStop(0, lighten(base, pl.kickHeld ? 130 : 60));
      g.addColorStop(1, pl.kickHeld ? lighten(base, 80) : base);
      ctx.fillStyle = g;
      ctx.fill();
    }

    const cursed =
      pl.buffs.slow > 0 || pl.buffs.reverse > 0 || pl.buffs.butter > 0 || pl.buffs.blind > 0;

    // Which side someone is on must survive whatever they are wearing, so a
    // flag gets a heavier ring in the team colour rather than a thin dark one.
    if (wearing) {
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = cursed ? '#b06bff' : base;
      ctx.stroke();
      if (pl.id === me) {
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, PLAYER_R + 2.4, 0, Math.PI * 2);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = pl.id === me ? 3 : 2;
      ctx.strokeStyle = cursed ? '#b06bff' : pl.id === me ? '#ffffff' : 'rgba(0,0,0,0.45)';
      ctx.stroke();
    }

    // Charge ring: fills clockwise as the shot builds.
    if (pl.charge > 0.01) {
      ctx.beginPath();
      ctx.arc(pl.x, pl.y, PLAYER_R + 5, -Math.PI / 2, -Math.PI / 2 + pl.charge * Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = pl.charge > 0.85 ? '#f0b429' : 'rgba(255,255,255,0.85)';
      ctx.stroke();
    }

    // Wound all the way up and not yet let go: sparks, so a shot that is
    // ready to go says so without anybody having to watch the meter.
    if (pl.charge >= FULL_POWER) paintChargeSparks(ctx, pl.x, pl.y, w.tick);

    // Initials inside the disc, so a crowded box is still readable when the
    // names above everyone overlap.
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Over a flag the initials need their own backing, because a flag can be
    // any colour at all underneath them.
    if (wearing) {
      shadowed(
        ctx,
        () => {
          ctx.fillStyle = '#ffffff';
          ctx.fillText(initials(name), pl.x, pl.y + 0.5);
        },
        4,
      );
    } else {
      ctx.fillStyle = pl.kickHeld ? 'rgba(30,20,20,0.85)' : 'rgba(255,255,255,0.92)';
      ctx.fillText(initials(name), pl.x, pl.y + 0.5);
    }
    ctx.textBaseline = 'alphabetic';

    if (name) {
      ctx.font = '600 11px system-ui, sans-serif';
      // Over grass, over netting, over a whiteout: a name needs something
      // behind it or it is only legible half the time.
      shadowed(ctx, () => {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(name, pl.x, pl.y - PLAYER_R - 9);
      });
    }

    // What they are carrying, as small pips under the disc.
    const carried: string[] = EFFECT_KINDS.filter((kind) => pl.buffs[kind] > 0);
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

  // Anything on the pitch that is neither a player nor the ball.
  drawIntruders(ctx, w);

  // Weather and whatever catastrophe is running sit over the pitch and under
  // the text, so the pitch stays readable through them.
  drawWeather(ctx, w);
  drawEvent(ctx, w);
  drawBlindness(ctx, w, me);

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
    shadowed(ctx, () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(secondsLeft > 0 ? String(secondsLeft) : 'GO', 0, 30);
    });
    ctx.restore();

    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    shadowed(ctx, () => {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('Get to your side', midX, midY + 76);
    });
  }
}

/* ------------------------------------------------- the stadium around it -- */

/** Boards behind the goals and along the touchlines, changing as you play. */
const ADVERTS: { text: string; bg: string; ink: string }[] = [
  { text: 'NEINCOMMZ · PLAY NICELY', bg: '#1b2a4a', ink: '#cfe0ff' },
  { text: 'SHOT POWER SOLD SEPARATELY', bg: '#3a1b1b', ink: '#ffd3cf' },
  { text: 'MIND THE POSTS', bg: '#123527', ink: '#c9f4de' },
  { text: 'NO REFUNDS ON OWN GOALS', bg: '#2d2410', ink: '#ffe9b8' },
  { text: 'THE KEEPER IS ALSO A STRIKER', bg: '#22163a', ink: '#e2d2ff' },
  { text: 'WEATHER PERMITTING', bg: '#0f2c3a', ink: '#c8ecff' },
  { text: 'BRING BACK THE BOUNCE', bg: '#341f2e', ink: '#ffd0ec' },
  { text: 'ORBS: READ BEFORE YOU RUN', bg: '#16301b', ink: '#d4f7c5' },
  { text: 'SUPPORT YOUR LOCAL DEFENDER', bg: '#2a2118', ink: '#f6ddc0' },
  { text: 'SLOW MOTION AVAILABLE ON REQUEST', bg: '#1a2436', ink: '#d6e4ff' },
];

/** How long each advert holds before the boards flip. */
const ADVERT_TICKS = 60 * 6;

/**
 * The ground, the stands and the boards.
 *
 * Painted across the whole canvas before anything else — which is also what
 * stops the replay camera smearing the goal when it looks past the touchline.
 * There is something out there to look at now.
 */
function drawStadium(ctx: CanvasRenderingContext2D, w: World): void {
  const p = w.pitch;
  const { left, right, top, bottom } = bounds(p);

  // The margin is the goal plus the surround; the surround is what there is
  // to build a stadium in, and every band below is a fraction of it so the
  // three pitch sizes all look like the same ground.
  const room = SURROUND;
  const crowd = room * 0.52;
  const boardW = room * 0.18;
  const apron = room * 0.44;

  ctx.fillStyle = '#0d1116';
  ctx.fillRect(0, 0, p.w, p.h);

  // Terracing, and a crowd on it.
  //
  // Drawn as people rather than as a texture, because a stand full of nobody
  // reads as a border. Each one has its own phase, so the stand ripples
  // instead of pulsing in time, and they all get up when a goal goes in.
  const excited = w.celebrating > 0 ? 1 : w.countdown > 0 ? 0.35 : 0;
  const bounce = 1.4 + excited * 7;

  for (let row = 0; row < 3; row++) {
    const inset = 5 + row * (crowd / 3);
    ctx.fillStyle = `rgba(255,255,255,${0.05 + row * 0.02})`;
    ctx.fillRect(inset - 4, inset - 4, p.w - (inset - 4) * 2, crowd / 3);
    ctx.fillRect(inset - 4, p.h - inset - crowd / 3 + 4, p.w - (inset - 4) * 2, crowd / 3);
  }

  // One walk along all four sides per row, so the corners fill in naturally.
  const spacing = 12;
  for (let row = 0; row < 3; row++) {
    const depth = 7 + row * (crowd / 3);
    const backRow = row * 0.18;

    for (let side = 0; side < 4; side++) {
      const vertical = side > 1;
      const span = vertical ? p.h : p.w;
      const count = Math.floor(span / spacing);

      for (let i = 0; i < count; i++) {
        // A fixed pseudo-random per seat: colour, phase and a little jitter,
        // none of which may change from frame to frame or the crowd crawls.
        const seed = side * 977 + row * 313 + i * 37;
        const r1 = fixedRandom(seed);
        const r2 = fixedRandom(seed + 1);
        if (r1 > 0.94) continue; // a few empty seats

        const along = i * spacing + spacing / 2 + (r2 - 0.5) * 4;
        const hop = Math.abs(Math.sin(w.tick / 9 + seed)) * bounce * (1 - backRow);

        const x = vertical ? (side === 2 ? depth : p.w - depth) : along;
        const y = vertical ? along : side === 0 ? depth : p.h - depth;
        // Everyone jumps away from the pitch edge they are standing at.
        const lift = vertical ? 0 : side === 0 ? -hop : hop;
        const liftX = vertical ? (side === 2 ? -hop : hop) : 0;

        paintSpectator(ctx, x + liftX, y + lift, r1, r2, 0.55 - backRow);
      }
    }
  }

  // The apron between the crowd and the grass.
  ctx.fillStyle = '#17202a';
  ctx.fillRect(
    p.pad - p.goalDepth - apron,
    p.pad - p.goalDepth - apron,
    p.w - (p.pad - p.goalDepth - apron) * 2,
    p.h - (p.pad - p.goalDepth - apron) * 2,
  );

  const slot = Math.floor(w.tick / ADVERT_TICKS);
  // Part-way into a slot the boards are mid-flip, which is what the real ones
  // do and costs one cosine.
  const into = (w.tick % ADVERT_TICKS) / ADVERT_TICKS;
  const flip = into < 0.07 ? Math.abs(Math.cos(into * Math.PI * 7)) : 1;

  const board = (
    cx: number,
    cy: number,
    length: number,
    turned: boolean,
    index: number,
  ): void => {
    const ad = ADVERTS[index % ADVERTS.length];
    ctx.save();
    ctx.translate(cx, cy);
    if (turned) ctx.rotate(Math.PI / 2);
    // The flip squashes the board about its own long axis.
    ctx.scale(1, Math.max(0.06, flip));

    ctx.fillStyle = ad.bg;
    ctx.fillRect(-length / 2, -boardW / 2, length, boardW);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-length / 2, -boardW / 2, length, boardW);

    if (flip > 0.5) {
      ctx.font = `700 ${Math.max(7, boardW * 0.62)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ad.ink;
      ctx.fillText(ad.text, 0, 0.5, length - 8);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  };

  // Along each touchline, just outside the grass.
  const sideLength = right - left + boardW * 2;
  board(p.w / 2, top - boardW, sideLength, false, slot);
  board(p.w / 2, bottom + boardW, sideLength, false, slot + 1);

  // And behind each goal, in the space that used not to exist at all. `left`
  // less the depth of the net is the back of it; the board sits behind that.
  const backLeft = left - p.goalDepth;
  const backRight = right + p.goalDepth;
  const endLength = p.goalHeight + boardW * 2;
  board(backLeft - boardW, p.h / 2, endLength, true, slot + 2);
  board(backRight + boardW, p.h / 2, endLength, true, slot + 3);
}


/** A fixed pseudo-random in 0..1. The same seat gets the same person for ever. */
function fixedRandom(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** One person in the stand: a head, a body, and a shirt somebody chose. */
function paintSpectator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r1: number,
  r2: number,
  alpha: number,
): void {
  // Shirts lean towards the two team colours, because a real stand does.
  const hue = r2 < 0.42 ? 4 + r1 * 14 : r2 < 0.84 ? 205 + r1 * 20 : r1 * 360;
  ctx.fillStyle = `hsla(${hue} ${50 + r1 * 30}% ${48 + r2 * 18}% / ${alpha})`;
  ctx.fillRect(x - 2.5, y - 1, 5, 6);

  ctx.beginPath();
  ctx.arc(x, y - 3.2, 2.1, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(30 ${28 + r2 * 20}% ${34 + r1 * 34}% / ${alpha + 0.15})`;
  ctx.fill();
}

/* --------------------------------------------------- weather + disasters -- */

/**
 * Rain, snow, fog and the rest.
 *
 * Every one of these is drawn from the world tick rather than from a particle
 * list, so a watching client and the host see the same sky without a byte of
 * it crossing the wire.
 */
function drawWeather(ctx: CanvasRenderingContext2D, w: World): void {
  const kind = w.rules.weather;
  if (!kind || kind === 'clear') return;
  const p = w.pitch;
  const t = w.tick;
  // How much of the pitch this sky is entitled to hide. One number, declared
  // next to the physics it comes with, rather than an alpha in each branch.
  const murk = WEATHER[kind]?.murk ?? 0;

  ctx.save();
  switch (kind) {
    case 'rain':
    case 'storm': {
      ctx.strokeStyle = 'rgba(180, 210, 255, 0.4)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 160; i++) {
        const x = (i * 97 + t * 6) % p.w;
        const y = (i * 53 + t * 17) % p.h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + 11);
        ctx.stroke();
      }
      ctx.fillStyle = withAlpha('#0a121e', murk * 0.55);
      ctx.fillRect(0, 0, p.w, p.h);
      if (kind === 'storm' && t % 190 < 5) {
        // A flash, which is all a lightning strike needs to be.
        ctx.fillStyle = `rgba(255,255,255,${0.42 - (t % 190) * 0.08})`;
        ctx.fillRect(0, 0, p.w, p.h);
      }
      break;
    }
    case 'snow': {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 130; i++) {
        const drift = Math.sin((t + i * 30) / 45) * 14;
        const x = (i * 71 + drift + t * 0.6) % p.w;
        const y = (i * 41 + t * 1.5) % p.h;
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + (i % 3) * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = withAlpha('#dcebff', murk * 0.5);
      ctx.fillRect(0, 0, p.w, p.h);
      break;
    }
    case 'wind': {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 24; i++) {
        const y = (i * 137 + Math.sin(t / 90 + i) * 20) % p.h;
        const x = (t * 3 + i * 211) % (p.w + 160) - 80;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 54, y + Math.sin(t / 60 + i) * 5);
        ctx.stroke();
      }
      break;
    }
    case 'fog': {
      // Banks of cloud rolling across, rather than a flat grey wash — a flat
      // one just looks like the brightness is wrong.
      for (let i = 0; i < 7; i++) {
        const x = ((t * 0.5 + i * 260) % (p.w + 400)) - 200;
        const y = p.h * ((i * 0.17) % 1);
        const g = ctx.createRadialGradient(x, y, 10, x, y, 190);
        g.addColorStop(0, 'rgba(210, 220, 232, 0.4)');
        g.addColorStop(1, 'rgba(210, 220, 232, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 200, y - 200, 400, 400);
      }
      ctx.fillStyle = withAlpha('#cdd7e4', murk * 0.36);
      ctx.fillRect(0, 0, p.w, p.h);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** Whatever catastrophe is running, drawn over the pitch. */
function drawEvent(ctx: CanvasRenderingContext2D, w: World): void {
  const ev = w.event;
  if (!ev) return;
  const p = w.pitch;
  const through = 1 - ev.ticks / Math.max(1, ev.total);
  // Fade in and out, so an event never snaps on at full strength.
  const strength = Math.min(1, Math.min(through, 1 - through) * 8);

  ctx.save();
  switch (ev.kind) {
    case 'blackout': {
      ctx.fillStyle = `rgba(2, 3, 6, ${0.82 * strength})`;
      ctx.fillRect(0, 0, p.w, p.h);
      // One failing floodlight still flickering in the corner.
      const flicker = 0.25 + Math.abs(Math.sin(w.tick / 5)) * 0.35;
      const g = ctx.createRadialGradient(p.w * 0.5, p.h * 0.5, 10, p.w * 0.5, p.h * 0.5, p.w * 0.4);
      g.addColorStop(0, `rgba(255, 244, 214, ${0.2 * flicker * strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, p.w, p.h);
      break;
    }
    case 'sirens': {
      // Blue and red washing across, alternating.
      const beat = Math.sin(w.tick / 11);
      ctx.fillStyle = withAlpha(beat > 0 ? '#4a9de0' : '#e0574f', 0.16 * strength * Math.abs(beat));
      ctx.fillRect(0, 0, p.w, p.h);
      break;
    }
    case 'magnet': {
      // Field lines converging on the ball.
      ctx.strokeStyle = withAlpha('#9fd8ff', 0.3 * strength);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + w.tick / 60;
        const r1 = 34 + ((w.tick * 1.6 + i * 9) % 60);
        ctx.beginPath();
        ctx.arc(w.ball.x, w.ball.y, r1, a, a + 0.5);
        ctx.stroke();
      }
      break;
    }
    case 'lowgrav':
    case 'icerink': {
      ctx.fillStyle = withAlpha(ev.kind === 'icerink' ? '#bfe9ff' : '#c0b4ff', 0.1 * strength);
      ctx.fillRect(0, 0, p.w, p.h);
      break;
    }
    case 'quake': {
      // Cracks radiating from the epicentre, which the shake is centred on too.
      ctx.strokeStyle = withAlpha('#14100c', 0.6 * strength);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + ev.x;
        ctx.beginPath();
        ctx.moveTo(ev.x, ev.y);
        let x = ev.x;
        let y = ev.y;
        for (let k = 1; k <= 5; k++) {
          x += Math.cos(a + Math.sin(i * k) * 0.5) * 34;
          y += Math.sin(a + Math.sin(i * k) * 0.5) * 34;
          ctx.lineTo(x, y);
        }
        ctx.lineWidth = 4 * strength + 0.5;
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();

  // Every event announces itself, because an unexplained rule change is just
  // a bug as far as anyone playing is concerned.
  if (through < 0.22) {
    const profile = EVENTS[ev.kind];
    const rise = Math.min(1, through / 0.06) * Math.min(1, (0.22 - through) / 0.05);
    ctx.save();
    ctx.globalAlpha = Math.max(0, rise);
    ctx.textAlign = 'center';
    ctx.font = '800 26px system-ui, sans-serif';
    shadowed(ctx, () => {
      ctx.fillStyle = '#ffd36e';
      ctx.fillText(profile.label.toUpperCase(), p.w / 2, p.h * 0.28);
    });
    ctx.font = '600 13px system-ui, sans-serif';
    shadowed(ctx, () => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(profile.blurb, p.w / 2, p.h * 0.28 + 22);
    });
    ctx.restore();
  }
}

/** Pitch invaders and meteors. */
function drawIntruders(ctx: CanvasRenderingContext2D, w: World): void {
  for (const it of w.intruders) {
    if (it.kind === 0) {
      ctx.beginPath();
      ctx.arc(it.x, it.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#c9a227';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', it.x, it.y + 0.5);
      ctx.textBaseline = 'alphabetic';
      continue;
    }

    // A meteor: a shadow that closes up, then the impact ring.
    if (it.ttl > 30) {
      const fall = 1 - (it.ttl - 30) / 60;
      ctx.beginPath();
      ctx.arc(it.x, it.y, 46 * (1 - fall * 0.65), 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha('#ff963c', 0.35 + fall * 0.5);
      ctx.lineWidth = 2 + fall * 3;
      ctx.stroke();

      const h = 240 * (1 - fall);
      ctx.beginPath();
      ctx.moveTo(it.x - h * 0.4, it.y - h);
      ctx.lineTo(it.x, it.y);
      ctx.strokeStyle = withAlpha('#ffb450', 0.8);
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      const boom = 1 - it.ttl / 30;
      ctx.beginPath();
      ctx.arc(it.x, it.y, 40 + boom * 90, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha('#ff963c', 1 - boom);
      ctx.lineWidth = 10 * (1 - boom);
      ctx.stroke();
    }
  }
}

/** The blind curse, which only darkens the screen of whoever is carrying it. */
function drawBlindness(ctx: CanvasRenderingContext2D, w: World, me: UUID): void {
  const mine = w.players.find((q) => q.id === me);
  if (!mine || mine.buffs.blind <= 0) return;
  const p = w.pitch;

  const g = ctx.createRadialGradient(mine.x, mine.y, 40, mine.x, mine.y, 190);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(2, 2, 6, 0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, p.w, p.h);
}

/* ----------------------------------------------------------- shot feel --- */

/** How long the picture shakes after a full-power strike. */
const SLAM_SHAKE_TICKS = 22;
const SLAM_SHAKE = 7;

/**
 * How hard the picture should be shaking this frame, in pixels.
 *
 * Driven by the world rather than by a local event, so everyone watching the
 * same match feels the same thump at the same moment.
 */
function shakeAmount(w: World): number {
  let amount = 0;

  const since = w.tick - w.slamTick;
  if (w.slamTick >= 0 && since >= 0 && since < SLAM_SHAKE_TICKS) {
    amount = SLAM_SHAKE * (1 - since / SLAM_SHAKE_TICKS);
  }
  if (w.event?.kind === 'quake') amount = Math.max(amount, 3.2);
  if (w.intruders.some((it) => it.kind === 1 && Math.abs(it.ttl - 30) < 7)) {
    amount = Math.max(amount, 6.5);
  }
  return amount;
}

/** Sparks off a player who has wound all the way up and not let go yet. */
function paintChargeSparks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tick: number,
): void {
  ctx.save();
  for (let i = 0; i < 9; i++) {
    // Each spark runs out from the disc on its own little clock.
    const life = ((tick * 2.4 + i * 17) % 40) / 40;
    const a = i * 2.3 + tick / 26;
    const dist = PLAYER_R + 4 + life * 20;
    const size = (1 - life) * 3.1;
    if (size <= 0.2) continue;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, size, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${38 + i * 4} 100% ${58 + life * 20}% / ${1 - life})`;
    ctx.fill();
  }

  // A hot rim, so it reads even when the sparks happen to be behind someone.
  ctx.beginPath();
  ctx.arc(x, y, PLAYER_R + 6.5 + Math.sin(tick / 4) * 1.2, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 210, 110, ${0.5 + Math.sin(tick / 5) * 0.25})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw text with something behind it.
 *
 * Canvas text sits directly on whatever was painted underneath, and the pitch
 * is not a background anyone chose: white-on-white happens over the snow,
 * over a whiteout goal effect, over the netting. A shadow is one line and it
 * makes every caption legible over all of them.
 */
function shadowed(ctx: CanvasRenderingContext2D, draw: () => void, blur = 6): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = 1;
  draw();
  // A second pass, because one shadow at this blur is too soft on its own to
  // separate small text from a busy background.
  ctx.shadowBlur = blur * 0.5;
  draw();
  ctx.restore();
}

/** A rounded plate to sit text on, for the captions that need more than a shadow. */
function plate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 0.55,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fillStyle = `rgba(6, 8, 12, ${alpha})`;
  ctx.fill();
  ctx.restore();
}

/* ======================================================= goal sequence ==== */

/**
 * The three acts, as fractions of the celebration, and how much they overlap.
 *
 * The overlap is the whole trick: each act is drawn over the one before it
 * with a rising alpha, so the picture never cuts and never dips to black. The
 * only darkening anywhere in the game belongs to the countdown.
 */
const MOMENT_END = 0.22;
const REPLAY_END = 0.92;
const CROSSFADE = 0.05;

/** How hard the replay camera chases the ball. Lower lags further behind. */
const CAMERA_EASE = 0.08;

/** Close enough to see the touch, wide enough to see it travel. */
const REPLAY_ZOOM = 1.3;

interface Tape {
  clip: Snapshot[];
  replayWorld: World | null;
  total: number;
  /** Where the replay camera has got to, carried between frames. */
  camera: { x: number; y: number };
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

  const line3 = goal?.ownGoal
    ? 'own goal'
    : goal?.assist
      ? `assist  ${nameFor(goal.assist, profiles)}`
      : 'unassisted';
  const who = nameFor(scorerId, profiles);

  ctx.save();
  ctx.globalAlpha *= Math.min(1, rise);
  ctx.textAlign = 'left';

  // A plate behind the whole card. The caption used to be bare text over the
  // grass, the netting and whatever the goal effect was doing, and over a
  // confetti burst or a whiteout it simply disappeared.
  const widest = Math.max(
    ...([
      ['800 54px system-ui, sans-serif', 'GOAL'],
      ['700 22px system-ui, sans-serif', who],
      ['600 14px system-ui, sans-serif', line3],
    ] as const).map(([font, text]) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    }),
  );
  plate(ctx, x - slide - 14, p.h * 0.45 - 52, widest + 28, 116, 0.5);

  ctx.font = '800 54px system-ui, sans-serif';
  shadowed(ctx, () => {
    ctx.fillStyle = goal ? TEAM_COLOR[goal.team] : '#ffffff';
    ctx.fillText('GOAL', x - slide, p.h * 0.45);
  }, 10);

  ctx.font = '700 22px system-ui, sans-serif';
  shadowed(ctx, () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillText(who, x - slide, p.h * 0.45 + 32);
  });

  ctx.font = '600 14px system-ui, sans-serif';
  shadowed(ctx, () => {
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(line3, x - slide, p.h * 0.45 + 54);
  });
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
      drawPitch(ctx, w, me, profiles, cosmetics);

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

          shadowed(ctx, () => {
            ctx.fillStyle = '#ffffff';
            ctx.fillText(shout, 0, 0);
          }, 4);
          ctx.restore();
        }
      }
    });

    letterbox(ctx, w, local / 0.3);
    goalCard(ctx, w, goal, scorerId, profiles, easeOut((local - 0.1) / 0.3));
    ctx.globalAlpha = 1;
  }

  // The bought image celebration, on the right, for the whole sequence rather
  // than for one act — it pops in, holds through the replay and fades out.
  if (scorerId && !goal?.ownGoal) {
    const kit = cosmetics.equippedOf(scorerId);
    paintBanner(
      kit.banner,
      kit.banneranim,
      ctx,
      p.w,
      p.h,
      t,
      w.tick,
      profiles.get(scorerId)?.accent_color ?? TEAM_COLOR[goal?.team ?? 0],
      nameFor(scorerId, profiles),
    );
  }

  /* -------------------------------------------------------- 2. the replay */
  if (aReplay > 0 && tape.clip.length > 1 && tape.replayWorld) {
    const local = Math.min(1, Math.max(0, (t - MOMENT_END) / (REPLAY_END - MOMENT_END)));
    const clip = tape.clip;

    // How long the replay actually has on screen, in seconds. Everything about
    // the pacing follows from this, so a practice game's short celebration
    // gets a shorter clip rather than the same clip at five times the speed.
    const seconds = ((REPLAY_END - MOMENT_END) * tape.total) / 60;
    const shotTick = goal?.shotTick ?? clip[clip.length - 1].t;
    const plan = planReplay(clip, shotTick, seconds);

    // A tick, blended between the two tape frames either side of it — stepping
    // whole frames at a third of speed is what made the slow motion judder.
    const { i, k } = sampleAt(clip, tickAt(local, plan));
    const rw = tape.replayWorld;
    blendInto(rw, clip[i], clip[i + 1], k);
    rw.celebrating = 0;
    rw.countdown = 0;
    rw.goal = null;

    // Follow the ball rather than being welded to it. Pinned exactly, at a
    // zoom, the ball sits dead still and the entire pitch tears past behind
    // it -- which looks like fast-forward however slowly the clip is actually
    // being played. Lagging the camera lets the ball move across the frame,
    // which is what reading speed on screen actually depends on.
    const cam = tape.camera;
    if (cam.x === 0 && cam.y === 0) {
      cam.x = rw.ball.x;
      cam.y = rw.ball.y;
    } else {
      cam.x += (rw.ball.x - cam.x) * CAMERA_EASE;
      cam.y += (rw.ball.y - cam.y) * CAMERA_EASE;
    }

    ctx.globalAlpha = aReplay;
    withCamera(ctx, p, { x: cam.x, y: cam.y }, REPLAY_ZOOM, p.w / 2, p.h / 2, () => {
      drawPitch(ctx, rw, me, profiles, { trail: [], equippedOf: cosmetics.equippedOf });
    });

    letterbox(ctx, w, 1);
    drawReplayBadge(ctx, p.w, local);

    const bar = p.h * 0.12;
    const baseline = p.h - bar * 0.42;
    ctx.save();
    ctx.textAlign = 'left';

    ctx.font = '700 15px system-ui, sans-serif';
    shadowed(ctx, () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(nameFor(scorerId, profiles), 18, baseline);
    });

    if (goal?.assist) {
      ctx.font = '600 13px system-ui, sans-serif';
      shadowed(ctx, () => {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(`assist ${nameFor(goal.assist, profiles)}`, 18, baseline + 17);
      });
    }

    ctx.textAlign = 'right';
    ctx.font = '700 16px system-ui, sans-serif';
    shadowed(ctx, () => {
      ctx.fillStyle = TEAM_COLOR[0];
      ctx.fillText(String(w.score.red), p.w - 46, baseline);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('–', p.w - 32, baseline);
      ctx.fillStyle = TEAM_COLOR[1];
      ctx.fillText(String(w.score.blue), p.w - 16, baseline);
    });
    ctx.restore();

    if (inSlowMotion(local, plan)) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '700 12px system-ui, sans-serif';
      const label = 'SLOW MOTION';
      const width = ctx.measureText(label).width;
      plate(ctx, p.w / 2 - width / 2 - 10, bar * 0.62 - 13, width + 20, 19, 0.5);
      shadowed(ctx, () => {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(label, p.w / 2, bar * 0.62);
      });
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------- 3. back to a live wide shot */
  if (aRestart > 0) {
    const local = Math.min(1, Math.max(0, (t - REPLAY_END) / (1 - REPLAY_END)));
    ctx.globalAlpha = aRestart;
    drawPitch(ctx, w, me, profiles, cosmetics);
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
  shadowed(ctx, () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillText('REPLAY', 48, 34);
  });

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
