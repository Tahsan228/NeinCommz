import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { GamePlayer, GameSession, Profile, UUID } from '../../../lib/types';
import {
  BALL_R,
  NO_INPUT,
  PITCH,
  PLAYER_R,
  applySnapshot,
  bounds,
  createWorld,
  snapshot,
  step,
  type Input,
  type Snapshot,
  type World,
} from './physics';

const TEAM_COLOR = ['#e0574f', '#4a9de0'];
const TICK_MS = 1000 / 60;
const BROADCAST_EVERY = 2; // every other tick -> ~30 snapshots/second

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const inputsRef = useRef<Map<string, Input>>(new Map());
  const myInputRef = useRef<Input>({ ...NO_INPUT });
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [score, setScore] = useState({ red: 0, blue: 0 });
  const [ready, setReady] = useState(false);

  const isHost = session.host_id === me;

  /* ------------------------------------------------------------- world -- */
  useEffect(() => {
    worldRef.current = createWorld(
      players.map((p) => ({ id: p.profile_id, team: (p.team % 2) as 0 | 1 })),
    );
    setReady(true);
  }, [players]);

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
      setScore({ ...w.score });
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
    const KEYS: Record<string, keyof Input> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      s: 'down',
      a: 'left',
      d: 'right',
      W: 'up',
      S: 'down',
      A: 'left',
      D: 'right',
      ' ': 'kick',
      x: 'kick',
      X: 'kick',
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
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [isHost, me]);

  /* -------------------------------------------------------- host loop --- */
  useEffect(() => {
    if (!isHost || !ready) return;
    let frame = 0;
    const id = window.setInterval(() => {
      const w = worldRef.current;
      if (!w) return;
      step(w, inputsRef.current);
      frame++;
      if (frame % BROADCAST_EVERY === 0) {
        void channelRef.current?.send({
          type: 'broadcast',
          event: 'state',
          payload: snapshot(w),
        });
      }
      if (w.score.red !== score.red || w.score.blue !== score.blue) setScore({ ...w.score });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [isHost, ready, score.red, score.blue]);

  /* ------------------------------------------------------------ render -- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      const w = worldRef.current;
      raf = requestAnimationFrame(draw);
      if (!w) return;

      const { left, right, top, bottom, goalTop, goalBottom } = bounds();

      // Pitch.
      const grass = ctx.createLinearGradient(0, 0, 0, PITCH.h);
      grass.addColorStop(0, '#1d3f28');
      grass.addColorStop(1, '#15301e');
      ctx.fillStyle = grass;
      ctx.fillRect(0, 0, PITCH.w, PITCH.h);

      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 2;
      ctx.strokeRect(left, top, right - left, bottom - top);

      ctx.beginPath();
      ctx.moveTo(PITCH.w / 2, top);
      ctx.lineTo(PITCH.w / 2, bottom);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(PITCH.w / 2, PITCH.h / 2, 62, 0, Math.PI * 2);
      ctx.stroke();

      // Goals.
      for (const side of [0, 1]) {
        const x = side === 0 ? left : right;
        const dir = side === 0 ? -1 : 1;
        ctx.strokeStyle = TEAM_COLOR[side];
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, goalTop);
        ctx.lineTo(x + dir * PITCH.goalDepth, goalTop);
        ctx.lineTo(x + dir * PITCH.goalDepth, goalBottom);
        ctx.lineTo(x, goalBottom);
        ctx.stroke();
      }

      // Players.
      for (const p of w.players) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(p.x - 4, p.y - 5, 2, p.x, p.y, PLAYER_R);
        g.addColorStop(0, lighten(TEAM_COLOR[p.team]));
        g.addColorStop(1, TEAM_COLOR[p.team]);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = p.id === me ? 3 : 2;
        ctx.strokeStyle = p.id === me ? '#ffffff' : 'rgba(0,0,0,0.45)';
        ctx.stroke();

        const name = profiles.get(p.id)?.display_name;
        if (name) {
          ctx.font = '600 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillText(name, p.x, p.y - PLAYER_R - 6);
        }
      }

      // Ball.
      ctx.beginPath();
      ctx.arc(w.ball.x, w.ball.y, BALL_R, 0, Math.PI * 2);
      const bg = ctx.createRadialGradient(w.ball.x - 3, w.ball.y - 3, 1, w.ball.x, w.ball.y, BALL_R);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(1, '#c9c9d2');
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();

      if (w.celebrating > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, PITCH.w, PITCH.h);
        ctx.font = '700 44px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = w.lastScorer === 0 ? TEAM_COLOR[0] : TEAM_COLOR[1];
        ctx.fillText('GOAL', PITCH.w / 2, PITCH.h / 2 + 14);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [me, profiles]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 30, fontWeight: 700 }}>
        <span style={{ color: TEAM_COLOR[0] }}>{score.red}</span>
        <span style={{ color: 'var(--ink-faint)', fontSize: 18 }}>–</span>
        <span style={{ color: TEAM_COLOR[1] }}>{score.blue}</span>
      </div>

      <div className="canvas-frame">
        <canvas ref={canvasRef} width={PITCH.w} height={PITCH.h} />
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', textAlign: 'center', lineHeight: 1.6 }}>
        <b>WASD</b> or arrows to move · <b>Space</b> to kick
        <br />
        {isHost
          ? 'You are hosting the match — if you leave, it ends.'
          : `${profiles.get(session.host_id)?.display_name ?? 'The host'} is running this match.`}
      </div>
    </>
  );
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 60);
  const g = Math.min(255, ((n >> 8) & 255) + 60);
  const b = Math.min(255, (n & 255) + 60);
  return `rgb(${r},${g},${b})`;
}
